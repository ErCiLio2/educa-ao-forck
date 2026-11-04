import { ChangeStatus, Role } from '@prisma/client';
import prisma from '../../shared/core/database';
import { writeAuditLog } from '../../shared/core/audit';
import { emit } from '../../shared/core/events';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/core/errors';
import { changeUserRole, getUserRole, listUsers, revokeUserSessions } from '../auth/auth.service';
import { ROLE_CHANGE_TTL_HOURS } from './admin.types';

// ── Utilizadores (RF-ADM-01) ─────────────────────────────────────────────────

export { listUsers };

// ── Alteração de papéis com segregação de funções (RN-08, RNF-SEG-06) ────────
// Quem pede não pode ser quem aprova: são precisos dois administradores, cada um com MFA recente.
// A BD também o impede (CHECK em RoleChangeRequest), para além deste código.

const REQUEST_SELECT = {
  id: true, fromRole: true, toRole: true, status: true, createdAt: true, decidedAt: true,
  target: { select: { id: true, name: true, email: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const;

export async function requestRoleChange(adminId: string, targetId: string, toRole: Role) {
  if (targetId === adminId) throw new ForbiddenError('Não pode alterar o seu próprio papel');
  const fromRole = await getUserRole(targetId);
  if (fromRole === toRole) throw new ConflictError('O utilizador já tem esse papel');

  const request = await prisma.$transaction(async (tx) => {
    // Serializa pedidos para o mesmo utilizador: só um pendente de cada vez
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetId} FOR UPDATE`;
    const pending = await tx.roleChangeRequest.findFirst({ where: { targetId, status: ChangeStatus.PENDING }, select: { id: true } });
    if (pending) throw new ConflictError('Já existe um pedido pendente para este utilizador');
    return tx.roleChangeRequest.create({
      data: { targetId, fromRole, toRole, requestedById: adminId },
      select: REQUEST_SELECT,
    });
  });

  await writeAuditLog({ actorId: adminId, entityType: 'RoleChangeRequest', entityId: request.id, action: 'ROLE_CHANGE_REQUESTED' });
  return request;
}

export async function listRoleChanges(query: { status?: ChangeStatus; page: number; limit: number }) {
  const where = query.status ? { status: query.status } : {};
  const [requests, total] = await prisma.$transaction([
    prisma.roleChangeRequest.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit, select: REQUEST_SELECT,
    }),
    prisma.roleChangeRequest.count({ where }),
  ]);
  return { requests, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

export async function decideRoleChange(adminId: string, requestId: string, approve: boolean) {
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "RoleChangeRequest" WHERE id = ${requestId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('Pedido não encontrado');

    const request = await tx.roleChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (request.status !== ChangeStatus.PENDING) throw new ConflictError('O pedido já foi decidido');
    // Segregação de funções
    if (request.requestedById === adminId) {
      throw new ForbiddenError('Quem pediu a alteração não pode decidi-la: é necessário outro administrador');
    }
    if (Date.now() - request.createdAt.getTime() > ROLE_CHANGE_TTL_HOURS * 3_600_000) {
      throw new ConflictError('O pedido caducou: crie um novo');
    }

    if (approve) await changeUserRole(tx, request.targetId, request.fromRole, request.toRole);

    const decided = await tx.roleChangeRequest.update({
      where: { id: requestId },
      data: {
        status: approve ? ChangeStatus.APPROVED : ChangeStatus.REJECTED,
        decidedById: adminId,
        decidedAt: new Date(),
      },
      select: REQUEST_SELECT,
    });
    return { decided, targetId: request.targetId };
  });

  if (approve) await revokeUserSessions(outcome.targetId); // o novo papel só vale em sessões novas
  await writeAuditLog({
    actorId: adminId,
    entityType: 'RoleChangeRequest',
    entityId: requestId,
    action: approve ? 'ROLE_CHANGE_APPROVED' : 'ROLE_CHANGE_REJECTED',
  });
  if (approve) {
    await writeAuditLog({ actorId: adminId, entityType: 'User', entityId: outcome.targetId, action: 'ROLE_CHANGED' });
  }

  await emit('role_change.decided', {
    targetId: outcome.targetId,
    toRole: outcome.decided.toRole,
    approved: approve,
  });

  return outcome.decided;
}
