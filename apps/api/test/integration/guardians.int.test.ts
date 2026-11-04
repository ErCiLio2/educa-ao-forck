import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { AppError } from '../../src/shared/core/errors';
import { authenticate } from '../../src/modules/auth/auth.middleware';
import { requireConsent } from '../../src/modules/guardians/guardians.middleware';
import { PASSWORD, app, bearer, body, del, email, get, post, registerUser } from './helpers';

// RF-AUT-03, RF-ENC-01/02, RN-02, RNF-SEG-02
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

async function setup() {
  const g1 = await registerUser('GUARDIAN', 'enc1');
  const g2 = await registerUser('GUARDIAN', 'enc2');
  const mail = email('dep');
  const dep = body(
    await post('/api/v1/guardians/dependents', { name: 'Menino', email: mail, password: PASSWORD, birthDate: '2014-05-01' }, bearer(g1.token)),
  ).dependent;
  const depToken = body(await post('/api/v1/auth/login', { email: mail, password: PASSWORD })).accessToken as string;
  return { g1, g2, dep, depToken, url: `/api/v1/guardians/dependents/${dep.id}/consent` };
}

describe('dependentes', () => {
  it('encarregado cria dependente; só ele o vê', async () => {
    const { g1, g2, dep } = await setup();
    expect(dep.password).toBeUndefined();
    const mine = body(await get('/api/v1/guardians/dependents', bearer(g1.token))).dependents;
    const theirs = body(await get('/api/v1/guardians/dependents', bearer(g2.token))).dependents;
    expect(mine.map((d: { id: string }) => d.id)).toContain(dep.id);
    expect(theirs).toHaveLength(0);
  });

  it('aluno adulto regista-se sozinho; menor não (RN-02)', async () => {
    expect((await registerUser('STUDENT')).res.statusCode).toBe(201);
    const minor = await post('/api/v1/auth/register', {
      name: 'Menor', email: email('menor'), password: PASSWORD, role: 'STUDENT',
      birthDate: `${new Date().getUTCFullYear() - 12}-06-15`,
    });
    expect(minor.statusCode).toBe(403);
  });

  it('aluno não cria dependentes (403)', async () => {
    const { depToken } = await setup();
    const r = await post('/api/v1/guardians/dependents', { name: 'X', email: email('x'), password: PASSWORD, birthDate: '2010-01-01' }, bearer(depToken));
    expect(r.statusCode).toBe(403);
  });
});

describe('consentimento', () => {
  it('guard bloqueia sem consentimento e liberta depois; revogação é imediata', async () => {
    const { g1, dep, depToken, url } = await setup();
    const probe = Fastify();
    probe.setErrorHandler((e, _q, r) => r.status(e instanceof AppError ? e.statusCode : 500).send({}));
    probe.get('/dados', { preHandler: [authenticate, requireConsent] }, async () => ({ ok: true }));
    const dados = async () => (await probe.inject({ method: 'GET', url: '/dados', headers: bearer(depToken) })).statusCode;

    expect(await dados()).toBe(403);
    expect((await post(url, {}, bearer(g1.token))).statusCode).toBe(201);
    expect(await dados()).toBe(200);
    expect(body(await get('/api/v1/guardians/consent/me', bearer(depToken))).consent).toEqual({ required: true, granted: true });

    const rev = await del(url, bearer(g1.token));
    expect(rev.statusCode).toBe(200);
    expect(body(rev).consent.revokedAt).not.toBeNull();
    expect(await dados()).toBe(403); // mesmo token
    expect(dep.id).toBeTruthy();
  });

  it('concessões simultâneas: um único consentimento activo', async () => {
    const { g1, dep, url } = await setup();
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(url, {}, bearer(g1.token))));
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.guardianConsent.count({ where: { studentId: dep.id, revokedAt: null } })).toBe(1);
  });

  it('outro encarregado não concede, revoga nem consulta (403)', async () => {
    const { g1, g2, url } = await setup();
    await post(url, {}, bearer(g1.token));
    expect((await post(url, {}, bearer(g2.token))).statusCode).toBe(403);
    expect((await del(url, bearer(g2.token))).statusCode).toBe(403);
    expect((await get(url, bearer(g2.token))).statusCode).toBe(403);
  });

  it('re-conceder após revogar preserva o histórico e audita', async () => {
    const { g1, url } = await setup();
    await post(url, {}, bearer(g1.token));
    await del(url, bearer(g1.token));
    expect((await post(url, {}, bearer(g1.token))).statusCode).toBe(201);
    const hist = body(await get(url, bearer(g1.token))).consents;
    expect(hist).toHaveLength(2);
    expect(hist.filter((c: { revokedAt: string | null }) => c.revokedAt === null)).toHaveLength(1);
    expect((await del(url, bearer(g1.token))).statusCode).toBe(200);
    expect((await del(url, bearer(g1.token))).statusCode).toBe(404);
  });
});
