// Verifica, em tempo de compilação, que os tipos gerados são utilizáveis e têm a forma esperada.
// Se o contrato mudar de forma incompatível, este ficheiro deixa de compilar (corre em `pnpm typecheck`).
import type { components, paths } from './index';

type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;

// Login: ou tokens, ou desafio MFA
type LoginOk = Json<paths['/api/v1/auth/login']['post']['responses']['200']>;
const tokens: LoginOk = { accessToken: 'jwt' };
const challenge: LoginOk = { mfaRequired: true, challenge: 'c' };

// Decimais viajam como string (sem perder precisão); datas como string ISO
type Offer = components['schemas']['PackageOffer'];
const offer: Offer = { id: 'x', name: 'Pacote', hours: '10.00', price: '5000.00', currency: 'AOA', validityDays: null, active: true };

// Erros: um único formato
type ApiError = components['schemas']['Error'];
const error: ApiError = { error: { code: 'MFA_REQUIRED', message: 'm' } };

// Parâmetros de query tipados
type ListQuery = NonNullable<paths['/api/v1/bookings/sessions']['get']['parameters']['query']>;
const query: ListQuery = { subject: 'Matemática', page: 1, limit: 20 };

// Campos que nunca devem existir nos tipos públicos
// @ts-expect-error o catálogo público não expõe o email do tutor
type NoEmail = components['schemas']['PublicTutor']['user']['email'];

export type { NoEmail };
export const _typed = { tokens, challenge, offer, error, query };
