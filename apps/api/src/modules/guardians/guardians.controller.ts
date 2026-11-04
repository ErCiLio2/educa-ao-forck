import type { FastifyReply, FastifyRequest } from 'fastify';
import * as GuardiansService from './guardians.service';
import { CreateDependentSchema, ResetDependentPasswordSchema, StudentParamsSchema } from './guardians.types';
import { ValidationError } from '../../shared/core/errors';

export async function createDependent(request: FastifyRequest, reply: FastifyReply) {
  const parsed = CreateDependentSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const dependent = await GuardiansService.createDependent(request.user!.id, parsed.data);
  return reply.status(201).send({ dependent });
}

export async function listDependents(request: FastifyRequest, reply: FastifyReply) {
  const dependents = await GuardiansService.listDependents(request.user!.id);
  return reply.send({ dependents });
}

function parseStudentId(params: unknown): string {
  const parsed = StudentParamsSchema.safeParse(params);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());
  return parsed.data.studentId;
}

export async function grantConsent(request: FastifyRequest, reply: FastifyReply) {
  const consent = await GuardiansService.grantConsent(request.user!.id, parseStudentId(request.params));
  return reply.status(201).send({ consent });
}

export async function revokeConsent(request: FastifyRequest, reply: FastifyReply) {
  const consent = await GuardiansService.revokeConsent(request.user!.id, parseStudentId(request.params));
  return reply.send({ consent });
}

export async function listConsents(request: FastifyRequest, reply: FastifyReply) {
  const consents = await GuardiansService.listConsents(request.user!.id, parseStudentId(request.params));
  return reply.send({ consents });
}

export async function myConsentStatus(request: FastifyRequest, reply: FastifyReply) {
  return reply.send({ consent: await GuardiansService.getConsentStatus(request.user!.id) });
}

export async function resetDependentPassword(request: FastifyRequest, reply: FastifyReply) {
  const studentId = parseStudentId(request.params);
  const parsed = ResetDependentPasswordSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  await GuardiansService.resetDependentPassword(request.user!.id, studentId, parsed.data.newPassword);
  return reply.status(204).send();
}
