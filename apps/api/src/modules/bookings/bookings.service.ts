// Módulo bookings — expõe apenas esta camada de serviço pública.
// Outros módulos comunicam via eventos internos (EventEmitter2/BullMQ),
// nunca por acesso directo ao Prisma deste módulo.
import { AccessToken } from 'livekit-server-sdk';
import { AttendanceStatus, ClassType, Prisma, TutorStatus } from '@prisma/client';
import prisma from '../../shared/core/database';
import { writeAuditLog } from '../../shared/core/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentRequiredError,
} from '../../shared/core/errors';
import { emit } from '../../shared/core/events';
import { env } from '../../shared/core/env';
import { getPayerIds } from '../guardians/guardians.service';
import { debitHours, refundHours } from '../payments/payments.service';
import { getTutorProfileId, requireApprovedTutor } from '../tutors/tutors.service';
import { CANCELLATION_WINDOW_HOURS } from './bookings.types';
import type { AttendanceDto, CreateSessionDto, ListSessionsQuery } from './bookings.types';

const PUBLIC_SESSION_SELECT = {
  id: true,
  title: true,
  subject: true,
  type: true,
  maxCapacity: true,
  scheduledAt: true,
  durationMin: true,
  tutor: { select: { id: true, ratingAverage: true, user: { select: { name: true } } } },
  _count: { select: { enrollments: true } },
} satisfies Prisma.ClassSessionSelect;

type PublicSession = Prisma.ClassSessionGetPayload<{ select: typeof PUBLIC_SESSION_SELECT }>;

function toPublic({ _count, ...session }: PublicSession) {
  return { ...session, spotsLeft: session.maxCapacity - _count.enrollments };
}

// Horas como string decimal exacta (durationMin é múltiplo de 15 → 2 casas decimais bastam)
const hoursFor = (durationMin: number) => (durationMin / 60).toFixed(2);

// ── Catálogo de aulas (RF-CAT-01) ────────────────────────────────────────────

export async function listSessions(query: ListSessionsQuery) {
  const { subject, tutorId, type, from, to, page, limit } = query;
  const now = new Date();

  const where: Prisma.ClassSessionWhereInput = {
    scheduledAt: { gt: from && from > now ? from : now, ...(to ? { lte: to } : {}) },
    tutor: { status: TutorStatus.APPROVED },
    ...(subject ? { subject: { equals: subject, mode: 'insensitive' } } : {}),
    ...(tutorId ? { tutorId } : {}),
    ...(type ? { type: type as ClassType } : {}),
  };

  const [sessions, total] = await prisma.$transaction([
    prisma.classSession.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: PUBLIC_SESSION_SELECT,
    }),
    prisma.classSession.count({ where }),
  ]);

  return { sessions: sessions.map(toPublic), total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getSession(id: string) {
  const session = await prisma.classSession.findFirst({
    where: { id, tutor: { status: TutorStatus.APPROVED } },
    select: PUBLIC_SESSION_SELECT,
  });
  if (!session) throw new NotFoundError('Aula não encontrada');
  return toPublic(session);
}

// ── Tutor: publicar e gerir aulas ────────────────────────────────────────────

export async function createSession(userId: string, data: CreateSessionDto) {
  const tutor = await requireApprovedTutor(userId);

  const session = await prisma.classSession.create({
    data: {
      tutorId: tutor.id,
      title: data.title,
      subject: data.subject,
      type: data.type as ClassType,
      maxCapacity: data.type === 'ONE_ON_ONE' ? 1 : (data.maxCapacity ?? 7),
      scheduledAt: data.scheduledAt,
      durationMin: data.durationMin,
    },
    select: PUBLIC_SESSION_SELECT,
  });

  await writeAuditLog({
    actorId: userId,
    entityType: 'ClassSession',
    entityId: session.id,
    action: 'SESSION_CREATED',
  });
  return toPublic(session);
}

export async function listMySessions(userId: string) {
  const tutorId = await getTutorProfileId(userId);
  return prisma.classSession.findMany({
    where: { tutorId },
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      title: true,
      subject: true,
      type: true,
      maxCapacity: true,
      scheduledAt: true,
      durationMin: true,
      enrollments: {
        select: {
          id: true,
          attendanceStatus: true,
          student: { select: { id: true, name: true } },
        },
      },
    },
  });
}

async function loadOwnedSession(userId: string, sessionId: string) {
  const session = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { id: true, scheduledAt: true, tutor: { select: { id: true, userId: true } } },
  });
  // 404 também para aulas de outros tutores: não revela a sua existência
  if (!session || session.tutor.userId !== userId) throw new NotFoundError('Aula não encontrada');
  return session;
}

// Sem política de cancelamento fechada, o tutor só pode remover aulas ainda sem alunos
export async function deleteSession(userId: string, sessionId: string) {
  await loadOwnedSession(userId, sessionId);

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ClassSession" WHERE id = ${sessionId} FOR UPDATE`;
    const enrolled = await tx.classEnrollment.count({ where: { classId: sessionId } });
    if (enrolled > 0) throw new ConflictError('A aula já tem alunos inscritos');
    await tx.classSession.delete({ where: { id: sessionId } });
  });

  await writeAuditLog({
    actorId: userId,
    entityType: 'ClassSession',
    entityId: sessionId,
    action: 'SESSION_DELETED',
  });
}

export async function markAttendance(
  userId: string,
  sessionId: string,
  enrollmentId: string,
  data: AttendanceDto,
) {
  const session = await loadOwnedSession(userId, sessionId);
  if (session.scheduledAt.getTime() > Date.now()) {
    throw new ConflictError('A aula ainda não começou');
  }

  const { count } = await prisma.classEnrollment.updateMany({
    where: { id: enrollmentId, classId: sessionId },
    data: { attendanceStatus: data.attendanceStatus as AttendanceStatus },
  });
  if (count === 0) throw new NotFoundError('Matrícula não encontrada');

  await writeAuditLog({
    actorId: userId,
    entityType: 'ClassEnrollment',
    entityId: enrollmentId,
    action: `ATTENDANCE_${data.attendanceStatus}`,
  });
  // Avisa quem calcula estatísticas (reputation) sem depender dele
  await emit('attendance.changed', { tutorId: session.tutor.id });
  return { id: enrollmentId, attendanceStatus: data.attendanceStatus };
}

// ── Aluno: matrícula (UC04, RF-AUL-01..04) ───────────────────────────────────

export async function enroll(studentId: string, sessionId: string) {
  const payerIds = await getPayerIds(studentId);

  const enrollment = await prisma.$transaction(async (tx) => {
    // Serializa as matrículas desta aula: garante RN-01 mesmo com pedidos simultâneos
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ClassSession" WHERE id = ${sessionId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('Aula não encontrada');

    const session = await tx.classSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        maxCapacity: true,
        scheduledAt: true,
        durationMin: true,
        tutor: { select: { status: true, userId: true } },
        _count: { select: { enrollments: true } },
      },
    });

    if (session.tutor.status !== TutorStatus.APPROVED) throw new NotFoundError('Aula não encontrada');
    if (session.tutor.userId === studentId) throw new ForbiddenError('Não pode inscrever-se na própria aula');
    if (session.scheduledAt.getTime() <= Date.now()) throw new ConflictError('A aula já começou');
    if (session._count.enrollments >= session.maxCapacity) throw new ConflictError('Aula esgotada');

    const already = await tx.classEnrollment.findUnique({
      where: { classId_studentId: { classId: sessionId, studentId } },
      select: { id: true },
    });
    if (already) throw new ConflictError('Já está inscrito nesta aula');

    // RN-04: sem pacote com horas suficientes não há matrícula
    const hours = hoursFor(session.durationMin);
    const packageId = await debitHours(tx, payerIds, hours);
    if (!packageId) throw new PaymentRequiredError('Sem horas disponíveis num pacote válido');

    return tx.classEnrollment.create({
      data: { classId: sessionId, studentId, packageId, hoursDebited: hours },
      select: { id: true, classId: true, attendanceStatus: true, hoursDebited: true, createdAt: true },
    });
  });

  await writeAuditLog({
    actorId: studentId,
    entityType: 'ClassEnrollment',
    entityId: enrollment.id,
    action: 'ENROLLED',
  });

  // Notificar o aluno da inscrição confirmada
  const session = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { scheduledAt: true, tutor: { select: { userId: true } } },
  });
  if (session) {
    await emit('booking.enrolled', {
      sessionId,
      studentId,
      tutorUserId: session.tutor.userId,
      scheduledAt: session.scheduledAt.toISOString(),
    });
  }

  return enrollment;
}

export async function cancelEnrollment(studentId: string, sessionId: string) {
  const enrollment = await prisma.$transaction(async (tx) => {
    const found = await tx.classEnrollment.findUnique({
      where: { classId_studentId: { classId: sessionId, studentId } },
      select: {
        id: true,
        packageId: true,
        hoursDebited: true,
        session: { select: { scheduledAt: true } },
      },
    });
    if (!found) throw new NotFoundError('Matrícula não encontrada');

    const limit = found.session.scheduledAt.getTime() - CANCELLATION_WINDOW_HOURS * 3_600_000;
    if (Date.now() > limit) {
      throw new ConflictError(`Só é possível cancelar com ${CANCELLATION_WINDOW_HOURS} h de antecedência`);
    }

    // deleteMany: se dois cancelamentos chegarem juntos, só um estorna
    const { count } = await tx.classEnrollment.deleteMany({ where: { id: found.id } });
    if (count === 0) throw new NotFoundError('Matrícula não encontrada');
    if (found.packageId) await refundHours(tx, found.packageId, found.hoursDebited.toFixed(2));
    return found;
  });

  await writeAuditLog({
    actorId: studentId,
    entityType: 'ClassEnrollment',
    entityId: enrollment.id,
    action: 'ENROLLMENT_CANCELLED',
  });

  const sess = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: { tutor: { select: { userId: true } } },
  });
  if (sess) {
    await emit('booking.enrollment_cancelled', { sessionId, studentId, tutorUserId: sess.tutor.userId });
  }
}

export function listMyEnrollments(studentId: string) {
  return prisma.classEnrollment.findMany({
    where: { studentId },
    orderBy: { session: { scheduledAt: 'asc' } },
    select: {
      id: true,
      attendanceStatus: true,
      hoursDebited: true,
      session: {
        select: {
          id: true,
          title: true,
          subject: true,
          type: true,
          scheduledAt: true,
          durationMin: true,
          tutor: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });
}

// ── Leitura para outros módulos (reputation) ─────────────────────────────────

const sessionEnd = (s: { scheduledAt: Date; durationMin: number }) =>
  new Date(s.scheduledAt.getTime() + s.durationMin * 60_000);

// A aula tem de ter terminado e o aluno de ter estado presente (confirmado pelo tutor)
export async function getAttendedSession(client: Prisma.TransactionClient, studentId: string, sessionId: string) {
  const enrollment = await client.classEnrollment.findUnique({
    where: { classId_studentId: { classId: sessionId, studentId } },
    select: {
      attendanceStatus: true,
      session: { select: { id: true, tutorId: true, subject: true, scheduledAt: true, durationMin: true } },
    },
  });
  if (!enrollment) throw new NotFoundError('Aula não encontrada');
  const { session } = enrollment;
  if (enrollment.attendanceStatus !== AttendanceStatus.PRESENT || sessionEnd(session).getTime() > Date.now()) {
    throw new ForbiddenError('Só pode avaliar aulas a que assistiu e que já terminaram');
  }
  return { sessionId: session.id, tutorId: session.tutorId, subject: session.subject };
}

export async function listAttendedSessions(studentId: string) {
  const enrollments = await prisma.classEnrollment.findMany({
    where: { studentId, attendanceStatus: AttendanceStatus.PRESENT, session: { scheduledAt: { lt: new Date() } } },
    orderBy: { session: { scheduledAt: 'desc' } },
    select: {
      session: {
        select: {
          id: true, tutorId: true, subject: true, title: true, scheduledAt: true, durationMin: true,
          tutor: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });
  return enrollments
    .map((e) => e.session)
    .filter((s) => sessionEnd(s).getTime() <= Date.now())
    .map(({ tutor, ...s }) => ({ ...s, tutorName: tutor.user.name }));
}

// Aulas dadas = com pelo menos uma presença; alunos = distintos com presença
export async function getTeachingStats(client: Prisma.TransactionClient, tutorId: string) {
  const [row] = await client.$queryRaw<Array<{ classes: bigint; students: bigint }>>`
    SELECT COUNT(DISTINCT s.id) AS classes, COUNT(DISTINCT e."studentId") AS students
    FROM "ClassSession" s
    JOIN "ClassEnrollment" e ON e."classId" = s.id
    WHERE s."tutorId" = ${tutorId} AND e."attendanceStatus" = 'PRESENT'`;
  return { totalClasses: Number(row.classes), totalStudents: Number(row.students) };
}

// ── Leitura para o módulo activity (histórico e métricas, RF-HIS-01) ─────────

const round1 = (n: number) => Math.round(n * 10) / 10;
const rate = (present: number, absent: number) =>
  present + absent === 0 ? null : round1((present / (present + absent)) * 100);

export async function getStudentStats(studentId: string) {
  const now = new Date();
  const [byStatus, upcoming, hours, bySubject, next] = await Promise.all([
    prisma.classEnrollment.groupBy({ by: ['attendanceStatus'], where: { studentId }, _count: { _all: true } }),
    prisma.classEnrollment.count({ where: { studentId, session: { scheduledAt: { gt: now } } } }),
    prisma.classEnrollment.aggregate({ where: { studentId }, _sum: { hoursDebited: true } }),
    prisma.$queryRaw<Array<{ subject: string; classes: number }>>`
      SELECT s.subject, COUNT(*)::int AS classes
      FROM "ClassEnrollment" e JOIN "ClassSession" s ON s.id = e."classId"
      WHERE e."studentId" = ${studentId} AND e."attendanceStatus" = 'PRESENT'
      GROUP BY s.subject ORDER BY classes DESC, s.subject LIMIT 5`,
    prisma.classEnrollment.findFirst({
      where: { studentId, session: { scheduledAt: { gt: now } } },
      orderBy: { session: { scheduledAt: 'asc' } },
      select: { session: { select: { id: true, title: true, subject: true, scheduledAt: true } } },
    }),
  ]);

  const count = (status: AttendanceStatus) => byStatus.find((g) => g.attendanceStatus === status)?._count._all ?? 0;
  const present = count(AttendanceStatus.PRESENT);
  const absent = count(AttendanceStatus.ABSENT);
  const total = byStatus.reduce((sum, g) => sum + g._count._all, 0);

  return {
    classes: {
      enrolled: total,
      upcoming,
      attended: present,
      absent,
      awaitingAttendance: count(AttendanceStatus.PENDING) - upcoming, // já decorreram, tutor ainda não marcou
      attendanceRate: rate(present, absent), // % de presenças sobre as marcadas
    },
    hoursConsumed: (hours._sum.hoursDebited ?? new Prisma.Decimal(0)).toFixed(2),
    topSubjects: bySubject,
    nextClass: next?.session ?? null,
  };
}

export async function getStudentHistory(
  studentId: string,
  query: { from?: Date; to?: Date; page: number; limit: number },
) {
  const where: Prisma.ClassEnrollmentWhereInput = {
    studentId,
    ...(query.from || query.to
      ? { session: { scheduledAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.classEnrollment.findMany({
      where,
      orderBy: { session: { scheduledAt: 'desc' } },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true, attendanceStatus: true, hoursDebited: true,
        session: {
          select: {
            id: true, title: true, subject: true, type: true, scheduledAt: true, durationMin: true,
            tutor: { select: { user: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.classEnrollment.count({ where }),
  ]);
  const items = rows.map(({ session: { tutor, ...session }, ...e }) => ({ ...e, session: { ...session, tutorName: tutor.user.name } }));
  return { items, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

export async function getTutorStats(tutorId: string) {
  const now = new Date();
  const [upcomingSessions, upcomingSeats, upcomingEnrolled, byStatus] = await Promise.all([
    prisma.classSession.count({ where: { tutorId, scheduledAt: { gt: now } } }),
    prisma.classSession.aggregate({ where: { tutorId, scheduledAt: { gt: now } }, _sum: { maxCapacity: true } }),
    prisma.classEnrollment.count({ where: { session: { tutorId, scheduledAt: { gt: now } } } }),
    prisma.classEnrollment.groupBy({
      by: ['attendanceStatus'],
      where: { session: { tutorId, scheduledAt: { lte: now } } },
      _count: { _all: true },
    }),
  ]);
  const count = (status: AttendanceStatus) => byStatus.find((g) => g.attendanceStatus === status)?._count._all ?? 0;
  const seats = upcomingSeats._sum.maxCapacity ?? 0;
  return {
    upcoming: {
      sessions: upcomingSessions,
      enrolled: upcomingEnrolled,
      seats,
      fillRate: seats === 0 ? null : round1((upcomingEnrolled / seats) * 100),
    },
    attendance: {
      present: count(AttendanceStatus.PRESENT),
      absent: count(AttendanceStatus.ABSENT),
      awaitingAttendance: count(AttendanceStatus.PENDING),
      rate: rate(count(AttendanceStatus.PRESENT), count(AttendanceStatus.ABSENT)),
    },
  };
}

// Aulas já dadas, com contagens (sem identificar alunos)
export async function getTutorHistory(tutorId: string, query: { page: number; limit: number }) {
  const where = { tutorId, scheduledAt: { lte: new Date() } };
  const [sessions, total] = await prisma.$transaction([
    prisma.classSession.findMany({
      where,
      orderBy: { scheduledAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { id: true, title: true, subject: true, type: true, scheduledAt: true, durationMin: true, maxCapacity: true },
    }),
    prisma.classSession.count({ where }),
  ]);
  const grouped = sessions.length
    ? await prisma.classEnrollment.groupBy({
        by: ['classId', 'attendanceStatus'],
        where: { classId: { in: sessions.map((s) => s.id) } },
        _count: { _all: true },
      })
    : [];
  const items = sessions.map((s) => {
    const n = (status: AttendanceStatus) =>
      grouped.find((g) => g.classId === s.id && g.attendanceStatus === status)?._count._all ?? 0;
    return { ...s, enrolled: n('PENDING') + n('PRESENT') + n('ABSENT'), present: n('PRESENT'), absent: n('ABSENT') };
  });
  return { items, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

export async function getPlatformBookingStats(since: Date) {
  const now = new Date();
  const [held, upcoming, enrollments, byStatus] = await Promise.all([
    prisma.classSession.count({ where: { scheduledAt: { gte: since, lte: now } } }),
    prisma.classSession.count({ where: { scheduledAt: { gt: now } } }),
    prisma.classEnrollment.count({ where: { createdAt: { gte: since } } }),
    prisma.classEnrollment.groupBy({
      by: ['attendanceStatus'],
      where: { session: { scheduledAt: { gte: since, lte: now } } },
      _count: { _all: true },
    }),
  ]);
  const count = (status: AttendanceStatus) => byStatus.find((g) => g.attendanceStatus === status)?._count._all ?? 0;
  return {
    sessionsHeld: held,
    upcomingSessions: upcoming,
    enrollmentsCreated: enrollments,
    attendanceRate: rate(count(AttendanceStatus.PRESENT), count(AttendanceStatus.ABSENT)),
  };
}

// ── Salas virtuais (RF-AUL-05) ───────────────────────────────────────────────

export type JoinRole = 'tutor' | 'student' | 'observer';

export async function generateJoinToken(
  sessionId: string,
  userId: string,
  role: 'STUDENT' | 'TUTOR' | 'ADMIN',
): Promise<{ token: string; url: string; room: string }> {
  const session = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      scheduledAt: true,
      durationMin: true,
      tutor: { select: { userId: true } },
      enrollments: {
        where: { studentId: userId },
        select: { id: true },
      },
    },
  });

  if (!session) throw new NotFoundError('Aula não encontrada');

  // Verificar acesso: tutor da sessão, aluno inscrito ou admin
  const isTutor = session.tutor.userId === userId;
  const isEnrolled = session.enrollments.length > 0;
  const isAdmin = role === 'ADMIN';

  if (!isTutor && !isEnrolled && !isAdmin) {
    throw new ForbiddenError('Não está inscrito nesta aula');
  }

  // Token válido até ao fim da aula (máx. 4 h para não ficar perpetuamente válido)
  const sessionEndMs = session.scheduledAt.getTime() + session.durationMin * 60_000;
  const maxTtlMs = 4 * 60 * 60 * 1000;
  const ttlMs = Math.min(Math.max(sessionEndMs - Date.now(), 60_000), maxTtlMs);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });

  const canPublish = !isAdmin;
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: userId,
    name: user.name,
    ttl: `${Math.ceil(ttlMs / 1000)}s`,
  });
  token.addGrant({
    roomJoin: true,
    room: sessionId,
    canPublish,
    canSubscribe: true,
    canPublishData: canPublish,
  });

  return { token: await token.toJwt(), url: env.LIVEKIT_URL, room: sessionId };
}

// ── Acesso à sala por WebSocket (RF-AUL-06) ───────────────────────────────────
// Usado pelo handler de whiteboard; não lança excepção, devolve null se sem acesso.
export async function getSessionAccess(
  sessionId: string,
  userId: string,
  role: string,
): Promise<'tutor' | 'student' | 'admin' | null> {
  if (role === 'ADMIN') return 'admin';

  const session = await prisma.classSession.findUnique({
    where: { id: sessionId },
    select: {
      tutor: { select: { userId: true } },
      enrollments: { where: { studentId: userId }, select: { id: true } },
    },
  });

  if (!session) return null;
  if (session.tutor.userId === userId) return 'tutor';
  if (session.enrollments.length > 0) return 'student';
  return null;
}
