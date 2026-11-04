import type { FastifyRequest, FastifyReply } from 'fastify';
import { parse } from '../../shared/core/validate';
import {
  UpdatePreferencesSchema,
  RegisterPushTokenSchema,
  SetChannelEnabledSchema,
  ChannelParamSchema,
} from './notifications.types';
import * as service from './notifications.service';

export async function getVapidKey(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ publicKey: service.getVapidPublicKey() ?? null });
}

export async function getPreferences(req: FastifyRequest, reply: FastifyReply) {
  const prefs = await service.getPreferences(req.user!.id);
  return reply.send({ preferences: prefs });
}

export async function updatePreferences(req: FastifyRequest, reply: FastifyReply) {
  const dto = parse(UpdatePreferencesSchema, req.body);
  const prefs = await service.updatePreferences(req.user!.id, dto);
  return reply.send({ preferences: prefs });
}

export async function registerToken(req: FastifyRequest, reply: FastifyReply) {
  const dto = parse(RegisterPushTokenSchema, req.body);
  await service.registerPushToken(req.user!.id, dto);
  return reply.status(201).send({ ok: true });
}

export async function unregisterToken(req: FastifyRequest, reply: FastifyReply) {
  const { token } = req.params as { token: string };
  await service.unregisterPushToken(req.user!.id, token);
  return reply.status(204).send();
}

export async function adminGetChannels(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ channels: await service.getChannelConfigs() });
}

export async function adminSetChannel(req: FastifyRequest, reply: FastifyReply) {
  const { channel } = parse(ChannelParamSchema, req.params);
  const { enabled } = parse(SetChannelEnabledSchema, req.body);
  const result = await service.setChannelEnabled(channel, enabled);
  return reply.send(result);
}
