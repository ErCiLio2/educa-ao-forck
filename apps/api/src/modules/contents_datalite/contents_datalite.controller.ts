import type { FastifyReply, FastifyRequest } from 'fastify';
import * as ContentsService from './contents_datalite.service';
import {
  AccessUrlQuerySchema,
  ChangeStatusSchema,
  ContentUploadUrlSchema,
  CreateContentSchema,
  ListAdminQuerySchema,
  ListContentsQuerySchema,
  UpdateContentSchema,
} from './contents_datalite.types';
import { ValidationError } from '../../shared/core/errors';

export async function requestUploadUrl(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ContentUploadUrlSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const result = await ContentsService.requestUploadUrl(request.user!.id, parsed.data);
  return reply.send(result);
}

export async function createContent(request: FastifyRequest, reply: FastifyReply) {
  const parsed = CreateContentSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const content = await ContentsService.createContent(request.user!.id, parsed.data);
  return reply.status(201).send({ content });
}

export async function listMine(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ListContentsQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());

  const result = await ContentsService.listMine(request.user!.id, parsed.data);
  return reply.send(result);
}

export async function listPublished(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ListContentsQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());

  const result = await ContentsService.listPublished(parsed.data);
  return reply.send(result);
}

export async function getById(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const content = await ContentsService.getPublicById(request.params.id);
  return reply.send({ content });
}

export async function updateContent(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = UpdateContentSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const content = await ContentsService.updateContent(request.user!.id, request.params.id, parsed.data);
  return reply.send({ content });
}

export async function changeStatus(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = ChangeStatusSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const content = await ContentsService.changeStatus(request.user!.id, request.params.id, parsed.data);
  return reply.send({ content });
}

export async function deleteContent(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await ContentsService.deleteContent(request.user!.id, request.params.id);
  return reply.status(204).send();
}

export async function getAccessUrl(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const parsed = AccessUrlQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());

  const result = await ContentsService.getAccessUrl(
    request.user!.id,
    request.user!.role,
    request.params.id,
    parsed.data.datalite,
  );
  return reply.send(result);
}

export async function adminListAll(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ListAdminQuerySchema.safeParse(request.query);
  if (!parsed.success) throw new ValidationError('Parâmetros inválidos', parsed.error.flatten());

  const result = await ContentsService.adminListAll(parsed.data);
  return reply.send(result);
}

export async function adminDeleteContent(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await ContentsService.adminDeleteContent(request.user!.id, request.params.id);
  return reply.status(204).send();
}
