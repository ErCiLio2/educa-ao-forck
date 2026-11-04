import { env } from '../../../shared/core/env';
import prisma from '../../../shared/core/database';
import { getContent } from './content';
import type { NotifTypeValue } from '../notifications.types';

export const SMS_CHANNEL = 'SMS' as const;

// Stub: interface completa, pronta para integrar com qualquer provider (Vonage, Twilio, etc.)
// quando a decisão de gateway for tomada (ponto em aberto, docs/ §11).
export function isSmsConfigured(): boolean {
  return false; // activar quando SMS_PROVIDER_URL for definida
}

export async function sendSms(userId: string, type: NotifTypeValue, data: Record<string, unknown>): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true, name: true } });
  if (!user?.phoneNumber) return;

  const { title, body } = getContent(type, data);
  // Registar a intenção — substituir pelo envio real quando o provider estiver configurado
  console.log(`[SMS:stub] para ${user.phoneNumber} — ${title}: ${body}`);
  void env; // referência explícita para o futuro SMS_PROVIDER_URL
}
