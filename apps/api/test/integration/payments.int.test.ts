import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { SANDBOX_SIGNATURE_HEADER, signSandboxPayload } from '../../src/modules/payments/gateways/sandbox.gateway';
import { PASSWORD, adminHeaders, adminSession, app, bearer, body, del, email, get, patch, post, registerUser } from './helpers';

// RF-PAG-01..03, RN-03, RN-07, RNF-SEG-04
beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const SECRET = process.env.SANDBOX_WEBHOOK_SECRET ?? 'test-payment-webhook-secret-0123456789ab';
const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;

async function newOffer(over: Record<string, unknown> = {}) {
  const res = await post('/api/v1/payments/offers', {
    name: `Pacote ${randomUUID().slice(0, 4)}`, hours: 10, price: 5000, validityDays: 90, ...over,
  }, await adminHeaders());
  return body(res).offer as { id: string; price: string; hours: string };
}

const buy = (token: string, offerId: string, key?: string) =>
  post('/api/v1/payments/references', { offerId }, { ...bearer(token), ...(key ? { 'idempotency-key': key } : {}) });

type Ev = { reference: string; status?: string; amount?: string; eventId?: string; timestamp?: number };
const sendEvent = (e: Ev, opts: { secret?: string } = {}) => {
  const raw = JSON.stringify({
    eventId: e.eventId ?? `evt-${randomUUID()}`, reference: e.reference, status: e.status ?? 'PAID',
    amount: e.amount ?? '5000.00', currency: 'AOA', timestamp: e.timestamp ?? Date.now(),
  });
  return app.inject({
    method: 'POST', url: '/api/v1/payments/webhooks/sandbox', payload: raw,
    headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(raw, opts.secret ?? SECRET) },
  });
};

// compra + devolve a referência a pagar
async function pendingPayment(over: Record<string, unknown> = {}) {
  const offer = await newOffer(over);
  const g = await registerUser('GUARDIAN');
  const payment = body(await buy(g.token, offer.id)).payment as { id: string; reference: string; amount: string };
  return { offer, g, payment, userId: idOf(g.token) };
}
const pkgsOf = (paymentId: string) => prisma.hourPackage.findMany({ where: { paymentId } });
const statusOf = async (id: string) => (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id } })).status;

describe('catálogo de pacotes', () => {
  it('só o admin cria; o público vê apenas os activos; valores inválidos → 422', async () => {
    const admin = await adminHeaders();
    const g = await registerUser('GUARDIAN');
    expect((await post('/api/v1/payments/offers', { name: 'X', hours: 1, price: 1 }, bearer(g.token))).statusCode).toBe(403);
    expect((await post('/api/v1/payments/offers', { name: 'Ok', hours: 10, price: -5 }, admin)).statusCode).toBe(422);
    expect((await post('/api/v1/payments/offers', { name: 'Ok', hours: 10, price: 5000, currency: 'USD' }, admin)).statusCode).toBe(422);

    const offer = await newOffer({ name: `Visível-${randomUUID().slice(0, 4)}` });
    const ids = () => get('/api/v1/payments/offers').then((r) => (body(r).offers as Array<{ id: string }>).map((o) => o.id));
    expect(await ids()).toContain(offer.id);
    expect((await patch(`/api/v1/payments/offers/${offer.id}`, { active: false }, admin)).statusCode).toBe(200);
    expect(await ids()).not.toContain(offer.id);
  });
});

describe('criar referência (RF-PAG-01)', () => {
  it('gera referência PENDING com o preço da oferta e sem criar horas (RN-03)', async () => {
    const { payment, userId } = await pendingPayment();
    expect(payment.reference).toMatch(/^\d{9}$/);
    expect(payment.amount).toBe('5000');
    expect(await statusOf(payment.id)).toBe('PENDING');
    expect(await prisma.hourPackage.count({ where: { userId } })).toBe(0);
  });

  it('oferta inactiva ou inexistente → 404', async () => {
    const g = await registerUser('GUARDIAN');
    const offer = await newOffer();
    await patch(`/api/v1/payments/offers/${offer.id}`, { active: false }, await adminHeaders());
    expect((await buy(g.token, offer.id)).statusCode).toBe(404);
    expect((await buy(g.token, randomUUID())).statusCode).toBe(404);
  });

  it('Idempotency-Key: repetir devolve a mesma referência; pedidos simultâneos geram uma só', async () => {
    const offer = await newOffer();
    const g = await registerUser('GUARDIAN');
    const key = `chave-${randomUUID()}`;

    const first = await buy(g.token, offer.id, key);
    const again = await buy(g.token, offer.id, key);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(body(again).payment.reference).toBe(body(first).payment.reference);
    expect(body(again).payment.entity).toBe(body(first).payment.entity);

    const other = await newOffer();
    expect((await buy(g.token, other.id, key)).statusCode).toBe(409);
    expect((await buy(g.token, offer.id, 'curta')).statusCode).toBe(422);

    const k2 = `chave-${randomUUID()}`;
    const rs = await Promise.all(Array.from({ length: 5 }, () => buy(g.token, offer.id, k2)));
    expect(new Set(rs.map((r) => body(r).payment.id)).size).toBe(1);
    expect(await prisma.paymentTransaction.count({ where: { idempotencyKey: `${idOf(g.token)}:${k2}` } })).toBe(1);
  });

  it('a mesma chave de outro utilizador não colide', async () => {
    const offer = await newOffer();
    const a = await registerUser('GUARDIAN');
    const b = await registerUser('GUARDIAN');
    const key = `partilhada-${randomUUID()}`;
    const ra = await buy(a.token, offer.id, key);
    const rb = await buy(b.token, offer.id, key);
    expect([ra.statusCode, rb.statusCode]).toEqual([201, 201]);
    expect(body(ra).payment.id).not.toBe(body(rb).payment.id);
  });

  it('tutor e admin não compram horas (403)', async () => {
    const offer = await newOffer();
    const t = await registerUser('TUTOR');
    expect((await buy(t.token, offer.id)).statusCode).toBe(403);
  });
});

describe('webhook: confirmação e libertação do pacote (RF-PAG-02, RN-03, RN-07)', () => {
  it('PAID liberta o pacote com horas e validade da oferta', async () => {
    const { payment, userId } = await pendingPayment({ hours: 12, validityDays: 30 });
    const res = await sendEvent({ reference: payment.reference });
    expect(body(res)).toEqual({ received: true, outcome: 'confirmed' });
    expect(await statusOf(payment.id)).toBe('CONFIRMED');

    const [pkg] = await pkgsOf(payment.id);
    expect(pkg.userId).toBe(userId);
    expect(Number(pkg.remainingHours)).toBe(12);
    const days = Math.round((pkg.expiresAt!.getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(30);
  });

  it('sem validityDays o pacote não expira', async () => {
    const { payment } = await pendingPayment({ validityDays: undefined });
    await sendEvent({ reference: payment.reference });
    expect((await pkgsOf(payment.id))[0].expiresAt).toBeNull();
  });

  it('o mesmo evento reentregue não duplica nada', async () => {
    const { payment } = await pendingPayment();
    const eventId = `evt-${randomUUID()}`;
    expect(body(await sendEvent({ reference: payment.reference, eventId })).outcome).toBe('confirmed');
    expect(body(await sendEvent({ reference: payment.reference, eventId })).outcome).toBe('duplicate');
    expect(await pkgsOf(payment.id)).toHaveLength(1);
  });

  it('um pagamento só origina um pacote, mesmo com eventos PAID distintos (RN-07)', async () => {
    const { payment } = await pendingPayment();
    await sendEvent({ reference: payment.reference });
    expect(body(await sendEvent({ reference: payment.reference })).outcome).toBe('noop');
    expect(await pkgsOf(payment.id)).toHaveLength(1);
  });

  it('entregas simultâneas: um só pacote', async () => {
    const { payment } = await pendingPayment();
    const eventId = `evt-${randomUUID()}`;
    const rs = await Promise.all(Array.from({ length: 6 }, () => sendEvent({ reference: payment.reference, eventId })));
    const outcomes = rs.map((r) => body(r).outcome as string).sort();
    expect(outcomes.filter((o) => o === 'confirmed')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(5);
    expect(await pkgsOf(payment.id)).toHaveLength(1);

    const other = await pendingPayment();
    const rs2 = await Promise.all(Array.from({ length: 6 }, () => sendEvent({ reference: other.payment.reference })));
    expect(rs2.every((r) => r.statusCode === 200)).toBe(true);
    expect(await pkgsOf(other.payment.id)).toHaveLength(1);
  });

  it('valor diferente do da referência não confirma', async () => {
    const { payment, userId } = await pendingPayment();
    expect(body(await sendEvent({ reference: payment.reference, amount: '1.00' })).outcome).toBe('amount_mismatch');
    expect(await statusOf(payment.id)).toBe('PENDING');
    expect(await prisma.hourPackage.count({ where: { userId } })).toBe(0);
  });

  it('assinatura inválida ou antiga → 401 e nada muda; referência desconhecida → 200 sem efeito', async () => {
    const { payment } = await pendingPayment();
    expect((await sendEvent({ reference: payment.reference }, { secret: 'x'.repeat(40) })).statusCode).toBe(401);
    expect((await sendEvent({ reference: payment.reference, timestamp: Date.now() - 3_600_000 })).statusCode).toBe(401);
    expect(await statusOf(payment.id)).toBe('PENDING');
    expect(body(await sendEvent({ reference: '000000000' })).outcome).toBe('unknown_reference');
  });

  it('FAILED não liberta horas; se for pago depois, confirma (o dinheiro foi recebido)', async () => {
    const { payment } = await pendingPayment();
    expect(body(await sendEvent({ reference: payment.reference, status: 'FAILED' })).outcome).toBe('failed');
    expect(await pkgsOf(payment.id)).toHaveLength(0);
    expect(body(await sendEvent({ reference: payment.reference })).outcome).toBe('confirmed');
    expect(await pkgsOf(payment.id)).toHaveLength(1);
  });

  it('REFUNDED anula as horas por usar e fica auditado', async () => {
    const { payment } = await pendingPayment();
    await sendEvent({ reference: payment.reference });
    expect(body(await sendEvent({ reference: payment.reference, status: 'REFUNDED' })).outcome).toBe('refunded');
    expect(await statusOf(payment.id)).toBe('REFUNDED');
    expect(Number((await pkgsOf(payment.id))[0].remainingHours)).toBe(0);
    const actions = (await prisma.auditLog.findMany({ where: { entityId: payment.id }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['PAYMENT_REFERENCE_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_REFUNDED']));
    // REFUNDED de um pagamento que não estava confirmado não faz nada
    const fresh = await pendingPayment();
    expect(body(await sendEvent({ reference: fresh.payment.reference, status: 'REFUNDED' })).outcome).toBe('noop');
  });
});

describe('saldo e ponta a ponta (RF-PAG-03)', () => {
  it('compra → webhook → dependente agenda com o pacote do Encarregado', async () => {
    const { payment, g, userId } = await pendingPayment({ hours: 3 });
    await sendEvent({ reference: payment.reference });

    // dependente com consentimento
    const mail = email('dep');
    const dep = body(await post('/api/v1/guardians/dependents', { name: 'Menino', email: mail, password: PASSWORD, birthDate: '2014-05-01' }, bearer(g.token))).dependent;
    await post(`/api/v1/guardians/dependents/${dep.id}/consent`, {}, bearer(g.token));
    const depToken = body(await post('/api/v1/auth/login', { email: mail, password: PASSWORD })).accessToken as string;

    const saldoDep = body(await get('/api/v1/payments/packages/mine', bearer(depToken)));
    expect(saldoDep.availableHours).toBe('3.00');
    expect(saldoDep.packages[0].sharedByGuardian).toBe(true);

    // aula aprovada, 1 h
    const tutor = await registerUser('TUTOR');
    const profile = await prisma.tutorProfile.create({ data: { userId: idOf(tutor.token), status: 'APPROVED', subjects: ['M'] } });
    const session = await prisma.classSession.create({
      data: { tutorId: profile.id, title: 'Aula', subject: 'M', type: 'GROUP', maxCapacity: 4, scheduledAt: new Date(Date.now() + 3 * 86_400_000), durationMin: 60 },
    });
    expect((await post(`/api/v1/bookings/sessions/${session.id}/enroll`, {}, bearer(depToken))).statusCode).toBe(201);

    const saldoEnc = body(await get('/api/v1/payments/packages/mine', bearer(g.token)));
    expect(saldoEnc.availableHours).toBe('2.00');
    expect(saldoEnc.packages[0].sharedByGuardian).toBe(false);
    expect(userId).toBeTruthy();
    expect((await del(`/api/v1/bookings/sessions/${session.id}/enroll`, bearer(depToken))).statusCode).toBe(204);
    expect(body(await get('/api/v1/payments/packages/mine', bearer(g.token))).availableHours).toBe('3.00');
  });

  it('pacote expirado não entra no saldo disponível; cada utilizador só vê o seu', async () => {
    const g = await registerUser('GUARDIAN');
    const other = await registerUser('GUARDIAN');
    const payment = await prisma.paymentTransaction.create({
      data: { userId: idOf(g.token), gateway: 'sandbox', reference: randomUUID().slice(0, 9), amount: 1, hours: 5, idempotencyKey: randomUUID() },
    });
    await prisma.hourPackage.create({
      data: { userId: idOf(g.token), paymentId: payment.id, totalHours: 5, remainingHours: 5, expiresAt: new Date(Date.now() - 1000) },
    });
    const saldo = body(await get('/api/v1/payments/packages/mine', bearer(g.token)));
    expect(saldo.availableHours).toBe('0.00');
    expect(saldo.packages[0].expired).toBe(true);
    expect(body(await get('/api/v1/payments/packages/mine', bearer(other.token))).packages).toHaveLength(0);
    expect(body(await get('/api/v1/payments/mine', bearer(other.token))).payments).toHaveLength(0);
  });
});

// ── Administração (RF-PAG-04) ────────────────────────────────────────────────

const nowS = () => Math.floor(Date.now() / 1000);

// Cria um token de admin com mfaAt antigo para testar o step-up (mesmo padrão de mfa.int.test.ts)
function staleAdminToken(token: string) {
  const claims = jwt.decode(token) as { sub: string; ep: number };
  return jwt.sign(
    { sub: claims.sub, role: 'ADMIN', ep: claims.ep, mfaAt: nowS() - 3600 },
    process.env.ACCESS_TOKEN_SECRET!,
    { expiresIn: '5m' },
  );
}

// Confirma um pagamento via webhook e devolve o pacote criado
async function confirmPayment(reference: string) {
  await sendEvent({ reference });
}

describe('admin: listar transacções', () => {
  it('devolve lista paginada com utilizador incluído; não-admin → 403', async () => {
    const { payment, g } = await pendingPayment();
    const admin = await adminHeaders();
    const g2 = await registerUser('GUARDIAN');

    expect((await get('/api/v1/payments/transactions', bearer(g2.token))).statusCode).toBe(403);

    const res = await get('/api/v1/payments/transactions', admin);
    expect(res.statusCode).toBe(200);
    const data = body(res);
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('page', 1);
    expect(data).toHaveProperty('limit', 20);
    expect(Array.isArray(data.transactions)).toBe(true);
    const tx = (data.transactions as Array<{ id: string; user: { id: string } }>)
      .find((t) => t.id === payment.id);
    expect(tx).toBeDefined();
    expect(tx!.user.id).toBe(idOf(g.token));
  });

  it('filtro por status devolve só as transacções correspondentes', async () => {
    const { payment } = await pendingPayment();
    const admin = await adminHeaders();

    const pending = body(await get('/api/v1/payments/transactions?status=PENDING', admin));
    expect((pending.transactions as Array<{ id: string }>).some((t) => t.id === payment.id)).toBe(true);

    const confirmed = body(await get('/api/v1/payments/transactions?status=CONFIRMED', admin));
    expect((confirmed.transactions as Array<{ id: string }>).some((t) => t.id === payment.id)).toBe(false);
  });

  it('filtro por userId devolve só as transacções desse utilizador', async () => {
    const { payment, g } = await pendingPayment();
    const other = await pendingPayment();
    const admin = await adminHeaders();

    const res = body(await get(`/api/v1/payments/transactions?userId=${idOf(g.token)}`, admin));
    const ids = (res.transactions as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(payment.id);
    expect(ids).not.toContain(other.payment.id);
  });

  it('paginação: limit e page reduzem e deslocam os resultados', async () => {
    const admin = await adminHeaders();
    const p1 = body(await get('/api/v1/payments/transactions?limit=2&page=1', admin));
    const p2 = body(await get('/api/v1/payments/transactions?limit=2&page=2', admin));
    expect((p1.transactions as unknown[]).length).toBeLessThanOrEqual(2);
    const ids1 = (p1.transactions as Array<{ id: string }>).map((t) => t.id);
    const ids2 = (p2.transactions as Array<{ id: string }>).map((t) => t.id);
    // As duas páginas não se sobrepõem
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });
});

describe('admin: detalhe de transacção', () => {
  it('devolve utilizador e hourPackage nulo quando pendente; após confirmação o pacote aparece', async () => {
    const { payment, g } = await pendingPayment({ hours: 8 });
    const admin = await adminHeaders();

    const before = body(await get(`/api/v1/payments/transactions/${payment.id}`, admin)).transaction;
    expect(before.user.id).toBe(idOf(g.token));
    expect(before.hourPackage).toBeNull();
    expect(before.status).toBe('PENDING');

    await confirmPayment(payment.reference);

    const after = body(await get(`/api/v1/payments/transactions/${payment.id}`, admin)).transaction;
    expect(after.status).toBe('CONFIRMED');
    expect(after.hourPackage).not.toBeNull();
    expect(Number(after.hourPackage.remainingHours)).toBe(8);
  });

  it('UUID inexistente → 404; UUID inválido → 422; não-admin → 403', async () => {
    const admin = await adminHeaders();
    const g = await registerUser('GUARDIAN');
    expect((await get(`/api/v1/payments/transactions/${randomUUID()}`, admin)).statusCode).toBe(404);
    expect((await get('/api/v1/payments/transactions/nao-um-uuid', admin)).statusCode).toBe(422);
    expect((await get(`/api/v1/payments/transactions/${randomUUID()}`, bearer(g.token))).statusCode).toBe(403);
  });
});

describe('admin: reembolso manual (RF-PAG-04)', () => {
  it('CONFIRMED → REFUNDED, horas anuladas e auditado', async () => {
    const { payment } = await pendingPayment({ hours: 5 });
    await confirmPayment(payment.reference);
    const admin = await adminSession();

    const res = await post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, admin.headers);
    expect(res.statusCode).toBe(200);
    expect(body(res).transaction.status).toBe('REFUNDED');

    const pkg = (await pkgsOf(payment.id))[0];
    expect(Number(pkg.remainingHours)).toBe(0);

    const actions = (await prisma.auditLog.findMany({ where: { entityId: payment.id }, select: { action: true } }))
      .map((a) => a.action);
    expect(actions).toContain('PAYMENT_REFUNDED_MANUAL');
  });

  it('PENDING → 422 (só se pode reembolsar o que está confirmado)', async () => {
    const { payment } = await pendingPayment();
    const admin = await adminSession();
    expect((await post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, admin.headers)).statusCode).toBe(422);
    expect(await statusOf(payment.id)).toBe('PENDING');
  });

  it('já REFUNDED → 422', async () => {
    const { payment } = await pendingPayment();
    await confirmPayment(payment.reference);
    const admin = await adminSession();
    expect((await post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, admin.headers)).statusCode).toBe(200);
    expect((await post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, admin.headers)).statusCode).toBe(422);
  });

  it('MFA antigo → 403 MFA_STEP_UP_REQUIRED', async () => {
    const { payment } = await pendingPayment();
    await confirmPayment(payment.reference);
    const admin = await adminSession();
    const stale = staleAdminToken(admin.token);
    const res = await post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, bearer(stale));
    expect(res.statusCode).toBe(403);
    expect(body(res).error.code).toBe('MFA_STEP_UP_REQUIRED');
    expect(await statusOf(payment.id)).toBe('CONFIRMED');
  });

  it('não-admin → 403 e estado inalterado', async () => {
    const { payment, g } = await pendingPayment();
    await confirmPayment(payment.reference);
    expect((await post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, bearer(g.token))).statusCode).toBe(403);
    expect(await statusOf(payment.id)).toBe('CONFIRMED');
  });

  it('reembolsos simultâneos: só um tem efeito (sem duplo reembolso)', async () => {
    const { payment } = await pendingPayment({ hours: 4 });
    await confirmPayment(payment.reference);
    const admin = await adminSession();

    const rs = await Promise.all(Array.from({ length: 5 }, () =>
      post(`/api/v1/payments/transactions/${payment.id}/refund`, {}, admin.headers),
    ));
    const codes = rs.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 422)).toHaveLength(4);

    expect(Number((await pkgsOf(payment.id))[0].remainingHours)).toBe(0);
    const refundLogs = (await prisma.auditLog.findMany({ where: { entityId: payment.id, action: 'PAYMENT_REFUNDED_MANUAL' } }));
    expect(refundLogs).toHaveLength(1);
  });
});

describe('admin: listar pacotes', () => {
  it('devolve todos os pacotes com utilizador; filtros de userId e expirado funcionam', async () => {
    const admin = await adminHeaders();
    const g = await registerUser('GUARDIAN');
    const userId = idOf(g.token);

    // Pacote expirado inserido directamente
    const txExpired = await prisma.paymentTransaction.create({
      data: { userId, gateway: 'sandbox', reference: randomUUID().slice(0, 9), amount: 1, hours: 2, idempotencyKey: randomUUID() },
    });
    await prisma.hourPackage.create({
      data: { userId, paymentId: txExpired.id, totalHours: 2, remainingHours: 2, expiresAt: new Date(Date.now() - 1000) },
    });

    // Pacote activo via compra + confirmação
    const { payment } = await pendingPayment({ hours: 3 });
    const gPendingUserId = (await prisma.paymentTransaction.findUniqueOrThrow({ where: { id: payment.id } })).userId;
    await confirmPayment(payment.reference);

    const all = body(await get('/api/v1/payments/packages', admin));
    expect(all).toHaveProperty('total');
    expect((all.packages as Array<{ user: unknown }>).every((p) => p.user !== undefined)).toBe(true);

    // Filtro por userId
    const byUser = body(await get(`/api/v1/payments/packages?userId=${userId}`, admin));
    expect((byUser.packages as Array<{ user: { id: string } }>).every((p) => p.user.id === userId)).toBe(true);

    // Filtro expirado=true
    const expired = body(await get('/api/v1/payments/packages?expired=true', admin));
    expect((expired.packages as Array<{ expired: boolean }>).every((p) => p.expired === true)).toBe(true);

    // Filtro expirado=false
    const active = body(await get('/api/v1/payments/packages?expired=false', admin));
    expect((active.packages as Array<{ expired: boolean }>).every((p) => p.expired === false)).toBe(true);

    // Pacote activo do utilizador que criou o pendingPayment aparece no filtro
    const byConfirmed = body(await get(`/api/v1/payments/packages?userId=${gPendingUserId}&expired=false`, admin));
    expect((byConfirmed.packages as Array<{ paymentId: string }>).some((p) => p.paymentId === payment.id)).toBe(true);
  });

  it('paginação: page e limit respeitados; não-admin → 403', async () => {
    const admin = await adminHeaders();
    const g = await registerUser('GUARDIAN');

    const p1 = body(await get('/api/v1/payments/packages?limit=1&page=1', admin));
    const p2 = body(await get('/api/v1/payments/packages?limit=1&page=2', admin));
    expect((p1.packages as unknown[]).length).toBeLessThanOrEqual(1);
    const ids1 = (p1.packages as Array<{ id: string }>).map((p) => p.id);
    const ids2 = (p2.packages as Array<{ id: string }>).map((p) => p.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);

    expect((await get('/api/v1/payments/packages', bearer(g.token))).statusCode).toBe(403);
  });
});
