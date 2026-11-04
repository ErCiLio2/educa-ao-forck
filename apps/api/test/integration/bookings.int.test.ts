import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { PASSWORD, adminHeaders, app, bearer, body, del, email, get, patch, post, registerUser } from './helpers';

// RF-CAT-01, RF-AUL-01..04, RN-01, RN-04
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function approvedTutor() {
  const t = await registerUser('TUTOR');
  await post('/api/v1/tutors/profile', { subjects: ['Matemática'] }, bearer(t.token));
  const id = body(await get('/api/v1/tutors/profile/me', bearer(t.token))).profile.id;
  await patch(`/api/v1/tutors/${id}/status`, { status: 'APPROVED' }, await adminHeaders());
  return { ...t, profileId: id as string };
}

// Atalho: cria o pacote já confirmado, sem passar pela compra (o fluxo de compra tem os seus testes)
async function givePackage(userId: string, hours: number, expiresAt?: Date) {
  const payment = await prisma.paymentTransaction.create({
    data: { userId, gateway: 'teste', reference: randomUUID(), amount: 0, hours, status: 'CONFIRMED', idempotencyKey: randomUUID() },
  });
  return prisma.hourPackage.create({
    data: { userId, paymentId: payment.id, totalHours: hours, remainingHours: hours, expiresAt },
  });
}
const remaining = async (packageId: string) =>
  Number((await prisma.hourPackage.findUniqueOrThrow({ where: { id: packageId } })).remainingHours);

async function student(hours = 0) {
  const s = await registerUser('STUDENT');
  const id = idOf(s.token);
  const pkg = hours > 0 ? await givePackage(id, hours) : null;
  return { ...s, id, pkg };
}

const newSession = (token: string, over: Record<string, unknown> = {}) =>
  post('/api/v1/bookings/sessions', {
    title: 'Revisão de funções', subject: 'Matemática', type: 'GROUP',
    scheduledAt: inDays(3), durationMin: 60, ...over,
  }, bearer(token));

describe('publicar aulas', () => {
  it('tutor não aprovado não publica (403)', async () => {
    const t = await registerUser('TUTOR');
    await post('/api/v1/tutors/profile', { subjects: ['X'] }, bearer(t.token));
    expect((await newSession(t.token)).statusCode).toBe(403);
  });

  it('1-on-1 tem capacidade 1; grupo 7 por omissão; 8 é rejeitado (RN-01)', async () => {
    const t = await approvedTutor();
    expect(body(await newSession(t.token, { type: 'ONE_ON_ONE' })).session.maxCapacity).toBe(1);
    expect(body(await newSession(t.token)).session.maxCapacity).toBe(7);
    expect((await newSession(t.token, { maxCapacity: 8 })).statusCode).toBe(422);
    expect((await newSession(t.token, { type: 'ONE_ON_ONE', maxCapacity: 3 })).statusCode).toBe(422);
  });

  it('rejeita datas passadas e durações que não são múltiplas de 15', async () => {
    const t = await approvedTutor();
    expect((await newSession(t.token, { scheduledAt: inHours(-1) })).statusCode).toBe(422);
    expect((await newSession(t.token, { durationMin: 20 })).statusCode).toBe(422);
  });
});

describe('catálogo (RF-CAT-01)', () => {
  it('lista aulas futuras com vagas, filtra por disciplina sem distinguir maiúsculas', async () => {
    const t = await approvedTutor();
    const subject = `Disc-${randomUUID().slice(0, 6)}`;
    const s = body(await newSession(t.token, { subject, maxCapacity: 4 })).session;

    const res = body(await get(`/api/v1/bookings/sessions?subject=${subject.toUpperCase()}`));
    expect(res.total).toBe(1);
    expect(res.sessions[0].id).toBe(s.id);
    expect(res.sessions[0].spotsLeft).toBe(4);
    expect(res.sessions[0].tutor.user.email).toBeUndefined();
    expect((await get(`/api/v1/bookings/sessions/${s.id}`)).statusCode).toBe(200);
    expect((await get('/api/v1/bookings/sessions?limit=999')).statusCode).toBe(422);
  });
});

describe('matrícula e horas (RN-04)', () => {
  it('sem pacote → 402; com pacote debita a duração da aula', async () => {
    const t = await approvedTutor();
    const s = body(await newSession(t.token, { durationMin: 90 })).session;
    const poor = await student();
    const rich = await student(5);

    expect((await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(poor.token))).statusCode).toBe(402);
    const ok = await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(rich.token));
    expect(ok.statusCode).toBe(201);
    expect(await remaining(rich.pkg!.id)).toBe(3.5);
    expect(body(await get(`/api/v1/bookings/sessions/${s.id}`)).session.spotsLeft).toBe(6);
    expect((await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(rich.token))).statusCode).toBe(409);
  });

  it('pacote expirado não conta', async () => {
    const t = await approvedTutor();
    const s = body(await newSession(t.token)).session;
    const st = await student();
    await givePackage(st.id, 10, new Date(Date.now() - 1000));
    expect((await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(st.token))).statusCode).toBe(402);
  });

  it('usa primeiro o pacote que expira mais cedo', async () => {
    const t = await approvedTutor();
    const s = body(await newSession(t.token)).session;
    const st = await student();
    const later = await givePackage(st.id, 5, new Date(Date.now() + 90 * 86_400_000));
    const sooner = await givePackage(st.id, 5, new Date(Date.now() + 10 * 86_400_000));
    await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(st.token));
    expect(await remaining(sooner.id)).toBe(4);
    expect(await remaining(later.id)).toBe(5);
  });

  it('tutor não se inscreve na própria aula; aulas que já começaram fecham', async () => {
    const t = await approvedTutor();
    expect((await prisma.user.count({ where: { id: idOf(t.token), role: 'TUTOR' } }))).toBe(1);
    const started = await prisma.classSession.create({
      data: { tutorId: t.profileId, title: 'Passada', subject: 'M', type: 'GROUP', maxCapacity: 5, scheduledAt: new Date(Date.now() - 60_000), durationMin: 60 },
    });
    const st = await student(5);
    expect((await post(`/api/v1/bookings/sessions/${started.id}/enroll`, {}, bearer(st.token))).statusCode).toBe(409);
  });

  it('nunca ultrapassa a capacidade com pedidos simultâneos (RN-01)', async () => {
    const t = await approvedTutor();
    const s = body(await newSession(t.token, { maxCapacity: 3 })).session;
    const students = await Promise.all(Array.from({ length: 6 }, () => student(2)));
    const rs = await Promise.all(students.map((st) => post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(st.token))));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 201, 201, 409, 409, 409]);
    expect(await prisma.classEnrollment.count({ where: { classId: s.id } })).toBe(3);
    // quem ficou de fora não perdeu horas
    for (const [i, st] of students.entries()) {
      expect(await remaining(st.pkg!.id)).toBe(rs[i].statusCode === 201 ? 1 : 2);
    }
  });

  it('o saldo nunca fica negativo com matrículas simultâneas em aulas diferentes', async () => {
    const t = await approvedTutor();
    const [a, b] = await Promise.all([newSession(t.token, { scheduledAt: inDays(4) }), newSession(t.token, { scheduledAt: inDays(5) })]);
    const st = await student(1);
    const rs = await Promise.all([
      post(`/api/v1/bookings/sessions/${body(a).session.id}/enroll`, {}, bearer(st.token)),
      post(`/api/v1/bookings/sessions/${body(b).session.id}/enroll`, {}, bearer(st.token)),
    ]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 402]);
    expect(await remaining(st.pkg!.id)).toBe(0);
  });
});

describe('dependentes (RN-02)', () => {
  it('sem consentimento não agenda; com consentimento paga o pacote do Encarregado', async () => {
    const t = await approvedTutor();
    const s = body(await newSession(t.token)).session;
    const g = await registerUser('GUARDIAN');
    const pkg = await givePackage(idOf(g.token), 4);
    const mail = email('dep');
    const dep = body(await post('/api/v1/guardians/dependents', { name: 'Menino', email: mail, password: PASSWORD, birthDate: '2014-05-01' }, bearer(g.token))).dependent;
    const depToken = body(await post('/api/v1/auth/login', { email: mail, password: PASSWORD })).accessToken as string;
    const enrollUrl = `/api/v1/bookings/sessions/${s.id}/enroll`;

    expect((await post(enrollUrl, {}, bearer(depToken))).statusCode).toBe(403);
    await post(`/api/v1/guardians/dependents/${dep.id}/consent`, {}, bearer(g.token));
    expect((await post(enrollUrl, {}, bearer(depToken))).statusCode).toBe(201);
    expect(await remaining(pkg.id)).toBe(3);

    await del(`/api/v1/guardians/dependents/${dep.id}/consent`, bearer(g.token));
    expect((await get('/api/v1/bookings/enrollments/mine', bearer(depToken))).statusCode).toBe(403);
  });
});

describe('cancelamento', () => {
  it('com antecedência estorna as horas; em cima da hora é recusado', async () => {
    const t = await approvedTutor();
    const far = body(await newSession(t.token, { scheduledAt: inDays(3) })).session;
    const near = body(await newSession(t.token, { scheduledAt: inHours(2) })).session;
    const st = await student(5);

    await post(`/api/v1/bookings/sessions/${far.id}/enroll`, {}, bearer(st.token));
    await post(`/api/v1/bookings/sessions/${near.id}/enroll`, {}, bearer(st.token));
    expect(await remaining(st.pkg!.id)).toBe(3);

    expect((await del(`/api/v1/bookings/sessions/${far.id}/enroll`, bearer(st.token))).statusCode).toBe(204);
    expect(await remaining(st.pkg!.id)).toBe(4);
    expect((await del(`/api/v1/bookings/sessions/${far.id}/enroll`, bearer(st.token))).statusCode).toBe(404);
    expect((await del(`/api/v1/bookings/sessions/${near.id}/enroll`, bearer(st.token))).statusCode).toBe(409);
    expect(await remaining(st.pkg!.id)).toBe(4);
  });

  it('cancelamentos simultâneos estornam uma só vez', async () => {
    const t = await approvedTutor();
    const s = body(await newSession(t.token)).session;
    const st = await student(2);
    await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(st.token));
    const rs = await Promise.all([1, 2, 3].map(() => del(`/api/v1/bookings/sessions/${s.id}/enroll`, bearer(st.token))));
    expect(rs.filter((r) => r.statusCode === 204)).toHaveLength(1);
    expect(await remaining(st.pkg!.id)).toBe(2);
  });
});

describe('gestão pelo tutor', () => {
  it('vê a lista de inscritos; só apaga aulas sem alunos; não mexe em aulas alheias', async () => {
    const a = await approvedTutor();
    const b = await approvedTutor();
    const s = body(await newSession(a.token)).session;
    const empty = body(await newSession(a.token)).session;
    const st = await student(2);
    await post(`/api/v1/bookings/sessions/${s.id}/enroll`, {}, bearer(st.token));

    const mine = body(await get('/api/v1/bookings/sessions/mine', bearer(a.token))).sessions;
    expect(mine.find((x: { id: string }) => x.id === s.id).enrollments[0].student.id).toBe(st.id);

    expect((await del(`/api/v1/bookings/sessions/${s.id}`, bearer(a.token))).statusCode).toBe(409);
    expect((await del(`/api/v1/bookings/sessions/${empty.id}`, bearer(b.token))).statusCode).toBe(404);
    expect((await del(`/api/v1/bookings/sessions/${empty.id}`, bearer(a.token))).statusCode).toBe(204);
  });

  it('presença: só depois do início e só no próprio tutor', async () => {
    const a = await approvedTutor();
    const b = await approvedTutor();
    const st = await student(2);
    const future = body(await newSession(a.token)).session;
    const enr = body(await post(`/api/v1/bookings/sessions/${future.id}/enroll`, {}, bearer(st.token))).enrollment;
    expect((await patch(`/api/v1/bookings/sessions/${future.id}/enrollments/${enr.id}`, { attendanceStatus: 'PRESENT' }, bearer(a.token))).statusCode).toBe(409);

    const past = await prisma.classSession.create({
      data: { tutorId: a.profileId, title: 'Hoje', subject: 'M', type: 'GROUP', maxCapacity: 5, scheduledAt: new Date(Date.now() - 3_600_000), durationMin: 60 },
    });
    const pe = await prisma.classEnrollment.create({ data: { classId: past.id, studentId: st.id, hoursDebited: 0 } });
    const url = `/api/v1/bookings/sessions/${past.id}/enrollments/${pe.id}`;
    expect((await patch(url, { attendanceStatus: 'PRESENT' }, bearer(b.token))).statusCode).toBe(404);
    expect((await patch(url, { attendanceStatus: 'PENDING' }, bearer(a.token))).statusCode).toBe(422);
    expect((await patch(url, { attendanceStatus: 'PRESENT' }, bearer(a.token))).statusCode).toBe(200);
    expect((await prisma.classEnrollment.findUniqueOrThrow({ where: { id: pe.id } })).attendanceStatus).toBe('PRESENT');
  });
});

describe('sala virtual — join token (RF-AUL-05)', () => {
  it('tutor da sessão recebe token com permissão de publicar', async () => {
    const t = await approvedTutor();
    const session = body(await newSession(t.token)).session;
    const res = await get(`/api/v1/bookings/sessions/${session.id}/join-token`, bearer(t.token));
    expect(res.statusCode).toBe(200);
    const { token, url, room } = body(res);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // JWT format
    expect(room).toBe(session.id);
    expect(typeof url).toBe('string');
  });

  it('aluno inscrito recebe token', async () => {
    const t = await approvedTutor();
    const st = await student(2);
    const session = body(await newSession(t.token)).session;
    await post(`/api/v1/bookings/sessions/${session.id}/enroll`, {}, bearer(st.token));
    const res = await get(`/api/v1/bookings/sessions/${session.id}/join-token`, bearer(st.token));
    expect(res.statusCode).toBe(200);
    expect(typeof body(res).token).toBe('string');
  });

  it('aluno não inscrito recebe 403', async () => {
    const t = await approvedTutor();
    const st = await student();
    const session = body(await newSession(t.token)).session;
    expect((await get(`/api/v1/bookings/sessions/${session.id}/join-token`, bearer(st.token))).statusCode).toBe(403);
  });

  it('admin recebe token de observador', async () => {
    const t = await approvedTutor();
    const session = body(await newSession(t.token)).session;
    const res = await get(`/api/v1/bookings/sessions/${session.id}/join-token`, await adminHeaders());
    expect(res.statusCode).toBe(200);
    expect(typeof body(res).token).toBe('string');
  });

  it('404 para sessão inexistente', async () => {
    const t = await approvedTutor();
    const fakeId = randomUUID();
    expect((await get(`/api/v1/bookings/sessions/${fakeId}/join-token`, bearer(t.token))).statusCode).toBe(404);
  });

  it('401 sem autenticação', async () => {
    const t = await approvedTutor();
    const session = body(await newSession(t.token)).session;
    expect((await get(`/api/v1/bookings/sessions/${session.id}/join-token`)).statusCode).toBe(401);
  });
});
