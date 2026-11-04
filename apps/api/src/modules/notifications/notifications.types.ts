import { z } from 'zod';

export const DELIVERY_CHANNELS = ['EMAIL', 'PUSH', 'SMS'] as const;
export const NOTIF_TYPES = [
  'PAYMENT_CONFIRMED', 'PAYMENT_FAILED',
  'BOOKING_ENROLLED', 'BOOKING_ENROLLMENT_CANCELLED',
  'TUTOR_APPROVED', 'TUTOR_REJECTED',
  'ROLE_CHANGE_APPROVED', 'ROLE_CHANGE_REJECTED',
  'CONTENT_READY',
] as const;

export type DeliveryChannelValue = (typeof DELIVERY_CHANNELS)[number];
export type NotifTypeValue = (typeof NOTIF_TYPES)[number];

export const UpdatePreferencesSchema = z.object({
  updates: z.array(
    z.object({
      channel: z.enum(DELIVERY_CHANNELS),
      type: z.enum(NOTIF_TYPES),
      enabled: z.boolean(),
    }),
  ).min(1).max(100),
});

export const RegisterPushTokenSchema = z.object({
  token:    z.string().min(1).max(512),
  platform: z.enum(['android', 'ios', 'web']),
  endpoint: z.string().min(1).max(2048),
  p256dh:   z.string().nullish(),
  auth:     z.string().nullish(),
});

export const SetChannelEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const ChannelParamSchema = z.object({
  channel: z.enum(DELIVERY_CHANNELS),
});

export type UpdatePreferencesDto = z.infer<typeof UpdatePreferencesSchema>;
export type RegisterPushTokenDto = z.infer<typeof RegisterPushTokenSchema>;
export type SetChannelEnabledDto = z.infer<typeof SetChannelEnabledSchema>;
