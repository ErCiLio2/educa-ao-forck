import { z } from 'zod';

export const CreateOfferSchema = z.object({
  name: z.string().trim().min(2).max(100),
  hours: z.number().positive().max(9999).multipleOf(0.25),
  price: z.number().positive().max(100_000_000_000).multipleOf(0.01),
  currency: z.literal('AOA').default('AOA'),
  validityDays: z.number().int().positive().max(3650).optional(),
});

export const UpdateOfferSchema = z.object({ active: z.boolean() });

export const OfferParamsSchema = z.object({ id: z.string().uuid() });

export const CreateReferenceSchema = z.object({ offerId: z.string().uuid() });

// Cabeçalho Idempotency-Key: repetir o pedido devolve a mesma referência em vez de criar outra
export const IdempotencyKeySchema = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const WebhookParamsSchema = z.object({ gateway: z.string().min(1).max(40) });

export const SandboxSimulateSchema = z.object({
  status: z.enum(['PAID', 'FAILED', 'REFUNDED']),
});

export const SandboxPaymentParamsSchema = z.object({ id: z.string().uuid() });

export type { GatewayEventStatus } from './gateways/gateway';

export const TransactionParamsSchema = z.object({ id: z.string().uuid() });

export const ListTransactionsQuerySchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']).optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ListPackagesQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  expired: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateOfferDto = z.infer<typeof CreateOfferSchema>;
export type ListTransactionsQuery = z.infer<typeof ListTransactionsQuerySchema>;
export type ListPackagesQuery = z.infer<typeof ListPackagesQuerySchema>;
