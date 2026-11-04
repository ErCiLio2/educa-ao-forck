import type { FastifyReply, FastifyRequest } from 'fastify';
import * as BookingsService from './bookings.service';
import {
  AttendanceParamsSchema,
  AttendanceSchema,
  CreateSessionSchema,
  ListSessionsQuerySchema,
  SessionParamsSchema,
} from './bookings.types';
import { parse } from '../../shared/core/validate';

export async function listSessions(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(ListSessionsQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await BookingsService.listSessions(query));
}

export async function getSession(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(SessionParamsSchema, request.params, 'Parâmetros inválidos');
  return reply.send({ session: await BookingsService.getSession(id) });
}

export async function createSession(request: FastifyRequest, reply: FastifyReply) {
  const data = parse(CreateSessionSchema, request.body);
  const session = await BookingsService.createSession(request.user!.id, data);
  return reply.status(201).send({ session });
}

export async function listMySessions(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ sessions: await BookingsService.listMySessions(request.user!.id) });
}

export async function deleteSession(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(SessionParamsSchema, request.params, 'Parâmetros inválidos');
  await BookingsService.deleteSession(request.user!.id, id);
  return reply.status(204).send();
}

export async function markAttendance(request: FastifyRequest, reply: FastifyReply) {
  const { id, enrollmentId } = parse(AttendanceParamsSchema, request.params, 'Parâmetros inválidos');
  const data = parse(AttendanceSchema, request.body);
  const enrollment = await BookingsService.markAttendance(request.user!.id, id, enrollmentId, data);
  return reply.send({ enrollment });
}

export async function enroll(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(SessionParamsSchema, request.params, 'Parâmetros inválidos');
  const enrollment = await BookingsService.enroll(request.user!.id, id);
  return reply.status(201).send({ enrollment });
}

export async function cancelEnrollment(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(SessionParamsSchema, request.params, 'Parâmetros inválidos');
  await BookingsService.cancelEnrollment(request.user!.id, id);
  return reply.status(204).send();
}

export async function listMyEnrollments(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ enrollments: await BookingsService.listMyEnrollments(request.user!.id) });
}

export async function getJoinToken(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await BookingsService.generateJoinToken(id, request.user!.id, request.user!.role as 'STUDENT' | 'TUTOR' | 'ADMIN');
  return reply.send(result);
}
