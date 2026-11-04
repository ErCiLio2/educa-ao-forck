import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../../shared/core/env';
import {
  ForbiddenError,
  MfaRequiredError,
  MfaStepUpRequiredError,
  UnauthorizedError,
} from '../../shared/core/errors';
import { isRevoked } from './auth.service';
import type { AccessTokenPayload } from './auth.types';
import './auth.types'; // ensure FastifyRequest augmentation is applied

export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();

  const token = header.slice(7);
  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload;
  } catch {
    throw new UnauthorizedError('Token inválido ou expirado');
  }

  // Sessões revogadas (mudança de papel, MFA activado) deixam de valer mesmo antes de o token expirar
  if (await isRevoked(payload.sub, payload.ep)) throw new UnauthorizedError('Sessão revogada');

  request.user = { id: payload.sub, role: payload.role, mfa: payload.mfaAt !== undefined, mfaAt: payload.mfaAt };
}

export function authorize(...roles: Role[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw new UnauthorizedError();
    if (!roles.includes(request.user.role)) throw new ForbiddenError();
  };
}

// Sessão estabelecida com segundo factor. Usar depois de authenticate (RNF-SEG-06).
export async function requireMfa(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.user) throw new UnauthorizedError();
  if (!request.user.mfa) throw new MfaRequiredError();
}

// Acções sensíveis (RN-08): o MFA tem de ter sido verificado há pouco. Se não, o cliente chama
// POST /auth/mfa/step-up e repete o pedido com o novo access token.
export function requireRecentMfa(maxAgeSeconds = 600) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) throw new UnauthorizedError();
    if (!request.user.mfa) throw new MfaRequiredError();
    if (Math.floor(Date.now() / 1000) - (request.user.mfaAt ?? 0) > maxAgeSeconds) {
      throw new MfaStepUpRequiredError();
    }
  };
}

// Operações de conta (password, email): só os administradores precisam de MFA recente; os outros perfis passam
export function requireRecentMfaIfAdmin(maxAgeSeconds = 600) {
  const check = requireRecentMfa(maxAgeSeconds);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.user?.role === Role.ADMIN) await check(request, reply);
  };
}
