import { ConsentType, Role } from '@prisma/client';
import prisma from '../../shared/core/database';
import { writeAuditLog } from '../../shared/core/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/core/errors';
import { createUserAccount, setPasswordForUser } from '../auth/auth.service';
import type { CreateDependentDto } from './guardians.types';

const DEPENDENT_SELECT = { id: true, name: true, email: true, birthDate: true, createdAt: true } as const;

export async function createDependent(guardianId: string, data: CreateDependentDto) {
  const dependent = await createUserAccount({
    ...data,
    role: Role.STUDENT,
    guardianId,
  });

  await writeAuditLog({
    actorId: guardianId,
    entityType: 'User',
    entityId: dependent.id,
    action: 'DEPENDENT_CREATED',
  });

  return {
    id: dependent.id,
    name: dependent.name,
    email: dependent.email,
    birthDate: dependent.birthDate,
    createdAt: dependent.createdAt,
  };
}

export async function listDependents(guardianId: string) {
  const dependents = await prisma.user.findMany({
    where: { guardianId },
    select: {
      ...DEPENDENT_SELECT,
      studentConsents: {
        where: { consentType: ConsentType.DATA_PROCESSING, revokedAt: null },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return dependents.map(({ studentConsents, ...d }) => ({
    ...d,
    consentGranted: studentConsents.length > 0,
  }));
}

// Verificação de propriedade (RNF-SEG-02): o Encarregado só actua sobre os seus dependentes.
// Reutilizável pelos módulos futuros (consentimento, pagamentos, histórico).
export async function assertGuardianOf(guardianId: string, studentId: string): Promise<void> {
  const dependent = await prisma.user.findFirst({
    where: { id: studentId, guardianId, role: Role.STUDENT },
    select: { id: true },
  });
  // 403 genérico: não revela se o aluno existe
  if (!dependent) throw new ForbiddenError();
}

// ── Consentimento (RF-ENC-01/02, RN-02) ──────────────────────────────────────

const CONSENT_SELECT = { id: true, consentType: true, grantedAt: true, revokedAt: true } as const;

export async function grantConsent(guardianId: string, studentId: string) {
  await assertGuardianOf(guardianId, studentId);

  // Bloqueia a linha do aluno para que dois pedidos simultâneos não criem consentimentos activos duplicados
  const consent = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${studentId} FOR UPDATE`;
    const active = await tx.guardianConsent.findFirst({
      where: { studentId, consentType: ConsentType.DATA_PROCESSING, revokedAt: null },
      select: { id: true },
    });
    if (active) throw new ConflictError('Consentimento já concedido');
    return tx.guardianConsent.create({
      data: { guardianId, studentId, consentType: ConsentType.DATA_PROCESSING },
      select: CONSENT_SELECT,
    });
  });

  await writeAuditLog({
    actorId: guardianId,
    entityType: 'GuardianConsent',
    entityId: consent.id,
    action: 'CONSENT_GRANTED',
  });
  return consent;
}

export async function revokeConsent(guardianId: string, studentId: string) {
  await assertGuardianOf(guardianId, studentId);

  const active = await prisma.guardianConsent.findFirst({
    where: { studentId, consentType: ConsentType.DATA_PROCESSING, revokedAt: null },
    select: { id: true },
  });
  if (!active) throw new NotFoundError('Não existe consentimento activo');

  // Condição revokedAt: null garante que só uma revogação concorrente tem efeito
  const { count } = await prisma.guardianConsent.updateMany({
    where: { id: active.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw new NotFoundError('Não existe consentimento activo');

  await writeAuditLog({
    actorId: guardianId,
    entityType: 'GuardianConsent',
    entityId: active.id,
    action: 'CONSENT_REVOKED',
  });
  return prisma.guardianConsent.findUniqueOrThrow({ where: { id: active.id }, select: CONSENT_SELECT });
}

export async function listConsents(guardianId: string, studentId: string) {
  await assertGuardianOf(guardianId, studentId);
  return prisma.guardianConsent.findMany({
    where: { studentId },
    select: CONSENT_SELECT,
    orderBy: { grantedAt: 'desc' },
  });
}

// Um aluno com Encarregado só pode ter os seus dados tratados com consentimento activo (RN-02)
export async function getConsentStatus(studentId: string) {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { guardianId: true },
  });
  if (!student?.guardianId) return { required: false, granted: true };

  const active = await prisma.guardianConsent.findFirst({
    where: {
      studentId,
      guardianId: student.guardianId,
      consentType: ConsentType.DATA_PROCESSING,
      revokedAt: null,
    },
    select: { id: true },
  });
  return { required: true, granted: active !== null };
}

// Quem pode pagar as aulas do aluno: ele próprio e, se for dependente, o seu Encarregado (UC06)
export async function getPayerIds(studentId: string): Promise<string[]> {
  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { guardianId: true } });
  return student?.guardianId ? [studentId, student.guardianId] : [studentId];
}

// O dependente esqueceu-se da password: só o seu Encarregado a repõe (o aluno nunca a define sozinho do zero).
// Revoga as sessões do dependente. É segurança da conta, por isso não depende do consentimento.
export async function resetDependentPassword(guardianId: string, studentId: string, newPassword: string) {
  await assertGuardianOf(guardianId, studentId);
  await setPasswordForUser(studentId, newPassword);
  await writeAuditLog({ actorId: guardianId, entityType: 'User', entityId: studentId, action: 'DEPENDENT_PASSWORD_RESET' });
}
