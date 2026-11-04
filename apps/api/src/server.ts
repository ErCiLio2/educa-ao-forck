import { env } from './shared/core/env';
import { buildApp } from './app';
import prisma from './shared/core/database';
import redis from './shared/core/redis';
import { registerTranscodeEventHandler, transcodingQueue, notificationQueue } from './shared/core/queue';
import { initSocket } from './shared/core/socket';
import { createWorker } from './modules/contents_datalite/contents_datalite.worker';
import { createNotificationWorker } from './modules/notifications/notifications.worker';
import { registerNotificationEventHandlers } from './modules/notifications/notifications.service';

const PORT = env.PORT;

async function main() {
  await prisma.$connect();
  console.log('[Prisma] ligado à base de dados');

  registerTranscodeEventHandler();
  registerNotificationEventHandlers();
  const worker = createWorker();
  const notifWorker = createNotificationWorker();
  console.log('[Worker] workers de transcodificação e notificações iniciados');

  const app = buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  const socketServer = initSocket(app);
  console.log(`[Server] a correr em http://localhost:${PORT}`);
  console.log(`[Server] ambiente: ${env.NODE_ENV}`);

  async function shutdown(signal: string) {
    console.log(`[Server] ${signal} recebido — a encerrar`);
    await worker.close();
    await notifWorker.close();
    await transcodingQueue.close();
    await notificationQueue.close();
    await socketServer.close();
    await app.close();
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Server] erro de arranque:', err);
  process.exit(1);
});
