import { z } from 'zod';

export const ALLOWED_LEVELS = [
  'Primário',
  'I Ciclo',
  'II Ciclo',
  'Exame de acesso',
  'Universitário',
] as const;

export type TeachingLevel = (typeof ALLOWED_LEVELS)[number];

export const CreateProfileSchema = z.object({
  bio: z.string().max(1000).optional(),
  subjects: z.array(z.string().min(1).max(100)).min(1).max(20),
  levels: z.array(z.enum(ALLOWED_LEVELS)).max(5).default([]),
  hourlyRate: z.number().int().min(500).max(100_000).optional(),
});

const MB = 1024 * 1024;

export const DOCUMENT_TYPES = {
  DIPLOMA: { field: 'diplomaKey', mimes: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 10 * MB },
  CRIMINAL_RECORD: { field: 'criminalRecordKey', mimes: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 10 * MB },
  PASSPORT_PHOTO: { field: 'passportPhotoKey', mimes: ['image/jpeg', 'image/png'], maxBytes: 5 * MB },
  VIDEO_INTRO: { field: 'videoIntroKey', mimes: ['video/mp4', 'video/webm'], maxBytes: 100 * MB },
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const UploadUrlSchema = z
  .object({
    type: z.enum(['DIPLOMA', 'CRIMINAL_RECORD', 'PASSPORT_PHOTO', 'VIDEO_INTRO', 'AVATAR']),
    contentType: z.string().max(100),
  })
  .refine(
    (d) => {
      const allowed = d.type === 'AVATAR'
        ? (AVATAR_MIMES as readonly string[])
        : (DOCUMENT_TYPES[d.type as DocumentType].mimes as readonly string[]);
      return allowed.includes(d.contentType);
    },
    { message: 'Tipo de ficheiro não permitido', path: ['contentType'] },
  );

export const UpdateTutorProfileSchema = z
  .object({
    bio: z.string().trim().max(1000).nullable().optional(),
    subjects: z.array(z.string().trim().min(1).max(100)).min(1).max(20).optional(),
    levels: z.array(z.enum(ALLOWED_LEVELS)).min(1).max(5).optional(),
    hourlyRate: z.number().int().min(500).max(100_000).optional(),
    avatarKey: z.string().max(300).optional(),
  })
  .refine(
    (d) =>
      d.bio !== undefined ||
      d.subjects !== undefined ||
      d.levels !== undefined ||
      d.hourlyRate !== undefined ||
      d.avatarKey !== undefined,
    { message: 'Nada para actualizar' },
  );

export const SubmitDocumentsSchema = z
  .object({
    diplomaKey: z.string().max(300).optional(),
    criminalRecordKey: z.string().max(300).optional(),
    passportPhotoKey: z.string().max(300).optional(),
    videoIntroKey: z.string().max(300).optional(),
  })
  .refine((d) => Object.values(d).some(Boolean), {
    message: 'Pelo menos um documento é obrigatório',
  });

export const ReviewTutorSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((d) => d.status !== 'REJECTED' || !!d.reason, {
    message: 'Indique o motivo da rejeição',
    path: ['reason'],
  });

export const ListTutorsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  disciplina: z.string().trim().max(100).optional(),
  nivel: z.enum(ALLOWED_LEVELS).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const ListPendingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UpdateTutorProfileDto = z.infer<typeof UpdateTutorProfileSchema>;
export type CreateProfileDto = z.infer<typeof CreateProfileSchema>;
export type UploadUrlDto = z.infer<typeof UploadUrlSchema>;
export type SubmitDocumentsDto = z.infer<typeof SubmitDocumentsSchema>;
export type ReviewTutorDto = z.infer<typeof ReviewTutorSchema>;
export type ListTutorsQuery = z.infer<typeof ListTutorsQuerySchema>;
