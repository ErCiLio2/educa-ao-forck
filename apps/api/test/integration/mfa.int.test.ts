import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { totp } from '../../src/shared/core/totp';
import {
  PASSWORD, adminSession, app, bearer, body, createAdmin, enrollMfa, get, loginWithMfa, nextCode,
  post, refreshCookie, registerUser, withCookie,
} from './helpers';

// RNF-SEG-06: MFA obrigatório para administradores
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const nowS = () => Math.floor(Date.now() / 1000);
const WRONG = '000000';
const login = (mail: string) => post('/api/v1/auth/login', { email: mail, password: PASSWORD });

describe('administrador sem MFA', () => {
  it('entra, mas só consegue configurar o MFA: as rotas de administração ficam fechadas', async () => {
    const mail = await createAdmin();
    const res = await login(mail);
    const data = body(res);
    expect(data.mfaEnrollmentRequired).toBe(true);
    expect(jwt.decode(data.accessToken)).not.toHaveProperty('mfaAt');

    const users = await get('/api/v1/admin/users', bearer(data.accessToken));
    expect(users.statusCode).toBe(403);
    expect(body(users).error.code).toBe('MFA_REQUIRED');
    expect((await get('/api/v1/tutors/admin/pending', bearer(data.accessToken))).statusCode).toBe(403);
    expect((await post('/api/v1/auth/mfa/setup', {}, bearer(data.accessToken))).statusCode).toBe(200);
  });

  it('utilizadores que não são admin não vêem mfaEnrollmentRequired nem configuram MFA', async () => {
    const t = await registerUser('TUTOR');
    const mail = (await prisma.user.findUniqueOrThrow({ where: { id: (jwt.decode(t.token) as { sub: string }).sub } })).email;
    expect(body(await login(mail)).mfaEnrollmentRequired).toBeUndefined();
    expect((await post('/api/v1/auth/mfa/setup', {}, bearer(t.token))).statusCode).toBe(403);
  });
});

describe('configuração', () => {
  it('setup devolve segredo e otpauth://; enable exige código válido e setup prévio', async () => {
    const mail = await createAdmin();
    const token = body(await login(mail)).accessToken as string;

    expect(body(await post('/api/v1/auth/mfa/enable', { code: WRONG }, bearer(token))).error.code).toBe('CONFLICT');

    const setup = body(await post('/api/v1/auth/mfa/setup', {}, bearer(token)));
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
    expect((await post('/api/v1/auth/mfa/enable', { code: WRONG }, bearer(token))).statusCode).toBe(401);
    expect((await post('/api/v1/auth/mfa/enable', { code: 'abc' }, bearer(token))).statusCode).toBe(422);
  });

  it('enable activa o MFA, devolve 8 códigos de recuperação e revoga as sessões abertas', async () => {
    const mail = await createAdmin();
    const oldToken = body(await login(mail)).accessToken as string;
    const setup = body(await post('/api/v1/auth/mfa/setup', {}, bearer(oldToken)));
    const res = await post('/api/v1/auth/mfa/enable', { code: nextCode(setup.secret) }, bearer(oldToken));
    const data = body(res);

    expect(res.statusCode).toBe(200);
    expect(data.relogin).toBe(true);
    expect(data.recoveryCodes).toHaveLength(8);
    expect(data.recoveryCodes[0]).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/);
    expect(new Set(data.recoveryCodes).size).toBe(8);

    // a sessão anterior (sem MFA) deixou de valer
    expect((await get('/api/v1/auth/me', bearer(oldToken))).statusCode).toBe(401);
    expect(body(await post('/api/v1/auth/mfa/setup', {}, bearer(oldToken))).error.message).toMatch(/revogada/i);
  });

  it('o segredo e os códigos de recuperação não ficam em claro na BD', async () => {
    const mail = await createAdmin();
    const { secret, recoveryCodes } = await enrollMfa(mail);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: mail }, include: { mfaRecoveryCodes: true } });

    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecret).toMatch(/^v1:/);
    expect(user.mfaSecret).not.toContain(secret);
    expect(user.mfaRecoveryCodes).toHaveLength(8);
    const stored = JSON.stringify(user.mfaRecoveryCodes);
    for (const c of recoveryCodes) expect(stored).not.toContain(c.replaceAll('-', ''));
  });

  it('não se pode configurar duas vezes', async () => {
    const admin = await adminSession();
    expect((await post('/api/v1/auth/mfa/setup', {}, bearer(admin.token))).statusCode).toBe(409);
  });
});

describe('login em dois passos', () => {
  it('a password sozinha não dá sessão: só um desafio, sem tokens nem cookie', async () => {
    const mail = await createAdmin();
    await enrollMfa(mail);
    const res = await login(mail);
    expect(body(res)).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(res.cookies).toHaveLength(0);
  });

  it('com o código certo entra, com MFA no token e na sessão (sobrevive ao refresh)', async () => {
    const admin = await adminSession();
    const claims = jwt.decode(admin.token) as { mfaAt: number };
    expect(Math.abs(claims.mfaAt - nowS())).toBeLessThan(10);
    expect((await get('/api/v1/admin/users', admin.headers)).statusCode).toBe(200);

    // refresh preserva o MFA e o instante original (não o renova)
    const second = await loginWithMfa(admin.email, nextCode(admin.secret));
    const refreshed = await post('/api/v1/auth/refresh', {}, withCookie(refreshCookie(second.res)));
    const refreshedClaims = jwt.decode(body(refreshed).accessToken) as { mfaAt: number };
    expect(refreshedClaims.mfaAt).toBe((jwt.decode(second.accessToken) as { mfaAt: number }).mfaAt);
    expect((await get('/api/v1/admin/users', bearer(body(refreshed).accessToken))).statusCode).toBe(200);
  });

  it('código errado, formato errado e desafio inválido → 401/422', async () => {
    const admin = await adminSession();
    const challenge = body(await login(admin.email)).challenge as string;
    expect((await post('/api/v1/auth/mfa/verify', { challenge, code: WRONG })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/mfa/verify', { challenge, code: 'ab' })).statusCode).toBe(422);
    expect((await post('/api/v1/auth/mfa/verify', { challenge: 'x'.repeat(40), code: nextCode(admin.secret) })).statusCode).toBe(401);
  });

  it('um access token não serve de desafio, nem um desafio de access token', async () => {
    const admin = await adminSession();
    const code = nextCode(admin.secret);
    expect((await post('/api/v1/auth/mfa/verify', { challenge: admin.token, code })).statusCode).toBe(401);
    const challenge = body(await login(admin.email)).challenge as string;
    expect((await get('/api/v1/auth/me', bearer(challenge))).statusCode).toBe(401);
  });

  it('um código só vale uma vez (anti-replay), incluindo o usado na configuração', async () => {
    const mail = await createAdmin();
    const { secret } = await enrollMfa(mail);
    const code = nextCode(secret);
    expect((await loginWithMfa(mail, code)).res.statusCode).toBe(200);
    expect((await loginWithMfa(mail, code)).res.statusCode).toBe(401); // o mesmo código outra vez

    // o código gerado no passo actual durante o enable também está queimado
    const burned = totp(secret, Date.now());
    const results = await Promise.all([burned].map((c) => loginWithMfa(mail, c).then((r) => r.res.statusCode)));
    expect(results[0]).toBe(401);
  });

  it('tentativas simultâneas com o mesmo código: só uma entra', async () => {
    const admin = await adminSession();
    const code = nextCode(admin.secret);
    const rs = await Promise.all(Array.from({ length: 5 }, () => loginWithMfa(admin.email, code)));
    expect(rs.map((r) => r.res.statusCode).sort()).toEqual([200, 401, 401, 401, 401]);
  });
});

describe('força bruta', () => {
  it('5 erros bloqueiam o utilizador (429), mesmo com o código certo; fica auditado', async () => {
    const admin = await adminSession();
    const challenge = body(await login(admin.email)).challenge as string;
    for (let i = 0; i < 5; i++) {
      expect((await post('/api/v1/auth/mfa/verify', { challenge, code: WRONG })).statusCode).toBe(401);
    }
    const locked = await post('/api/v1/auth/mfa/verify', { challenge, code: nextCode(admin.secret) });
    expect(locked.statusCode).toBe(429);
    expect(body(locked).error.code).toBe('TOO_MANY_REQUESTS');

    const user = await prisma.user.findUniqueOrThrow({ where: { email: admin.email } });
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'MFA_LOCKED' } })).toBe(1);
  });

  it('um sucesso repõe o contador', async () => {
    const admin = await adminSession();
    const challenge = body(await login(admin.email)).challenge as string;
    for (let i = 0; i < 4; i++) await post('/api/v1/auth/mfa/verify', { challenge, code: WRONG });
    expect((await post('/api/v1/auth/mfa/verify', { challenge, code: nextCode(admin.secret) })).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await post('/api/v1/auth/mfa/verify', { challenge, code: WRONG })).statusCode).toBe(401); // nenhum 429
    }
  });
});

describe('códigos de recuperação', () => {
  it('servem uma vez, com ou sem traços e em maiúsculas; o seguinte funciona', async () => {
    const mail = await createAdmin();
    const { recoveryCodes } = await enrollMfa(mail);

    const first = await loginWithMfa(mail, recoveryCodes[0].toUpperCase());
    expect(first.res.statusCode).toBe(200);
    expect((await loginWithMfa(mail, recoveryCodes[0])).res.statusCode).toBe(401); // já gasto
    expect((await loginWithMfa(mail, recoveryCodes[1].replaceAll('-', ''))).res.statusCode).toBe(200);
    expect((await loginWithMfa(mail, 'ffffff-ffffff')).res.statusCode).toBe(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: mail } });
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: 'MFA_RECOVERY_CODE_USED' } })).toBe(2);
  });

  it('código de recuperação de outro administrador não serve', async () => {
    const a = await createAdmin();
    const b = await createAdmin();
    await enrollMfa(a);
    const { recoveryCodes } = await enrollMfa(b);
    expect((await loginWithMfa(a, recoveryCodes[0])).res.statusCode).toBe(401);
  });
});

describe('step-up (acções sensíveis, RN-08)', () => {
  it('MFA antigo → 403 STEP_UP; confirmar com um código dá um token novo que passa', async () => {
    const admin = await adminSession();
    // Token com MFA de há 1 h, na época de sessão actual do administrador
    const claims = jwt.decode(admin.token) as { sub: string; ep: number };
    const stale = jwt.sign(
      { sub: claims.sub, role: 'ADMIN', ep: claims.ep, mfaAt: nowS() - 3600 },
      process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '5m' },
    );
    const sensitive = (token: string) =>
      post('/api/v1/admin/role-changes', { userId: '00000000-0000-4000-8000-000000000001', role: 'TUTOR' }, bearer(token));

    const denied = await sensitive(stale);
    expect(denied.statusCode).toBe(403);
    expect(body(denied).error.code).toBe('MFA_STEP_UP_REQUIRED');
    expect((await get('/api/v1/admin/users', bearer(stale))).statusCode).toBe(200); // leitura não exige recente

    expect((await post('/api/v1/auth/mfa/step-up', { code: WRONG }, bearer(stale))).statusCode).toBe(401);
    const up = await post('/api/v1/auth/mfa/step-up', { code: nextCode(admin.secret) }, bearer(stale));
    expect(up.statusCode).toBe(200);
    expect(Math.abs((jwt.decode(body(up).accessToken) as { mfaAt: number }).mfaAt - nowS())).toBeLessThan(10);
    expect((await sensitive(body(up).accessToken)).statusCode).toBe(404); // passou o guard: o alvo é que não existe
  });

  it('step-up exige sessão com MFA (um admin sem MFA não o consegue)', async () => {
    const mail = await createAdmin();
    const token = body(await login(mail)).accessToken as string;
    expect((await post('/api/v1/auth/mfa/step-up', { code: WRONG }, bearer(token))).statusCode).toBe(403);
  });
});
