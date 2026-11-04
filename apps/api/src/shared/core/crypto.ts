import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { env } from './env';

// Cifragem ao nível da aplicação (RNF-SEG-03). AES-256-GCM: confidencialidade + integridade.
// A chave vem do ambiente (em produção, de um serviço de segredos) e nunca fica na BD.
const KEY = Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex');
const VERSION = 'v1';

// `context` (ex.: o id do utilizador) entra como AAD: um valor cifrado para um utilizador não decifra noutro,
// mesmo que alguém copie o campo entre linhas da BD.
export function encrypt(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string, context: string): string {
  const [version, iv, tag, ct] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('Formato cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// HMAC com chave do servidor: serve para guardar códigos de recuperação sem os poder recuperar,
// e (ao contrário de um SHA-256 simples) uma BD roubada não permite testar códigos offline
export function hmac(value: string): string {
  return createHmac('sha256', KEY).update(value).digest('hex');
}
