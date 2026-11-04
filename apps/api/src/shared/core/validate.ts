import type { ZodType, ZodTypeDef } from 'zod';
import { ValidationError } from './errors';

// Valida e devolve o resultado tipado; lança ValidationError (422) com os detalhes do Zod
export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown, message = 'Dados inválidos'): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ValidationError(message, parsed.error.flatten());
  return parsed.data;
}
