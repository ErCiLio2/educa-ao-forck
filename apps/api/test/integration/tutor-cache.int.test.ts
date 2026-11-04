// Cache Redis para perfis públicos e catálogo de tutores (arquitectura §2.3)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { adminHeaders, app, bearer, body, get, patch, post, registerUser } from './helpers';

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function approvedTutor(tag = 'cache-tutor') {
  const t = await registerUser('TUTOR', tag);
  await post('/api/v1/tutors/profile', { subjects: ['Química'] }, bearer(t.token));
  const profileId = body(await get('/api/v1/tutors/profile/me', bearer(t.token))).profile.id as string;
  await patch(`/api/v1/tutors/${profileId}/status`, { status: 'APPROVED' }, await adminHeaders());
  return { ...t, profileId };
}

async function givePackage(userId: string, hours: number) {
  const payment = await prisma.paymentTransaction.create({
    data: { userId, gateway: 'teste', reference: randomUUID(), amount: 0, hours, status: 'CONFIRMED', idempotencyKey: randomUUID() },
  });
  return prisma.hourPackage.create({
    data: { userId, paymentId: payment.id, totalHours: hours, remainingHours: hours },
  });
}

describe('cache de perfil público', () => {
  it('popula a cache após a primeira leitura', async () => {
    const t = await approvedTutor('cache-profile-1');

    // Limpa cache anterior
    await redis.del(`tutor:profile:${t.profileId}`);

    expect(await redis.get(`tutor:profile:${t.profileId}`)).toBeNull();

    const res = await get(`/api/v1/tutors/${t.profileId}`);
    expect(res.statusCode).toBe(200);

    // Após o GET, a chave deve estar em Redis
    const cached = await redis.get(`tutor:profile:${t.profileId}`);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!).id).toBe(t.profileId);
  });

  it('segunda leitura devolve dados idênticos (hit de cache)', async () => {
    const t = await approvedTutor('cache-profile-2');
    await redis.del(`tutor:profile:${t.profileId}`);

    const r1 = body(await get(`/api/v1/tutors/${t.profileId}`));
    const r2 = body(await get(`/api/v1/tutors/${t.profileId}`));

    expect(r1).toEqual(r2);
  });

  it('actualização do perfil invalida a cache do perfil', async () => {
    const t = await approvedTutor('cache-profile-upd');
    await redis.del(`tutor:profile:${t.profileId}`);

    // Popula a cache
    await get(`/api/v1/tutors/${t.profileId}`);
    expect(await redis.get(`tutor:profile:${t.profileId}`)).not.toBeNull();

    // Actualiza o perfil
    await patch('/api/v1/tutors/profile', { bio: 'Novo bio' }, bearer(t.token));

    // Cache deve estar inválida
    expect(await redis.get(`tutor:profile:${t.profileId}`)).toBeNull();
  });

  it('aprovação invalida a cache do perfil e incrementa a versão do catálogo', async () => {
    // Cria perfil PENDING (não aprovado) — profile não está em cache ainda
    const t2 = await registerUser('TUTOR', 'cache-profile-rev');
    await post('/api/v1/tutors/profile', { subjects: ['Química'] }, bearer(t2.token));
    const profileId = body(await get('/api/v1/tutors/profile/me', bearer(t2.token))).profile.id as string;

    const vBefore = Number((await redis.get('tutor:catalog:v')) ?? 0);
    expect(await redis.get(`tutor:profile:${profileId}`)).toBeNull();

    // Aprovação chama reviewTutor → invalidateTutorCache
    await patch(`/api/v1/tutors/${profileId}/status`, { status: 'APPROVED' }, await adminHeaders());

    // Versão do catálogo deve ter incrementado
    expect(Number((await redis.get('tutor:catalog:v')) ?? 0)).toBeGreaterThan(vBefore);
    // Chave de perfil continua nula (nunca foi populada — tutor só entra no cache após o primeiro GET)
    expect(await redis.get(`tutor:profile:${profileId}`)).toBeNull();
  });
});

// Os testes do catálogo verificam apenas que a versão incrementa (comportamento de invalidação).
// Asserções sobre chaves específicas de cache do catálogo são rácias com ficheiros de testes paralelos
// que também aprovam tutores e fazem GETs, partilhando o contador `tutor:catalog:v`.
describe('cache do catálogo', () => {
  it('GET ao catálogo devolve lista válida e paginada', async () => {
    await approvedTutor('cache-cat-list');
    const r = body(await get('/api/v1/tutors?page=1&limit=5'));
    expect(r.tutors).toBeInstanceOf(Array);
    expect(r.total).toBeGreaterThan(0);
    expect(r.page).toBe(1);
    expect(r.limit).toBe(5);
  });

  it('actualização de perfil incrementa a versão do catálogo', async () => {
    const t = await approvedTutor('cache-cat-upd');
    const before = Number((await redis.get('tutor:catalog:v')) ?? 0);

    await patch('/api/v1/tutors/profile', { bio: 'Muda catálogo' }, bearer(t.token));

    const after = Number((await redis.get('tutor:catalog:v')) ?? 0);
    expect(after).toBeGreaterThan(before);
  });

  it('aprovação incrementa a versão do catálogo', async () => {
    const t2 = await registerUser('TUTOR', 'cache-cat-appr');
    await post('/api/v1/tutors/profile', { subjects: ['Biologia'] }, bearer(t2.token));
    const profileId = body(await get('/api/v1/tutors/profile/me', bearer(t2.token))).profile.id as string;

    const before = Number((await redis.get('tutor:catalog:v')) ?? 0);
    await patch(`/api/v1/tutors/${profileId}/status`, { status: 'APPROVED' }, await adminHeaders());

    const after = Number((await redis.get('tutor:catalog:v')) ?? 0);
    expect(after).toBeGreaterThan(before);
  });

  it('duas escritas seguidas incrementam a versão duas vezes', async () => {
    const t = await approvedTutor('cache-cat-2x');
    const v0 = Number((await redis.get('tutor:catalog:v')) ?? 0);

    await patch('/api/v1/tutors/profile', { bio: 'Write 1' }, bearer(t.token));
    await patch('/api/v1/tutors/profile', { bio: 'Write 2' }, bearer(t.token));

    const vFinal = Number((await redis.get('tutor:catalog:v')) ?? 0);
    expect(vFinal).toBeGreaterThanOrEqual(v0 + 2);
  });
});

describe('invalidação após avaliação (ratingAverage)', () => {
  it('avaliação invalida o perfil do tutor', async () => {
    const t = await approvedTutor('cache-rating');
    const st = await registerUser('STUDENT', 'cache-rating-st');
    const stId = body(await get('/api/v1/auth/me', bearer(st.token))).user.id as string;
    await givePackage(stId, 5);

    // Cria sessão, inscreve aluno e marca presença (para poder avaliar)
    const session = body(
      await post('/api/v1/bookings/sessions', {
        title: 'Aula cache', subject: 'Química', type: 'ONE_ON_ONE',
        scheduledAt: inDays(1), durationMin: 60,
      }, bearer(t.token)),
    ).session as { id: string };

    await post(`/api/v1/bookings/sessions/${session.id}/enroll`, {}, bearer(st.token));
    const enrollment = body(await get('/api/v1/bookings/enrollments/mine', bearer(st.token)))
      .enrollments[0] as { enrollments: Array<{ id: string }> };

    // Força passado para poder marcar presença
    await prisma.classSession.update({
      where: { id: session.id },
      data: { scheduledAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    const enrId = (enrollment as unknown as { enrollments: Array<{ id: string }> }).enrollments?.[0]?.id
      ?? (enrollment as unknown as { id: string }).id;
    await patch(`/api/v1/bookings/sessions/${session.id}/enrollments/${enrId}`, { attendanceStatus: 'PRESENT' }, bearer(t.token));

    // Popula a cache do perfil
    await redis.del(`tutor:profile:${t.profileId}`);
    await get(`/api/v1/tutors/${t.profileId}`);
    expect(await redis.get(`tutor:profile:${t.profileId}`)).not.toBeNull();

    // Cria avaliação
    await post(`/api/v1/reputation/sessions/${session.id}/review`, {
      rating: 5, punctuality: 5, subjectMastery: 5, didacticClarity: 5, progress: 5,
    }, bearer(st.token));

    // Cache do perfil deve ter sido invalidada pela actualização do ratingAverage
    expect(await redis.get(`tutor:profile:${t.profileId}`)).toBeNull();
  });
});
