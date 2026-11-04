import { Role } from '@prisma/client';
import { z } from 'zod';
import { BirthDateSchema, EmailSchema, NameSchema, PasswordSchema } from '../../shared/core/schemas';

declare module 'fastify' {
  interface FastifyRequest {
    // mfa: a sessão foi estabelecida com segundo factor; mfaAt: instante (s) da última verificação
    user?: { id: string; role: Role; mfa: boolean; mfaAt?: number };
  }
}

// ── Payloads JWT ──────────────────────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: string; // userId
  role: Role;
  iat: number;
  ep?: number; // época de sessão do utilizador na emissão (ver revokeUserSessions)
  mfaAt?: number; // epoch (s) da última verificação MFA; ausente = sessão sem MFA
}

export interface RefreshTokenPayload {
  sub: string; // userId
  familyId: string;
  tokenId: string;
  iat: number;
  ep?: number;
}

// ── Redis: família de refresh tokens ─────────────────────────────────────────
// Chave: rtf:{familyId}
// Valor: JSON deste tipo
export interface RefreshTokenFamily {
  userId: string;
  currentTokenId: string;
  mfaAt?: number; // a sessão herda o MFA com que foi estabelecida
}

// ── Schemas de validação (Zod) ────────────────────────────────────────────────

// ADMIN nunca é auto-registável (seed / alteração de papel por outro admin com MFA).
// Menores não se registam sozinhos: são criados pelo Encarregado (POST /guardians/dependents).
export const RegisterSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
    password: PasswordSchema,
    role: z.enum(['STUDENT', 'GUARDIAN', 'TUTOR']),
    birthDate: BirthDateSchema.optional(),
  })
  .refine((d) => d.role !== 'STUDENT' || d.birthDate !== undefined, {
    message: 'Data de nascimento obrigatória para alunos',
    path: ['birthDate'],
  })
  .refine((d) => d.role === 'STUDENT' || d.birthDate === undefined, {
    message: 'Data de nascimento só é aplicável a alunos',
    path: ['birthDate'],
  });

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

// Alterar o email é sensível (é o identificador de login): exige a password actual
export const UpdateProfileSchema = z
  .object({
    name: NameSchema.optional(),
    email: EmailSchema.optional(),
    currentPassword: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.name !== undefined || d.email !== undefined, { message: 'Nada para actualizar' })
  .refine((d) => d.email === undefined || d.currentPassword !== undefined, {
    message: 'A alteração do email exige a password actual',
    path: ['currentPassword'],
  });

export const ChangePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: PasswordSchema })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'A nova password tem de ser diferente da actual',
    path: ['newPassword'],
  });

// Código TOTP (6 dígitos) ou de recuperação (xxxxx-xxxxx-xxxxx-xxxxx)
export const MfaCodeSchema = z.object({ code: z.string().trim().min(6).max(40) });
export const MfaVerifySchema = z.object({ challenge: z.string().min(20).max(2000), code: MfaCodeSchema.shape.code });

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type RegisterDto = z.infer<typeof RegisterSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;

export type LoginResult =
  | { kind: 'tokens'; tokens: AuthTokens; mfaEnrollmentRequired: boolean }
  | { kind: 'mfa'; challenge: string };

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
