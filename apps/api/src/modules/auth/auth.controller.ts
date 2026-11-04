import type { FastifyReply, FastifyRequest } from 'fastify';
import * as AuthService from './auth.service';
import {
  ChangePasswordSchema,
  LoginSchema,
  MfaCodeSchema,
  MfaVerifySchema,
  RegisterSchema,
  UpdateProfileSchema,
} from './auth.types';
import { ValidationError } from '../../shared/core/errors';
import { env } from '../../shared/core/env';

const COOKIE_NAME = 'refresh_token';

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: env.REFRESH_TOKEN_EXPIRY_SECONDS,
    path: '/api/v1/auth',
  };
}

export async function register(request: FastifyRequest, reply: FastifyReply) {
  const parsed = RegisterSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const { accessToken, refreshToken } = await AuthService.register(parsed.data);
  reply.setCookie(COOKIE_NAME, refreshToken, cookieOptions());
  return reply.status(201).send({ accessToken });
}

export async function login(request: FastifyRequest, reply: FastifyReply) {
  const parsed = LoginSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const result = await AuthService.login(parsed.data);
  // Com MFA activo não há sessão ainda: o cliente tem de apresentar o código (POST /auth/mfa/verify)
  if (result.kind === 'mfa') return reply.send({ mfaRequired: true, challenge: result.challenge });

  reply.setCookie(COOKIE_NAME, result.tokens.refreshToken, cookieOptions());
  return reply.send({
    accessToken: result.tokens.accessToken,
    ...(result.mfaEnrollmentRequired ? { mfaEnrollmentRequired: true } : {}),
  });
}

export async function mfaVerify(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MfaVerifySchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const { accessToken, refreshToken } = await AuthService.verifyMfaLogin(parsed.data.challenge, parsed.data.code);
  reply.setCookie(COOKIE_NAME, refreshToken, cookieOptions());
  return reply.send({ accessToken });
}

export async function mfaSetup(request: FastifyRequest, reply: FastifyReply) {
  return reply.send(await AuthService.setupMfa(request.user!.id));
}

export async function mfaEnable(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MfaCodeSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const result = await AuthService.enableMfa(request.user!.id, parsed.data.code);
  // As sessões anteriores foram revogadas: o cookie deixa de servir e é preciso entrar de novo
  reply.clearCookie(COOKIE_NAME, { path: '/api/v1/auth' });
  return reply.send({ ...result, relogin: true });
}

export async function mfaStepUp(request: FastifyRequest, reply: FastifyReply) {
  const parsed = MfaCodeSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  return reply.send(await AuthService.stepUpMfa(request.user!.id, parsed.data.code));
}

export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const rawToken = request.cookies[COOKIE_NAME];
  if (!rawToken) {
    return reply
      .status(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Sem refresh token' } });
  }

  const { accessToken, refreshToken } = await AuthService.refreshTokens(rawToken);
  reply.setCookie(COOKIE_NAME, refreshToken, cookieOptions());
  return reply.send({ accessToken });
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const rawToken = request.cookies[COOKIE_NAME];
  if (rawToken) await AuthService.logout(rawToken);
  reply.clearCookie(COOKIE_NAME, { path: '/api/v1/auth' });
  return reply.status(204).send();
}

export async function me(request: FastifyRequest, reply: FastifyReply) {
  const user = await AuthService.getMe(request.user!.id);
  return reply.send({ user });
}

export async function updateMe(request: FastifyRequest, reply: FastifyReply) {
  const parsed = UpdateProfileSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const { id, role, mfaAt } = request.user!;
  const { user, tokens } = await AuthService.updateProfile(id, role, mfaAt, parsed.data);
  if (!tokens) return reply.send({ user });

  reply.setCookie(COOKIE_NAME, tokens.refreshToken, cookieOptions());
  return reply.send({ user, accessToken: tokens.accessToken });
}

export async function changePassword(request: FastifyRequest, reply: FastifyReply) {
  const parsed = ChangePasswordSchema.safeParse(request.body);
  if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());

  const { id, role, mfaAt } = request.user!;
  const { accessToken, refreshToken } = await AuthService.changePassword(id, role, mfaAt, parsed.data);
  reply.setCookie(COOKIE_NAME, refreshToken, cookieOptions());
  return reply.send({ accessToken });
}
