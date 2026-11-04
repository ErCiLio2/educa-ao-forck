import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { buildApp } from '../src/app';
import { ID, PROTECTED, ROLES, type Role } from './protected-routes';

// Segregação dos 4 perfis (RF-AUT-02, RNF-SEG-02). Cobre as recusas, que acontecem nos
// guards antes de qualquer acesso à BD. Os caminhos permitidos são cobertos por testes de integração.

const tokenFor = (role: Role, secret = process.env.ACCESS_TOKEN_SECRET!) =>
  jwt.sign({ sub: ID, role }, secret, { expiresIn: '5m' });

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

const call = (method: string, url: string, token?: string) =>
  app.inject({
    method: method as 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: method === 'GET' ? undefined : {},
  });

describe('sem autenticação', () => {
  it.each(PROTECTED)('%s %s → 401', async (method, url) => {
    expect((await call(method, url)).statusCode).toBe(401);
  });
});

describe('perfil errado → 403', () => {
  const denied = PROTECTED.flatMap(([method, url, allowed]) =>
    ROLES.filter((r) => !allowed.includes(r)).map((r) => [r, method, url] as const),
  );
  it.each(denied)('%s em %s %s', async (role, method, url) => {
    expect((await call(method, url, tokenFor(role))).statusCode).toBe(403);
  });
});

describe('tokens inválidos → 401', () => {
  it('assinado com outro segredo (ex.: o do refresh token)', async () => {
    const t = tokenFor('ADMIN', process.env.REFRESH_TOKEN_SECRET!);
    expect((await call('GET', '/api/v1/tutors/admin/pending', t)).statusCode).toBe(401);
  });
  it('alg none', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: ID, role: 'ADMIN' })}.`;
    expect((await call('GET', '/api/v1/tutors/admin/pending', t)).statusCode).toBe(401);
  });
  it('expirado', async () => {
    const t = jwt.sign({ sub: ID, role: 'ADMIN' }, process.env.ACCESS_TOKEN_SECRET!, { expiresIn: -10 });
    expect((await call('GET', '/api/v1/tutors/admin/pending', t)).statusCode).toBe(401);
  });
  it('lixo', async () => {
    expect((await call('GET', '/api/v1/auth/me', 'abc.def.ghi')).statusCode).toBe(401);
  });
});

describe('registo não permite escalada nem menores sozinhos', () => {
  const base = { name: 'Teste', email: 't@x.com', password: 'Abcdefg1' };
  const register = (body: object) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });

  it('ADMIN não é auto-registável', async () => {
    expect((await register({ ...base, role: 'ADMIN' })).statusCode).toBe(422);
  });
  it('aluno sem data de nascimento', async () => {
    expect((await register({ ...base, role: 'STUDENT' })).statusCode).toBe(422);
  });
  it('aluno menor não se regista sozinho (RN-02)', async () => {
    const y = new Date().getUTCFullYear() - 12;
    expect((await register({ ...base, role: 'STUDENT', birthDate: `${y}-06-15` })).statusCode).toBe(403);
  });
  it('data de nascimento só para alunos', async () => {
    expect((await register({ ...base, role: 'TUTOR', birthDate: '1990-01-01' })).statusCode).toBe(422);
  });
});

describe('MFA obrigatório nas rotas de administração (RNF-SEG-06)', () => {
  const nowS = () => Math.floor(Date.now() / 1000);
  const adminToken = (mfaAt?: number) =>
    jwt.sign({ sub: ID, role: 'ADMIN', ...(mfaAt ? { mfaAt } : {}) }, process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '5m' });
  const errorCode = async (method: string, url: string, token: string) => {
    const res = await call(method, url, token);
    return [res.statusCode, JSON.parse(res.body).error?.code] as const;
  };

  const ADMIN_READ: Array<[string, string]> = [
    ['GET', '/api/v1/admin/users'],
    ['GET', '/api/v1/admin/role-changes'],
    ['GET', '/api/v1/tutors/admin/pending'],
    ['GET', '/api/v1/payments/offers/all'],
    ['GET', '/api/v1/activity/admin/metrics'],
    ['POST', '/api/v1/payments/offers'],
    ['PATCH', `/api/v1/payments/offers/${ID}`],
    ['POST', '/api/v1/auth/mfa/step-up'],
  ];
  const ADMIN_SENSITIVE: Array<[string, string]> = [
    ['POST', '/api/v1/admin/role-changes'],
    ['POST', `/api/v1/admin/role-changes/${ID}/approve`],
    ['POST', `/api/v1/admin/role-changes/${ID}/reject`],
    ['PATCH', `/api/v1/tutors/${ID}/status`],
  ];

  it.each([...ADMIN_READ, ...ADMIN_SENSITIVE])('admin sem MFA: %s %s → MFA_REQUIRED', async (method, url) => {
    expect(await errorCode(method, url, adminToken())).toEqual([403, 'MFA_REQUIRED']);
  });

  it.each(ADMIN_SENSITIVE)('MFA com mais de 10 min: %s %s → MFA_STEP_UP_REQUIRED', async (method, url) => {
    expect(await errorCode(method, url, adminToken(nowS() - 11 * 60))).toEqual([403, 'MFA_STEP_UP_REQUIRED']);
  });

  it('password e email do admin exigem MFA recente; os outros perfis passam o guard', async () => {
    for (const [method, url] of [['POST', '/api/v1/auth/password'], ['PATCH', '/api/v1/auth/me']] as const) {
      expect(await errorCode(method, url, adminToken())).toEqual([403, 'MFA_REQUIRED']);
      expect(await errorCode(method, url, adminToken(nowS() - 11 * 60))).toEqual([403, 'MFA_STEP_UP_REQUIRED']);
      // um tutor chega à validação do corpo (422), ou seja, passou o guard
      const t = jwt.sign({ sub: ID, role: 'TUTOR' }, process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '5m' });
      expect((await call(method, url, t)).statusCode).toBe(422);
    }
  });

  it('um desafio MFA nunca é aceite como access token', async () => {
    const challengeKey = createHmac('sha256', process.env.ACCESS_TOKEN_SECRET!).update('educa:mfa-challenge').digest();
    const challenge = jwt.sign({ sub: ID, typ: 'mfa-challenge' }, challengeKey, { expiresIn: '5m' });
    expect((await call('GET', '/api/v1/auth/me', challenge)).statusCode).toBe(401);
  });

  it('o claim mfaAt não pode ser forjado sem o segredo', async () => {
    const forged = jwt.sign({ sub: ID, role: 'ADMIN', mfaAt: nowS() }, 'outro-segredo-qualquer-0123456789abcdef', { expiresIn: '5m' });
    expect((await call('GET', '/api/v1/admin/users', forged)).statusCode).toBe(401);
  });

  it('os outros perfis continuam a receber 403 simples, sem pistas sobre MFA', async () => {
    const t = jwt.sign({ sub: ID, role: 'TUTOR' }, process.env.ACCESS_TOKEN_SECRET!, { expiresIn: '5m' });
    expect(await errorCode('GET', '/api/v1/admin/users', t)).toEqual([403, 'FORBIDDEN']);
  });
});
