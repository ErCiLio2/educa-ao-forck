import { z } from 'zod';

const Page = {
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const HistoryQuerySchema = z
  .object({
    from: z.string().datetime().transform((v) => new Date(v)).optional(),
    to: z.string().datetime().transform((v) => new Date(v)).optional(),
    ...Page,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" tem de ser anterior a "to"', path: ['from'] });

export const PageQuerySchema = z.object(Page);

export const MetricsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const StudentParamsSchema = z.object({ studentId: z.string().uuid() });
