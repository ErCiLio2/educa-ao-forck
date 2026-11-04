import type { FastifyReply, FastifyRequest } from 'fastify';
import * as ActivityService from './activity.service';
import { HistoryQuerySchema, MetricsQuerySchema, PageQuerySchema, StudentParamsSchema } from './activity.types';
import { parse } from '../../shared/core/validate';

const studentIdOf = (request: FastifyRequest) =>
  parse(StudentParamsSchema, request.params, 'Parâmetros inválidos').studentId;

// ── Aluno ──
export async function mySummary(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ summary: await ActivityService.studentSummary(request.user!.id) });
}

export async function myHistory(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(HistoryQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await ActivityService.studentHistory(request.user!.id, query));
}

// ── Encarregado ──
export async function dependentsOverview(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ dependents: await ActivityService.dependentsOverview(request.user!.id) });
}

export async function dependentSummary(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ summary: await ActivityService.dependentSummary(request.user!.id, studentIdOf(request)) });
}

export async function dependentHistory(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(HistoryQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await ActivityService.dependentHistory(request.user!.id, studentIdOf(request), query));
}

// ── Tutor ──
export async function tutorSummary(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ summary: await ActivityService.tutorSummary(request.user!.id) });
}

export async function tutorHistory(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(PageQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await ActivityService.tutorHistory(request.user!.id, query));
}

// ── Administrador ──
export async function adminMetrics(request: FastifyRequest, reply: FastifyReply) {
  const { days } = parse(MetricsQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send({ metrics: await ActivityService.adminMetrics(days) });
}
