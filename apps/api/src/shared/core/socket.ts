import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { env } from './env';
import { makeQueueRedis } from './queue';
import redis from './redis';
import prisma from './database';

// Chave Redis usada pelo módulo auth para a época da sessão (SEP = Session EPoch)
const sessionEpochKey = (userId: string) => `sep:${userId}`;

export let io: Server | undefined;

// Módulos registam handlers aqui antes de initSocket ser chamado (durante registo de rotas)
type ConnectionHandler = (socket: Socket) => void | Promise<void>;
const connectionHandlers: ConnectionHandler[] = [];

export function registerConnectionHandler(handler: ConnectionHandler): void {
  connectionHandlers.push(handler);
}

export function initSocket(app: FastifyInstance): Server {
  // Captura os handlers registados até agora e limpa o array para a próxima instância (testes)
  const handlers = [...connectionHandlers];
  connectionHandlers.length = 0;

  const instance = new Server(app.server, {
    path: '/socket.io',
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Redis pub/sub para multi-instância (RNF-DIS-01). Em testes usa o adapter de memória.
  if (env.NODE_ENV !== 'test') {
    const pub = makeQueueRedis();
    const sub = makeQueueRedis();
    instance.adapter(createAdapter(pub, sub));
  }

  // Autenticação por token JWT no handshake
  instance.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    if (!token) return next(new Error('UNAUTHORIZED'));

    let payload: { sub: string; role?: string; ep?: number };
    try {
      payload = jwt.verify(token, env.ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] }) as typeof payload;
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }

    // Verifica se a sessão foi revogada (mesmo critério do middleware HTTP)
    const epoch = Number((await redis.get(sessionEpochKey(payload.sub))) ?? 0);
    if ((payload.ep ?? 0) < epoch) return next(new Error('SESSION_REVOKED'));

    socket.data.userId = payload.sub;
    socket.data.role = payload.role ?? 'STUDENT';

    // Nome do utilizador para o chat e notificações de entrada/saída na sala
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { name: true } });
    socket.data.userName = user?.name ?? payload.sub;

    return next();
  });

  instance.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    await socket.join(`user:${userId}`);
    // Confirma ao cliente que está na sua room e pode receber eventos
    socket.emit('ready');

    // Delega handlers adicionais registados por módulos (ex.: bookings → whiteboard)
    for (const handler of handlers) {
      await handler(socket);
    }

    socket.on('disconnect', () => {
      // sem log em produção para não saturar output
    });
  });

  io = instance;
  return instance;
}

// Emite um evento para todos os sockets de um utilizador (multi-dispositivo via Redis pub/sub)
export function emitToUser(userId: string, event: string, data: unknown): void {
  io?.to(`user:${userId}`).emit(event, data);
}
