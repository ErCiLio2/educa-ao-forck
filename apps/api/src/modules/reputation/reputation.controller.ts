import type { FastifyReply, FastifyRequest } from 'fastify';
import * as ReputationService from './reputation.service';
import {
  CreateReviewSchema,
  ListReviewsQuerySchema,
  SessionParamsSchema,
  TutorParamsSchema,
} from './reputation.types';
import { parse } from '../../shared/core/validate';

export async function createReview(request: FastifyRequest, reply: FastifyReply) {
  const { sessionId } = parse(SessionParamsSchema, request.params, 'Parâmetros inválidos');
  const data = parse(CreateReviewSchema, request.body);
  const review = await ReputationService.createReview(request.user!.id, sessionId, data);
  return reply.status(201).send({ review });
}

export async function listPending(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ sessions: await ReputationService.listPendingReviews(request.user!.id) });
}

export async function listTutorReviews(request: FastifyRequest, reply: FastifyReply) {
  const { tutorId } = parse(TutorParamsSchema, request.params, 'Parâmetros inválidos');
  const query = parse(ListReviewsQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await ReputationService.listTutorReviews(tutorId, query));
}
