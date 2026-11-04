import Redis from 'ioredis';
import { Queue } from 'bullmq';
import { env } from './env';
import { on } from './events';
import prisma from './database';

export type TranscodeJobData = {
  contentId: string;
  storageKey: string;
  type: 'VIDEO' | 'DOCUMENT';
};

export type NotificationJobData = {
  userId: string;
  type: string;
  data: Record<string, unknown>;
};

// BullMQ requer maxRetriesPerRequest: null (usa BLPOP/BRPOP — comandos bloqueantes)
export function makeQueueRedis() {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export const transcodingQueue = new Queue<TranscodeJobData>('content-transcode', {
  connection: makeQueueRedis(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection: makeQueueRedis(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

// Liga o evento de upload in-process à fila BullMQ.
// Chamar uma vez no arranque do servidor (não em testes).
export function registerTranscodeEventHandler(): void {
  on('content.uploaded', async ({ contentId, type }) => {
    const item = await prisma.contentItem.findUnique({ where: { id: contentId }, select: { storageKey: true } });
    if (!item?.storageKey) return;
    await transcodingQueue.add('transcode', { contentId, storageKey: item.storageKey, type });
    console.log(`[Queue] enfileirado: ${contentId} (${type})`);
  });
}
