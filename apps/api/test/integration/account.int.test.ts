import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import {
  PASSWORD, adminSession, app, bearer, body, email, get, patch, post, refreshCookie, registerUser, withCookie,
} from './helpers';

// RF-AUT-04: o utilizador gere o seu perfil e a sua password
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;
const NEW_PASSWORD = 'NovaPass123';
const login = (mail: string, password = PASSWORD) => post('/api/v1/auth/login', { email: mail, password });
const changePassword = (token: string, currentPassword: string, newPassword: string) =>
  post('/api/v1/auth/password', { currentPassword, newPassword }, bearer(token));
const audit = (userId: string, action: string) => prisma.auditLog.count({ where: { actorId: userId, action } });

async function userWithSession(role: 'TUTOR' | 'GUARDIAN' | 'STUDENT' = 'TUTOR') {
  const u = await registerUser(role);
  const session = await login(u.email);
  return { ...u, id: idOf(u.token), refresh: refreshCookie(session), token: body(session).accessToken as string };
}

describe('dados da conta', () => {
  it('altera o nome sem pedir password e mantém a sessão', async () => {
    const u = await userWithSession();
    const res = await patch('/api/v1/auth/me', { name: '  Maria Silva  ' }, bearer(u.token));
    expect(res.statusCode).toBe(200);
    expect(body(res).user.name).toBe('Maria Silva');
    expect(body(res).accessToken).toBeUndefined();
    expect((await get('/api/v1/auth/me', bearer(u.token))).statusCode).toBe(200);
    expect(await audit(u.id, 'PROFILE_UPDATED')).toBe(1);
  });

  it('validações: vazio, nome curto, campos que não se podem alterar', async () => {
    const u = await userWithSession();
    expect((await patch('/api/v1/auth/me', {}, bearer(u.token))).statusCode).toBe(422);
    expect((await patch('/api/v1/auth/me', { name: 'A' }, bearer(u.token))).statusCode).toBe(422);
    // papel e data de nascimento são ignorados: nunca se alteram por aqui
    const res = await patch('/api/v1/auth/me', { name: 'Nome Novo', role: 'ADMIN', birthDate: '2000-01-01' }, bearer(u.token));
    expect(res.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('TUTOR');
    expect((await patch('/api/v1/auth/me', { name: 'X Y' })).statusCode).toBe(401);
  });

  it('o email exige a password actual; com ela muda, normaliza e revoga as outras sessões', async () => {
    const u = await userWithSession();
    const other = await login(u.email); // outro dispositivo
    const otherToken = body(other).accessToken as string;
    const newMail = email('novo').toUpperCase();

    expect((await patch('/api/v1/auth/me', { email: newMail }, bearer(u.token))).statusCode).toBe(422);
    const wrong = await patch('/api/v1/auth/me', { email: newMail, currentPassword: 'Errada1234' }, bearer(u.token));
    expect(wrong.statusCode).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).email).toBe(u.email);

    const ok = await patch('/api/v1/auth/me', { email: newMail, currentPassword: PASSWORD }, bearer(u.token));
    expect(ok.statusCode).toBe(200);
    expect(body(ok).user.email).toBe(newMail.toLowerCase());
    // esta sessão recebe tokens novos; as outras caem
    expect((await get('/api/v1/auth/me', bearer(body(ok).accessToken))).statusCode).toBe(200);
    expect((await get('/api/v1/auth/me', bearer(u.token))).statusCode).toBe(401);
    expect((await get('/api/v1/auth/me', bearer(otherToken))).statusCode).toBe(401);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(refreshCookie(other)))).statusCode).toBe(401);

    expect((await login(u.email)).statusCode).toBe(401); // o email antigo já não entra
    expect((await login(newMail)).statusCode).toBe(200);
    expect(await audit(u.id, 'EMAIL_CHANGED')).toBe(1);
  });

  it('email já registado → 409; o mesmo email não revoga nada', async () => {
    const a = await userWithSession();
    const b = await userWithSession();
    const taken = await patch('/api/v1/auth/me', { email: b.email, currentPassword: PASSWORD }, bearer(a.token));
    expect(taken.statusCode).toBe(409);
    expect((await get('/api/v1/auth/me', bearer(a.token))).statusCode).toBe(200);

    const same = await patch('/api/v1/auth/me', { email: a.email.toUpperCase(), currentPassword: PASSWORD }, bearer(a.token));
    expect(same.statusCode).toBe(200);
    expect(body(same).accessToken).toBeUndefined();
    expect((await get('/api/v1/auth/me', bearer(a.token))).statusCode).toBe(200);
  });
});

describe('alterar a password', () => {
  it('valida a password actual e a força da nova', async () => {
    const u = await userWithSession();
    expect((await changePassword(u.token, 'Errada1234', NEW_PASSWORD)).statusCode).toBe(403);
    expect((await changePassword(u.token, PASSWORD, 'fraca')).statusCode).toBe(422);
    expect((await changePassword(u.token, PASSWORD, PASSWORD)).statusCode).toBe(422);
    expect((await changePassword(u.token, PASSWORD, 'A1' + 'x'.repeat(200))).statusCode).toBe(422);
    expect((await login(u.email)).statusCode).toBe(200); // nada mudou
  });

  it('troca a password, mantém este dispositivo e derruba todos os outros', async () => {
    const u = await userWithSession();
    const second = await login(u.email);
    const secondToken = body(second).accessToken as string;

    const res = await changePassword(u.token, PASSWORD, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);
    const fresh = body(res).accessToken as string;

    expect((await login(u.email, PASSWORD)).statusCode).toBe(401);
    expect((await login(u.email, NEW_PASSWORD)).statusCode).toBe(200);
    expect((await get('/api/v1/auth/me', bearer(fresh))).statusCode).toBe(200);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(refreshCookie(res)))).statusCode).toBe(200);

    for (const old of [u.token, secondToken]) expect((await get('/api/v1/auth/me', bearer(old))).statusCode).toBe(401);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(u.refresh))).statusCode).toBe(401);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(refreshCookie(second)))).statusCode).toBe(401);
    expect(await audit(u.id, 'PASSWORD_CHANGED')).toBe(1);
  });

  it('a password nunca aparece nas respostas nem nos registos de auditoria', async () => {
    const u = await userWithSession();
    const res = await changePassword(u.token, PASSWORD, NEW_PASSWORD);
    expect(res.body).not.toContain(NEW_PASSWORD);
    const logs = JSON.stringify(await prisma.auditLog.findMany({ where: { actorId: u.id } }));
    expect(logs).not.toContain(NEW_PASSWORD);
    expect(logs).not.toContain(PASSWORD);
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).password;
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('5 erros bloqueiam a verificação (429), mesmo com a password certa', async () => {
    const u = await userWithSession();
    for (let i = 0; i < 5; i++) expect((await changePassword(u.token, 'Errada1234', NEW_PASSWORD)).statusCode).toBe(403);
    const locked = await changePassword(u.token, PASSWORD, NEW_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect((await login(u.email, PASSWORD)).statusCode).toBe(200); // a password não mudou
    expect(await audit(u.id, 'PASSWORD_CHECK_LOCKED')).toBe(1);
  });

  it('o bloqueio também protege a mudança de email', async () => {
    const u = await userWithSession();
    for (let i = 0; i < 5; i++) await patch('/api/v1/auth/me', { email: email('x'), currentPassword: 'Errada1234' }, bearer(u.token));
    const res = await patch('/api/v1/auth/me', { email: email('y'), currentPassword: PASSWORD }, bearer(u.token));
    expect(res.statusCode).toBe(429);
  });

  it('administrador: precisa de MFA recente e a sessão mantém o MFA', async () => {
    const admin = await adminSession();
    const res = await changePassword(admin.token, PASSWORD, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);
    const fresh = body(res).accessToken as string;
    expect(jwt.decode(fresh)).toHaveProperty('mfaAt');
    expect((await get('/api/v1/admin/users', bearer(fresh))).statusCode).toBe(200);

    // sem MFA (sessão só com password) não consegue
    const mail = (await adminSession()).email;
    const stale = jwt.sign(
      { sub: idOf(admin.token), role: 'ADMIN', ep: (jwt.decode(fresh) as { ep: number }).ep },
      process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '5m' },
    );
    const denied = await changePassword(stale, NEW_PASSWORD, 'Outra12345');
    expect(denied.statusCode).toBe(403);
    expect(body(denied).error.code).toBe('MFA_REQUIRED');
    expect(mail).toBeTruthy();
  });
});

describe('Encarregado repõe a password do dependente', () => {
  async function guardianWithDependent() {
    const g = await registerUser('GUARDIAN');
    const mail = email('dep');
    const dep = body(await post('/api/v1/guardians/dependents', { name: 'Menino', email: mail, password: PASSWORD, birthDate: '2014-05-01' }, bearer(g.token))).dependent;
    const session = await login(mail);
    return { g, dep, mail, depToken: body(session).accessToken as string, depRefresh: refreshCookie(session) };
  }
  const reset = (token: string, studentId: string, newPassword: string) =>
    post(`/api/v1/guardians/dependents/${studentId}/password`, { newPassword }, bearer(token));

  it('repõe, revoga as sessões do dependente e a nova password funciona', async () => {
    const { g, dep, mail, depToken, depRefresh } = await guardianWithDependent();
    const res = await reset(g.token, dep.id, NEW_PASSWORD);
    expect(res.statusCode).toBe(204);

    expect((await login(mail, PASSWORD)).statusCode).toBe(401);
    expect((await login(mail, NEW_PASSWORD)).statusCode).toBe(200);
    expect((await get('/api/v1/auth/me', bearer(depToken))).statusCode).toBe(401);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(depRefresh))).statusCode).toBe(401);
    expect(await audit(idOf(g.token), 'DEPENDENT_PASSWORD_RESET')).toBe(1);
    // o Encarregado continua com a sua sessão
    expect((await get('/api/v1/auth/me', bearer(g.token))).statusCode).toBe(200);
  });

  it('só o seu Encarregado: outro Encarregado, um aluno e um tutor são recusados', async () => {
    const { g, dep, mail } = await guardianWithDependent();
    const stranger = await registerUser('GUARDIAN');
    const tutor = await registerUser('TUTOR');
    const unrelated = await registerUser('STUDENT');

    expect((await reset(stranger.token, dep.id, NEW_PASSWORD)).statusCode).toBe(403);
    expect((await reset(tutor.token, dep.id, NEW_PASSWORD)).statusCode).toBe(403);
    expect((await reset(unrelated.token, dep.id, NEW_PASSWORD)).statusCode).toBe(403);
    expect((await reset(g.token, idOf(unrelated.token), NEW_PASSWORD)).statusCode).toBe(403); // não é dependente seu
    expect((await login(mail, PASSWORD)).statusCode).toBe(200); // nada mudou
  });

  it('valida a nova password e o identificador', async () => {
    const { g, dep } = await guardianWithDependent();
    expect((await reset(g.token, dep.id, 'fraca')).statusCode).toBe(422);
    expect((await reset(g.token, 'nao-e-uuid', NEW_PASSWORD)).statusCode).toBe(422);
  });

  it('o dependente troca a sua própria password mesmo sem consentimento (segurança da conta)', async () => {
    const { dep, depToken, mail } = await guardianWithDependent();
    expect(dep.id).toBeTruthy();
    const res = await changePassword(depToken, PASSWORD, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);
    expect((await login(mail, NEW_PASSWORD)).statusCode).toBe(200);
  });
});

describe('perfil do tutor (RF-AUT-04)', () => {
  async function approvedTutor() {
    const t = await registerUser('TUTOR');
    const profile = await prisma.tutorProfile.create({ data: { userId: idOf(t.token), status: 'APPROVED', subjects: ['Matemática'], bio: 'Antiga' } });
    return { ...t, profileId: profile.id };
  }

  it('edita a biografia e as disciplinas; o catálogo reflecte a alteração', async () => {
    const t = await approvedTutor();
    const subject = `Disc-${Date.now()}`;
    const res = await patch('/api/v1/tutors/profile', { bio: '  Nova biografia  ', subjects: ['Matemática', subject, subject] }, bearer(t.token));
    expect(res.statusCode).toBe(200);
    expect(body(res).profile.bio).toBe('Nova biografia');
    expect(body(res).profile.subjects).toEqual(['Matemática', subject]); // sem repetidas
    expect(body(res).profile.diplomaKey).toBeUndefined();

    const catalog = body(await get(`/api/v1/tutors?disciplina=${encodeURIComponent(subject)}`));
    expect(catalog.tutors.map((x: { id: string }) => x.id)).toContain(t.profileId);
    expect(await audit(idOf(t.token), 'PROFILE_UPDATED')).toBe(1);
  });

  it('actualização parcial, null apaga a biografia, nada para actualizar → 422', async () => {
    const t = await approvedTutor();
    const only = await patch('/api/v1/tutors/profile', { subjects: ['Física'] }, bearer(t.token));
    expect(body(only).profile).toMatchObject({ bio: 'Antiga', subjects: ['Física'] });
    const cleared = await patch('/api/v1/tutors/profile', { bio: null }, bearer(t.token));
    expect(body(cleared).profile.bio).toBeNull();
    for (const bad of [{}, { subjects: [] }, { subjects: Array(21).fill('M') }, { bio: 'x'.repeat(1001) }]) {
      expect((await patch('/api/v1/tutors/profile', bad, bearer(t.token))).statusCode, JSON.stringify(bad).slice(0, 30)).toBe(422);
    }
  });

  it('não altera o estado de verificação nem os documentos; outros perfis e sem perfil são recusados', async () => {
    const t = await approvedTutor();
    await patch('/api/v1/tutors/profile', { bio: 'x', status: 'REJECTED', diplomaKey: 'tutors/x/DIPLOMA/y.pdf', ratingAverage: 5 }, bearer(t.token));
    const row = await prisma.tutorProfile.findUniqueOrThrow({ where: { id: t.profileId } });
    expect(row).toMatchObject({ status: 'APPROVED', diplomaKey: null, ratingAverage: 0 });

    const g = await registerUser('GUARDIAN');
    expect((await patch('/api/v1/tutors/profile', { bio: 'x' }, bearer(g.token))).statusCode).toBe(403);
    const noProfile = await registerUser('TUTOR');
    expect((await patch('/api/v1/tutors/profile', { bio: 'x' }, bearer(noProfile.token))).statusCode).toBe(404);
  });
});
