import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { Role } from '@prisma/client';
import { buildApp } from '../../src/app';
import { createUserAccount } from '../../src/modules/auth/auth.service';
import { stepOf, totp } from '../../src/shared/core/totp';

export const app = buildApp();

export const PASSWORD = 'Abcdefg1';

// Emails únicos por execução: os testes não precisam de limpar a BD
export const email = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@teste.educa`;

export const body = (r: LightMyRequestResponse) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return r.body;
  }
};

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const refreshCookie = (r: LightMyRequestResponse) =>
  r.cookies.find((c) => c.name === 'refresh_token')?.value ?? '';
export const withCookie = (value: string) => ({ cookie: `refresh_token=${value}` });

export const post = (url: string, payload: object = {}, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers });
export const get = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers });
export const patch = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'PATCH', url, payload, headers });
export const del = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'DELETE', url, headers });

export async function registerUser(role: 'GUARDIAN' | 'TUTOR' | 'STUDENT', tag: string = role.toLowerCase()) {
  const mail = email(tag);
  const res = await post('/api/v1/auth/register', {
    name: `Utilizador ${tag}`,
    email: mail,
    password: PASSWORD,
    role,
    ...(role === 'STUDENT' ? { birthDate: '1995-01-01' } : {}),
  });
  return { email: mail, token: body(res).accessToken as string, res };
}

// ── Administradores com MFA (fluxo real, sem atalhos) ────────────────────────

const usedSteps = new Map<string, Set<number>>();

// Devolve um código TOTP válido que ainda não foi usado com este segredo (cada código só vale uma vez).
// A janela tolera ±1 passo, por isso há até 3 códigos distintos por segredo em cada 30 s.
export function nextCode(secret: string): string {
  const used = usedSteps.get(secret) ?? new Set<number>();
  const current = stepOf(Date.now());
  for (const step of [current + 1, current, current - 1]) {
    if (!used.has(step)) {
      used.add(step);
      usedSteps.set(secret, used);
      return totp(secret, step * 30_000 + 1000);
    }
  }
  throw new Error('Sem códigos TOTP livres nesta janela: o teste usa demasiados para o mesmo segredo');
}

export async function createAdmin(tag = 'admin') {
  const mail = email(tag);
  await createUserAccount({ name: `Admin ${tag}`, email: mail, password: PASSWORD, role: Role.ADMIN });
  return mail;
}

// Configura o MFA como o faria um administrador: sessão sem MFA → setup → enable → entrar de novo
export async function enrollMfa(mail: string) {
  const first = await post('/api/v1/auth/login', { email: mail, password: PASSWORD });
  const token = body(first).accessToken as string;
  const setup = body(await post('/api/v1/auth/mfa/setup', {}, bearer(token)));
  const enabled = body(await post('/api/v1/auth/mfa/enable', { code: nextCode(setup.secret) }, bearer(token)));
  return { secret: setup.secret as string, recoveryCodes: enabled.recoveryCodes as string[] };
}

export async function loginWithMfa(mail: string, code: string) {
  const challenge = body(await post('/api/v1/auth/login', { email: mail, password: PASSWORD })).challenge as string;
  const res = await post('/api/v1/auth/mfa/verify', { challenge, code });
  return { res, accessToken: body(res).accessToken as string };
}

// Administrador pronto a usar: MFA configurado e sessão estabelecida com segundo factor
export async function adminSession(tag = 'admin') {
  const mail = await createAdmin(tag);
  const { secret, recoveryCodes } = await enrollMfa(mail);
  const { accessToken } = await loginWithMfa(mail, nextCode(secret));
  return { email: mail, secret, recoveryCodes, token: accessToken, headers: bearer(accessToken) };
}

export const adminHeaders = async () => (await adminSession()).headers;
