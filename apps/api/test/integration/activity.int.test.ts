import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { PASSWORD, adminSession, app, bearer, body, del, email, get, post, registerUser } from './helpers';

// RF-HIS-01 (histórico e métricas por perfil), RF-ENC-03 (Encarregado acompanha dependentes), RN-02
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;
const HOUR = 3_600_000;
type Att = 'PRESENT' | 'ABSENT' | 'PENDING';

async function tutorProfile(status: 'APPROVED' | 'PENDING' = 'APPROVED') {
  const t = await registerUser('TUTOR');
  const profile = await prisma.tutorProfile.create({ data: { userId: idOf(t.token), status, subjects: ['M'] } });
  return { ...t, id: idOf(t.token), profileId: profile.id };
}

// hoursFromNow < 0 = já decorreu
const session = (tutorId: string, hoursFromNow: number, subject = 'Matemática', maxCapacity = 5) =>
  prisma.classSession.create({
    data: {
      tutorId, title: `Aula de ${subject}`, subject, type: 'GROUP', maxCapacity,
      scheduledAt: new Date(Date.now() + hoursFromNow * HOUR), durationMin: 60,
    },
  });
const enrol = (classId: string, studentId: string, attendanceStatus: Att = 'PENDING', hoursDebited = 1) =>
  prisma.classEnrollment.create({ data: { classId, studentId, attendanceStatus, hoursDebited } });

async function studentWithHistory() {
  const tutor = await tutorProfile();
  const s = await registerUser('STUDENT');
  const id = idOf(s.token);
  // 2 presenças (Matemática, Física), 1 falta, 1 por marcar (já decorreu), 1 futura
  await enrol((await session(tutor.profileId, -10, 'Matemática')).id, id, 'PRESENT');
  await enrol((await session(tutor.profileId, -20, 'Física')).id, id, 'PRESENT');
  await enrol((await session(tutor.profileId, -30, 'Matemática')).id, id, 'PRESENT');
  await enrol((await session(tutor.profileId, -40, 'Química')).id, id, 'ABSENT');
  await enrol((await session(tutor.profileId, -5, 'Biologia')).id, id, 'PENDING');
  await enrol((await session(tutor.profileId, 48, 'Inglês')).id, id, 'PENDING');
  return { tutor, student: { ...s, id } };
}

async function packageFor(userId: string, hours: number) {
  const payment = await prisma.paymentTransaction.create({
    data: { userId, gateway: 'teste', reference: randomUUID(), amount: 100, hours, status: 'CONFIRMED', idempotencyKey: randomUUID() },
  });
  return prisma.hourPackage.create({ data: { userId, paymentId: payment.id, totalHours: hours, remainingHours: hours } });
}

describe('aluno: resumo e histórico (RF-HIS-01)', () => {
  it('métricas correctas: presenças, faltas, taxa, por marcar, futuras, horas e disciplinas', async () => {
    const { student } = await studentWithHistory();
    await packageFor(student.id, 8);

    const { summary } = body(await get('/api/v1/activity/me/summary', bearer(student.token)));
    expect(summary.classes).toEqual({
      enrolled: 6, upcoming: 1, attended: 3, absent: 1,
      awaitingAttendance: 1, // a futura não conta como "por marcar"
      attendanceRate: 75, // 3 presenças em 4 marcadas
    });
    expect(summary.hoursConsumed).toBe('6.00');
    expect(summary.hoursAvailable).toBe('8.00');
    expect(summary.topSubjects).toEqual([{ subject: 'Matemática', classes: 2 }, { subject: 'Física', classes: 1 }]);
    expect(summary.nextClass).toMatchObject({ subject: 'Inglês' });
    expect(summary.reviewsGiven).toBe(0);
  });

  it('conta as avaliações dadas', async () => {
    const tutor = await tutorProfile();
    const s = await registerUser('STUDENT');
    const cls = await session(tutor.profileId, -5);
    await enrol(cls.id, idOf(s.token), 'PRESENT');
    await post(`/api/v1/reputation/sessions/${cls.id}/review`, { rating: 5, punctuality: 5, subjectMastery: 5, didacticClarity: 5, progress: 5 }, bearer(s.token));
    expect(body(await get('/api/v1/activity/me/summary', bearer(s.token))).summary.reviewsGiven).toBe(1);
  });

  it('aluno sem actividade: tudo a zero e taxa nula (sem dividir por zero)', async () => {
    const s = await registerUser('STUDENT');
    const { summary } = body(await get('/api/v1/activity/me/summary', bearer(s.token)));
    expect(summary.classes).toEqual({ enrolled: 0, upcoming: 0, attended: 0, absent: 0, awaitingAttendance: 0, attendanceRate: null });
    expect(summary.nextClass).toBeNull();
    expect(summary.hoursConsumed).toBe('0.00');
  });

  it('histórico: mais recente primeiro, paginado, com filtro de datas e nome do tutor', async () => {
    const { student, tutor } = await studentWithHistory();
    const all = body(await get('/api/v1/activity/me/history', bearer(student.token)));
    expect(all.total).toBe(6);
    const dates = all.items.map((i: { session: { scheduledAt: string } }) => i.session.scheduledAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(all.items[0].session.subject).toBe('Inglês'); // a futura é a mais recente
    expect(all.items[0].session.tutorName).toBeTruthy();
    expect(JSON.stringify(all)).not.toContain(tutor.profileId);

    const page2 = body(await get('/api/v1/activity/me/history?limit=4&page=2', bearer(student.token)));
    expect(page2.items).toHaveLength(2);
    expect(page2.pages).toBe(2);

    const from = new Date(Date.now() - 25 * HOUR).toISOString();
    const to = new Date(Date.now() - 6 * HOUR).toISOString();
    const filtered = body(await get(`/api/v1/activity/me/history?from=${from}&to=${to}`, bearer(student.token)));
    expect(filtered.items.map((i: { session: { subject: string } }) => i.session.subject).sort()).toEqual(['Física', 'Matemática']);

    expect((await get('/api/v1/activity/me/history?limit=999', bearer(student.token))).statusCode).toBe(422);
    expect((await get(`/api/v1/activity/me/history?from=${to}&to=${from}`, bearer(student.token))).statusCode).toBe(422);
    expect((await get('/api/v1/activity/me/history?from=ontem', bearer(student.token))).statusCode).toBe(422);
  });

  it('cada aluno só vê a sua actividade', async () => {
    const { student } = await studentWithHistory();
    const other = await registerUser('STUDENT');
    expect(body(await get('/api/v1/activity/me/summary', bearer(other.token))).summary.classes.enrolled).toBe(0);
    expect(body(await get('/api/v1/activity/me/history', bearer(other.token))).total).toBe(0);
    expect(body(await get('/api/v1/activity/me/summary', bearer(student.token))).summary.classes.enrolled).toBe(6);
  });
});

describe('Encarregado acompanha os dependentes (RF-ENC-03, RN-02)', () => {
  async function guardianWithDependent() {
    const g = await registerUser('GUARDIAN');
    const mail = email('dep');
    const dep = body(await post('/api/v1/guardians/dependents', { name: 'Menino', email: mail, password: PASSWORD, birthDate: '2014-05-01' }, bearer(g.token))).dependent;
    const depToken = body(await post('/api/v1/auth/login', { email: mail, password: PASSWORD })).accessToken as string;
    const tutor = await tutorProfile();
    await enrol((await session(tutor.profileId, -10)).id, dep.id, 'PRESENT');
    await enrol((await session(tutor.profileId, -20)).id, dep.id, 'ABSENT');
    await enrol((await session(tutor.profileId, 24, 'Inglês')).id, dep.id);
    await packageFor(idOf(g.token), 5);
    return { g, dep, depToken, consentUrl: `/api/v1/guardians/dependents/${dep.id}/consent` };
  }

  it('sem consentimento não há dados, nem para o Encarregado', async () => {
    const { g, dep } = await guardianWithDependent();
    const overview = body(await get('/api/v1/activity/dependents', bearer(g.token))).dependents;
    expect(overview).toEqual([{ id: dep.id, name: 'Menino', consentGranted: false }]);

    const summary = await get(`/api/v1/activity/dependents/${dep.id}/summary`, bearer(g.token));
    expect(summary.statusCode).toBe(403);
    expect(body(summary).error.message).toMatch(/consentimento/i);
    expect((await get(`/api/v1/activity/dependents/${dep.id}/history`, bearer(g.token))).statusCode).toBe(403);
  });

  it('com consentimento vê o resumo e o histórico; revogar fecha de imediato', async () => {
    const { g, dep, consentUrl } = await guardianWithDependent();
    await post(consentUrl, {}, bearer(g.token));

    const overview = body(await get('/api/v1/activity/dependents', bearer(g.token))).dependents;
    expect(overview[0]).toMatchObject({ id: dep.id, consentGranted: true, attended: 1, upcoming: 1, attendanceRate: 50 });
    expect(overview[0].nextClass.subject).toBe('Inglês');

    const { summary } = body(await get(`/api/v1/activity/dependents/${dep.id}/summary`, bearer(g.token)));
    expect(summary.classes).toMatchObject({ enrolled: 3, attended: 1, absent: 1, upcoming: 1 });
    expect(summary.hoursAvailable).toBe('5.00'); // o pacote do Encarregado
    expect(body(await get(`/api/v1/activity/dependents/${dep.id}/history`, bearer(g.token))).total).toBe(3);

    await del(consentUrl, bearer(g.token));
    expect((await get(`/api/v1/activity/dependents/${dep.id}/summary`, bearer(g.token))).statusCode).toBe(403);
    expect(body(await get('/api/v1/activity/dependents', bearer(g.token))).dependents[0]).toEqual({ id: dep.id, name: 'Menino', consentGranted: false });
  });

  it('outro Encarregado nunca vê dependentes alheios (mesmo com consentimento activo)', async () => {
    const { g, dep, consentUrl } = await guardianWithDependent();
    await post(consentUrl, {}, bearer(g.token));
    const stranger = await registerUser('GUARDIAN');

    expect((await get(`/api/v1/activity/dependents/${dep.id}/summary`, bearer(stranger.token))).statusCode).toBe(403);
    expect((await get(`/api/v1/activity/dependents/${dep.id}/history`, bearer(stranger.token))).statusCode).toBe(403);
    expect(body(await get('/api/v1/activity/dependents', bearer(stranger.token))).dependents).toEqual([]);
    // um aluno qualquer que não é dependente seu também é recusado
    const unrelated = await registerUser('STUDENT');
    expect((await get(`/api/v1/activity/dependents/${idOf(unrelated.token)}/summary`, bearer(g.token))).statusCode).toBe(403);
    expect((await get('/api/v1/activity/dependents/nao-e-uuid/summary', bearer(g.token))).statusCode).toBe(422);
  });

  it('cada consulta aos dados do menor fica auditada; consultas recusadas não', async () => {
    const { g, dep, consentUrl } = await guardianWithDependent();
    const count = (action: string) => prisma.auditLog.count({ where: { actorId: idOf(g.token), entityId: dep.id, action } });

    await get(`/api/v1/activity/dependents/${dep.id}/summary`, bearer(g.token)); // sem consentimento: recusada
    expect(await count('DEPENDENT_SUMMARY_VIEWED')).toBe(0);

    await post(consentUrl, {}, bearer(g.token));
    await get(`/api/v1/activity/dependents/${dep.id}/summary`, bearer(g.token));
    await get(`/api/v1/activity/dependents/${dep.id}/history`, bearer(g.token));
    expect(await count('DEPENDENT_SUMMARY_VIEWED')).toBe(1);
    expect(await count('DEPENDENT_HISTORY_VIEWED')).toBe(1);
  });

  it('o próprio dependente só acede depois do consentimento', async () => {
    const { g, depToken, consentUrl } = await guardianWithDependent();
    expect((await get('/api/v1/activity/me/summary', bearer(depToken))).statusCode).toBe(403);
    await post(consentUrl, {}, bearer(g.token));
    const res = await get('/api/v1/activity/me/summary', bearer(depToken));
    expect(res.statusCode).toBe(200);
    expect(body(res).summary.hoursAvailable).toBe('5.00');
  });
});

describe('tutor: resumo e histórico', () => {
  async function tutorWithClasses() {
    const t = await tutorProfile();
    await prisma.tutorProfile.update({ where: { id: t.profileId }, data: { ratingAverage: 4.5, totalReviews: 2, totalClasses: 2, totalStudents: 3 } });
    const students = await Promise.all([1, 2, 3].map(() => registerUser('STUDENT')));
    const [a, b, c] = students.map((s) => idOf(s.token));
    const past1 = await session(t.profileId, -10);
    const past2 = await session(t.profileId, -20);
    await enrol(past1.id, a, 'PRESENT'); await enrol(past1.id, b, 'PRESENT'); await enrol(past1.id, c, 'ABSENT');
    await enrol(past2.id, a, 'PRESENT'); await enrol(past2.id, b, 'PENDING');
    const future = await session(t.profileId, 24, 'Inglês', 4);
    await session(t.profileId, 48, 'Física', 6);
    await enrol(future.id, a); await enrol(future.id, b);
    return { t, students, past1 };
  }

  it('resumo: estatísticas do perfil, ocupação das próximas aulas e assiduidade', async () => {
    const { t } = await tutorWithClasses();
    const { summary } = body(await get('/api/v1/activity/tutor/summary', bearer(t.token)));
    expect(summary.status).toBe('APPROVED');
    expect(summary.profile).toEqual({ ratingAverage: 4.5, totalReviews: 2, totalClasses: 2, totalStudents: 3 });
    expect(summary.upcoming).toEqual({ sessions: 2, enrolled: 2, seats: 10, fillRate: 20 });
    expect(summary.attendance).toEqual({ present: 3, absent: 1, awaitingAttendance: 1, rate: 75 });
    expect(JSON.stringify(summary)).not.toMatch(/@teste\.educa/);
  });

  it('histórico: só aulas já dadas, com contagens e sem identificar alunos', async () => {
    const { t, students, past1 } = await tutorWithClasses();
    const res = body(await get('/api/v1/activity/tutor/history', bearer(t.token)));
    expect(res.total).toBe(2);
    const row = res.items.find((i: { id: string }) => i.id === past1.id);
    expect(row).toMatchObject({ enrolled: 3, present: 2, absent: 1 });
    for (const s of students) expect(JSON.stringify(res)).not.toContain(idOf(s.token));
    expect(res.items.every((i: { scheduledAt: string }) => new Date(i.scheduledAt) < new Date())).toBe(true);
  });

  it('um tutor não vê dados de outro; sem perfil → 404', async () => {
    await tutorWithClasses();
    const other = await tutorProfile();
    expect(body(await get('/api/v1/activity/tutor/history', bearer(other.token))).total).toBe(0);
    expect(body(await get('/api/v1/activity/tutor/summary', bearer(other.token))).summary.upcoming.fillRate).toBeNull();

    const noProfile = await registerUser('TUTOR');
    expect((await get('/api/v1/activity/tutor/summary', bearer(noProfile.token))).statusCode).toBe(404);
  });
});

describe('administrador: métricas agregadas (RF-HIS-01)', () => {
  const metrics = async (admin: { headers: Record<string, string> }, days = 30) =>
    body(await get(`/api/v1/activity/admin/metrics?days=${days}`, admin.headers)).metrics;

  it('exige administrador com MFA; parâmetros validados', async () => {
    const admin = await adminSession();
    const t = await registerUser('TUTOR');
    expect((await get('/api/v1/activity/admin/metrics', bearer(t.token))).statusCode).toBe(403);
    expect((await get('/api/v1/activity/admin/metrics', admin.headers)).statusCode).toBe(200);
    for (const bad of ['0', '400', 'abc']) {
      expect((await get(`/api/v1/activity/admin/metrics?days=${bad}`, admin.headers)).statusCode).toBe(422);
    }
    // admin sem MFA não vê nada
    const { createAdmin } = await import('./helpers');
    const plain = await createAdmin();
    const token = body(await post('/api/v1/auth/login', { email: plain, password: PASSWORD })).accessToken as string;
    const denied = await get('/api/v1/activity/admin/metrics', bearer(token));
    expect(denied.statusCode).toBe(403);
    expect(body(denied).error.code).toBe('MFA_REQUIRED');
  });

  it('os números acompanham a actividade (variações em relação ao estado anterior)', async () => {
    const admin = await adminSession();
    const before = await metrics(admin);

    const tutor = await tutorProfile('PENDING');
    const cls = await session((await tutorProfile()).profileId, -3);
    const st = await registerUser('STUDENT');
    await enrol(cls.id, idOf(st.token), 'PRESENT');
    const payer = await registerUser('GUARDIAN');
    const payment = await prisma.paymentTransaction.create({
      data: { userId: idOf(payer.token), gateway: 'teste', reference: randomUUID(), amount: 1234.56, hours: 10, status: 'CONFIRMED', confirmedAt: new Date(), idempotencyKey: randomUUID() },
    });
    await prisma.hourPackage.create({ data: { userId: idOf(payer.token), paymentId: payment.id, totalHours: 10, remainingHours: 4 } });
    expect(tutor.profileId).toBeTruthy();

    const after = await metrics(admin);
    expect(after.usersByRole.TUTOR - before.usersByRole.TUTOR).toBe(2);
    expect(after.usersByRole.STUDENT - before.usersByRole.STUDENT).toBe(1);
    expect(after.tutorsByStatus.PENDING - before.tutorsByStatus.PENDING).toBe(1);
    expect(after.tutorsByStatus.APPROVED - before.tutorsByStatus.APPROVED).toBe(1);
    expect(after.classes.sessionsHeld - before.classes.sessionsHeld).toBe(1);
    expect(after.payments.confirmedPayments - before.payments.confirmedPayments).toBe(1);
    expect(+after.payments.confirmedAmount - +before.payments.confirmedAmount).toBeCloseTo(1234.56, 2);
    expect(+after.payments.hoursReleased - +before.payments.hoursReleased).toBeCloseTo(10, 2);
    expect(+after.payments.hoursOutstanding - +before.payments.hoursOutstanding).toBeCloseTo(4, 2);
    expect(after.payments.currency).toBe('AOA');
  });

  it('a janela de dias conta: um pagamento antigo só entra em janelas maiores', async () => {
    const admin = await adminSession();
    const payer = await registerUser('GUARDIAN');
    const before30 = await metrics(admin, 30);
    const before90 = await metrics(admin, 90);
    await prisma.paymentTransaction.create({
      data: { userId: idOf(payer.token), gateway: 'teste', reference: randomUUID(), amount: 500, hours: 1, status: 'CONFIRMED', confirmedAt: new Date(Date.now() - 60 * 86_400_000), idempotencyKey: randomUUID() },
    });
    expect((await metrics(admin, 30)).payments.confirmedPayments).toBe(before30.payments.confirmedPayments);
    expect((await metrics(admin, 90)).payments.confirmedPayments).toBe(before90.payments.confirmedPayments + 1);
  });

  it('só agregados: nenhum dado pessoal nas métricas', async () => {
    const admin = await adminSession();
    const json = JSON.stringify(await metrics(admin));
    expect(json).not.toMatch(/@|password|email|name/i);
  });
});
