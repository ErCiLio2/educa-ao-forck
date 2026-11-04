import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { env } from '../src/shared/core/env';
import { SANDBOX_SIGNATURE_HEADER, signSandboxPayload } from '../src/modules/payments/gateways/sandbox.gateway';

// Simula o aviso do gateway sandbox (enquanto não há gateway real).
// Uso: pnpm --filter educa-api payments:simulate <referência> [PAID|FAILED|REFUNDED] [URL_DA_API]
async function main() {
  const [reference, status = 'PAID', apiUrl = `http://localhost:${env.PORT}`] = process.argv.slice(2);
  if (!reference) {
    console.error('Uso: payments:simulate <referência> [PAID|FAILED|REFUNDED] [URL_DA_API]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const payment = await prisma.paymentTransaction.findFirst({ where: { gateway: 'sandbox', reference } });
  await prisma.$disconnect();
  if (!payment) {
    console.error(`Referência ${reference} não encontrada`);
    process.exit(1);
  }

  const raw = JSON.stringify({
    eventId: `sim-${randomUUID()}`,
    reference,
    status,
    amount: payment.amount.toFixed(2),
    currency: payment.currency,
    timestamp: Date.now(),
  });
  const res = await fetch(`${apiUrl}/api/v1/payments/webhooks/sandbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(raw, env.SANDBOX_WEBHOOK_SECRET!) },
    body: raw,
  });
  console.log(res.status, await res.text());
}

main();
