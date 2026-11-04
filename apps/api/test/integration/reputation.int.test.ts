import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { PASSWORD, app, bearer, body, email, get, patch, post, registerUser } from './helpers';

// RF-AVA-01, RN-06, RF-TUT-03
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;
const HOUR = 3_600_000;
const GOOD = { rating: 4, punctuality: 5, subjectMastery: 4, didacticClarity: 4, progress: 3 };

async function approvedTutor(status: 'APPROVED' | 'PENDING' = 'APPROVED') {
  const t = await registerUser('TUTOR');
  const profile = await prisma.tutorProfile.create({ data: { userId: idOf(t.token), status, subjects: ['M'] } });
  return { ...t, profileId: profile.id };
}

// Aula que começou há `startedHoursAgo` h e dura 1 h
const sessionFor = (tutorId: string, startedHoursAgo = 3) =>
  prisma.classSession.create({
    data: {
      tutorId, title: 'Aula', subject: 'M', type: 'GROUP', maxCapacity: 7,
      scheduledAt: new Date(Date.now() - startedHoursAgo * HOUR), durationMin: 60,
    },
  });

async function attendee(sessionId: string, attendance: 'PRESENT' | 'ABSENT' | 'PENDING' = 'PRESENT') {
  const s = await registerUser('STUDENT');
  const id = idOf(s.token);
  const enrollment = await prisma.classEnrollment.create({
    data: { classId: sessionId, studentId: id, hoursDebited: 0, attendanceStatus: attendance },
  });
  return { ...s, id, enrollmentId: enrollment.id };
}

const review = (token: string, sessionId: string, over: Record<string, unknown> = {}) =>
  post(`/api/v1/reputation/sessions/${sessionId}/review`, { ...GOOD, ...over }, bearer(token));
const profileOf = (id: string) => prisma.tutorProfile.findUniqueOrThrow({ where: { id } });

describe('quem pode avaliar', () => {
  it('só quem esteve presente numa aula já terminada', async () => {
    const t = await approvedTutor();
    const ended = await sessionFor(t.profileId);
    const ongoing = await sessionFor(t.profileId, 0.5); // começou há 30 min, ainda decorre

    const present = await attendee(ended.id);
    const absent = await attendee(ended.id, 'ABSENT');
    const unmarked = await attendee(ended.id, 'PENDING');
    const stranger = await registerUser('STUDENT');
    const inProgress = await attendee(ongoing.id);

    expect((await review(present.token, ended.id)).statusCode).toBe(201);
    expect((await review(absent.token, ended.id)).statusCode).toBe(403);
    expect((await review(unmarked.token, ended.id)).statusCode).toBe(403);
    expect((await review(stranger.token, ended.id)).statusCode).toBe(404);
    expect((await review(inProgress.token, ongoing.id)).statusCode).toBe(403);
    expect(await prisma.review.count({ where: { tutorId: t.profileId } })).toBe(1);
  });

  it('uma avaliação por aula (409) e só perfis de aluno (403)', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const st = await attendee(s.id);
    expect((await review(st.token, s.id)).statusCode).toBe(201);
    expect((await review(st.token, s.id)).statusCode).toBe(409);
    expect((await review(t.token, s.id)).statusCode).toBe(403);
    expect((await post(`/api/v1/reputation/sessions/${s.id}/review`, GOOD)).statusCode).toBe(401);
  });

  it('dependente sem consentimento não avalia nem consulta pendentes', async () => {
    const g = await registerUser('GUARDIAN');
    const mail = email('dep');
    await post('/api/v1/guardians/dependents', { name: 'Menino', email: mail, password: PASSWORD, birthDate: '2014-05-01' }, bearer(g.token));
    const depToken = body(await post('/api/v1/auth/login', { email: mail, password: PASSWORD })).accessToken as string;
    expect((await get('/api/v1/reputation/reviews/pending', bearer(depToken))).statusCode).toBe(403);
    expect((await review(depToken, randomUUID())).statusCode).toBe(403);
  });
});

describe('validação (RN-06)', () => {
  it('só 1 a 5 inteiros, todos os critérios obrigatórios, comentário opcional', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const st = await attendee(s.id);
    for (const bad of [{ rating: 0 }, { rating: 6 }, { punctuality: 2.5 }, { progress: '5' }, { comment: 'x'.repeat(1001) }]) {
      expect((await review(st.token, s.id, bad)).statusCode, JSON.stringify(bad)).toBe(422);
    }
    const { rating: _omit, ...semNota } = GOOD;
    expect((await post(`/api/v1/reputation/sessions/${s.id}/review`, semNota, bearer(st.token))).statusCode).toBe(422);
    const ok = await review(st.token, s.id, { comment: '   ' });
    expect(ok.statusCode).toBe(201);
    expect(body(ok).review.comment).toBeNull();
  });

  it('a BD também recusa notas fora de 1..5', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const st = await attendee(s.id);
    await expect(
      prisma.review.create({ data: { studentId: st.id, classId: s.id, tutorId: t.profileId, ...GOOD, rating: 9 } }),
    ).rejects.toThrow();
  });
});

describe('estatísticas do perfil do tutor (RF-TUT-03)', () => {
  it('média e total de avaliações actualizam-se e aparecem no perfil público', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const [a, b] = [await attendee(s.id), await attendee(s.id)];
    await review(a.token, s.id, { rating: 4 });
    await review(b.token, s.id, { rating: 5 });

    const p = await profileOf(t.profileId);
    expect(p.ratingAverage).toBe(4.5);
    expect(p.totalReviews).toBe(2);
    const pub = body(await get(`/api/v1/tutors/${t.profileId}`)).profile;
    expect(pub.averageRating).toBe(4.5);
    expect(pub.reviewCount).toBe(2);
  });

  it('avaliações simultâneas não perdem nenhuma (média e total exactos)', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const students = await Promise.all(Array.from({ length: 6 }, () => attendee(s.id)));
    const ratings = [1, 2, 3, 4, 5, 5];
    const rs = await Promise.all(students.map((st, i) => review(st.token, s.id, { rating: ratings[i] })));
    expect(rs.every((r) => r.statusCode === 201)).toBe(true);

    const p = await profileOf(t.profileId);
    expect(p.totalReviews).toBe(6);
    expect(p.ratingAverage).toBe(3.33); // (1+2+3+4+5+5)/6
  });

  it('presenças marcadas pelo tutor actualizam aulas dadas e alunos', async () => {
    const t = await approvedTutor();
    const s1 = await sessionFor(t.profileId, 5);
    const s2 = await sessionFor(t.profileId, 4);
    const a = await attendee(s1.id, 'PENDING');
    const b = await attendee(s1.id, 'PENDING');
    const c = await prisma.classEnrollment.create({ data: { classId: s2.id, studentId: a.id, hoursDebited: 0 } });
    const mark = (sessionId: string, enrollmentId: string, status: string) =>
      patch(`/api/v1/bookings/sessions/${sessionId}/enrollments/${enrollmentId}`, { attendanceStatus: status }, bearer(t.token));

    expect((await profileOf(t.profileId)).totalClasses).toBe(0);
    await mark(s1.id, a.enrollmentId, 'PRESENT');
    await mark(s1.id, b.enrollmentId, 'PRESENT');
    await mark(s2.id, c.id, 'PRESENT'); // o mesmo aluno em 2 aulas conta 1 vez
    let p = await profileOf(t.profileId);
    expect([p.totalClasses, p.totalStudents]).toEqual([2, 2]);

    await mark(s1.id, b.enrollmentId, 'ABSENT');
    await mark(s2.id, c.id, 'ABSENT');
    p = await profileOf(t.profileId);
    expect([p.totalClasses, p.totalStudents]).toEqual([1, 1]);
  });
});

describe('consulta pública e pendentes', () => {
  it('lista anónima com resumo por critério; tutor não aprovado → 404', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const st = await attendee(s.id);
    await review(st.token, s.id, { rating: 5, punctuality: 4, comment: 'Excelente' });

    const res = await get(`/api/v1/reputation/tutors/${t.profileId}/reviews`);
    const data = body(res);
    expect(res.statusCode).toBe(200);
    expect(data.summary).toMatchObject({ total: 1, average: 5, criteria: { punctuality: 4 } });
    expect(data.reviews[0].comment).toBe('Excelente');
    expect(JSON.stringify(data)).not.toContain(st.id);
    expect(data.reviews[0].studentId).toBeUndefined();

    const pending = await approvedTutor('PENDING');
    expect((await get(`/api/v1/reputation/tutors/${pending.profileId}/reviews`)).statusCode).toBe(404);
    expect((await get(`/api/v1/reputation/tutors/${t.profileId}/reviews?limit=999`)).statusCode).toBe(422);
    expect((await get('/api/v1/reputation/tutors/nao-e-uuid/reviews')).statusCode).toBe(422);
  });

  it('pendentes: aparecem até serem avaliadas', async () => {
    const t = await approvedTutor();
    const s = await sessionFor(t.profileId);
    const st = await attendee(s.id);
    const ids = async () => (body(await get('/api/v1/reputation/reviews/pending', bearer(st.token))).sessions as Array<{ id: string }>).map((x) => x.id);

    expect(await ids()).toContain(s.id);
    await review(st.token, s.id);
    expect(await ids()).not.toContain(s.id);
  });
});
