import type { DeliveryChannelValue, NotifTypeValue } from '../notifications.types';
import { EMAIL_CHANNEL, isEmailConfigured, sendEmail } from './email.channel';
import { PUSH_CHANNEL, isPushConfigured, sendPush } from './push.channel';
import { SMS_CHANNEL, isSmsConfigured, sendSms } from './sms.channel';

export type ChannelAdapter = {
  channel: DeliveryChannelValue;
  isConfigured: () => boolean;
  send: (userId: string, type: NotifTypeValue, data: Record<string, unknown>) => Promise<void>;
};

export const CHANNEL_ADAPTERS: ChannelAdapter[] = [
  { channel: EMAIL_CHANNEL, isConfigured: isEmailConfigured, send: sendEmail },
  { channel: PUSH_CHANNEL,  isConfigured: isPushConfigured,  send: sendPush  },
  { channel: SMS_CHANNEL,   isConfigured: isSmsConfigured,   send: sendSms   },
];

export const ADAPTER_MAP = new Map<DeliveryChannelValue, ChannelAdapter>(
  CHANNEL_ADAPTERS.map((a) => [a.channel, a]),
);
