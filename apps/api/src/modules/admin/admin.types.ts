import { z } from 'zod';

const RoleEnum = z.enum(['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN']);

export const ListUsersQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  role: RoleEnum.optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const RequestRoleChangeSchema = z.object({
  userId: z.string().uuid(),
  role: RoleEnum,
});

export const ListRoleChangesQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().positive().max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const RequestParamsSchema = z.object({ id: z.string().uuid() });

// Um pedido pendente caduca: aprovar muito depois já não reflecte a decisão de quem o pediu
export const ROLE_CHANGE_TTL_HOURS = 24;
