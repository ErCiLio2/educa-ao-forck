import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { adminSession, app, bearer, body, del, get, patch, post, registerUser } from './helpers';

// RF-NOT-01: preferências por canal/tipo; RF-NOT-02: tokens push; RF-NOT-03: admin controla canais.

beforeAll(() => app.ready());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

const PREF_URL = '/api/v1/notifications/preferences';
const TOKEN_URL = '/api/v1/notifications/push/tokens';
const CHANNELS_URL = '/api/v1/notifications/admin/channels';

describe('chave VAPID pública', () => {
  it('retorna null quando VAPID não está configurado', async () => {
    const res = await get('/api/v1/notifications/vapid');
    expect(res.statusCode).toBe(200);
    expect(body(res).publicKey).toBeNull();
  });
});

describe('preferências de notificação', () => {
  it('401 sem autenticação', async () => {
    expect((await get(PREF_URL)).statusCode).toBe(401);
    expect((await patch(PREF_URL, { updates: [] })).statusCode).toBe(401);
  });

  it('devolve lista vazia por defeito (opted-in implícito)', async () => {
    const u = await registerUser('STUDENT');
    const res = await get(PREF_URL, bearer(u.token));
    expect(res.statusCode).toBe(200);
    expect(body(res).preferences).toEqual([]);
  });

  it('actualiza preferências e as devolve correctamente', async () => {
    const u = await registerUser('TUTOR');
    const updates = [
      { channel: 'EMAIL', type: 'BOOKING_ENROLLED', enabled: false },
      { channel: 'PUSH',  type: 'CONTENT_READY',    enabled: false },
    ];
    const put = await patch(PREF_URL, { updates }, bearer(u.token));
    expect(put.statusCode).toBe(200);
    const prefs = body(put).preferences as Array<{ channel: string; type: string; enabled: boolean }>;
    expect(prefs).toHaveLength(2);
    expect(prefs.find((p) => p.channel === 'EMAIL' && p.type === 'BOOKING_ENROLLED')?.enabled).toBe(false);
    expect(prefs.find((p) => p.channel === 'PUSH'  && p.type === 'CONTENT_READY'   )?.enabled).toBe(false);
  });

  it('reenvia o mesmo update e idempotente', async () => {
    const u = await registerUser('GUARDIAN');
    const update = { updates: [{ channel: 'EMAIL', type: 'PAYMENT_CONFIRMED', enabled: false }] };
    await patch(PREF_URL, update, bearer(u.token));
    const res = await patch(PREF_URL, update, bearer(u.token));
    expect(res.statusCode).toBe(200);
    const db = await prisma.notificationPreference.count({ where: { userId: { not: '' } } });
    expect(db).toBeGreaterThan(0);
  });

  it('422 se lista de updates estiver vazia', async () => {
    const u = await registerUser('STUDENT', 'pref-val');
    expect((await patch(PREF_URL, { updates: [] }, bearer(u.token))).statusCode).toBe(422);
  });

  it('qualquer perfil pode gerir as suas preferências', async () => {
    const roles = ['STUDENT', 'GUARDIAN', 'TUTOR'] as const;
    for (const role of roles) {
      const u = await registerUser(role, `pref-${role.toLowerCase()}`);
      const res = await get(PREF_URL, bearer(u.token));
      expect(res.statusCode, `${role} deve aceder a preferências`).toBe(200);
    }
  });
});

describe('tokens push', () => {
  it('401 sem autenticação', async () => {
    const dummyToken = 'token-sem-auth';
    expect((await post(TOKEN_URL, { token: dummyToken, platform: 'web', endpoint: 'https://example.com/push', p256dh: null, auth: null })).statusCode).toBe(401);
    expect((await del(`${TOKEN_URL}/${dummyToken}`))).toMatchObject({ statusCode: 401 });
  });

  it('regista e remove token Web Push (VAPID)', async () => {
    const u = await registerUser('STUDENT', 'push-web');
    const token = `web-push-token-${Date.now()}`;
    const register = await post(TOKEN_URL, {
      token,
      platform: 'web',
      endpoint: 'https://fcm.googleapis.com/test-endpoint',
      p256dh: 'BNcde1234567890abcdef',
      auth:   'authsecret123',
    }, bearer(u.token));
    expect(register.statusCode).toBe(201);
    expect(body(register).ok).toBe(true);

    const inDb = await prisma.pushToken.findUnique({ where: { token } });
    expect(inDb).not.toBeNull();
    expect(inDb?.platform).toBe('web');

    const remove = await del(`${TOKEN_URL}/${token}`, bearer(u.token));
    expect(remove.statusCode).toBe(204);
    expect(await prisma.pushToken.findUnique({ where: { token } })).toBeNull();
  });

  it('regista token FCM (sem p256dh)', async () => {
    const u = await registerUser('STUDENT', 'push-fcm');
    const token = `fcm-token-${Date.now()}`;
    const register = await post(TOKEN_URL, {
      token,
      platform: 'android',
      endpoint: 'fcm',
      p256dh: null,
      auth: null,
    }, bearer(u.token));
    expect(register.statusCode).toBe(201);
    await prisma.pushToken.deleteMany({ where: { token } });
  });

  it('registar o mesmo token duas vezes é idempotente (upsert)', async () => {
    const u = await registerUser('TUTOR', 'push-upsert');
    const token = `upsert-token-${Date.now()}`;
    const payload = { token, platform: 'ios', endpoint: 'fcm', p256dh: null, auth: null };
    await post(TOKEN_URL, payload, bearer(u.token));
    const res2 = await post(TOKEN_URL, payload, bearer(u.token));
    expect(res2.statusCode).toBe(201);
    const count = await prisma.pushToken.count({ where: { token } });
    expect(count).toBe(1);
    await prisma.pushToken.deleteMany({ where: { token } });
  });

  it('404 ao remover token de outro utilizador', async () => {
    const u1 = await registerUser('STUDENT', 'push-owner');
    const u2 = await registerUser('STUDENT', 'push-thief');
    const token = `owned-token-${Date.now()}`;
    await post(TOKEN_URL, { token, platform: 'web', endpoint: 'https://example.com', p256dh: null, auth: null }, bearer(u1.token));
    const res = await del(`${TOKEN_URL}/${token}`, bearer(u2.token));
    expect(res.statusCode).toBe(404);
    await prisma.pushToken.deleteMany({ where: { token } });
  });
});

describe('admin — gestão de canais', () => {
  it('401/403 sem autenticação ou sem ser admin', async () => {
    expect((await get(CHANNELS_URL)).statusCode).toBe(401);
    const tutor = await registerUser('TUTOR', 'ch-tutor');
    expect((await get(CHANNELS_URL, bearer(tutor.token))).statusCode).toBe(403);
  });

  it('lista todos os canais', async () => {
    const admin = await adminSession('ch-list');
    const res = await get(CHANNELS_URL, admin.headers);
    expect(res.statusCode).toBe(200);
    const channels = body(res).channels as Array<{ channel: string; enabled: boolean; configured: boolean }>;
    expect(channels.length).toBeGreaterThanOrEqual(3);
    expect(channels.every((c) => typeof c.channel === 'string' && typeof c.enabled === 'boolean')).toBe(true);
  });

  it('desactiva e reactiva um canal', async () => {
    const admin = await adminSession('ch-toggle');

    const disable = await patch(`${CHANNELS_URL}/EMAIL`, { enabled: false }, admin.headers);
    expect(disable.statusCode).toBe(200);
    expect(body(disable).enabled).toBe(false);

    const enable = await patch(`${CHANNELS_URL}/EMAIL`, { enabled: true }, admin.headers);
    expect(enable.statusCode).toBe(200);
    expect(body(enable).enabled).toBe(true);

    // verificar persistência na BD
    const db = await prisma.channelConfig.findUnique({ where: { channel: 'EMAIL' } });
    expect(db?.enabled).toBe(true);
  });

  it('422 para canal com valor fora do enum', async () => {
    const admin = await adminSession('ch-422b');
    const res = await patch(`${CHANNELS_URL}/CARRIER_PIGEON`, { enabled: false }, admin.headers);
    expect(res.statusCode).toBe(422);
  });

  it('422 se enabled não for boolean', async () => {
    const admin = await adminSession('ch-422');
    const res = await patch(`${CHANNELS_URL}/PUSH`, { enabled: 'yes' }, admin.headers);
    expect(res.statusCode).toBe(422);
  });
});
