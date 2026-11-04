import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ChangeStatus, Role } from '@prisma/client';
import * as AdminService from './admin.service';
import {
  ListRoleChangesQuerySchema,
  ListUsersQuerySchema,
  RequestParamsSchema,
  RequestRoleChangeSchema,
} from './admin.types';
import { parse } from '../../shared/core/validate';

export async function listUsers(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(ListUsersQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await AdminService.listUsers({ ...query, role: query.role as Role | undefined }));
}

export async function requestRoleChange(request: FastifyRequest, reply: FastifyReply) {
  const { userId, role } = parse(RequestRoleChangeSchema, request.body);
  const change = await AdminService.requestRoleChange(request.user!.id, userId, role as Role);
  return reply.status(201).send({ request: change });
}

export async function listRoleChanges(request: FastifyRequest, reply: FastifyReply) {
  const query = parse(ListRoleChangesQuerySchema, request.query, 'Parâmetros inválidos');
  return reply.send(await AdminService.listRoleChanges({ ...query, status: query.status as ChangeStatus | undefined }));
}

export async function approveRoleChange(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(RequestParamsSchema, request.params, 'Parâmetros inválidos');
  return reply.send({ request: await AdminService.decideRoleChange(request.user!.id, id, true) });
}

export async function rejectRoleChange(request: FastifyRequest, reply: FastifyReply) {
  const { id } = parse(RequestParamsSchema, request.params, 'Parâmetros inválidos');
  return reply.send({ request: await AdminService.decideRoleChange(request.user!.id, id, false) });
}
