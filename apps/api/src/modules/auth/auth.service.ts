import { createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Prisma, Role } from '@prisma/client';
import prisma from '../../shared/core/database';
import redis from '../../shared/core/redis';
import { env } from '../../shared/core/env';
import { isAdult } from '../../shared/core/age';
import { decrypt, encrypt, hmac } from '../../shared/core/crypto';
import { generateSecret, otpauthUrl, verifyTotp } from '../../shared/core/totp';
import { writeAuditLog } from '../../shared/core/audit';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../shared/core/errors';
import type {
  AccessTokenPayload,
  AuthTokens,
  LoginDto,
  LoginResult,
  RefreshTokenFamily,
  RefreshTokenPayload,
  RegisterDto,
  ChangePasswordDto,
  UpdateProfileDto,
} from './auth.types';

const ACCESS_SECRET = env.ACCESS_TOKEN_SECRET;
const REFRESH_SECRET = env.REFRESH_TOKEN_SECRET;
const ACCESS_EXPIRY = env.ACCESS_TOKEN_EXPIRY;
const REFRESH_TTL_SECONDS = env.REFRESH_TOKEN_EXPIRY_SECONDS;

// Hash pré-computado no arranque; guardado como string para que o verify não envolva
// nenhum await extra quando o utilizador não existe (elimina diferença de microtask)
let _dummyHash: string | undefined;
const _dummyHashReady: Promise<void> = argon2
  .hash('dummy-password-for-timing', { type: argon2.argon2id })
  .then((h) => { _dummyHash = h; });

// Prefixo Redis para famílias de refresh token
const RTF_KEY = (familyId: string) => `rtf:${familyId}`;

// Rotação atómica: compara o token actual e substitui-o numa única operação Redis.
// Devolve {estado, mfaAt}: estado 1 = rodado, 0 = família inexistente/expirada, -1 = reutilização (família apagada).
// A sessão mantém o instante de verificação MFA com que foi estabelecida.
const ROTATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {0, 0} end
local family = cjson.decode(raw)
if family.currentTokenId ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {-1, 0}
end
local mfaAt = family.mfaAt or 0
local updated = { userId = family.userId, currentTokenId = ARGV[2] }
if mfaAt > 0 then updated.mfaAt = mfaAt end
redis.call('SET', KEYS[1], cjson.encode(updated), 'EX', tonumber(ARGV[3]))
return {1, mfaAt}
`;

// Revogação de sessões de um utilizador (mudança de papel, MFA activado): cada utilizador tem uma "época"
// de sessão (contador). Os tokens levam a época da emissão; ao revogar incrementa-se a época e todos os
// tokens anteriores deixam de valer, mesmo os access tokens ainda não expirados. Sem relógios, sem ambiguidades.
const SESSION_EPOCH_KEY = (userId: string) => `sep:${userId}`;
const MFA_FAIL_KEY = (userId: string) => `mfa:fail:${userId}`;
const MFA_USED_KEY = (userId: string, step: number) => `mfa:used:${userId}:${step}`;
const MFA_PENDING_KEY = (userId: string) => `mfa:pending:${userId}`;
const MFA_MAX_FAILURES = 5;
const MFA_LOCK_SECONDS = 15 * 60;
const MFA_CHALLENGE_TTL = '5m';
const RECOVERY_CODE_COUNT = 8;

const nowSeconds = () => Math.floor(Date.now() / 1000);

// Chave própria para os desafios MFA: um desafio nunca é aceite como access token (nem o contrário)
const MFA_CHALLENGE_KEY = createHmac('sha256', ACCESS_SECRET).update('educa:mfa-challenge').digest();

function signAccessToken(userId: string, role: Role, epoch: number, mfaAt?: number): string {
  const payload: Omit<AccessTokenPayload, 'iat'> = { sub: userId, role, ep: epoch, ...(mfaAt ? { mfaAt } : {}) };
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY } as jwt.SignOptions);
}

function signRefreshToken(userId: string, familyId: string, tokenId: string, epoch: number): string {
  const payload: Omit<RefreshTokenPayload, 'iat'> = { sub: userId, familyId, tokenId, ep: epoch };
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: REFRESH_TTL_SECONDS,
  } as jwt.SignOptions);
}

async function storeFamily(
  familyId: string,
  userId: string,
  tokenId: string,
  mfaAt?: number,
): Promise<void> {
  const family: RefreshTokenFamily = { userId, currentTokenId: tokenId, ...(mfaAt ? { mfaAt } : {}) };
  await redis.set(RTF_KEY(familyId), JSON.stringify(family), 'EX', REFRESH_TTL_SECONDS);
}

async function issueTokens(
  userId: string,
  role: Role,
  mfaAt?: number,
): Promise<AuthTokens & { familyId: string }> {
  const familyId = uuidv4();
  const tokenId = uuidv4();
  await storeFamily(familyId, userId, tokenId, mfaAt);
  // Lida antes de assinar: se uma revogação ocorrer entre as duas coisas, o token já nasce revogado (lado seguro)
  const epoch = await getSessionEpoch(userId);
  return {
    accessToken: signAccessToken(userId, role, epoch, mfaAt),
    refreshToken: signRefreshToken(userId, familyId, tokenId, epoch),
    familyId,
  };
}

// ── Serviço público ───────────────────────────────────────────────────────────

interface NewUserData {
  name: string;
  email: string;
  password: string;
  role: Role;
  birthDate?: Date;
  guardianId?: string;
}

// Único ponto de criação de contas (registo próprio e criação de dependentes pelo Encarregado)
export async function createUserAccount(data: NewUserData) {
  const password = await argon2.hash(data.password, { type: argon2.argon2id });
  try {
    return await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password,
        role: data.role,
        birthDate: data.birthDate ?? null,
        guardianId: data.guardianId ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Email já registado');
    }
    throw err;
  }
}

export async function register(dto: RegisterDto): Promise<AuthTokens> {
  // RN-02: menores só existem como dependentes de um Encarregado
  if (dto.role === 'STUDENT' && !isAdult(dto.birthDate!)) {
    throw new ForbiddenError('Menores de 18 anos têm de ser registados por um Encarregado de Educação');
  }

  const user = await createUserAccount({
    name: dto.name,
    email: dto.email,
    password: dto.password,
    role: dto.role as Role,
    birthDate: dto.birthDate,
  });

  await writeAuditLog({
    actorId: user.id,
    entityType: 'User',
    entityId: user.id,
    action: 'REGISTER',
  });

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role);
  return { accessToken, refreshToken };
}

export async function login(dto: LoginDto): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: dto.email } });

  // Tempo constante mesmo quando o utilizador não existe (evita user enumeration).
  // _dummyHash é string depois do arranque; fallback para a Promise só na janela de startup.
  const dummy: string = _dummyHash ?? await _dummyHashReady.then(() => _dummyHash as string);
  const passwordToVerify: string = user?.password ?? dummy;
  const valid = await argon2.verify(passwordToVerify, dto.password);

  if (!user || !valid) throw new UnauthorizedError('Credenciais inválidas');

  // Com MFA activo a password sozinha não dá sessão: devolve-se um desafio de curta duração
  if (user.mfaEnabled) {
    await writeAuditLog({ actorId: user.id, entityType: 'User', entityId: user.id, action: 'LOGIN_MFA_CHALLENGE' });
    return { kind: 'mfa', challenge: signMfaChallenge(user.id) };
  }

  await writeAuditLog({
    actorId: user.id,
    entityType: 'User',
    entityId: user.id,
    action: 'LOGIN',
  });

  const { accessToken, refreshToken } = await issueTokens(user.id, user.role);
  // Um ADMIN sem MFA obtém uma sessão que só serve para o configurar (as rotas de admin exigem MFA)
  return {
    kind: 'tokens',
    tokens: { accessToken, refreshToken },
    mfaEnrollmentRequired: user.role === Role.ADMIN,
  };
}

export async function refreshTokens(rawToken: string): Promise<AuthTokens> {
  let payload: RefreshTokenPayload;

  try {
    payload = jwt.verify(rawToken, REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw new UnauthorizedError('Token inválido');
  }

  const { sub: userId, familyId, tokenId } = payload;

  if (await isRevoked(userId, payload.ep)) {
    await redis.del(RTF_KEY(familyId));
    throw new UnauthorizedError('Sessão revogada');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) {
    await redis.del(RTF_KEY(familyId));
    throw new UnauthorizedError('Utilizador não encontrado');
  }

  const newTokenId = uuidv4();
  const [outcome, mfaAt] = (await redis.eval(
    ROTATE_SCRIPT,
    1,
    RTF_KEY(familyId),
    tokenId,
    newTokenId,
    REFRESH_TTL_SECONDS,
  )) as [number, number];

  if (outcome === 0) throw new UnauthorizedError('Sessão expirada');

  if (outcome === -1) {
    // Reutilização detectada: a família já foi revogada pelo script
    await writeAuditLog({
      actorId: userId,
      entityType: 'User',
      entityId: userId,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
    });
    throw new UnauthorizedError('Token comprometido — faça login novamente');
  }

  const epoch = await getSessionEpoch(userId);
  return {
    accessToken: signAccessToken(userId, user.role, epoch, mfaAt > 0 ? mfaAt : undefined),
    refreshToken: signRefreshToken(userId, familyId, newTokenId, epoch),
  };
}

export async function logout(rawToken: string): Promise<void> {
  try {
    const payload = jwt.verify(rawToken, REFRESH_SECRET) as RefreshTokenPayload;
    await redis.del(RTF_KEY(payload.familyId));
    await writeAuditLog({
      actorId: payload.sub,
      entityType: 'User',
      entityId: payload.sub,
      action: 'LOGOUT',
    });
  } catch {
    // Token inválido ou expirado: nada a fazer
  }
}

export async function getMe(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
}

// ── Perfil e password (RF-AUT-04) ────────────────────────────────────────────

const PWD_FAIL_KEY = (userId: string) => `pwd:fail:${userId}`;
const PWD_MAX_FAILURES = 5;

// Confirma a password actual. Com um access token roubado, sem este limite dava para adivinhar a password.
async function verifyCurrentPassword(userId: string, password: string): Promise<void> {
  if (Number((await redis.get(PWD_FAIL_KEY(userId))) ?? 0) >= PWD_MAX_FAILURES) {
    throw new TooManyRequestsError('Demasiadas tentativas. Tente novamente dentro de alguns minutos.');
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { password: true } });
  if (!(await argon2.verify(user.password, password))) {
    const failures = await redis.incr(PWD_FAIL_KEY(userId));
    if (failures === 1) await redis.expire(PWD_FAIL_KEY(userId), MFA_LOCK_SECONDS);
    if (failures === PWD_MAX_FAILURES) {
      await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'PASSWORD_CHECK_LOCKED' });
    }
    // 403 e não 401: um 401 faria o cliente achar que a sessão expirou
    throw new ForbiddenError('Password actual incorrecta');
  }
  await redis.del(PWD_FAIL_KEY(userId));
}

// Define a password e revoga TODAS as sessões do utilizador (usado também pelo Encarregado para o dependente)
export async function setPasswordForUser(userId: string, newPassword: string): Promise<void> {
  const password = await argon2.hash(newPassword, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: userId }, data: { password } });
  await revokeUserSessions(userId);
}

// Troca a password e devolve uma sessão nova: o dispositivo actual continua ligado, todos os outros caem
export async function changePassword(
  userId: string,
  role: Role,
  mfaAt: number | undefined,
  dto: ChangePasswordDto,
): Promise<AuthTokens> {
  await verifyCurrentPassword(userId, dto.currentPassword);
  await setPasswordForUser(userId, dto.newPassword);
  await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'PASSWORD_CHANGED' });
  const { accessToken, refreshToken } = await issueTokens(userId, role, mfaAt); // o MFA da sessão mantém-se
  return { accessToken, refreshToken };
}

export async function updateProfile(
  userId: string,
  role: Role,
  mfaAt: number | undefined,
  dto: UpdateProfileDto,
): Promise<{ user: Awaited<ReturnType<typeof getMe>>; tokens: AuthTokens | null }> {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
  const emailChanged = dto.email !== undefined && dto.email !== current.email;
  if (emailChanged) await verifyCurrentPassword(userId, dto.currentPassword!);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { ...(dto.name !== undefined ? { name: dto.name } : {}), ...(emailChanged ? { email: dto.email } : {}) },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Email já registado');
    }
    throw err;
  }
  if (dto.name !== undefined && dto.name !== current.name) {
    await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'PROFILE_UPDATED' });
  }

  let tokens: AuthTokens | null = null;
  if (emailChanged) {
    // O email é o identificador de login: as outras sessões deixam de valer
    await revokeUserSessions(userId);
    await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'EMAIL_CHANGED' });
    const { accessToken, refreshToken } = await issueTokens(userId, role, mfaAt);
    tokens = { accessToken, refreshToken };
  }
  return { user: await getMe(userId), tokens };
}

// ── Revogação de sessões ─────────────────────────────────────────────────────

export async function getSessionEpoch(userId: string): Promise<number> {
  return Number((await redis.get(SESSION_EPOCH_KEY(userId))) ?? 0);
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await redis.incr(SESSION_EPOCH_KEY(userId));
  // TTL = vida máxima de um refresh token: passado esse tempo já não pode existir nenhum token anterior
  await redis.expire(SESSION_EPOCH_KEY(userId), REFRESH_TTL_SECONDS + 60);
}

// Um token é válido se foi emitido na época actual (tokens sem época contam como época 0)
export async function isRevoked(userId: string, tokenEpoch: number | undefined): Promise<boolean> {
  return (tokenEpoch ?? 0) < (await getSessionEpoch(userId));
}

// ── MFA (RNF-SEG-06) ─────────────────────────────────────────────────────────

function signMfaChallenge(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'mfa-challenge' }, MFA_CHALLENGE_KEY, { expiresIn: MFA_CHALLENGE_TTL });
}

function readMfaChallenge(token: string): string {
  try {
    const payload = jwt.verify(token, MFA_CHALLENGE_KEY, { algorithms: ['HS256'] }) as { sub: string; typ: string };
    if (payload.typ !== 'mfa-challenge') throw new Error('tipo');
    return payload.sub;
  } catch {
    throw new UnauthorizedError('Desafio inválido ou expirado');
  }
}

async function assertNotLocked(userId: string): Promise<void> {
  const failures = Number((await redis.get(MFA_FAIL_KEY(userId))) ?? 0);
  if (failures >= MFA_MAX_FAILURES) {
    throw new TooManyRequestsError('Demasiadas tentativas. Tente novamente dentro de alguns minutos.');
  }
}

async function registerFailure(userId: string): Promise<void> {
  const failures = await redis.incr(MFA_FAIL_KEY(userId));
  if (failures === 1) await redis.expire(MFA_FAIL_KEY(userId), MFA_LOCK_SECONDS);
  if (failures === MFA_MAX_FAILURES) {
    await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'MFA_LOCKED' });
  }
}

const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');

// Aceita um código TOTP ou um código de recuperação. Cada código TOTP só vale uma vez (anti-replay).
async function checkSecondFactor(
  user: { id: string; mfaSecret: string | null },
  rawCode: string,
): Promise<boolean> {
  const code = rawCode.trim();

  if (/^\d{6}$/.test(code)) {
    if (!user.mfaSecret) return false;
    const step = verifyTotp(decrypt(user.mfaSecret, user.id), code);
    if (step === null) return false;
    // NX: se este passo já foi usado (por nós ou por quem espiou o código), recusa
    const first = await redis.set(MFA_USED_KEY(user.id, step), '1', 'EX', 120, 'NX');
    return first === 'OK';
  }

  const normalized = normalizeRecovery(code);
  if (!/^[0-9a-f]{20}$/.test(normalized)) return false;
  const { count } = await prisma.mfaRecoveryCode.updateMany({
    where: { userId: user.id, codeHash: hmac(normalized), usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 1) {
    await writeAuditLog({ actorId: user.id, entityType: 'User', entityId: user.id, action: 'MFA_RECOVERY_CODE_USED' });
    return true;
  }
  return false;
}

async function verifyOrFail(user: { id: string; mfaSecret: string | null }, code: string): Promise<void> {
  await assertNotLocked(user.id);
  if (!(await checkSecondFactor(user, code))) {
    await registerFailure(user.id);
    throw new UnauthorizedError('Código inválido');
  }
  await redis.del(MFA_FAIL_KEY(user.id));
}

// 2.º passo do login (UC01 com MFA)
export async function verifyMfaLogin(challenge: string, code: string): Promise<AuthTokens> {
  const userId = readMfaChallenge(challenge);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, mfaEnabled: true, mfaSecret: true },
  });
  if (!user?.mfaEnabled) throw new UnauthorizedError('Desafio inválido ou expirado');

  await verifyOrFail(user, code);

  await writeAuditLog({ actorId: user.id, entityType: 'User', entityId: user.id, action: 'LOGIN' });
  const { accessToken, refreshToken } = await issueTokens(user.id, user.role, nowSeconds());
  return { accessToken, refreshToken };
}

// Passo 1 da configuração: gera o segredo e guarda-o (cifrado) até ser confirmado
export async function setupMfa(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, mfaEnabled: true },
  });
  if (user.mfaEnabled) throw new ConflictError('MFA já está activo');

  const secret = generateSecret();
  await redis.set(MFA_PENDING_KEY(userId), encrypt(secret, userId), 'EX', 600);
  return { secret, otpauthUrl: otpauthUrl(secret, user.email, 'Educa') };
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(10).toString('hex')); // 80 bits cada
}
const formatRecovery = (hex: string) => hex.match(/.{5}/g)!.join('-');

// Passo 2: confirma com um código válido, activa o MFA e devolve os códigos de recuperação (só desta vez)
export async function enableMfa(userId: string, code: string) {
  await assertNotLocked(userId);
  const pending = await redis.get(MFA_PENDING_KEY(userId));
  if (!pending) throw new ConflictError('Inicie a configuração do MFA primeiro');

  const secret = decrypt(pending, userId);
  const step = verifyTotp(secret, code.trim());
  if (step === null) {
    await registerFailure(userId);
    throw new UnauthorizedError('Código inválido');
  }
  await redis.del(MFA_FAIL_KEY(userId));

  const codes = newRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, mfaEnabled: false },
      data: { mfaEnabled: true, mfaSecret: encrypt(secret, userId), mfaEnabledAt: new Date() },
    });
    if (count === 0) throw new ConflictError('MFA já está activo');
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hmac(c) })) });
  });
  await redis.del(MFA_PENDING_KEY(userId));
  await redis.set(MFA_USED_KEY(userId, step), '1', 'EX', 120, 'NX'); // o código de configuração não serve para entrar

  // As sessões abertas sem MFA deixam de valer: é preciso entrar de novo, já com o segundo factor
  await revokeUserSessions(userId);
  await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'MFA_ENABLED' });
  return { recoveryCodes: codes.map(formatRecovery) };
}

// Reautenticação para acções sensíveis: devolve um access token com MFA acabado de verificar
export async function stepUpMfa(userId: string, code: string): Promise<{ accessToken: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, role: true, mfaEnabled: true, mfaSecret: true },
  });
  if (!user.mfaEnabled) throw new ForbiddenError('MFA não está activo');

  await verifyOrFail(user, code);
  await writeAuditLog({ actorId: userId, entityType: 'User', entityId: userId, action: 'MFA_STEP_UP' });
  return { accessToken: signAccessToken(user.id, user.role, await getSessionEpoch(user.id), nowSeconds()) };
}

// ── Gestão de utilizadores (usada pelo módulo admin) ─────────────────────────

export async function listUsers(query: { search?: string; role?: Role; page: number; limit: number }) {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.search
      ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] }
      : {}),
  };
  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { id: true, name: true, email: true, role: true, mfaEnabled: true, createdAt: true },
    }),
    prisma.user.count({ where }),
  ]);
  return { users, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

export async function getUserRole(userId: string): Promise<Role> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new NotFoundError('Utilizador não encontrado');
  return user.role;
}

// Muda o papel dentro da transacção do chamador, com as regras de integridade do modelo
export async function changeUserRole(
  tx: Prisma.TransactionClient,
  userId: string,
  from: Role,
  to: Role,
): Promise<void> {
  if (from === Role.ADMIN) {
    // Bloqueia todos os admins: dois pedidos simultâneos não conseguem deixar o sistema sem nenhum
    const admins = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;
    if (admins.length <= 1) throw new ConflictError('Não pode remover o último administrador');
  }

  const target = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, guardianId: true, birthDate: true, _count: { select: { dependents: true } } },
  });
  if (!target) throw new NotFoundError('Utilizador não encontrado');
  if (target.role !== from) throw new ConflictError('O papel do utilizador mudou entretanto');
  if (target.guardianId || target._count.dependents > 0) {
    throw new ConflictError('Encarregados com dependentes e dependentes não podem mudar de papel');
  }
  if (to === Role.STUDENT && !target.birthDate) throw new ConflictError('Um aluno exige data de nascimento');

  await tx.user.update({ where: { id: userId }, data: { role: to } });
}

export async function countUsersByRole() {
  const grouped = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });
  return Object.fromEntries(Object.values(Role).map((r) => [r, grouped.find((g) => g.role === r)?._count._all ?? 0]));
}
