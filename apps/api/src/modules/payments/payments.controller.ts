import type { FastifyReply, FastifyRequest } from 'fastify';
import * as PaymentsService from './payments.service';
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
  WebhookParamsSchema,
} from './payments.types';
import { parse } from '../../shared/core/validate';

export async function listOffers(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ offers: await PaymentsService.listOffers() });
}

export async function listAllOffers(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ offers: await PaymentsService.listOffers(true) });
}

export async function createOffer(request: FastifyRequest, reply: FastifyReply) {
  const data = parse(CreateOfferSchema, request.body);
  return reply.status(201).send({ offer: await PaymentsService.createOffer(request.user!.id, data) });
}

export async function updateOffer(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(OfferParamsSchema, request.params, 'Parâmetros inválidos');
  const { active } = parse(UpdateOfferSchema, request.body);
  return reply.send({ offer: await PaymentsService.setOfferActive(request.user!.id, id, active) });
}

export async function createReference(request: FastifyRequest, reply: FastifyReply) {
  const { offerId } = parse(CreateReferenceSchema, request.body);
  const header = request.headers['idempotency-key'];
  const key = header === undefined ? undefined : parse(IdempotencyKeySchema, header, 'Idempotency-Key inválida');

  const { created, payment } = await PaymentsService.createReference(request.user!.id, offerId, key);
  return reply.status(created ? 201 : 200).send({ payment });
}

export async function listMyPayments(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ payments: await PaymentsService.listMyPayments(request.user!.id) });
}

export async function listMyPackages(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(await PaymentsService.listMyPackages(request.user!.id));
}

// O corpo chega como Buffer (parser dedicado em payments.routes): a assinatura é sobre os bytes originais
export async function webhook(request: FastifyRequest, reply: FastifyReply) {
  const { gateway } = parse(WebhookParamsSchema, request.params, 'Parâmetros inválidos');
  const outcome = await PaymentsService.handleWebhook(gateway, request.body as Buffer, request.headers);
  return reply.send({ received: true, outcome });
}

export async function adminListTransactions(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(ListTransactionsQuerySchema, request.query);
  return reply.send(await PaymentsService.adminListTransactions(query));
}

export async function adminGetTransaction(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(TransactionParamsSchema, request.params, 'Parâmetros inválidos');
  return reply.send({ transaction: await PaymentsService.adminGetTransaction(id) });
}

export async function adminRefundTransaction(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(TransactionParamsSchema, request.params, 'Parâmetros inválidos');
  return reply.send({ transaction: await PaymentsService.adminRefundTransaction(request.user!.id, id) });
}

export async function adminListPackages(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(ListPackagesQuerySchema, request.query);
  return reply.send(await PaymentsService.adminListPackages(query));
}

export async function sandboxListPending(_request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ transactions: await PaymentsService.listSandboxPending() });
}

export async function sandboxSimulate(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(SandboxPaymentParamsSchema, request.params, 'Parâmetros inválidos');
  const { status } = parse(SandboxSimulateSchema, request.body);
  const outcome = await PaymentsService.simulateWebhookEvent(request.user!.id, id, status);
  return reply.send({ outcome });
}
