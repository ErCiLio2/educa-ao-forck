import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  ACCESS_TOKEN_SECRET: z.string().min(32, 'mínimo 32 caracteres'),
  REFRESH_TOKEN_SECRET: z.string().min(32, 'mínimo 32 caracteres'),
  ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRY_SECONDS: z.coerce.number().int().positive().default(604800),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Gateway de pagamento por referência. O gateway real ainda não está decidido (Proxypay, PayPay
  // ou Kwanza Online): 'sandbox' é o simulador local e é proibido em produção.
  PAYMENT_GATEWAY: z.string().default('sandbox'),
  // Chave AES-256 (64 hex) que cifra os segredos TOTP em repouso. Em produção: serviço de segredos.
  MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, '64 caracteres hexadecimais (openssl rand -hex 32)'),
  PAYMENT_REFERENCE_TTL_HOURS: z.coerce.number().int().positive().default(72),
  // ── Gateways de pagamento: cada gateway tem o seu próprio bloco de credenciais ──
  // Sandbox (simulador local, só fora de produção)
  SANDBOX_WEBHOOK_SECRET: z.string().min(32, 'mínimo 32 caracteres').optional(),
  // Proxypay (quando integrado, activar: PAYMENT_GATEWAY=proxypay)
  PROXYPAY_API_URL: z.string().url().optional(),
  PROXYPAY_API_KEY: z.string().optional(),
  PROXYPAY_WEBHOOK_SECRET: z.string().min(32).optional(),
  // PayPay / Kwanza Online — blocos análogos ao Proxypay quando for decidido
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // ── Email (nodemailer) ───────────────────────────────────────────────────────
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default('noreply@educa.ao'),
  // ── Push: Web Push VAPID ─────────────────────────────────────────────────────
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:noreply@educa.ao'),
  // ── Push: FCM HTTP v1 (sem SDK firebase-admin) ────────────────────────────────
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // ── Videoconferência (LiveKit) ────────────────────────────────────────────────
  LIVEKIT_URL: z.string().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().default('educa_livekit'),
  LIVEKIT_API_SECRET: z.string().min(32).default('educa_livekit_secret_dev_minimum32x'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[Env] variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  [parsed.data.ACCESS_TOKEN_SECRET, parsed.data.REFRESH_TOKEN_SECRET].some((s) =>
    s.startsWith('CHANGE_ME'),
  )
) {
  console.error('[Env] segredos JWT placeholder não são permitidos em produção');
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.PAYMENT_GATEWAY === 'sandbox') {
  console.error('[Env] PAYMENT_GATEWAY=sandbox não é permitido em produção');
  process.exit(1);
}

// Verificar que o gateway activo tem as credenciais necessárias
const gw = parsed.data.PAYMENT_GATEWAY;
if (gw === 'sandbox' && !parsed.data.SANDBOX_WEBHOOK_SECRET) {
  console.error('[Env] SANDBOX_WEBHOOK_SECRET é obrigatório quando PAYMENT_GATEWAY=sandbox');
  process.exit(1);
}
if (gw === 'proxypay' && (!parsed.data.PROXYPAY_API_URL || !parsed.data.PROXYPAY_API_KEY || !parsed.data.PROXYPAY_WEBHOOK_SECRET)) {
  console.error('[Env] PROXYPAY_API_URL, PROXYPAY_API_KEY e PROXYPAY_WEBHOOK_SECRET são obrigatórios quando PAYMENT_GATEWAY=proxypay');
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.LIVEKIT_API_SECRET === 'educa_livekit_secret_dev_minimum32x') {
  console.error('[Env] LIVEKIT_API_SECRET padrão não é permitido em produção');
  process.exit(1);
}

if (parsed.data.ACCESS_TOKEN_SECRET === parsed.data.REFRESH_TOKEN_SECRET) {
  console.error('[Env] ACCESS_TOKEN_SECRET e REFRESH_TOKEN_SECRET devem ser diferentes');
  process.exit(1);
}

export const env = parsed.data;
