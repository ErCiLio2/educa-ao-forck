import type { FastifyReply, FastifyRequest } from 'fastify';
import * as TutorsService from './tutors.service';
import {
  CreateProfileSchema,
  UpdateTutorProfileSchema,
  SubmitDocumentsSchema,
  UploadUrlSchema,
  ReviewTutorSchema,
  ListTutorsQuerySchema,
  ListPendingQuerySchema,
} from './tutors.types';
import { ValidationError } from '../../shared/core/errors';

export async function createProfile(request: FastifyRequest, reply: FastifyReply) {
  const parsed = CreateProfileSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const profile = await TutorsService.createProfile(request.user!.id, parsed.data);
  return reply.status(201).send({ profile });
}

export async function requestUploadUrl(request: FastifyRequest, reply: FastifyReply) {
  const parsed = UploadUrlSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const upload = await TutorsService.requestUploadUrl(request.user!.id, parsed.data);
  return reply.send(upload);
}

export async function updateProfile(request: FastifyRequest, reply: FastifyReply) {
  const parsed = UpdateTutorProfileSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const profile = await TutorsService.updateProfile(request.user!.id, parsed.data);
  return reply.send({ profile });
}

export async function submitDocuments(request: FastifyRequest, reply: FastifyReply) {
  const parsed = SubmitDocumentsSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const profile = await TutorsService.submitDocuments(request.user!.id, parsed.data);
  return reply.send({ profile });
}

export async function getMyProfile(request: FastifyRequest, reply: FastifyReply) {
  const profile = await TutorsService.getMyProfile(request.user!.id);
  return reply.send({ profile });
}

export async function listApproved(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ListTutorsQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());

  const result = await TutorsService.listApproved(parsed.data);
  return reply.send(result);
}

export async function getPublicProfile(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const profile = await TutorsService.getPublicProfile(request.params.id);
  return reply.send({ profile });
}

export async function reviewTutor(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = ReviewTutorSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const profile = await TutorsService.reviewTutor(request.user!.id, request.params.id, parsed.data);
  return reply.send({ profile });
}

export async function listPending(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ListPendingQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());

  const result = await TutorsService.listPending(parsed.data.page, parsed.data.limit);
  return reply.send(result);
}
