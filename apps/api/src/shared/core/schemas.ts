import { z } from 'zod';

// Primitivas de validação partilhadas entre módulos (um módulo não importa os tipos de outro)
export const NameSchema = z.string().trim().min(2).max(100);
export const EmailSchema = z.string().trim().toLowerCase().email();
export const PasswordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, 'Deve conter pelo menos uma letra maiúscula')
  .regex(/[0-9]/, 'Deve conter pelo menos um número');
// Data de nascimento no formato AAAA-MM-DD, no passado
export const BirthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD')
  .transform((v) => new Date(`${v}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()) && d < new Date() && d.getUTCFullYear() > 1900, {
    message: 'Data de nascimento inválida',
  });
