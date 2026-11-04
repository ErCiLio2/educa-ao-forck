import { z } from 'zod';
import { decimal, docs, errorResponses, isoDate, named, obj, uuid } from '../../shared/core/openapi';
import {
  CreateOfferSchema,
  CreateReferenceSchema,
  IdempotencyKeySchema,
  ListPackagesQuerySchema,
  ListTransactionsQuerySchema,
  OfferParamsSchema,
  SandboxPaymentParamsSchema,
  SandboxSimulateSchema,
  TransactionParamsSchema,
  UpdateOfferSchema,
} from './payments.types';

export const Offer = named(
  'PackageOffer',
  obj({
    id: uuid,
    name: z.string(),
    hours: decimal,
    price: decimal,
    currency: z.literal('AOA'),
    validityDays: z.number().int().nullable().describe('Dias de validade após a confirmação; nulo = não expira'),
    active: z.boolean(),
  }),
);

export const Payment = named(
  'Payment',
  obj({
    id: uuid,
    status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']),
    gateway: z.string(),
    entity: z.string().nullable().describe('Entidade de pagamento, nos gateways que a exigem (estilo Multicaixa)'),
    reference: z.string().describe('A referência que o cliente paga (ATM, banco ou app)'),
    amount: decimal,
    currency: z.literal('AOA'),
    hours: decimal,
    referenceExpiresAt: isoDate.nullable(),
    confirmedAt: isoDate.nullable(),
    createdAt: isoDate,
    offerId: uuid.nullable(),
  }),
);

const Package = obj({
  id: uuid,
  totalHours: decimal,
  remainingHours: decimal,
  releasedAt: isoDate,
  expiresAt: isoDate.nullable(),
  sharedByGuardian: z.boolean().describe('Pacote do Encarregado, usado pelo dependente'),
  expired: z.boolean(),
});

// O formato do corpo depende do gateway; este é o do simulador `sandbox` (os reais definem o seu e têm adaptador próprio)
const SandboxWebhook = z.object({
  eventId: z.string(), reference: z.string(), status: z.enum(['PAID', 'FAILED', 'REFUNDED']),
  amount: z.string(), currency: z.string(), timestamp: z.number().int().describe('Epoch em ms; fora de ±5 min é recusado'),
});

const TAG = ['Pagamentos'];

const AdminUser = obj({ id: uuid, name: z.string(), email: z.string() });

const AdminTransaction = named(
  'AdminTransaction',
  obj({
    id: uuid,
    status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']),
    gateway: z.string(),
    entity: z.string().nullable(),
    reference: z.string(),
    amount: decimal,
    currency: z.literal('AOA'),
    hours: decimal,
    referenceExpiresAt: isoDate.nullable(),
    confirmedAt: isoDate.nullable(),
    createdAt: isoDate,
    offerId: uuid.nullable(),
    user: AdminUser,
  }),
);

const AdminTransactionDetail = named(
  'AdminTransactionDetail',
  obj({
    id: uuid,
    status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']),
    gateway: z.string(),
    entity: z.string().nullable(),
    reference: z.string(),
    amount: decimal,
    currency: z.literal('AOA'),
    hours: decimal,
    referenceExpiresAt: isoDate.nullable(),
    confirmedAt: isoDate.nullable(),
    createdAt: isoDate,
    offerId: uuid.nullable(),
    user: AdminUser,
    hourPackage: obj({
      id: uuid,
      totalHours: decimal,
      remainingHours: decimal,
      releasedAt: isoDate,
      expiresAt: isoDate.nullable(),
    }).nullable(),
  }),
);

const AdminPackage = named(
  'AdminPackage',
  obj({
    id: uuid,
    totalHours: decimal,
    remainingHours: decimal,
    releasedAt: isoDate,
    expiresAt: isoDate.nullable(),
    expired: z.boolean(),
    paymentId: uuid,
    user: AdminUser,
  }),
);

const ADMIN_TAG = ['Pagamentos · Administração'];

export const paymentsDocs = {
  listOffers: docs({
    tags: TAG, operationId: 'listOffers', summary: 'Pacotes de horas à venda', security: 'none',
    response: { 200: obj({ offers: z.array(Offer) }) },
  }),
  listAllOffers: docs({
    tags: ['Pagamentos · Administração'], operationId: 'listAllOffers', summary: 'Todos os pacotes, incluindo inactivos',
    roles: ['ADMIN'], mfa: 'session',
    response: { 200: obj({ offers: z.array(Offer) }), ...errorResponses(401, 403) },
  }),
  createOffer: docs({
    tags: ['Pagamentos · Administração'], operationId: 'createOffer', summary: 'Criar um pacote de horas',
    description: 'Preços e validade são decisão do cliente: não estão no código.',
    roles: ['ADMIN'], mfa: 'session', body: CreateOfferSchema,
    response: { 201: obj({ offer: Offer }), ...errorResponses(401, 403, 422) },
  }),
  updateOffer: docs({
    tags: ['Pagamentos · Administração'], operationId: 'setOfferActive', summary: 'Activar ou desactivar um pacote',
    roles: ['ADMIN'], mfa: 'session', params: OfferParamsSchema, body: UpdateOfferSchema,
    response: { 200: obj({ offer: Offer }), ...errorResponses(401, 403, 404, 422) },
  }),
  createReference: docs({
    tags: TAG, operationId: 'createPaymentReference', summary: 'Gerar a referência de pagamento',
    description:
      'Devolve 201 com uma referência nova ou 200 se o `Idempotency-Key` já tiver sido usado (mesma referência). O pagamento só ' +
      'liberta horas quando o gateway confirmar (webhook). Alunos dependentes precisam de consentimento activo.',
    roles: ['STUDENT', 'GUARDIAN'], body: CreateReferenceSchema,
    headers: z.object({ 'idempotency-key': IdempotencyKeySchema.optional().describe('8 a 64 caracteres [A-Za-z0-9_-]') }),
    response: { 200: obj({ payment: Payment }), 201: obj({ payment: Payment }), ...errorResponses(401, 403, 404, 409, 422, 429) },
  }),
  mine: docs({
    tags: TAG, operationId: 'listMyPayments', summary: 'Os meus pagamentos',
    roles: ['STUDENT', 'GUARDIAN'],
    response: { 200: obj({ payments: z.array(Payment) }), ...errorResponses(401, 403) },
  }),
  myPackages: docs({
    tags: TAG, operationId: 'listMyPackages', summary: 'O meu saldo de horas',
    description: 'O dependente vê também os pacotes do Encarregado (`sharedByGuardian`), que são os que usa.',
    roles: ['STUDENT', 'GUARDIAN'],
    response: { 200: obj({ availableHours: decimal, packages: z.array(Package) }), ...errorResponses(401, 403) },
  }),
  webhook: docs({
    tags: ['Pagamentos · Gateway'], operationId: 'paymentWebhook', summary: 'Aviso do gateway de pagamento', security: 'none',
    description:
      'Chamado pelo gateway, **não por clientes**. Autenticado pela assinatura sobre o corpo cru (no `sandbox`, o cabeçalho ' +
      '`x-educa-signature` = HMAC-SHA256 hex). Idempotente por `eventId`. `outcome`: `confirmed` liberta o pacote; `duplicate` e ' +
      '`noop` não têm efeito; `amount_mismatch` não confirma (o valor tem de coincidir).',
    params: z.object({ gateway: z.string().describe('Nome do gateway, ex.: sandbox') }),
    body: SandboxWebhook,
    response: {
      200: obj({
        received: z.literal(true),
        outcome: z.enum(['confirmed', 'failed', 'refunded', 'noop', 'duplicate', 'unknown_reference', 'amount_mismatch']),
      }),
      ...errorResponses(401, 404, 422),
    },
  }),

  // ── Admin ───────────────────────────────────────────────────────────────────

  adminListTransactions: docs({
    tags: ADMIN_TAG, operationId: 'adminListTransactions', summary: 'Listar todas as transacções',
    roles: ['ADMIN'], mfa: 'session', querystring: ListTransactionsQuerySchema,
    response: {
      200: obj({
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
        transactions: z.array(AdminTransaction),
      }),
      ...errorResponses(401, 403, 422),
    },
  }),

  adminGetTransaction: docs({
    tags: ADMIN_TAG, operationId: 'adminGetTransaction', summary: 'Detalhe de uma transacção',
    roles: ['ADMIN'], mfa: 'session', params: TransactionParamsSchema,
    response: {
      200: obj({ transaction: AdminTransactionDetail }),
      ...errorResponses(401, 403, 404, 422),
    },
  }),

  adminRefundTransaction: docs({
    tags: ADMIN_TAG, operationId: 'adminRefundTransaction', summary: 'Reembolso manual de uma transacção (RF-PAG-04)',
    description: 'Marca a transacção como REFUNDED e anula as horas restantes do pacote. Exige MFA recente.',
    roles: ['ADMIN'], mfa: 'recent', params: TransactionParamsSchema,
    response: {
      200: obj({ transaction: AdminTransaction }),
      ...errorResponses(401, 403, 404, 422),
    },
  }),

  adminListPackages: docs({
    tags: ADMIN_TAG, operationId: 'adminListPackages', summary: 'Listar todos os pacotes de horas',
    roles: ['ADMIN'], mfa: 'session', querystring: ListPackagesQuerySchema,
    response: {
      200: obj({
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
        packages: z.array(AdminPackage),
      }),
      ...errorResponses(401, 403, 422),
    },
  }),

  // ── Sandbox ─────────────────────────────────────────────────────────────────

  sandboxSimulate: docs({
    tags: ['Pagamentos · Sandbox'], operationId: 'sandboxSimulate',
    summary: 'Simular evento de pagamento (sandbox, não-produção)',
    description:
      'Dispara um evento PAID, FAILED ou REFUNDED sobre uma transacção sandbox, passando pelo caminho ' +
      'completo do webhook (idempotência, pacote de horas, eventos de domínio). Só disponível com ' +
      '`PAYMENT_GATEWAY=sandbox`. Registado no log de auditoria como `PAYMENT_SIMULATED`.',
    roles: ['ADMIN'], mfa: 'session',
    params: SandboxPaymentParamsSchema,
    body: SandboxSimulateSchema,
    response: {
      200: obj({
        outcome: z.enum(['confirmed', 'failed', 'refunded', 'noop', 'duplicate', 'unknown_reference', 'amount_mismatch']),
      }),
      ...errorResponses(401, 403, 404, 422),
    },
  }),
};
