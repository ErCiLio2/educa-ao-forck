import { z } from 'zod';
import { docs, errorResponses, NoContent, obj } from '../../shared/core/openapi';
import { DELIVERY_CHANNELS, NOTIF_TYPES } from './notifications.types';

const PrefItem = obj({
  channel: z.enum(DELIVERY_CHANNELS),
  type: z.enum(NOTIF_TYPES),
  enabled: z.boolean(),
});

const ChannelStatus = obj({
  channel: z.enum(DELIVERY_CHANNELS),
  enabled: z.boolean(),
  configured: z.boolean(),
});

export const notifDocs = {
  vapidKey: docs({
    tags: ['Notificações'],
    operationId: 'getVapidPublicKey',
    summary: 'Chave pública VAPID para Web Push',
    security: 'none',
    response: { 200: obj({ publicKey: z.string().nullable() }) },
  }),

  getPreferences: docs({
    tags: ['Notificações'],
    operationId: 'getNotificationPreferences',
    summary: 'Preferências de notificação do utilizador',
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'],
    response: { 200: obj({ preferences: z.array(PrefItem) }), ...errorResponses(401, 403) },
  }),

  updatePreferences: docs({
    tags: ['Notificações'],
    operationId: 'updateNotificationPreferences',
    summary: 'Actualizar preferências de notificação',
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'],
    body: obj({
      updates: z.array(obj({ channel: z.enum(DELIVERY_CHANNELS), type: z.enum(NOTIF_TYPES), enabled: z.boolean() })).min(1).max(100),
    }),
    response: { 200: obj({ preferences: z.array(PrefItem) }), ...errorResponses(401, 403, 422) },
  }),

  registerToken: docs({
    tags: ['Notificações'],
    operationId: 'registerPushToken',
    summary: 'Registar token de push',
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'],
    body: obj({
      token:    z.string(),
      platform: z.enum(['android', 'ios', 'web']),
      endpoint: z.string(),
      p256dh:   z.string().nullish(),
      auth:     z.string().nullish(),
    }),
    response: { 201: obj({ ok: z.literal(true) }), ...errorResponses(401, 403, 422) },
  }),

  unregisterToken: docs({
    tags: ['Notificações'],
    operationId: 'unregisterPushToken',
    summary: 'Remover token de push',
    roles: ['STUDENT', 'GUARDIAN', 'TUTOR', 'ADMIN'],
    params: z.object({ token: z.string() }),
    response: { 204: NoContent, ...errorResponses(401, 403, 404) },
  }),

  adminGetChannels: docs({
    tags: ['Notificações'],
    operationId: 'adminGetNotificationChannels',
    summary: 'Listar canais e estado (Admin)',
    roles: ['ADMIN'],
    mfa: 'session',
    response: { 200: obj({ channels: z.array(ChannelStatus) }), ...errorResponses(401, 403) },
  }),

  adminSetChannel: docs({
    tags: ['Notificações'],
    operationId: 'adminSetNotificationChannel',
    summary: 'Activar ou desactivar canal (Admin)',
    roles: ['ADMIN'],
    mfa: 'session',
    params: z.object({ channel: z.enum(DELIVERY_CHANNELS) }),
    body: obj({ enabled: z.boolean() }),
    response: { 200: ChannelStatus, ...errorResponses(401, 403, 404, 422) },
  }),
};
