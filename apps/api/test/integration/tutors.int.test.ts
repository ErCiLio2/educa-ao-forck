import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { adminHeaders as newAdmin, app, bearer, body, get, patch, post, registerUser } from './helpers';

// RF-TUT-01/02, RN-05, RNF-SEG-03
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

async function uploadFile(info: { url: string; fields: Record<string, string> }, data: Uint8Array, contentType: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(info.fields)) form.append(k, v);
  form.set('Content-Type', contentType);
  form.append('file', new Blob([data], { type: contentType }), 'f');
  return fetch(info.url, { method: 'POST', body: form });
}

const requestUpload = (token: string, type: string, contentType: string) =>
  post('/api/v1/tutors/profile/documents/upload-url', { type, contentType }, bearer(token));

describe('upload de documentos (bucket privado)', () => {
  it('mime não permitido para o tipo → 422', async () => {
    const t = await registerUser('TUTOR');
    await post('/api/v1/tutors/profile', { subjects: ['Física'] }, bearer(t.token));
    expect((await requestUpload(t.token, 'PASSPORT_PHOTO', 'application/pdf')).statusCode).toBe(422);
  });

  it('fluxo completo: upload, associação, URL assinada, bucket sem acesso anónimo', async () => {
    const t = await registerUser('TUTOR');
    await post('/api/v1/tutors/profile', { subjects: ['Física'] }, bearer(t.token));

    const info = body(await requestUpload(t.token, 'DIPLOMA', 'application/pdf'));
    expect(info.key).toMatch(/^tutors\/.+\/DIPLOMA\/.+\.pdf$/);
    const pdf = new TextEncoder().encode('%PDF-1.4 teste');
    expect((await uploadFile(info, pdf, 'application/pdf')).status).toBeLessThan(300);

    const sub = await patch('/api/v1/tutors/profile/documents', { diplomaKey: info.key }, bearer(t.token));
    expect(sub.statusCode).toBe(200);
    const profile = body(sub).profile;
    expect(profile.diplomaKey).toBeUndefined();

    const dl = await fetch(profile.documents.diploma);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toContain('%PDF');
    expect((await fetch(profile.documents.diploma.split('?')[0])).status).toBeGreaterThanOrEqual(400);
  });

  it('o storage impõe Content-Type e tamanho máximo', async () => {
    const t = await registerUser('TUTOR');
    await post('/api/v1/tutors/profile', { subjects: ['Física'] }, bearer(t.token));
    const wrongType = await uploadFile(body(await requestUpload(t.token, 'DIPLOMA', 'application/pdf')), new Uint8Array(10), 'image/png');
    expect(wrongType.status).toBeGreaterThanOrEqual(400);
    const tooBig = await uploadFile(body(await requestUpload(t.token, 'PASSPORT_PHOTO', 'image/png')), new Uint8Array(6 * 1024 * 1024), 'image/png');
    expect(tooBig.status).toBeGreaterThanOrEqual(400);
  });

  it('chaves de outro tutor, inexistentes ou de outro tipo → 422', async () => {
    const a = await registerUser('TUTOR');
    const b = await registerUser('TUTOR');
    for (const t of [a, b]) await post('/api/v1/tutors/profile', { subjects: ['X'] }, bearer(t.token));
    const info = body(await requestUpload(a.token, 'DIPLOMA', 'application/pdf'));
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');

    expect((await patch('/api/v1/tutors/profile/documents', { diplomaKey: info.key }, bearer(b.token))).statusCode).toBe(422);
    expect((await patch('/api/v1/tutors/profile/documents', { criminalRecordKey: info.key }, bearer(a.token))).statusCode).toBe(422);
    expect((await patch('/api/v1/tutors/profile/documents', { diplomaKey: `tutors/x/DIPLOMA/nao-existe.pdf` }, bearer(a.token))).statusCode).toBe(422);
  });
});

describe('revisão pelo administrador', () => {
  async function tutorWithDocument() {
    const t = await registerUser('TUTOR');
    await post('/api/v1/tutors/profile', { subjects: ['Matemática'] }, bearer(t.token));
    const info = body(await requestUpload(t.token, 'DIPLOMA', 'application/pdf'));
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    await patch('/api/v1/tutors/profile/documents', { diplomaKey: info.key }, bearer(t.token));
    const me = body(await get('/api/v1/tutors/profile/me', bearer(t.token))).profile;
    return { t, id: me.id as string };
  }

  it('rejeitar exige motivo; tutor vê o motivo; reenvio volta a PENDING; aprovar', async () => {
    const admin = await newAdmin();
    const { t, id } = await tutorWithDocument();

    expect((await patch(`/api/v1/tutors/${id}/status`, { status: 'REJECTED' }, admin)).statusCode).toBe(422);
    const rej = await patch(`/api/v1/tutors/${id}/status`, { status: 'REJECTED', reason: 'Diploma ilegível' }, admin);
    expect(rej.statusCode).toBe(200);
    expect(body(await get('/api/v1/tutors/profile/me', bearer(t.token))).profile.rejectionReason).toBe('Diploma ilegível');

    const info = body(await requestUpload(t.token, 'DIPLOMA', 'application/pdf'));
    await uploadFile(info, new TextEncoder().encode('%PDF novo'), 'application/pdf');
    const re = body(await patch('/api/v1/tutors/profile/documents', { diplomaKey: info.key }, bearer(t.token))).profile;
    expect(re.status).toBe('PENDING');
    expect(re.rejectionReason).toBeNull();

    const ok = await patch(`/api/v1/tutors/${id}/status`, { status: 'APPROVED' }, admin);
    expect(body(ok).profile.status).toBe('APPROVED');
    expect((await patch(`/api/v1/tutors/${id}/status`, { status: 'REJECTED', reason: 'x' }, admin)).statusCode).toBe(409);
  });

  it('perfil sem documentos não entra na fila; com documentos aparece com URLs assinadas', async () => {
    const admin = await newAdmin();
    const empty = await registerUser('TUTOR');
    await post('/api/v1/tutors/profile', { subjects: ['Vazio'] }, bearer(empty.token));
    const { id } = await tutorWithDocument();

    // Percorre todas as páginas para encontrar o tutor (BD acumula PENDING de execuções anteriores)
    type PendingTutor = { id: string; documents: { diploma: string } };
    let found: PendingTutor | undefined;
    for (let page = 1; !found; page++) {
      const page_tutors = body(await get(`/api/v1/tutors/admin/pending?limit=50&page=${page}`, admin)).tutors as PendingTutor[];
      if (!page_tutors || page_tutors.length === 0) break;
      found = page_tutors.find((p) => p.id === id);
    }
    expect(found?.documents.diploma).toMatch(/^http/);
    const emptyId = body(await get('/api/v1/tutors/profile/me', bearer(empty.token))).profile.id;
    // Tutor sem documentos nunca aparece em nenhuma página
    for (let page = 1; ; page++) {
      const page_tutors = body(await get(`/api/v1/tutors/admin/pending?limit=50&page=${page}`, admin)).tutors as PendingTutor[];
      if (!page_tutors || page_tutors.length === 0) break;
      expect(page_tutors.find((p) => p.id === emptyId)).toBeUndefined();
    }
  });

  it('aprovação fica no audit log e só aprovados entram no catálogo público', async () => {
    const admin = await newAdmin();
    const { id } = await tutorWithDocument();
    expect((await get(`/api/v1/tutors/${id}`)).statusCode).toBe(404);
    await patch(`/api/v1/tutors/${id}/status`, { status: 'APPROVED' }, admin);
    expect((await get(`/api/v1/tutors/${id}`)).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'TUTOR_APPROVED' } })).toBe(1);
  });
});
