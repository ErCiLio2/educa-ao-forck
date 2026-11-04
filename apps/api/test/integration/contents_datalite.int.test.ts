import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import {
  adminSession,
  app,
  bearer,
  body,
  del,
  get,
  patch,
  post,
  registerUser,
} from './helpers';

// RF-CON-01, RF-CON-02, RF-CON-03
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

async function uploadFile(
  info: { url: string; fields: Record<string, string> },
  data: Uint8Array,
  contentType: string,
) {
  const form = new FormData();
  for (const [k, v] of Object.entries(info.fields)) form.append(k, v);
  form.set('Content-Type', contentType);
  form.append('file', new Blob([data], { type: contentType }), 'f');
  return fetch(info.url, { method: 'POST', body: form });
}

async function tutorWithProfile() {
  const t = await registerUser('TUTOR');
  await post('/api/v1/tutors/profile', { subjects: ['Matemática'] }, bearer(t.token));
  return t;
}

async function createPublishedContent(token: string) {
  const info = body(
    await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(token)),
  );
  await uploadFile(info, new TextEncoder().encode('%PDF-1.4'), 'application/pdf');
  const created = body(
    await post(
      '/api/v1/contents',
      { title: 'Aula de Álgebra', type: 'DOCUMENT', isPaid: false, storageKey: info.key },
      bearer(token),
    ),
  );
  await patch(`/api/v1/contents/${created.content.id}/status`, { status: 'PUBLISHED' }, bearer(token));
  return created.content.id as string;
}

// ── Upload de ficheiro ────────────────────────────────────────────────────────

describe('upload URL', () => {
  it('mime não permitido para o tipo → 422', async () => {
    const t = await tutorWithProfile();
    const res = await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'video/mp4' }, bearer(t.token));
    expect(res.statusCode).toBe(422);
  });

  it('devolve chave com prefixo do perfil e URL assinada', async () => {
    const t = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(t.token)),
    );
    expect(info.key).toMatch(/^contents\/.+\/.+\.pdf$/);
    expect(info.url).toBeTruthy();
    expect(info.maxBytes).toBeGreaterThan(0);
  });
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

describe('criar conteúdo', () => {
  it('fluxo completo: upload → criar → aparece em /mine', async () => {
    const t = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(t.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF-1.4'), 'application/pdf');

    const res = await post(
      '/api/v1/contents',
      { title: 'Aula de Geometria', type: 'DOCUMENT', isPaid: false, storageKey: info.key },
      bearer(t.token),
    );
    expect(res.statusCode).toBe(201);
    const content = body(res).content;
    expect(content.title).toBe('Aula de Geometria');
    expect(content.status).toBe('DRAFT');
    expect(content.storageKey).toBeUndefined();
    expect(content.dataliteKey).toBeUndefined();

    const mine = body(await get('/api/v1/contents/mine', bearer(t.token)));
    expect(mine.contents.some((c: { id: string }) => c.id === content.id)).toBe(true);
  });

  it('chave de outro tutor → 422', async () => {
    const a = await tutorWithProfile();
    const b = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(a.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    const res = await post(
      '/api/v1/contents',
      { title: 'Conteúdo', type: 'DOCUMENT', isPaid: false, storageKey: info.key },
      bearer(b.token),
    );
    expect(res.statusCode).toBe(422);
  });

  it('chave inexistente → 422', async () => {
    const t = await tutorWithProfile();
    const profileId = body(await get('/api/v1/tutors/profile/me', bearer(t.token))).profile.id as string;
    const res = await post(
      '/api/v1/contents',
      { title: 'X', type: 'DOCUMENT', isPaid: false, storageKey: `contents/${profileId}/nao-existe.pdf` },
      bearer(t.token),
    );
    expect(res.statusCode).toBe(422);
  });
});

describe('editar e eliminar', () => {
  it('tutor actualiza os metadados do próprio conteúdo', async () => {
    const t = await tutorWithProfile();
    const id = await createPublishedContent(t.token);

    const res = await patch(`/api/v1/contents/${id}`, { title: 'Novo Título', isPaid: true }, bearer(t.token));
    expect(res.statusCode).toBe(200);
    expect(body(res).content.title).toBe('Novo Título');
    expect(body(res).content.isPaid).toBe(true);
  });

  it('tutor não acede ao conteúdo de outro tutor', async () => {
    const a = await tutorWithProfile();
    const b = await tutorWithProfile();
    const id = await createPublishedContent(a.token);

    expect((await patch(`/api/v1/contents/${id}`, { title: 'X' }, bearer(b.token))).statusCode).toBe(404);
    expect((await del(`/api/v1/contents/${id}`, bearer(b.token))).statusCode).toBe(404);
  });

  it('eliminar apaga o conteúdo e não aparece na listagem', async () => {
    const t = await tutorWithProfile();
    const id = await createPublishedContent(t.token);

    expect((await del(`/api/v1/contents/${id}`, bearer(t.token))).statusCode).toBe(204);
    expect((await get(`/api/v1/contents/${id}`)).statusCode).toBe(404);
  });
});

describe('estado do conteúdo', () => {
  it('DRAFT não aparece no catálogo público', async () => {
    const t = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(t.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    const c = body(
      await post('/api/v1/contents', { title: 'Rascunho', type: 'DOCUMENT', isPaid: false, storageKey: info.key }, bearer(t.token)),
    );
    expect(c.content.status).toBe('DRAFT');

    const catalog = body(await get('/api/v1/contents'));
    expect(catalog.contents.some((x: { id: string }) => x.id === c.content.id)).toBe(false);
    expect((await get(`/api/v1/contents/${c.content.id}`)).statusCode).toBe(404);
  });

  it('publicar torna o conteúdo visível; arquivar esconde', async () => {
    const t = await tutorWithProfile();
    const id = await createPublishedContent(t.token);

    expect((await get(`/api/v1/contents/${id}`)).statusCode).toBe(200);

    await patch(`/api/v1/contents/${id}/status`, { status: 'ARCHIVED' }, bearer(t.token));
    expect((await get(`/api/v1/contents/${id}`)).statusCode).toBe(404);
  });
});

// ── DPM: URL de acesso ────────────────────────────────────────────────────────

describe('URL de acesso (DPM, RF-CON-03)', () => {
  it('conteúdo gratuito publicado: qualquer utilizador autenticado obtém URL', async () => {
    const tutor = await tutorWithProfile();
    const id = await createPublishedContent(tutor.token);
    const student = await registerUser('STUDENT');

    const res = await get(`/api/v1/contents/${id}/url`, bearer(student.token));
    expect(res.statusCode).toBe(200);
    expect(body(res).url).toMatch(/^https?:\/\//);
    expect(body(res).expiresInSeconds).toBe(300);

    // A URL é do bucket privado: sem parâmetros de assinatura → 403/400
    const raw = body(res).url.split('?')[0];
    const publicAccess = await fetch(raw);
    expect(publicAccess.status).toBeGreaterThanOrEqual(400);
  });

  it('conteúdo pago: sem pacote de horas → 402', async () => {
    const tutor = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    const c = body(
      await post('/api/v1/contents', { title: 'Premium', type: 'DOCUMENT', isPaid: true, storageKey: info.key }, bearer(tutor.token)),
    );
    await patch(`/api/v1/contents/${c.content.id}/status`, { status: 'PUBLISHED' }, bearer(tutor.token));

    const student = await registerUser('STUDENT');
    expect((await get(`/api/v1/contents/${c.content.id}/url`, bearer(student.token))).statusCode).toBe(402);
  });

  it('conteúdo pago: com pacote activo → 200', async () => {
    const tutor = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    const c = body(
      await post('/api/v1/contents', { title: 'Premium2', type: 'DOCUMENT', isPaid: true, storageKey: info.key }, bearer(tutor.token)),
    );
    await patch(`/api/v1/contents/${c.content.id}/status`, { status: 'PUBLISHED' }, bearer(tutor.token));

    // Criar pacote de horas directamente na BD (contorna o fluxo de pagamento)
    const student = await registerUser('STUDENT');
    const studentUser = await prisma.user.findUniqueOrThrow({ where: { email: student.email } });
    // Precisa de um PaymentTransaction (FK obrigatória)
    const tx = await prisma.paymentTransaction.create({
      data: {
        userId: studentUser.id,
        gateway: 'test',
        reference: `test-${Date.now()}`,
        amount: 1000,
        currency: 'AOA',
        status: 'CONFIRMED',
        idempotencyKey: `test-${Date.now()}`,
        hours: 10,
      },
    });
    await prisma.hourPackage.create({
      data: { userId: studentUser.id, paymentId: tx.id, totalHours: 10, remainingHours: 10 },
    });

    expect((await get(`/api/v1/contents/${c.content.id}/url`, bearer(student.token))).statusCode).toBe(200);
  });

  it('conteúdo DRAFT não acessível por aluno', async () => {
    const tutor = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    const c = body(
      await post('/api/v1/contents', { title: 'Draft', type: 'DOCUMENT', isPaid: false, storageKey: info.key }, bearer(tutor.token)),
    );

    const student = await registerUser('STUDENT');
    expect((await get(`/api/v1/contents/${c.content.id}/url`, bearer(student.token))).statusCode).toBe(404);
  });

  it('tutor acede ao próprio conteúdo em DRAFT', async () => {
    const tutor = await tutorWithProfile();
    const info = body(
      await post('/api/v1/contents/upload-url', { type: 'DOCUMENT', contentType: 'application/pdf' }, bearer(tutor.token)),
    );
    await uploadFile(info, new TextEncoder().encode('%PDF'), 'application/pdf');
    const c = body(
      await post('/api/v1/contents', { title: 'Draft', type: 'DOCUMENT', isPaid: false, storageKey: info.key }, bearer(tutor.token)),
    );
    expect((await get(`/api/v1/contents/${c.content.id}/url`, bearer(tutor.token))).statusCode).toBe(200);
  });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

describe('administração', () => {
  it('admin lista todos os conteúdos (incluindo DRAFT e ARCHIVED)', async () => {
    const admin = await adminSession();
    const tutor = await tutorWithProfile();
    await createPublishedContent(tutor.token);

    const res = await get('/api/v1/contents/admin', admin.headers);
    expect(res.statusCode).toBe(200);
    expect(body(res).contents.length).toBeGreaterThan(0);
  });

  it('admin elimina qualquer conteúdo', async () => {
    const admin = await adminSession();
    const tutor = await tutorWithProfile();
    const id = await createPublishedContent(tutor.token);

    expect((await del(`/api/v1/contents/admin/${id}`, admin.headers)).statusCode).toBe(204);
    expect((await get(`/api/v1/contents/${id}`)).statusCode).toBe(404);
  });
});
