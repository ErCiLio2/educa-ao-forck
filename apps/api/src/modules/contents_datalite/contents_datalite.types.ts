import { z } from 'zod';

const MB = 1024 * 1024;

export const CONTENT_UPLOAD_TYPES = {
  VIDEO: { mimes: ['video/mp4', 'video/webm'], maxBytes: 500 * MB },
  DOCUMENT: { mimes: ['application/pdf'], maxBytes: 20 * MB },
} as const;

export type ContentUploadType = keyof typeof CONTENT_UPLOAD_TYPES;

export const ContentUploadUrlSchema = z
  .object({
    type: z.enum(['VIDEO', 'DOCUMENT']),
    contentType: z.string().max(100),
  })
  .refine(
    (d) => (CONTENT_UPLOAD_TYPES[d.type].mimes as readonly string[]).includes(d.contentType),
    { message: 'Tipo de ficheiro não permitido para este conteúdo', path: ['contentType'] },
  );

export const CreateContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['VIDEO', 'DOCUMENT']),
  isPaid: z.boolean().default(false),
  storageKey: z.string().min(1).max(500),
  subject: z.string().trim().min(1).max(100).optional(),
});

export const UpdateContentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    isPaid: z.boolean().optional(),
    subject: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nada para actualizar' });

export const ChangeStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
});

export const ListContentsQuerySchema = z.object({
  subject: z.string().optional(),
  type: z.enum(['VIDEO', 'DOCUMENT']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ListAdminQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  tutorProfileId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const AccessUrlQuerySchema = z.object({
  datalite: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type ContentUploadUrlDto = z.infer<typeof ContentUploadUrlSchema>;
export type CreateContentDto = z.infer<typeof CreateContentSchema>;
export type UpdateContentDto = z.infer<typeof UpdateContentSchema>;
export type ChangeStatusDto = z.infer<typeof ChangeStatusSchema>;
export type ListContentsQuery = z.infer<typeof ListContentsQuerySchema>;
export type ListAdminQuery = z.infer<typeof ListAdminQuerySchema>;
