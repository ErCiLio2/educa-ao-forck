import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { initSocket, io as socketIo } from '../../src/shared/core/socket';
import { dispatch } from '../../src/modules/notifications/notifications.service';
import { buildApp } from '../../src/app';
import { body, PASSWORD, post, registerUser } from './helpers';

const userId = (token: string) => (jwt.decode(token) as { sub: string }).sub;

// Estes testes precisam de um servidor HTTP real (WebSocket upgrade).
// Usam a sua própria instância de Fastify — isolada da instância partilhada em helpers.ts.
const app = buildApp();
let port: number;

async function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(`http://localhost:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      timeout: 5000,
    });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

// Após o connect(), espera que o servidor confirme que o utilizador entrou na sua room.
// O Redis adapter torna o join assíncrono, por isso precisamos desta garantia.
async function connectAndReady(token: string): Promise<Socket> {
  const s = await connect(token);
  await new Promise<void>((resolve) => {
    s.once('ready', resolve);
    setTimeout(resolve, 500); // fallback: 500 ms para o join completar via Redis
  });
  return s;
}

beforeAll(async () => {
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;
  initSocket(app);
});

afterAll(async () => {
  await socketIo?.close();
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
}, 60_000);

describe('autenticação socket', () => {
  it('recusa ligação sem token', async () => {
    await expect(connect('')).rejects.toThrow();
  });

  it('recusa ligação com token inválido', async () => {
    await expect(connect('token-inventado')).rejects.toThrow();
  });

  it('aceita ligação com access token válido', async () => {
    const u = await registerUser('STUDENT', 'rt-auth');
    const s = await connect(u.token);
    expect(s.connected).toBe(true);
    s.disconnect();
  });
});

describe('entrega de notificações em tempo real', () => {
  it('recebe evento `notification` quando dispatch() é chamado', async () => {
    const u = await registerUser('STUDENT', 'rt-notif');
    const s = await connectAndReady(u.token);

    const received = new Promise<{ type: string }>((resolve) => s.once('notification', resolve));
    await dispatch(userId(u.token), 'PAYMENT_CONFIRMED', { amount: '500.00', currency: 'AOA', hours: 5 });

    const event = await Promise.race([received, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    expect(event, 'evento não chegou ao socket').not.toBeNull();
    expect((event as { type: string }).type).toBe('PAYMENT_CONFIRMED');

    s.disconnect();
  });

  it('utilizador offline não bloqueia o dispatch', async () => {
    const u = await registerUser('TUTOR', 'rt-offline');
    await expect(dispatch(userId(u.token), 'TUTOR_APPROVED', {})).resolves.not.toThrow();
  });

  it('dois dispositivos do mesmo utilizador recebem ambos a notificação', async () => {
    const u = await registerUser('STUDENT', 'rt-multi');
    const login2 = await post('/api/v1/auth/login', { email: u.email, password: PASSWORD });
    const token2 = body(login2).accessToken as string;

    const s1 = await connectAndReady(u.token);
    const s2 = await connectAndReady(token2);

    const p1 = new Promise<unknown>((r) => s1.once('notification', r));
    const p2 = new Promise<unknown>((r) => s2.once('notification', r));

    await dispatch(userId(u.token), 'BOOKING_ENROLLED', { sessionId: 'abc', scheduledAt: new Date().toISOString() });

    const [e1, e2] = await Promise.all([
      Promise.race([p1, new Promise<null>((r) => setTimeout(() => r(null), 4000))]),
      Promise.race([p2, new Promise<null>((r) => setTimeout(() => r(null), 4000))]),
    ]);

    expect(e1, 'socket 1 não recebeu notificação').not.toBeNull();
    expect(e2, 'socket 2 não recebeu notificação').not.toBeNull();

    s1.disconnect();
    s2.disconnect();
  });
});
