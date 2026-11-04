import { z } from 'zod';
import { BirthDateSchema, EmailSchema, NameSchema, PasswordSchema } from '../../shared/core/schemas';

// O Encarregado cria a conta do dependente e entrega as credenciais ao aluno (UC13 / RF-AUT-03)
export const CreateDependentSchema = z.object({
  name: NameSchema,
  email: EmailSchema,
  password: PasswordSchema,
  birthDate: BirthDateSchema,
});

export const ResetDependentPasswordSchema = z.object({ newPassword: PasswordSchema });

export const StudentParamsSchema = z.object({ studentId: z.string().uuid() });

export type ResetDependentPasswordDto = z.infer<typeof ResetDependentPasswordSchema>;
export type CreateDependentDto = z.infer<typeof CreateDependentSchema>;
