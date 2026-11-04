// Módulo reputation — expõe apenas esta camada de serviço pública.
// Outros módulos comunicam via eventos internos (EventEmitter2/BullMQ),
// nunca por acesso directo ao Prisma deste módulo.
import type { Prisma } from '@prisma/client';
import prisma from '../../shared/core/database';
import { writeAuditLog } from '../../shared/core/audit';
import { ConflictError } from '../../shared/core/errors';
import { on } from '../../shared/core/events';
import { getAttendedSession, getTeachingStats, listAttendedSessions } from '../bookings/bookings.service';
import { getPublicProfile, invalidateTutorCache, lockProfile, setStats } from '../tutors/tutors.service';
import type { CreateReviewDto, ListReviewsQuery } from './reputation.types';

const round2 = (n: number) => Math.round(n * 100) / 100;

// Recalcula as estatísticas do perfil (RF-TUT-03). Chamar sempre depois de lockProfile na mesma transacção.
async function recalculate(tx: Prisma.TransactionClient, tutorId: string): Promise<void> {
  const [reviews, teaching] = await Promise.all([
    tx.review.aggregate({ where: { tutorId }, _avg: { rating: true }, _count: { _all: true } }),
    getTeachingStats(tx, tutorId),
  ]);
  await setStats(tx, tutorId, {
    ratingAverage: round2(reviews._avg.rating ?? 0),
    totalReviews: reviews._count._all,
    ...teaching,
  });
}

// Presenças alteram "aulas dadas" e "alunos": o bookings avisa por evento, sem depender deste módulo
on('attendance.changed', async ({ tutorId }) => {
  await prisma.$transaction(async (tx) => {
    await lockProfile(tx, tutorId);
    await recalculate(tx, tutorId);
  });
  await invalidateTutorCache(tutorId);
});

// ── Avaliar (UC07, RF-AVA-01) ────────────────────────────────────────────────

export async function createReview(studentId: string, sessionId: string, data: CreateReviewDto) {
  let tutorProfileId = '';
  const review = await prisma.$transaction(async (tx) => {
    const attended = await getAttendedSession(tx, studentId, sessionId);
    tutorProfileId = attended.tutorId;

    // O bloqueio do perfil serializa avaliações simultâneas do mesmo tutor: a média nunca perde uma
    await lockProfile(tx, attended.tutorId);
    const existing = await tx.review.findUnique({
      where: { studentId_classId: { studentId, classId: sessionId } },
      select: { id: true },
    });
    if (existing) throw new ConflictError('Já avaliou esta aula');

    const created = await tx.review.create({
      data: { studentId, classId: sessionId, tutorId: attended.tutorId, ...data },
      select: {
        id: true, classId: true, rating: true, punctuality: true, subjectMastery: true,
        didacticClarity: true, progress: true, comment: true, createdAt: true,
      },
    });
    await recalculate(tx, attended.tutorId);
    return created;
  });

  await writeAuditLog({ actorId: studentId, entityType: 'Review', entityId: review.id, action: 'REVIEW_CREATED' });
  await invalidateTutorCache(tutorProfileId);
  return review;
}

// Aulas a que o aluno assistiu e ainda não avaliou
export async function listPendingReviews(studentId: string) {
  const attended = await listAttendedSessions(studentId);
  if (attended.length === 0) return [];
  const reviewed = await prisma.review.findMany({
    where: { studentId, classId: { in: attended.map((s) => s.id) } },
    select: { classId: true },
  });
  const done = new Set(reviewed.map((r) => r.classId));
  return attended.filter((s) => !done.has(s.id));
}

// ── Consulta pública (RF-TUT-03) ─────────────────────────────────────────────

// Anónimo: o autor nunca é exposto (há menores) — só a nota, os critérios e o comentário
export async function listTutorReviews(tutorId: string, query: ListReviewsQuery) {
  await getPublicProfile(tutorId); // 404 se não existir ou não estiver aprovado

  const { page, limit } = query;
  const [reviews, summary] = await Promise.all([
    prisma.review.findMany({
      where: { tutorId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, rating: true, punctuality: true, subjectMastery: true,
        didacticClarity: true, progress: true, comment: true, createdAt: true,
      },
    }),
    prisma.review.aggregate({
      where: { tutorId },
      _count: { _all: true },
      _avg: { rating: true, punctuality: true, subjectMastery: true, didacticClarity: true, progress: true },
    }),
  ]);

  const avg = (v: number | null) => (v === null ? null : round2(v));
  const total = summary._count._all;
  return {
    summary: {
      total,
      average: avg(summary._avg.rating),
      criteria: {
        punctuality: avg(summary._avg.punctuality),
        subjectMastery: avg(summary._avg.subjectMastery),
        didacticClarity: avg(summary._avg.didacticClarity),
        progress: avg(summary._avg.progress),
      },
    },
    reviews,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

// ── Leitura para o módulo activity ───────────────────────────────────────────

export function countReviewsBy(studentId: string): Promise<number> {
  return prisma.review.count({ where: { studentId } });
}

export async function getPlatformReputation() {
  const agg = await prisma.review.aggregate({ _avg: { rating: true }, _count: { _all: true } });
  return { reviews: agg._count._all, averageRating: agg._avg.rating === null ? null : round2(agg._avg.rating) };
}
