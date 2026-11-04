import { env } from '../../../shared/core/env';
import type { PaymentGateway } from './gateway';
import { SandboxGateway } from './sandbox.gateway';
// import { ProxypayGateway } from './proxypay.gateway';

// ── Registo de gateways ───────────────────────────────────────────────────────
// Cada gateway só é instanciado quando as suas credenciais estão presentes.
// Para adicionar um novo gateway:
//   1. Criar apps/api/src/modules/payments/gateways/<nome>.gateway.ts
//      implementando a interface PaymentGateway (ver gateway.ts e proxypay.gateway.ts)
//   2. Adicionar as variáveis de ambiente em env.ts (bloco "Gateways de pagamento")
//   3. Descomentar o import e o bloco de registo abaixo
//   4. Definir PAYMENT_GATEWAY=<nome> e as credenciais no .env de produção

const registry: Record<string, PaymentGateway> = {};

// Sandbox — simulador local (proibido em produção, validado em env.ts)
if (env.NODE_ENV !== 'production' && env.SANDBOX_WEBHOOK_SECRET) {
  registry.sandbox = new SandboxGateway(env.SANDBOX_WEBHOOK_SECRET);
}

// Proxypay (descomentar quando integrado)
// if (env.PROXYPAY_API_URL && env.PROXYPAY_API_KEY && env.PROXYPAY_WEBHOOK_SECRET) {
//   registry.proxypay = new ProxypayGateway(
//     env.PROXYPAY_API_URL,
//     env.PROXYPAY_API_KEY,
//     env.PROXYPAY_WEBHOOK_SECRET,
//   );
// }

export function getGateway(name: string): PaymentGateway | undefined {
  return Object.hasOwn(registry, name) ? registry[name] : undefined;
}

export function activeGateway(): PaymentGateway {
  const gateway = getGateway(env.PAYMENT_GATEWAY);
  if (!gateway) throw new Error(`PAYMENT_GATEWAY desconhecido ou sem credenciais: ${env.PAYMENT_GATEWAY}`);
  return gateway;
}
