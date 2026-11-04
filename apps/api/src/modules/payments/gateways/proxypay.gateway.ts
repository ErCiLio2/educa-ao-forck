import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  InvalidWebhookSignatureError,
  MalformedWebhookError,
  type CreateReferenceInput,
  type GatewayEvent,
  type GatewayReference,
  type PaymentGateway,
} from './gateway';

// ── Adaptador Proxypay ────────────────────────────────────────────────────────
// Documentação: https://proxypay.co.ao/docs  (confirmar URL com o cliente)
//
// Antes de activar:
//   1. Obter credenciais do Proxypay (apiKey + webhookSecret)
//   2. Definir no .env: PAYMENT_GATEWAY=proxypay
//      PROXYPAY_API_URL=https://api.proxypay.co.ao
//      PROXYPAY_API_KEY=<chave>
//      PROXYPAY_WEBHOOK_SECRET=<segredo>
//   3. Descomentar o bloco em gateways/index.ts
//
// TODO antes de produção:
//   - Confirmar formato exacto do payload de criação de referência
//   - Confirmar campo e algoritmo da assinatura do webhook
//   - Confirmar formato do eventId e se o Proxypay suporta idempotência nativa
//   - Testar com conta sandbox do Proxypay (ambiente separado do nosso sandbox)

// Estrutura da resposta de criação de referência — ajustar ao contrato real do Proxypay
type ProxypayReferenceResponse = {
  reference: string;
  entity: string;
  expiry_date: string; // ISO 8601
};

// Estrutura do payload do webhook — ajustar ao contrato real do Proxypay
type ProxypayWebhookPayload = {
  id: string;          // eventId — único por notificação
  reference: string;
  entity: string;
  amount: string;      // decimal exacto, ex.: "5000.00"
  currency: string;    // ex.: "AOA"
  terminal_type: string;
  terminal_id: string;
  datetime: string;    // ISO 8601
  product_code: string;
  // TODO: confirmar campo de status (paid/failed/refunded) e os seus valores
  status: string;
};

// Mapeamento dos estados Proxypay → estados internos da plataforma
// TODO: confirmar os valores exactos que o Proxypay envia
const STATUS_MAP: Record<string, 'PAID' | 'FAILED' | 'REFUNDED'> = {
  PAID: 'PAID',
  FAILED: 'FAILED',
  REVERSED: 'REFUNDED',
};

export class ProxypayGateway implements PaymentGateway {
  readonly name = 'proxypay';

  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly webhookSecret: string,
  ) {}

  async createReference(input: CreateReferenceInput): Promise<GatewayReference> {
    // TODO: confirmar endpoint e formato exacto do corpo com a documentação do Proxypay
    const res = await fetch(`${this.apiUrl}/references`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        custom_fields: { order_id: input.orderId },
        expiry_date: input.expiresAt.toISOString().slice(0, 10), // TODO: confirmar formato
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Proxypay createReference falhou: ${res.status} ${body}`);
    }

    const data = (await res.json()) as ProxypayReferenceResponse;
    return {
      reference: data.reference,
      entity: data.entity,
      expiresAt: new Date(data.expiry_date),
    };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent {
    // TODO: confirmar o nome do cabeçalho de assinatura e o algoritmo (HMAC-SHA256 é o mais comum)
    const received = headers['x-proxypay-signature'];
    const signature = Array.isArray(received) ? received[0] : received;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');

    const a = Buffer.from(signature ?? '', 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new InvalidWebhookSignatureError();

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new MalformedWebhookError('JSON inválido');
    }

    // TODO: validar com Zod após confirmar o contrato definitivo
    const data = json as ProxypayWebhookPayload;
    if (!data.id || !data.reference || !data.amount || !data.currency || !data.status) {
      throw new MalformedWebhookError('Campos obrigatórios em falta no webhook Proxypay');
    }

    const status = STATUS_MAP[data.status.toUpperCase()];
    if (!status) throw new MalformedWebhookError(`Estado desconhecido: ${data.status}`);

    return {
      eventId: data.id,
      reference: data.reference,
      status,
      amount: data.amount,
      currency: data.currency,
    };
  }
}
