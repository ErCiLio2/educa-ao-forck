import { z } from 'zod';
import { docs, errorResponses, isoDate, named, obj, pageShape, Roles, uuid } from '../../shared/core/openapi';
import {
  ListRoleChangesQuerySchema,
  ListUsersQuerySchema,
  RequestParamsSchema,
  RequestRoleChangeSchema,
} from './admin.types';

const AdminUser = obj({ id: uuid, name: z.string(), email: z.string().email(), role: Roles, mfaEnabled: z.boolean(), createdAt: isoDate });

const RoleChange = named(
  'RoleChangeRequest',
  obj({
    id: uuid,
    fromRole: Roles,
    toRole: Roles,
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    createdAt: isoDate,
    decidedAt: isoDate.nullable(),
    target: obj({ id: uuid, name: z.string(), email: z.string().email() }),
    requestedBy: obj({ id: uuid, name: z.string() }),
    decidedBy: obj({ id: uuid, name: z.string() }).nullable(),
  }),
);

const TAG = ['Administração'];

export const adminDocs = {
  users: docs({
    tags: TAG, operationId: 'adminListUsers', summary: 'Listar utilizadores',
    description: 'Sem dados sensíveis (password, segredo MFA, data de nascimento).',
    roles: ['ADMIN'], mfa: 'session', querystring: ListUsersQuerySchema,
    response: { 200: obj({ users: z.array(AdminUser), ...pageShape }), ...errorResponses(401, 403, 422) },
  }),
  listRoleChanges: docs({
    tags: TAG, operationId: 'listRoleChanges', summary: 'Pedidos de alteração de papel',
    roles: ['ADMIN'], mfa: 'session', querystring: ListRoleChangesQuerySchema,
    response: { 200: obj({ requests: z.array(RoleChange), ...pageShape }), ...errorResponses(401, 403, 422) },
  }),
  requestRoleChange: docs({
    tags: TAG, operationId: 'requestRoleChange', summary: 'Pedir uma alteração de papel',
    description:
      'Segregação de funções (RN-08): o pedido tem de ser aprovado por **outro** administrador (válido 24 h). Não se altera o ' +
      'próprio papel; um pendente de cada vez por utilizador.',
    roles: ['ADMIN'], mfa: 'recent', body: RequestRoleChangeSchema,
    response: { 201: obj({ request: RoleChange }), ...errorResponses(401, 403, 404, 409, 422) },
  }),
  approve: docs({
    tags: TAG, operationId: 'approveRoleChange', summary: 'Aprovar uma alteração de papel',
    description:
      'Só por um administrador diferente do que pediu. Revoga as sessões do utilizador alterado. 409 se o pedido caducou, já foi ' +
      'decidido, ou a alteração violar a integridade (último administrador, encarregado com dependentes…).',
    roles: ['ADMIN'], mfa: 'recent', params: RequestParamsSchema,
    response: { 200: obj({ request: RoleChange }), ...errorResponses(401, 403, 404, 409, 422) },
  }),
  reject: docs({
    tags: TAG, operationId: 'rejectRoleChange', summary: 'Rejeitar uma alteração de papel',
    roles: ['ADMIN'], mfa: 'recent', params: RequestParamsSchema,
    response: { 200: obj({ request: RoleChange }), ...errorResponses(401, 403, 404, 409, 422) },
  }),
};
