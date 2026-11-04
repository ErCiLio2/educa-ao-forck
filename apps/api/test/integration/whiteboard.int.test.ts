// RF-AUL-06 — Whiteboard colaborativo em tempo real via WebSocket
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma from '../../src/shared/core/database';
import redis from '../../src/shared/core/redis';
import { initSocket, io as socketIo } from '../../src/shared/core/socket';
import { buildApp } from '../../src/app';
import { adminSession, app as sharedApp, bearer, body, registerUser } from './helpers';

// ─── Instância própria com servidor HTTP real (WebSocket precisa de upgrade) ──
const app = buildApp();
let port: number;

const idOf = (token: string) => (jwt.decode(token) as { sub: string }).sub;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

// ─── Helpers de Socket.io ─────────────────────────────────────────────────────

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

async function connectAndReady(token: string): Promise<Socket> {
  const s = await connect(token);
  await new Promise<void>((resolve) => {
    s.once('ready', resolve);
    setTimeout(resolve, 500);
  });
  return s;
}

// Emite evento com acknowledge e devolve a resposta do servidor
function emit<T>(socket: Socket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, data, resolve));
}

// Espera um evento com timeout; devolve null se expirar
function waitFor<T>(socket: Socket, event: string, ms = 2000): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ─── Helpers de domínio ───────────────────────────────────────────────────────

async function approvedTutor() {
  const t = await registerUser('TUTOR', 'wb-tutor');
  // sharedApp é a instância de injecção HTTP — usamos para HTTP, não para WebSocket
  await sharedApp.inject({ method: 'POST', url: '/api/v1/tutors/profile', payload: { subjects: ['Física'] }, headers: bearer(t.token) });
  const profileId = body(await sharedApp.inject({ method: 'GET', url: '/api/v1/tutors/profile/me', headers: bearer(t.token) })).profile.id as string;
  const admin = await adminSession('wb-adm-approve');
  await sharedApp.inject({ method: 'PATCH', url: `/api/v1/tutors/${profileId}/status`, payload: { status: 'APPROVED' }, headers: admin.headers });
  return { ...t, profileId };
}

async function givePackage(userId: string, hours: number) {
  const payment = await prisma.paymentTransaction.create({
    data: { userId, gateway: 'teste', reference: randomUUID(), amount: 0, hours, status: 'CONFIRMED', idempotencyKey: randomUUID() },
  });
  return prisma.hourPackage.create({
    data: { userId, paymentId: payment.id, totalHours: hours, remainingHours: hours },
  });
}

async function createSession(tutorToken: string) {
  const res = await sharedApp.inject({
    method: 'POST', url: '/api/v1/bookings/sessions',
    payload: { title: 'Aula WB', subject: 'Física', type: 'GROUP', scheduledAt: inDays(1), durationMin: 60 },
    headers: bearer(tutorToken),
  });
  return body(res).session as { id: string };
}

async function enrollStudent(studentToken: string, sessionId: string) {
  await sharedApp.inject({ method: 'POST', url: `/api/v1/bookings/sessions/${sessionId}/enroll`, headers: bearer(studentToken) });
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

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

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('session:join — controlo de acesso', () => {
  it('tutor da sessão entra com access=tutor', async () => {
    const t = await approvedTutor();
    const session = await createSession(t.token);

    const s = await connectAndReady(t.token);
    const res = await emit<{ ok?: boolean; access?: string; error?: string }>(s, 'session:join', { sessionId: session.id });

    expect(res.ok).toBe(true);
    expect(res.access).toBe('tutor');
    s.disconnect();
  });

  it('aluno inscrito entra com access=student', async () => {
    const t = await approvedTutor();
    const session = await createSession(t.token);

    const st = await registerUser('STUDENT', 'wb-st-ok');
    await givePackage(idOf(st.token), 5);
    await enrollStudent(st.token, session.id);

    const s = await connectAndReady(st.token);
    const res = await emit<{ ok?: boolean; access?: string; error?: string }>(s, 'session:join', { sessionId: session.id });

    expect(res.ok).toBe(true);
    expect(res.access).toBe('student');
    s.disconnect();
  });

  it('aluno não inscrito recebe FORBIDDEN', async () => {
    const t = await approvedTutor();
    const session = await createSession(t.token);

    const st = await registerUser('STUDENT', 'wb-st-no');
    const s = await connectAndReady(st.token);
    const res = await emit<{ ok?: boolean; error?: string }>(s, 'session:join', { sessionId: session.id });

    expect(res.error).toBe('FORBIDDEN');
    s.disconnect();
  });

  it('admin entra com access=admin', async () => {
    const t = await approvedTutor();
    const session = await createSession(t.token);

    const adm = await adminSession('wb-adm-join');
    const s = await connectAndReady(adm.token);
    const res = await emit<{ ok?: boolean; access?: string; error?: string }>(s, 'session:join', { sessionId: session.id });

    expect(res.ok).toBe(true);
    expect(res.access).toBe('admin');
    s.disconnect();
  });

  it('sessionId inválido (não-UUID) devolve INVALID_DATA', async () => {
    const t = await approvedTutor();
    const s = await connectAndReady(t.token);
    const res = await emit<{ error?: string }>(s, 'session:join', { sessionId: 'nao-e-uuid' });

    expect(res.error).toBe('INVALID_DATA');
    s.disconnect();
  });
});

describe('relay de eventos whiteboard (RF-AUL-06)', () => {
  async function setup() {
    const t = await approvedTutor();
    const session = await createSession(t.token);
    const st = await registerUser('STUDENT', 'wb-relay-st');
    await givePackage(idOf(st.token), 5);
    await enrollStudent(st.token, session.id);
    return { tutorToken: t.token, studentToken: st.token, sessionId: session.id };
  }

  it('wb:stroke é relayado para os outros participantes', async () => {
    const { tutorToken, studentToken, sessionId } = await setup();

    const tSock = await connectAndReady(tutorToken);
    const stSock = await connectAndReady(studentToken);

    await emit(tSock, 'session:join', { sessionId });
    await emit(stSock, 'session:join', { sessionId });

    const received = waitFor<{ userId: string; color: string }>(stSock, 'wb:stroke');
    tSock.emit('wb:stroke', { sessionId, points: [{ x: 10, y: 20 }], color: '#ff0000', width: 3 });

    const event = await received;
    expect(event).not.toBeNull();
    expect(event!.color).toBe('#ff0000');
    expect(event!.userId).toBe(idOf(tutorToken));

    tSock.disconnect();
    stSock.disconnect();
  });

  it('wb:clear é relayado para os outros participantes', async () => {
    const { tutorToken, studentToken, sessionId } = await setup();

    const tSock = await connectAndReady(tutorToken);
    const stSock = await connectAndReady(studentToken);

    await emit(tSock, 'session:join', { sessionId });
    await emit(stSock, 'session:join', { sessionId });

    const received = waitFor<{ userId: string }>(stSock, 'wb:clear');
    tSock.emit('wb:clear', { sessionId });

    const event = await received;
    expect(event).not.toBeNull();
    expect(event!.userId).toBe(idOf(tutorToken));

    tSock.disconnect();
    stSock.disconnect();
  });

  it('wb:cursor é relayado para os outros participantes', async () => {
    const { tutorToken, studentToken, sessionId } = await setup();

    const tSock = await connectAndReady(tutorToken);
    const stSock = await connectAndReady(studentToken);

    await emit(tSock, 'session:join', { sessionId });
    await emit(stSock, 'session:join', { sessionId });

    const received = waitFor<{ userId: string; x: number; y: number }>(tSock, 'wb:cursor');
    stSock.emit('wb:cursor', { sessionId, x: 100, y: 200 });

    const event = await received;
    expect(event).not.toBeNull();
    expect(event!.x).toBe(100);
    expect(event!.y).toBe(200);
    expect(event!.userId).toBe(idOf(studentToken));

    tSock.disconnect();
    stSock.disconnect();
  });

  it('wb:stroke ignorado sem session:join prévio (sem acesso à room)', async () => {
    const { tutorToken, studentToken, sessionId } = await setup();

    const tSock = await connectAndReady(tutorToken);
    const stSock = await connectAndReady(studentToken);

    // Tutor não fez session:join — student não deve receber nada
    await emit(stSock, 'session:join', { sessionId });

    const received = waitFor<unknown>(stSock, 'wb:stroke', 1000);
    tSock.emit('wb:stroke', { sessionId, points: [{ x: 0, y: 0 }], color: '#000000', width: 1 });

    expect(await received).toBeNull();

    tSock.disconnect();
    stSock.disconnect();
  });

  it('session:leave para de receber eventos da sala', async () => {
    const { tutorToken, studentToken, sessionId } = await setup();

    const tSock = await connectAndReady(tutorToken);
    const stSock = await connectAndReady(studentToken);

    await emit(tSock, 'session:join', { sessionId });
    await emit(stSock, 'session:join', { sessionId });

    // Aluno sai da sala
    stSock.emit('session:leave', { sessionId });
    // Aguarda processamento do leave
    await new Promise((r) => setTimeout(r, 100));

    const received = waitFor<unknown>(stSock, 'wb:stroke', 1000);
    tSock.emit('wb:stroke', { sessionId, points: [{ x: 5, y: 5 }], color: '#0000ff', width: 2 });

    expect(await received).toBeNull();

    tSock.disconnect();
    stSock.disconnect();
  });
});
