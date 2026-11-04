import { createHash } from 'crypto';
import prisma from './database';

interface AuditParams {
  actorId?: string;
  entityType: string;
  entityId: string;
  action: string;
}

// Escreve um registo imutável no AuditLog com encadeamento de hash SHA-256.
// Transacção SERIALIZABLE: garante que findFirst + create são atómicos em multi-réplica,
// impedindo que dois escritores simultâneos leiam o mesmo hashPrev e quebrem a cadeia.
export async function writeAuditLog(params: AuditParams): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const last = await tx.auditLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { hashSelf: true },
      });

      const hashPrev = last?.hashSelf ?? '0'.repeat(64);
      const content = [
        hashPrev,
        params.actorId ?? '',
        params.entityType,
        params.entityId,
        params.action,
        Date.now().toString(),
      ].join('|');

      const hashSelf = createHash('sha256').update(content).digest('hex');

      await tx.auditLog.create({ data: { ...params, hashPrev, hashSelf } });
    },
    { isolationLevel: 'Serializable' },
  );
}
