import { z } from 'zod';

export const MAX_GROUP_SIZE = 7; // RN-01
// ⚠ Pressuposto: a política de cancelamento ainda é ponto em aberto (levantamento, secção 11)
export const CANCELLATION_WINDOW_HOURS = 24;

export const CreateSessionSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    subject: z.string().trim().min(2).max(100),
    type: z.enum(['ONE_ON_ONE', 'GROUP']),
    // Só para GROUP: 2..7. ONE_ON_ONE tem sempre capacidade 1
    maxCapacity: z.number().int().min(2).max(MAX_GROUP_SIZE).optional(),
    scheduledAt: z.string().datetime().transform((v) => new Date(v)),
    // Múltiplos de 15 min para que as horas debitadas sejam exactas (0,25 h)
    durationMin: z.number().int().min(15).max(240).multipleOf(15),
  })
  .refine((d) => d.scheduledAt.getTime() > Date.now(), {
    message: 'A aula tem de ser agendada no futuro',
    path: ['scheduledAt'],
  })
  .refine((d) => d.type === 'GROUP' || d.maxCapacity === undefined, {
    message: 'maxCapacity só se aplica a aulas em grupo',
    path: ['maxCapacity'],
  });

export const ListSessionsQuerySchema = z.object({
  subject: z.string().trim().min(1).max(100).optional(),
  tutorId: z.string().uuid().optional(),
  type: z.enum(['ONE_ON_ONE', 'GROUP']).optional(),
  from: z.string().datetime().transform((v) => new Date(v)).optional(),
  to: z.string().datetime().transform((v) => new Date(v)).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const SessionParamsSchema = z.object({ id: z.string().uuid() });

export const AttendanceParamsSchema = z.object({
  id: z.string().uuid(),
  enrollmentId: z.string().uuid(),
});

export const AttendanceSchema = z.object({
  attendanceStatus: z.enum(['PRESENT', 'ABSENT']),
});

export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;
export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;
export type AttendanceDto = z.infer<typeof AttendanceSchema>;
