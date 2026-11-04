import { z } from 'zod';
import type { Socket } from 'socket.io';
import { registerConnectionHandler } from '../../shared/core/socket';
import { getSessionAccess } from './bookings.service';

// ── Schemas de validação dos eventos WebSocket ────────────────────────────────

const SessionIdSchema = z.object({ sessionId: z.string().uuid() });

const StrokeSchema = z.object({
  sessionId: z.string().uuid(),
  // Limite de 500 pontos por stroke para evitar payloads gigantes
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(1).max(500),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#000000'),
  width: z.number().min(1).max(50).default(2),
});

const CursorSchema = z.object({
  sessionId: z.string().uuid(),
  x: z.number(),
  y: z.number(),
});

const ChatMessageSchema = z.object({
  sessionId: z.string().uuid(),
  // Limite razoável; evita mensagens gigantes no relay
  text: z.string().trim().min(1).max(1000),
});

const TypingSchema = z.object({
  sessionId: z.string().uuid(),
  // true = começou a escrever; false = parou (debounce no cliente)
  typing: z.boolean(),
});

// Verifica se o socket está na room da sessão (garantia de que fez session:join com sucesso)
function inSessionRoom(socket: Socket, sessionId: string): boolean {
  return socket.rooms.has(`session:${sessionId}`);
}

function cb(callback: unknown, payload: unknown): void {
  if (typeof callback === 'function') (callback as (p: unknown) => void)(payload);
}

// ── Handler registado no initSocket de cada ligação WebSocket ─────────────────

function handleConnection(socket: Socket): void {
  const userId = socket.data.userId as string;
  const role = socket.data.role as string;
  // Nome do utilizador injectado no handshake (auth.token JWT tem `name`)
  const userName = (socket.data.userName as string | undefined) ?? userId;

  // Entrar na room da sessão (RF-AUL-06): valida acesso antes de aderir
  socket.on('session:join', async (data: unknown, callback: unknown) => {
    const parsed = SessionIdSchema.safeParse(data);
    if (!parsed.success) return cb(callback, { error: 'INVALID_DATA' });

    const { sessionId } = parsed.data;
    const access = await getSessionAccess(sessionId, userId, role);
    if (!access) return cb(callback, { error: 'FORBIDDEN' });

    await socket.join(`session:${sessionId}`);

    // Notifica os outros participantes que este utilizador entrou (RF-AUL-05)
    socket.to(`session:${sessionId}`).emit('session:participant_joined', {
      userId,
      userName,
      role: access,
    });

    cb(callback, { ok: true, access });
  });

  // Sair da room da sessão
  socket.on('session:leave', (data: unknown) => {
    const parsed = SessionIdSchema.safeParse(data);
    if (!parsed.success) return;
    const { sessionId } = parsed.data;
    if (!inSessionRoom(socket, sessionId)) return;
    socket.to(`session:${sessionId}`).emit('session:participant_left', { userId, userName });
    socket.leave(`session:${sessionId}`);
  });

  // Relay de traço do whiteboard — só relaya se o socket estiver na room
  socket.on('wb:stroke', (data: unknown) => {
    const parsed = StrokeSchema.safeParse(data);
    if (!parsed.success) return;
    const { sessionId, ...stroke } = parsed.data;
    if (!inSessionRoom(socket, sessionId)) return;
    socket.to(`session:${sessionId}`).emit('wb:stroke', { userId, ...stroke });
  });

  // Limpar o quadro — só o tutor ou admin (impede alunos de apagar o quadro durante a aula)
  socket.on('wb:clear', (data: unknown) => {
    const parsed = SessionIdSchema.safeParse(data);
    if (!parsed.success) return;
    const { sessionId } = parsed.data;
    if (!inSessionRoom(socket, sessionId)) return;
    if (role !== 'TUTOR' && role !== 'ADMIN') return;
    socket.to(`session:${sessionId}`).emit('wb:clear', { userId });
  });

  // Cursor em tempo real (alta frequência — validação leve)
  socket.on('wb:cursor', (data: unknown) => {
    const parsed = CursorSchema.safeParse(data);
    if (!parsed.success) return;
    const { sessionId, x, y } = parsed.data;
    if (!inSessionRoom(socket, sessionId)) return;
    socket.to(`session:${sessionId}`).emit('wb:cursor', { userId, x, y });
  });

  // ── Chat em sala (RF-AUL-05) ────────────────────────────────────────────────

  // Enviar mensagem de chat — relay para todos na room (incluindo o remetente, para confirmação)
  socket.on('chat:message', (data: unknown, callback: unknown) => {
    const parsed = ChatMessageSchema.safeParse(data);
    if (!parsed.success) return cb(callback, { error: 'INVALID_DATA' });

    const { sessionId, text } = parsed.data;
    if (!inSessionRoom(socket, sessionId)) return cb(callback, { error: 'FORBIDDEN' });

    const payload = {
      id: crypto.randomUUID(),
      userId,
      userName,
      text,
      sentAt: new Date().toISOString(),
    };
    // Emite para todos na room, incluindo o remetente
    socket.nsp.to(`session:${sessionId}`).emit('chat:message', payload);
    cb(callback, { ok: true, id: payload.id });
  });

  // Indicador de escrita — relay sem persistência (debounce no cliente, ~1 s)
  socket.on('chat:typing', (data: unknown) => {
    const parsed = TypingSchema.safeParse(data);
    if (!parsed.success) return;
    const { sessionId, typing } = parsed.data;
    if (!inSessionRoom(socket, sessionId)) return;
    socket.to(`session:${sessionId}`).emit('chat:typing', { userId, userName, typing });
  });
}

// Regista o handler uma vez; chamado de bookings.routes.ts durante o arranque
export function initBookingsSocket(): void {
  registerConnectionHandler(handleConnection);
}
