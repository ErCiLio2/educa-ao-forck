import { DeliveryChannel, NotifType } from '@prisma/client';
import prisma from '../../shared/core/database';
import { notificationQueue } from '../../shared/core/queue';
import { on } from '../../shared/core/events';
import { NotFoundError } from '../../shared/core/errors';
import { env } from '../../shared/core/env';
import { emitToUser } from '../../shared/core/socket';
import { getContent } from './channels/content';
import { CHANNEL_ADAPTERS, ADAPTER_MAP } from './channels/index';
import type { DeliveryChannelValue, NotifTypeValue, RegisterPushTokenDto, UpdatePreferencesDto } from './notifications.types';

// ── Enqueue ───────────────────────────────────────────────────────────────────

export async function enqueue(userId: string, type: NotifTypeValue, data: Record<string, unknown>): Promise<void> {
  await notificationQueue.add('notify', { userId, type, data });
}

// ── Dispatch (chamado pelo worker) ────────────────────────────────────────────

export async function dispatch(userId: string, type: NotifTypeValue, data: Record<string, unknown>): Promise<void> {
  const [configs, prefs] = await Promise.all([
    prisma.channelConfig.findMany(),
    prisma.notificationPreference.findMany({ where: { userId, type: type as NotifType } }),
  ]);

  const prefMap = new Map(prefs.map((p) => [p.channel, p.enabled]));
  const enabledGlobally = new Set(configs.filter((c) => c.enabled).map((c) => c.channel));

  for (const adapter of CHANNEL_ADAPTERS) {
    const ch = adapter.channel as DeliveryChannelValue;
    if (!enabledGlobally.has(ch as DeliveryChannel)) continue;
    const userPref = prefMap.get(ch as DeliveryChannel);
    if (userPref === false) continue; // opt-out explícito; ausência = enabled
    if (!adapter.isConfigured()) continue;

    try {
      await adapter.send(userId, type, data);
    } catch (err) {
      console.error(`[Notifications] canal ${ch} falhou para ${userId}/${type}:`, (err as Error).message);
    }
  }

  // Tempo real: emite independentemente das preferências/canais configurados
  const { title, body } = getContent(type, data);
  emitToUser(userId, 'notification', { type, title, body, data });
}

// ── Preferências do utilizador ────────────────────────────────────────────────

export async function getPreferences(userId: string) {
  const prefs = await prisma.notificationPreference.findMany({ where: { userId } });
  return prefs.map((p) => ({ channel: p.channel, type: p.type, enabled: p.enabled }));
}

export async function updatePreferences(userId: string, dto: UpdatePreferencesDto) {
  await prisma.$transaction(
    dto.updates.map(({ channel, type, enabled }) =>
      prisma.notificationPreference.upsert({
        where: { userId_channel_type: { userId, channel: channel as DeliveryChannel, type: type as NotifType } },
        create: { userId, channel: channel as DeliveryChannel, type: type as NotifType, enabled },
        update: { enabled },
      }),
    ),
  );
  return getPreferences(userId);
}

// ── Tokens de push ────────────────────────────────────────────────────────────

export async function registerPushToken(userId: string, dto: RegisterPushTokenDto) {
  await prisma.pushToken.upsert({
    where: { token: dto.token },
    create: { userId, token: dto.token, platform: dto.platform, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth },
    update: { userId, platform: dto.platform, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth },
  });
}

export async function unregisterPushToken(userId: string, token: string) {
  const existing = await prisma.pushToken.findUnique({ where: { token }, select: { userId: true } });
  if (!existing || existing.userId !== userId) throw new NotFoundError('Token não encontrado');
  await prisma.pushToken.delete({ where: { token } });
}

export function getVapidPublicKey(): string | undefined {
  return env.VAPID_PUBLIC_KEY;
}

// ── Canais (Admin) ────────────────────────────────────────────────────────────

export async function getChannelConfigs() {
  const configs = await prisma.channelConfig.findMany();
  const configMap = new Map(configs.map((c) => [c.channel, c.enabled]));
  return CHANNEL_ADAPTERS.map((a) => ({
    channel: a.channel,
    enabled: configMap.get(a.channel as DeliveryChannel) ?? true,
    configured: a.isConfigured(),
  }));
}

export async function setChannelEnabled(channel: DeliveryChannelValue, enabled: boolean) {
  const updated = await prisma.channelConfig.update({
    where: { channel: channel as DeliveryChannel },
    data: { enabled },
  });
  const adapter = ADAPTER_MAP.get(channel);
  return { channel: updated.channel, enabled: updated.enabled, configured: adapter?.isConfigured() ?? false };
}

// ── Ligação dos eventos do domínio à fila ─────────────────────────────────────
// Registar uma vez no arranque do servidor (não em testes).

export function registerNotificationEventHandlers(): void {
  on('payment.confirmed', (p) => enqueue(p.userId, 'PAYMENT_CONFIRMED', { amount: p.amount, currency: p.currency, hours: p.hours }));
  on('payment.failed',    (p) => enqueue(p.userId, 'PAYMENT_FAILED',    { amount: p.amount, currency: p.currency }));
  on('booking.enrolled',  (p) => enqueue(p.studentId, 'BOOKING_ENROLLED', { sessionId: p.sessionId, scheduledAt: p.scheduledAt }));
  on('booking.enrollment_cancelled', (p) => enqueue(p.studentId, 'BOOKING_ENROLLMENT_CANCELLED', { sessionId: p.sessionId }));
  on('tutor.status_changed', (p) => enqueue(p.userId, p.status === 'APPROVED' ? 'TUTOR_APPROVED' : 'TUTOR_REJECTED', { reason: p.reason }));
  on('role_change.decided', (p) => enqueue(p.targetId, p.approved ? 'ROLE_CHANGE_APPROVED' : 'ROLE_CHANGE_REJECTED', { toRole: p.toRole }));
  on('content.ready', (p) => enqueue(p.tutorUserId, 'CONTENT_READY', { contentId: p.contentId, title: p.title }));
}
