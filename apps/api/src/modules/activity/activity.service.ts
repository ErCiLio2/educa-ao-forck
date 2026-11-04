// Módulo activity — histórico e métricas por perfil (RF-HIS-01) e acompanhamento do Encarregado (RF-ENC-03).
// É só leitura: compõe os números que cada módulo expõe pelo seu serviço, sem tocar nas tabelas dos outros.
import { writeAuditLog } from '../../shared/core/audit';
import { ForbiddenError } from '../../shared/core/errors';
import { countUsersByRole } from '../auth/auth.service';
import {
  getPlatformBookingStats,
  getStudentHistory,
  getStudentStats,
  getTutorHistory,
  getTutorStats,
} from '../bookings/bookings.service';
import { assertGuardianOf, getConsentStatus, listDependents } from '../guardians/guardians.service';
import { getPlatformPaymentStats, listMyPackages } from '../payments/payments.service';
import { countReviewsBy, getPlatformReputation } from '../reputation/reputation.service';
import { countProfilesByStatus, getTutorOwnStats } from '../tutors/tutors.service';

// ── Aluno ────────────────────────────────────────────────────────────────────

export async function studentSummary(studentId: string) {
  const [stats, reviewsGiven, balance] = await Promise.all([
    getStudentStats(studentId),
    countReviewsBy(studentId),
    listMyPackages(studentId), // inclui os pacotes do Encarregado, que são os que o dependente usa
  ]);
  return { ...stats, reviewsGiven, hoursAvailable: balance.availableHours };
}

export { getStudentHistory as studentHistory };

// ── Encarregado ──────────────────────────────────────────────────────────────

// RN-02: sem consentimento activo os dados do menor não são tratados, nem sequer para o Encarregado
async function requireActiveConsent(studentId: string): Promise<void> {
  const { required, granted } = await getConsentStatus(studentId);
  if (required && !granted) {
    throw new ForbiddenError('Sem consentimento activo: conceda-o para acompanhar a actividade do dependente');
  }
}

// Visão geral de todos os dependentes. Os que estão sem consentimento aparecem sem dados.
export async function dependentsOverview(guardianId: string) {
  const dependents = await listDependents(guardianId);
  return Promise.all(
    dependents.map(async (d) => {
      const base = { id: d.id, name: d.name, consentGranted: d.consentGranted };
      if (!d.consentGranted) return base;
      const s = await getStudentStats(d.id);
      return {
        ...base,
        attended: s.classes.attended,
        upcoming: s.classes.upcoming,
        attendanceRate: s.classes.attendanceRate,
        nextClass: s.nextClass,
      };
    }),
  );
}

// Cada consulta aos dados de um menor fica registada (rastreabilidade, RNF-CON-01)
async function authorizeDependentAccess(guardianId: string, studentId: string, action: string): Promise<void> {
  await assertGuardianOf(guardianId, studentId); // propriedade do recurso (RNF-SEG-02)
  await requireActiveConsent(studentId);
  await writeAuditLog({ actorId: guardianId, entityType: 'User', entityId: studentId, action });
}

export async function dependentSummary(guardianId: string, studentId: string) {
  await authorizeDependentAccess(guardianId, studentId, 'DEPENDENT_SUMMARY_VIEWED');
  return studentSummary(studentId);
}

export async function dependentHistory(
  guardianId: string,
  studentId: string,
  query: Parameters<typeof getStudentHistory>[1],
) {
  await authorizeDependentAccess(guardianId, studentId, 'DEPENDENT_HISTORY_VIEWED');
  return getStudentHistory(studentId, query);
}

// ── Tutor ────────────────────────────────────────────────────────────────────

export async function tutorSummary(userId: string) {
  const { id, status, ...profile } = await getTutorOwnStats(userId);
  return { status, profile, ...(await getTutorStats(id)) };
}

export async function tutorHistory(userId: string, query: { page: number; limit: number }) {
  const { id } = await getTutorOwnStats(userId);
  return getTutorHistory(id, query);
}

// ── Administrador: métricas agregadas (sem dados pessoais) ───────────────────

export async function adminMetrics(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const [usersByRole, tutorsByStatus, classes, payments, reputation] = await Promise.all([
    countUsersByRole(),
    countProfilesByStatus(),
    getPlatformBookingStats(since),
    getPlatformPaymentStats(since),
    getPlatformReputation(),
  ]);
  return { periodDays: days, since, usersByRole, tutorsByStatus, classes, payments, reputation };
}
