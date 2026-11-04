import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import {
  PASSWORD, adminSession, app, bearer, body, email, get, loginWithMfa, nextCode, post, registerUser,
} from './helpers';

// RN-08 / RNF-SEG-06: alteração de papéis com MFA e segregação de funções (quatro olhos)
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;
const requestChange = (admin: { headers: Record<string, string> }, userId: string, role: string) =>
  post('/api/v1/admin/role-changes', { userId, role }, admin.headers);
const approve = (admin: { headers: Record<string, string> }, id: string) =>
  post(`/api/v1/admin/role-changes/${id}/approve`, {}, admin.headers);
const reject = (admin: { headers: Record<string, string> }, id: string) =>
  post(`/api/v1/admin/role-changes/${id}/reject`, {}, admin.headers);
const roleOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role;

async function tutor() {
  const t = await registerUser('TUTOR');
  return { ...t, id: idOf(t.token) };
}

describe('pedir e aprovar (quatro olhos)', () => {
  it('quem pede não aprova: é preciso outro administrador; o papel só muda na aprovação', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();

    const req = await requestChange(a, target.id, 'ADMIN');
    expect(req.statusCode).toBe(201);
    const id = body(req).request.id as string;
    expect(body(req).request).toMatchObject({ fromRole: 'TUTOR', toRole: 'ADMIN', status: 'PENDING' });
    expect(await roleOf(target.id)).toBe('TUTOR');

    const self = await approve(a, id);
    expect(self.statusCode).toBe(403);
    expect(body(self).error.message).toMatch(/outro administrador/);
    expect(await roleOf(target.id)).toBe('TUTOR');

    const ok = await approve(b, id);
    expect(ok.statusCode).toBe(200);
    expect(body(ok).request).toMatchObject({ status: 'APPROVED', decidedBy: { id: idOf(b.token) } });
    expect(await roleOf(target.id)).toBe('ADMIN');

    expect((await approve(b, id)).statusCode).toBe(409); // já decidido
  });

  it('a BD recusa que o mesmo administrador peça e decida, mesmo contornando o código', async () => {
    const a = await adminSession('a');
    const target = await tutor();
    const id = body(await requestChange(a, target.id, 'GUARDIAN')).request.id as string;
    await expect(
      prisma.roleChangeRequest.update({
        where: { id },
        data: { status: 'APPROVED', decidedById: idOf(a.token), decidedAt: new Date() },
      }),
    ).rejects.toThrow(/four_eyes|check/i);
  });

  it('rejeitar deixa o papel como estava e fecha o pedido', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();
    const id = body(await requestChange(a, target.id, 'ADMIN')).request.id as string;

    expect((await reject(a, id)).statusCode).toBe(403);
    expect(body(await reject(b, id)).request.status).toBe('REJECTED');
    expect(await roleOf(target.id)).toBe('TUTOR');
    expect((await approve(b, id)).statusCode).toBe(409);
  });

  it('dois administradores a aprovar em simultâneo: só um decide', async () => {
    const [a, b, c] = [await adminSession('a'), await adminSession('b'), await adminSession('c')];
    const target = await tutor();
    const id = body(await requestChange(a, target.id, 'ADMIN')).request.id as string;
    const rs = await Promise.all([approve(b, id), approve(c, id)]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await prisma.roleChangeRequest.count({ where: { id, status: 'APPROVED' } })).toBe(1);
  });

  it('pedidos caducam ao fim de 24 h', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();
    const id = body(await requestChange(a, target.id, 'ADMIN')).request.id as string;
    await prisma.roleChangeRequest.update({ where: { id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    const res = await approve(b, id);
    expect(res.statusCode).toBe(409);
    expect(body(res).error.message).toMatch(/caducou/);
    expect(await roleOf(target.id)).toBe('TUTOR');
  });
});

describe('validações do pedido', () => {
  it('não altera o próprio papel; mesmo papel; utilizador inexistente; um pendente de cada vez', async () => {
    const a = await adminSession('a');
    const target = await tutor();

    expect((await requestChange(a, idOf(a.token), 'TUTOR')).statusCode).toBe(403);
    expect((await requestChange(a, target.id, 'TUTOR')).statusCode).toBe(409);
    expect((await requestChange(a, randomUUID(), 'ADMIN')).statusCode).toBe(404);
    expect((await requestChange(a, target.id, 'ROOT')).statusCode).toBe(422);

    expect((await requestChange(a, target.id, 'ADMIN')).statusCode).toBe(201);
    expect((await requestChange(a, target.id, 'GUARDIAN')).statusCode).toBe(409);
  });

  it('pedidos simultâneos para o mesmo utilizador: só um fica pendente', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();
    const rs = await Promise.all([requestChange(a, target.id, 'ADMIN'), requestChange(b, target.id, 'GUARDIAN')]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('encarregado com dependentes não muda de papel (a aprovação falha e nada muda)', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const g = await registerUser('GUARDIAN');
    await post('/api/v1/guardians/dependents', { name: 'Menino', email: email('dep'), password: PASSWORD, birthDate: '2014-05-01' }, bearer(g.token));
    const id = body(await requestChange(a, idOf(g.token), 'ADMIN')).request.id as string;

    const res = await approve(b, id);
    expect(res.statusCode).toBe(409);
    expect(await roleOf(idOf(g.token))).toBe('GUARDIAN');
    expect((await prisma.roleChangeRequest.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });
});

describe('efeitos de uma alteração de papel', () => {
  it('as sessões do utilizador são revogadas e o novo papel vale ao entrar de novo', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();
    expect((await get('/api/v1/auth/me', bearer(target.token))).statusCode).toBe(200);

    const id = body(await requestChange(a, target.id, 'ADMIN')).request.id as string;
    await approve(b, id);

    // o token antigo (com papel TUTOR) deixou de valer imediatamente
    const old = await get('/api/v1/auth/me', bearer(target.token));
    expect(old.statusCode).toBe(401);
    expect(body(old).error.message).toMatch(/revogada/i);

    // ao entrar de novo é admin, mas sem MFA só consegue configurá-lo
    const login = await post('/api/v1/auth/login', { email: target.email, password: PASSWORD });
    expect(body(login).mfaEnrollmentRequired).toBe(true);
    expect((await get('/api/v1/admin/users', bearer(body(login).accessToken))).statusCode).toBe(403);
  });

  it('o novo administrador só opera depois de configurar o MFA', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();
    await approve(b, body(await requestChange(a, target.id, 'ADMIN')).request.id);

    const { enrollMfa } = await import('./helpers');
    const { secret } = await enrollMfa(target.email);
    const { accessToken } = await loginWithMfa(target.email, nextCode(secret));
    expect((await get('/api/v1/admin/users', bearer(accessToken))).statusCode).toBe(200);
  });

  it('fica tudo auditado', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();
    const id = body(await requestChange(a, target.id, 'ADMIN')).request.id as string;
    await approve(b, id);
    const actions = (await prisma.auditLog.findMany({ where: { OR: [{ entityId: id }, { entityId: target.id }] }, select: { action: true } })).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['ROLE_CHANGE_REQUESTED', 'ROLE_CHANGE_APPROVED', 'ROLE_CHANGED']));
  });
});

describe('consulta', () => {
  it('lista utilizadores (sem dados sensíveis) e pedidos por estado', async () => {
    const [a, b] = [await adminSession('a'), await adminSession('b')];
    const target = await tutor();

    const users = body(await get(`/api/v1/admin/users?search=${encodeURIComponent(target.email)}`, a.headers));
    expect(users.total).toBe(1);
    expect(users.users[0]).toMatchObject({ id: target.id, role: 'TUTOR', mfaEnabled: false });
    expect(JSON.stringify(users)).not.toMatch(/password|mfaSecret|birthDate/);
    expect((await get('/api/v1/admin/users?role=INVALIDO', a.headers)).statusCode).toBe(422);
    expect((await get('/api/v1/admin/users?limit=999', a.headers)).statusCode).toBe(422);

    const id = body(await requestChange(a, target.id, 'GUARDIAN')).request.id as string;
    const pending = body(await get('/api/v1/admin/role-changes?status=PENDING', b.headers)).requests as Array<{ id: string }>;
    expect(pending.map((r) => r.id)).toContain(id);
    await approve(b, id);
    const stillPending = body(await get('/api/v1/admin/role-changes?status=PENDING', b.headers)).requests as Array<{ id: string }>;
    expect(stillPending.map((r) => r.id)).not.toContain(id);
  });

  it('um tutor não vê utilizadores nem pedidos', async () => {
    const t = await tutor();
    expect((await get('/api/v1/admin/users', bearer(t.token))).statusCode).toBe(403);
    expect((await get('/api/v1/admin/role-changes', bearer(t.token))).statusCode).toBe(403);
  });
});
