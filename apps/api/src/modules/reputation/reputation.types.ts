import { z } from 'zod';

// RN-06: 1 a 5 estrelas, com os critérios pedagógicos definidos (RF-AVA-01)
const Stars = z.number().int().min(1).max(5);

export const CreateReviewSchema = z.object({
  rating: Stars,
  punctuality: Stars,
  subjectMastery: Stars,
  didacticClarity: Stars,
  progress: Stars,
  comment: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const SessionParamsSchema = z.object({ sessionId: z.string().uuid() });
export const TutorParamsSchema = z.object({ tutorId: z.string().uuid() });

export const ListReviewsQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateReviewDto = z.infer<typeof CreateReviewSchema>;
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;
