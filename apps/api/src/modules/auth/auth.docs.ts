import { z } from 'zod';
import { docs, errorResponses, named, NoContent, obj, REFRESH_COOKIE_NOTE, Roles, uuid, isoDate } from '../../shared/core/openapi';
import {
  ChangePasswordSchema,
  LoginSchema,
  MfaCodeSchema,
  MfaVerifySchema,
  RegisterSchema,
  UpdateProfileSchema,
} from './auth.types';

const AccessToken = obj({ accessToken: z.string().describe('JWT de curta duração (15 min)') });

export const UserSummary = named(
  'User',
  obj({ id: uuid, name: z.string(), email: z.string().email(), role: Roles, createdAt: isoDate }),
);

const LoginResponse = z.union([
  obj({
    accessToken: z.string(),
    mfaEnrollmentRequired: z.literal(true).optional().describe('Administrador sem MFA: só pode configurá-lo'),
  }),
  obj({ mfaRequired: z.literal(true), challenge: z.string().describe('Desafio de 5 min para POST /auth/mfa/verify') }),
]);

const TAG = ['Autenticação'];

export const authDocs = {
  register: docs({
    tags: TAG, operationId: 'register', summary: 'Criar conta', security: 'none',
    description: `Aluno (maior de 18 anos), Encarregado ou Tutor. Menores são criados pelo Encarregado. ADMIN nunca é auto-registável. ${REFRESH_COOKIE_NOTE}`,
    body: RegisterSchema,
    response: { 201: AccessToken, ...errorResponses(403, 409, 422) },
  }),
  login: docs({
    tags: TAG, operationId: 'login', summary: 'Iniciar sessão', security: 'none',
    description: `Com MFA activo devolve um desafio (\`mfaRequired\`) em vez de tokens. ${REFRESH_COOKIE_NOTE}`,
    body: LoginSchema,
    response: { 200: LoginResponse, ...errorResponses(401, 422) },
  }),
  refresh: docs({
    tags: TAG, operationId: 'refreshSession', summary: 'Renovar o access token', security: 'none',
    description: `Usa o cookie \`refresh_token\`. Rotação com detecção de reutilização: reapresentar um token antigo revoga a sessão. ${REFRESH_COOKIE_NOTE}`,
    response: { 200: AccessToken, ...errorResponses(401) },
  }),
  logout: docs({
    tags: TAG, operationId: 'logout', summary: 'Terminar sessão', security: 'none',
    description: 'Revoga a sessão do cookie `refresh_token` e limpa o cookie. Idempotente.',
    response: { 204: NoContent },
  }),
  me: docs({
    tags: TAG, operationId: 'getMe', summary: 'Utilizador autenticado', roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'],
    response: { 200: obj({ user: UserSummary }), ...errorResponses(401) },
  }),
  updateMe: docs({
    tags: TAG, operationId: 'updateMe', summary: 'Alterar nome ou email',
    description:
      'O email exige `currentPassword` e revoga as outras sessões (devolve tokens novos para esta). O papel e a data de nascimento nunca se alteram aqui. Administradores precisam de MFA recente.',
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'], body: UpdateProfileSchema,
    response: { 200: obj({ user: UserSummary, accessToken: z.string().optional() }), ...errorResponses(401, 403, 409, 422, 429) },
  }),
  changePassword: docs({
    tags: TAG, operationId: 'changePassword', summary: 'Alterar a password',
    description: `Revoga todas as outras sessões; esta recebe tokens novos. 5 erros na password actual bloqueiam 15 min. Administradores precisam de MFA recente. ${REFRESH_COOKIE_NOTE}`,
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'], body: ChangePasswordSchema,
    response: { 200: AccessToken, ...errorResponses(401, 403, 422, 429) },
  }),
  mfaVerify: docs({
    tags: ['MFA'], operationId: 'verifyMfa', summary: '2.º passo do login com MFA', security: 'none',
    description: `Código TOTP de 6 dígitos ou código de recuperação. Cada código TOTP só vale uma vez; 5 erros bloqueiam 15 min. ${REFRESH_COOKIE_NOTE}`,
    body: MfaVerifySchema,
    response: { 200: AccessToken, ...errorResponses(401, 422, 429) },
  }),
  mfaSetup: docs({
    tags: ['MFA'], operationId: 'setupMfa', summary: 'Iniciar a configuração do MFA',
    description: 'Gera o segredo TOTP (válido 10 min até ser confirmado). Mostrar `otpauthUrl` como QR code.',
    roles: ['ADMIN'],
    response: { 200: obj({ secret: z.string(), otpauthUrl: z.string() }), ...errorResponses(401, 403, 409) },
  }),
  mfaEnable: docs({
    tags: ['MFA'], operationId: 'enableMfa', summary: 'Confirmar e activar o MFA',
    description: 'Devolve os 8 códigos de recuperação, **mostrados só desta vez**. Revoga todas as sessões: é preciso entrar de novo.',
    roles: ['ADMIN'], body: MfaCodeSchema,
    response: { 200: obj({ recoveryCodes: z.array(z.string()), relogin: z.literal(true) }), ...errorResponses(401, 403, 409, 422, 429) },
  }),
  mfaStepUp: docs({
    tags: ['MFA'], operationId: 'stepUpMfa', summary: 'Reconfirmar o MFA para acções sensíveis',
    description: 'Devolve um access token com o MFA acabado de verificar (necessário para as rotas que exigem MFA recente).',
    roles: ['ADMIN'], mfa: 'session', body: MfaCodeSchema,
    response: { 200: AccessToken, ...errorResponses(401, 403, 422, 429) },
  }),
};
