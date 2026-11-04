// Contrato dos gateways de pagamento por referência (Proxypay, PayPay, Kwanza Online…).
// O gateway real ainda não está decidido: cada fornecedor é um adaptador que implementa esta interface;
// o resto do módulo não conhece o fornecedor.

export interface CreateReferenceInput {
  orderId: string;
  amount: string; // decimal exacto, ex.: "5000.00"
  currency: string;
  expiresAt: Date;
}

export interface GatewayReference {
  reference: string; // o que o cliente paga (ATM / banco / app)
  entity?: string; // entidade, nos gateways que a exigem (estilo Multicaixa)
  expiresAt: Date;
}

export type GatewayEventStatus = 'PAID' | 'FAILED' | 'REFUNDED';

export interface GatewayEvent {
  eventId: string; // único por evento: base da idempotência
  reference: string;
  status: GatewayEventStatus;
  amount: string;
  currency: string;
}

export class InvalidWebhookSignatureError extends Error {}
export class MalformedWebhookError extends Error {}

export interface PaymentGateway {
  readonly name: string;
  createReference(input: CreateReferenceInput): Promise<GatewayReference>;
  // Verifica a assinatura sobre o corpo CRU antes de interpretar o conteúdo (RNF-SEG-04).
  // Lança InvalidWebhookSignatureError ou MalformedWebhookError.
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): GatewayEvent;
}
