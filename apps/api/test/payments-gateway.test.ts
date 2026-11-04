import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import {
  SANDBOX_SIGNATURE_HEADER,
  SandboxGateway,
  signSandboxPayload,
} from '../src/modules/payments/gateways/sandbox.gateway';
import {
  InvalidWebhookSignatureError,
  MalformedWebhookError,
} from '../src/modules/payments/gateways/gateway';

// RNF-SEG-04: verificação de assinatura dos webhooks. Tudo isto falha antes de tocar na BD.
const SECRET = process.env.SANDBOX_WEBHOOK_SECRET!;
const gateway = new SandboxGateway(SECRET);

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    eventId: 'evt-12345678', reference: '123456789', status: 'PAID',
    amount: '5000.00', currency: 'AOA', timestamp: Date.now(), ...over,
  });
const signed = (raw: string, secret = SECRET) => ({ [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(raw, secret) });

describe('SandboxGateway.parseWebhook', () => {
  it('aceita um webhook correctamente assinado', () => {
    const raw = payload();
    expect(gateway.parseWebhook(Buffer.from(raw), signed(raw))).toMatchObject({
      eventId: 'evt-12345678', reference: '123456789', status: 'PAID', amount: '5000.00',
    });
  });

  it('recusa sem assinatura, com assinatura errada ou de outro segredo', () => {
    const raw = payload();
    expect(() => gateway.parseWebhook(Buffer.from(raw), {})).toThrow(InvalidWebhookSignatureError);
    expect(() => gateway.parseWebhook(Buffer.from(raw), { [SANDBOX_SIGNATURE_HEADER]: 'abc' })).toThrow(InvalidWebhookSignatureError);
    expect(() => gateway.parseWebhook(Buffer.from(raw), signed(raw, 'outro-segredo-qualquer-0123456789abcdef'))).toThrow(InvalidWebhookSignatureError);
  });

  it('recusa um corpo adulterado depois de assinado (ex.: valor ou estado)', () => {
    const raw = payload();
    const headers = signed(raw);
    const tampered = raw.replace('"PAID"', '"PAID" ').replace('5000.00', '1.00');
    expect(() => gateway.parseWebhook(Buffer.from(tampered), headers)).toThrow(InvalidWebhookSignatureError);
  });

  it('recusa webhooks antigos (anti-replay) e futuros', () => {
    for (const ts of [Date.now() - 10 * 60_000, Date.now() + 10 * 60_000]) {
      const raw = payload({ timestamp: ts });
      expect(() => gateway.parseWebhook(Buffer.from(raw), signed(raw))).toThrow(InvalidWebhookSignatureError);
    }
  });

  it('assinado mas malformado → MalformedWebhookError', () => {
    for (const raw of ['não é json', payload({ status: 'QUALQUER' }), payload({ amount: '-3' })]) {
      expect(() => gateway.parseWebhook(Buffer.from(raw), signed(raw))).toThrow(MalformedWebhookError);
    }
  });

  it('gera referências de 9 dígitos', async () => {
    const r = await gateway.createReference({ orderId: 'x', amount: '1.00', currency: 'AOA', expiresAt: new Date() });
    expect(r.reference).toMatch(/^\d{9}$/);
  });
});

describe('POST /api/v1/payments/webhooks/:gateway', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });
  const hook = (gw: string, raw: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: `/api/v1/payments/webhooks/${gw}`, payload: raw, headers: { 'content-type': 'application/json', ...headers } });

  it('sem assinatura → 401 (sem autenticação de utilizador, só a assinatura conta)', async () => {
    expect((await hook('sandbox', payload())).statusCode).toBe(401);
  });
  it('assinatura inválida → 401', async () => {
    expect((await hook('sandbox', payload(), { [SANDBOX_SIGNATURE_HEADER]: 'f'.repeat(64) })).statusCode).toBe(401);
  });
  it('gateway desconhecido → 404', async () => {
    expect((await hook('inexistente', payload())).statusCode).toBe(404);
    expect((await hook('constructor', payload())).statusCode).toBe(404);
  });
  it('assinado mas malformado → 422', async () => {
    const raw = 'isto não é json';
    expect((await hook('sandbox', raw, signed(raw))).statusCode).toBe(422);
  });
});
