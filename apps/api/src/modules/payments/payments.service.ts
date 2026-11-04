// Módulo payments — expõe apenas esta camada de serviço pública.
// Outros módulos comunicam via eventos internos (EventEmitter2/BullMQ),
// nunca por acesso directo ao Prisma deste módulo.
import { randomUUID } from 'node:crypto';
import { PaymentStatus, Prisma } from '@prisma/client';
import prisma from '../../shared/core/database';
import { env } from '../../shared/core/env';
import { writeAuditLog } from '../../shared/core/audit';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../shared/core/errors';
import { getPayerIds } from '../guardians/guardians.service';
import { activeGateway, getGateway } from './gateways';
import { SANDBOX_SIGNATURE_HEADER, signSandboxPayload } from './gateways/sandbox.gateway';
import { InvalidWebhookSignatureError, MalformedWebhookError } from './gateways/gateway';
import { emit } from '../../shared/core/events';
import type { CreateOfferDto, GatewayEventStatus, ListPackagesQuery, ListTransactionsQuery } from './payments.types';

// ── Débito / estorno de horas (usado pelo bookings) ──────────────────────────
// Débito de horas (RN-04). Corre dentro da transacção do chamador para que a matrícula
// e o débito sejam atómicos. Escolhe o pacote válido que expira primeiro e bloqueia a
// linha (FOR UPDATE), por isso dois débitos simultâneos nunca deixam o saldo negativo.
export async function debitHours(
  tx: Prisma.TransactionClient,
  payerIds: string[],
  hours: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "HourPackage"
    SET "remainingHours" = "remainingHours" - ${hours}::numeric
    WHERE id = (
      SELECT id FROM "HourPackage"
      WHERE "userId" IN (${Prisma.join(payerIds)})
        AND "remainingHours" >= ${hours}::numeric
        AND ("expiresAt" IS NULL OR "expiresAt" > now())
      ORDER BY "expiresAt" ASC NULLS LAST, "releasedAt" ASC
      LIMIT 1
      FOR UPDATE
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

export async function refundHours(
  tx: Prisma.TransactionClient,
  packageId: string,
  hours: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "HourPackage"
    SET "remainingHours" = LEAST("remainingHours" + ${hours}::numeric, "totalHours")
    WHERE id = ${packageId}`;
}

// ── Catálogo de pacotes (geridos pelo Administrador) ─────────────────────────

const OFFER_SELECT = {
  id: true, name: true, hours: true, price: true, currency: true, validityDays: true, active: true,
} as const;

export function listOffers(includeInactive = false) {
  return prisma.packageOffer.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: { price: 'asc' },
    select: OFFER_SELECT,
  });
}

export async function createOffer(adminId: string, data: CreateOfferDto) {
  const offer = await prisma.packageOffer.create({
    data: {
      name: data.name,
      hours: data.hours.toFixed(2),
      price: data.price.toFixed(2),
      currency: data.currency,
      validityDays: data.validityDays ?? null,
    },
    select: OFFER_SELECT,
  });
  await writeAuditLog({ actorId: adminId, entityType: 'PackageOffer', entityId: offer.id, action: 'OFFER_CREATED' });
  return offer;
}

export async function setOfferActive(adminId: string, offerId: string, active: boolean) {
  const { count } = await prisma.packageOffer.updateMany({ where: { id: offerId }, data: { active } });
  if (count === 0) throw new NotFoundError('Pacote não encontrado');
  await writeAuditLog({
    actorId: adminId,
    entityType: 'PackageOffer',
    entityId: offerId,
    action: active ? 'OFFER_ACTIVATED' : 'OFFER_DEACTIVATED',
  });
  return prisma.packageOffer.findUniqueOrThrow({ where: { id: offerId }, select: OFFER_SELECT });
}

// ── Pagamento por referência (RF-PAG-01) ─────────────────────────────────────

const PAYMENT_SELECT = {
  id: true, status: true, gateway: true, entity: true, reference: true, amount: true, currency: true,
  hours: true, referenceExpiresAt: true, confirmedAt: true, createdAt: true, offerId: true,
} as const;

export async function createReference(userId: string, offerId: string, idempotencyKey?: string) {
  // A chave inclui o utilizador: ninguém consegue colidir nem sondar chaves de outros
  const key = `${userId}:${idempotencyKey ?? randomUUID()}`;

  const replay = async () => {
    const existing = await prisma.paymentTransaction.findUnique({
      where: { idempotencyKey: key },
      select: { ...PAYMENT_SELECT },
    });
    if (!existing) return null;
    if (existing.offerId !== offerId) throw new ConflictError('Idempotency-Key já usada com outro pacote');
    return { created: false as const, payment: existing };
  };

  const previous = await replay();
  if (previous) return previous;

  const offer = await prisma.packageOffer.findFirst({ where: { id: offerId, active: true } });
  if (!offer) throw new NotFoundError('Pacote não encontrado');

  const gateway = activeGateway();
  const expiresAt = new Date(Date.now() + env.PAYMENT_REFERENCE_TTL_HOURS * 3_600_000);

  for (let attempt = 0; attempt < 3; attempt++) {
    const id = randomUUID();
    const ref = await gateway.createReference({
      orderId: id,
      amount: offer.price.toFixed(2),
      currency: offer.currency,
      expiresAt,
    });
    try {
      const payment = await prisma.paymentTransaction.create({
        data: {
          id,
          userId,
          gateway: gateway.name,
          reference: ref.reference,
          entity: ref.entity ?? null,
          amount: offer.price,
          currency: offer.currency,
          idempotencyKey: key,
          offerId: offer.id,
          hours: offer.hours,
          validityDays: offer.validityDays,
          referenceExpiresAt: ref.expiresAt,
        },
        select: PAYMENT_SELECT,
      });
      await writeAuditLog({ actorId: userId, entityType: 'PaymentTransaction', entityId: id, action: 'PAYMENT_REFERENCE_CREATED' });
      return { created: true as const, payment };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      // Pedido duplicado em simultâneo (mesma Idempotency-Key) → devolve o vencedor; senão, colisão de referência → tenta outra
      const raced = await replay();
      if (raced) return raced;
    }
  }
  throw new ConflictError('Não foi possível gerar uma referência única, tente novamente');
}

export function listMyPayments(userId: string) {
  return prisma.paymentTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: PAYMENT_SELECT,
  });
}

// Saldo de horas (RF-PAG-03). O dependente vê também os pacotes do seu Encarregado, que são os que usa.
export async function listMyPackages(userId: string) {
  const payerIds = await getPayerIds(userId);
  const packages = await prisma.hourPackage.findMany({
    where: { userId: { in: payerIds } },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { releasedAt: 'asc' }],
    select: { id: true, userId: true, totalHours: true, remainingHours: true, releasedAt: true, expiresAt: true },
  });
  const now = Date.now();
  const mapped = packages.map(({ userId: owner, ...p }) => ({
    ...p,
    sharedByGuardian: owner !== userId,
    expired: p.expiresAt !== null && p.expiresAt.getTime() <= now,
  }));
  const availableHours = mapped
    .filter((p) => !p.expired)
    .reduce((sum, p) => sum.plus(p.remainingHours), new Prisma.Decimal(0));
  return { availableHours: availableHours.toFixed(2), packages: mapped };
}

// ── Webhook do gateway (RF-PAG-02, RN-03, RN-07, RNF-SEG-04) ─────────────────

export type WebhookOutcome =
  | 'confirmed' | 'failed' | 'refunded' | 'noop' | 'duplicate' | 'unknown_reference' | 'amount_mismatch';

export async function handleWebhook(
  gatewayName: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): Promise<WebhookOutcome> {
  const gateway = getGateway(gatewayName);
  if (!gateway) throw new NotFoundError('Gateway desconhecido');

  // 1. Assinatura sobre o corpo cru, antes de qualquer outra coisa
  let event;
  try {
    event = gateway.parseWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) throw new UnauthorizedError('Assinatura inválida');
    if (err instanceof MalformedWebhookError) throw new ValidationError(err.message);
    throw err;
  }

  // 2. Tudo numa transacção: se algo falhar, o evento não fica marcado e o gateway pode reenviar
  const { outcome, paymentId } = await prisma.$transaction(async (tx) => {
    // Idempotência: o mesmo evento entregue duas vezes só tem efeito uma vez
    const inserted = await tx.$executeRaw`
      INSERT INTO "PaymentWebhookEvent" (id, gateway, "eventId")
      VALUES (${randomUUID()}, ${gateway.name}, ${event.eventId})
      ON CONFLICT (gateway, "eventId") DO NOTHING`;
    if (inserted === 0) return { outcome: 'duplicate' as const, paymentId: null };

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "PaymentTransaction"
      WHERE gateway = ${gateway.name} AND reference = ${event.reference} FOR UPDATE`;
    if (locked.length === 0) return { outcome: 'unknown_reference' as const, paymentId: null };

    const payment = await tx.paymentTransaction.findUniqueOrThrow({ where: { id: locked[0].id } });

    // O valor pago tem de ser exactamente o da referência
    if (event.currency !== payment.currency || !new Prisma.Decimal(event.amount).equals(payment.amount)) {
      return { outcome: 'amount_mismatch' as const, paymentId: payment.id };
    }

    if (event.status === 'PAID') {
      // Pago depois de a referência expirar (FAILED) também conta: o dinheiro foi recebido
      if (payment.status === PaymentStatus.CONFIRMED || payment.status === PaymentStatus.REFUNDED) {
        return { outcome: 'noop' as const, paymentId: payment.id };
      }
      const now = new Date();
      await tx.paymentTransaction.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CONFIRMED, confirmedAt: now },
      });
      // RN-03 + RN-07: o pacote só nasce aqui, e paymentId @unique garante no máximo um por pagamento
      await tx.hourPackage.create({
        data: {
          userId: payment.userId,
          paymentId: payment.id,
          totalHours: payment.hours,
          remainingHours: payment.hours,
          expiresAt: payment.validityDays ? new Date(now.getTime() + payment.validityDays * 86_400_000) : null,
        },
      });
      return { outcome: 'confirmed' as const, paymentId: payment.id };
    }

    if (event.status === 'FAILED') {
      if (payment.status !== PaymentStatus.PENDING) return { outcome: 'noop' as const, paymentId: payment.id };
      await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      return { outcome: 'failed' as const, paymentId: payment.id };
    }

    // REFUNDED: anula as horas ainda por usar (as já consumidas ficam consumidas)
    if (payment.status !== PaymentStatus.CONFIRMED) return { outcome: 'noop' as const, paymentId: payment.id };
    await tx.paymentTransaction.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } });
    await tx.hourPackage.updateMany({ where: { paymentId: payment.id }, data: { remainingHours: 0 } });
    return { outcome: 'refunded' as const, paymentId: payment.id };
  });

  const actions: Partial<Record<WebhookOutcome, string>> = {
    confirmed: 'PAYMENT_CONFIRMED',
    failed: 'PAYMENT_FAILED',
    refunded: 'PAYMENT_REFUNDED',
    amount_mismatch: 'PAYMENT_AMOUNT_MISMATCH',
  };
  const action = actions[outcome];
  if (action && paymentId) {
    await writeAuditLog({ entityType: 'PaymentTransaction', entityId: paymentId, action });
  }
  // Referência desconhecida pode indicar payload manipulado — auditado para investigação forense
  if (outcome === 'unknown_reference') {
    await writeAuditLog({ entityType: 'PaymentWebhook', entityId: event.reference, action: 'PAYMENT_UNKNOWN_REFERENCE' });
  }
  if (outcome === 'amount_mismatch') {
    console.error('[Payments] valor do webhook difere da referência', paymentId);
  }

  if ((outcome === 'confirmed' || outcome === 'failed') && paymentId) {
    const payment = await prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      select: { userId: true, amount: true, currency: true, hours: true },
    });
    if (payment) {
      const amount = payment.amount.toFixed(2);
      if (outcome === 'confirmed') {
        await emit('payment.confirmed', { userId: payment.userId, amount, currency: payment.currency, hours: payment.hours.toNumber() });
      } else {
        await emit('payment.failed', { userId: payment.userId, amount, currency: payment.currency });
      }
    }
  }

  return outcome;
}

// ── Administração: listagem, detalhe, reembolso manual (RF-PAG-04) ───────────

const ADMIN_TRANSACTION_SELECT = {
  id: true, status: true, gateway: true, entity: true, reference: true,
  amount: true, currency: true, hours: true, referenceExpiresAt: true,
  confirmedAt: true, createdAt: true, offerId: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

export async function adminListTransactions(query: ListTransactionsQuery) {
  const where: Prisma.PaymentTransactionWhereInput = {};
  if (query.status) where.status = PaymentStatus[query.status];
  if (query.userId) where.userId = query.userId;

  const [total, rows] = await Promise.all([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ADMIN_TRANSACTION_SELECT,
    }),
  ]);
  return { total, page: query.page, limit: query.limit, transactions: rows };
}

export async function adminGetTransaction(id: string) {
  const tx = await prisma.paymentTransaction.findUnique({
    where: { id },
    select: {
      ...ADMIN_TRANSACTION_SELECT,
      hourPackage: {
        select: { id: true, totalHours: true, remainingHours: true, releasedAt: true, expiresAt: true },
      },
    },
  });
  if (!tx) throw new NotFoundError('Transacção não encontrada');
  return tx;
}

export async function adminRefundTransaction(adminId: string, id: string) {
  const record = await prisma.paymentTransaction.findUnique({
    where: { id },
    select: { userId: true, amount: true, currency: true },
  });
  if (!record) throw new NotFoundError('Transacção não encontrada');

  // UPDATE WHERE status=CONFIRMED é atómico: o primeiro pedido bloqueia a linha;
  // o segundo vê REFUNDED e obtém count=0 — cobre PENDING, FAILED e REFUNDED.
  await prisma.$transaction(async (trx) => {
    const { count } = await trx.paymentTransaction.updateMany({
      where: { id, status: PaymentStatus.CONFIRMED },
      data: { status: PaymentStatus.REFUNDED },
    });
    if (count === 0) {
      throw new ValidationError('Só é possível reembolsar transacções confirmadas', { status: ['deve ser CONFIRMED'] });
    }
    await trx.hourPackage.updateMany({ where: { paymentId: id }, data: { remainingHours: 0 } });
  });

  await writeAuditLog({ actorId: adminId, entityType: 'PaymentTransaction', entityId: id, action: 'PAYMENT_REFUNDED_MANUAL' });
  await emit('payment.refunded', { userId: record.userId, amount: record.amount.toFixed(2), currency: record.currency });

  return prisma.paymentTransaction.findUniqueOrThrow({
    where: { id },
    select: ADMIN_TRANSACTION_SELECT,
  });
}

const ADMIN_PACKAGE_SELECT = {
  id: true, totalHours: true, remainingHours: true, releasedAt: true, expiresAt: true,
  paymentId: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

export async function adminListPackages(query: ListPackagesQuery) {
  const now = new Date();
  const where: Prisma.HourPackageWhereInput = {};
  if (query.userId) where.userId = query.userId;
  if (query.expired === 'true') where.expiresAt = { lte: now };
  if (query.expired === 'false') where.OR = [{ expiresAt: null }, { expiresAt: { gt: now } }];

  const [total, rows] = await Promise.all([
    prisma.hourPackage.count({ where }),
    prisma.hourPackage.findMany({
      where,
      orderBy: { releasedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ADMIN_PACKAGE_SELECT,
    }),
  ]);
  const mapped = rows.map((p) => ({ ...p, expired: p.expiresAt !== null && p.expiresAt <= now }));
  return { total, page: query.page, limit: query.limit, packages: mapped };
}

// ── Sandbox: simulação de eventos de pagamento (só fora de produção) ──────────

export async function listSandboxPending() {
  return prisma.paymentTransaction.findMany({
    where: { gateway: 'sandbox', status: PaymentStatus.PENDING },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, reference: true, entity: true, amount: true, currency: true,
      hours: true, referenceExpiresAt: true, createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function simulateWebhookEvent(
  adminId: string,
  paymentId: string,
  status: GatewayEventStatus,
): Promise<WebhookOutcome> {
  if (env.PAYMENT_GATEWAY !== 'sandbox') {
    throw new ForbiddenError('Simulação só disponível com PAYMENT_GATEWAY=sandbox');
  }
  const payment = await prisma.paymentTransaction.findUnique({
    where: { id: paymentId },
    select: { reference: true, amount: true, currency: true, gateway: true },
  });
  if (!payment) throw new NotFoundError('Transacção não encontrada');
  if (payment.gateway !== 'sandbox') {
    throw new ForbiddenError('Transacção não pertence ao gateway sandbox');
  }

  // Constrói um payload sandbox válido e passa-o pela mesma rota do webhook real —
  // sem duplicar lógica: idempotência, pacote de horas e eventos de domínio são reutilizados.
  const raw = Buffer.from(JSON.stringify({
    eventId: `sim-${randomUUID()}`,
    reference: payment.reference,
    status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    timestamp: Date.now(),
  }));
  const headers = { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(raw, env.SANDBOX_WEBHOOK_SECRET!) };
  const outcome = await handleWebhook('sandbox', raw, headers);

  await writeAuditLog({
    actorId: adminId,
    entityType: 'PaymentTransaction',
    entityId: paymentId,
    action: 'PAYMENT_SIMULATED',
  });
  return outcome;
}

// ── Leitura para o módulo activity (métricas de administração) ───────────────

export async function getPlatformPaymentStats(since: Date) {
  const now = new Date();
  const [confirmed, pending, released, outstanding] = await Promise.all([
    prisma.paymentTransaction.aggregate({
      where: { status: PaymentStatus.CONFIRMED, confirmedAt: { gte: since } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.paymentTransaction.count({ where: { status: PaymentStatus.PENDING } }),
    prisma.hourPackage.aggregate({ where: { releasedAt: { gte: since } }, _sum: { totalHours: true } }),
    // Horas pagas e ainda por usar (e válidas): é o que a plataforma deve em aulas
    prisma.hourPackage.aggregate({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _sum: { remainingHours: true },
    }),
  ]);
  const zero = new Prisma.Decimal(0);
  return {
    confirmedPayments: confirmed._count._all,
    confirmedAmount: (confirmed._sum.amount ?? zero).toFixed(2),
    currency: 'AOA',
    pendingPayments: pending,
    hoursReleased: (released._sum.totalHours ?? zero).toFixed(2),
    hoursOutstanding: (outstanding._sum.remainingHours ?? zero).toFixed(2),
  };
}
