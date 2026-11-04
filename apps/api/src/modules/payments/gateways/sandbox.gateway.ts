import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  InvalidWebhookSignatureError,
  MalformedWebhookError,
  type CreateReferenceInput,
  type GatewayEvent,
  type GatewayReference,
  type PaymentGateway,
} from './gateway';

// Simulador local de um gateway por referência. Serve para desenvolvimento e testes e documenta o
// formato que os adaptadores reais devem cumprir. Proibido em produção (ver env.ts).
export const SANDBOX_SIGNATURE_HEADER = 'x-educa-signature';
const TOLERANCE_MS = 5 * 60_000; // rejeita webhooks reenviados fora desta janela (anti-replay)

const PayloadSchema = z.object({
  eventId: z.string().min(8).max(100),
  reference: z.string().min(1).max(50),
  status: z.enum(['PAID', 'FAILED', 'REFUNDED']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.string().length(3),
  timestamp: z.number().int(),
});

export function signSandboxPayload(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';

  constructor(private readonly secret: string) {}

  async createReference(input: CreateReferenceInput): Promise<GatewayReference> {
    return {
      entity: '11223',
      reference: String(randomInt(100_000_000, 1_000_000_000)), // 9 dígitos
      expiresAt: input.expiresAt,
    };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent {
    const received = headers[SANDBOX_SIGNATURE_HEADER];
    const signature = Array.isArray(received) ? received[0] : received;
    const expected = signSandboxPayload(rawBody, this.secret);

    const a = Buffer.from(signature ?? '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new InvalidWebhookSignatureError();

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new MalformedWebhookError('JSON inválido');
    }
    const parsed = PayloadSchema.safeParse(json);
    if (!parsed.success) throw new MalformedWebhookError('Payload inválido');

    if (Math.abs(Date.now() - parsed.data.timestamp) > TOLERANCE_MS) {
      throw new InvalidWebhookSignatureError(); // fora da janela: tratado como inválido
    }
    const { eventId, reference, status, amount, currency } = parsed.data;
    return { eventId, reference, status, amount, currency };
  }
}
