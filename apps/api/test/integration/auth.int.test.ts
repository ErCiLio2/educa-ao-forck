import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import {
  PASSWORD, app, bearer, body, email, get, post, refreshCookie, registerUser, withCookie,
} from './helpers';

// US02 — RF-AUT-01, RNF-SEG-01: JWT curto, refresh rotativo com detecção de reutilização
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

describe('registo e login', () => {
  it('regista, emite access token e cookie httpOnly de refresh', async () => {
    const { res } = await registerUser('TUTOR');
    expect(res.statusCode).toBe(201);
    const cookie = res.cookies.find((c) => c.name === 'refresh_token')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
    expect(cookie.path).toBe('/api/v1/auth');
  });

  it('access token dura entre 10 e 15 minutos', async () => {
    const { token } = await registerUser('TUTOR');
    const { iat, exp } = jwt.decode(token) as { iat: number; exp: number };
    expect(exp - iat).toBeGreaterThanOrEqual(600);
    expect(exp - iat).toBeLessThanOrEqual(900);
  });

  it('email duplicado (maiúsculas incluídas) → 409', async () => {
    const { email: mail } = await registerUser('TUTOR');
    const dup = await post('/api/v1/auth/register', {
      name: 'Outro', email: mail.toUpperCase(), password: PASSWORD, role: 'TUTOR',
    });
    expect(dup.statusCode).toBe(409);
  });

  it('login com credenciais erradas ou inexistentes dá a mesma resposta (sem enumeração)', async () => {
    const { email: mail } = await registerUser('TUTOR');
    const wrongPw = await post('/api/v1/auth/login', { email: mail, password: 'Errada123' });
    const unknown = await post('/api/v1/auth/login', { email: email('naoexiste'), password: PASSWORD });
    expect(wrongPw.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(body(wrongPw)).toEqual(body(unknown));
  });

  it('/me devolve o utilizador autenticado', async () => {
    const { token, email: mail } = await registerUser('GUARDIAN');
    const me = await get('/api/v1/auth/me', bearer(token));
    expect(me.statusCode).toBe(200);
    expect(body(me).user.email).toBe(mail);
    expect(body(me).user.password).toBeUndefined();
  });
});

describe('refresh token rotativo', () => {
  const login = async () => {
    const { email: mail } = await registerUser('TUTOR');
    return post('/api/v1/auth/login', { email: mail, password: PASSWORD });
  };

  it('sem cookie → 401', async () => {
    expect((await post('/api/v1/auth/refresh')).statusCode).toBe(401);
  });

  it('cada refresh devolve um token novo e o anterior deixa de servir', async () => {
    const r0 = refreshCookie(await login());
    const first = await post('/api/v1/auth/refresh', {}, withCookie(r0));
    expect(first.statusCode).toBe(200);
    const r1 = refreshCookie(first);
    expect(r1).not.toBe(r0);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(r1))).statusCode).toBe(200);
  });

  it('reutilização de um token antigo revoga toda a família', async () => {
    const r0 = refreshCookie(await login());
    const r1 = refreshCookie(await post('/api/v1/auth/refresh', {}, withCookie(r0)));

    const replay = await post('/api/v1/auth/refresh', {}, withCookie(r0));
    expect(replay.statusCode).toBe(401);
    // o token legítimo mais recente também foi revogado
    expect((await post('/api/v1/auth/refresh', {}, withCookie(r1))).statusCode).toBe(401);
  });

  it('reutilização fica no audit log', async () => {
    const { email: mail } = await registerUser('TUTOR');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: mail } });
    const r0 = refreshCookie(await post('/api/v1/auth/login', { email: mail, password: PASSWORD }));
    await post('/api/v1/auth/refresh', {}, withCookie(r0));
    await post('/api/v1/auth/refresh', {}, withCookie(r0));
    const n = await prisma.auditLog.count({ where: { actorId: user.id, action: 'REFRESH_TOKEN_REUSE_DETECTED' } });
    expect(n).toBe(1);
  });

  it('dois refresh simultâneos com o mesmo token: só um vence', async () => {
    const r0 = refreshCookie(await login());
    const [a, b] = await Promise.all([
      post('/api/v1/auth/refresh', {}, withCookie(r0)),
      post('/api/v1/auth/refresh', {}, withCookie(r0)),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
  });

  it('logout revoga a sessão', async () => {
    const r0 = refreshCookie(await login());
    expect((await post('/api/v1/auth/logout', {}, withCookie(r0))).statusCode).toBe(204);
    expect((await post('/api/v1/auth/refresh', {}, withCookie(r0))).statusCode).toBe(401);
  });

  it('token de refresh não serve como access token', async () => {
    const r0 = refreshCookie(await login());
    expect((await get('/api/v1/auth/me', bearer(r0))).statusCode).toBe(401);
  });
});
