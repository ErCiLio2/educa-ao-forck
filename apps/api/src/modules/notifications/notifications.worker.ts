import { Worker } from 'bullmq';
import { makeQueueRedis } from '../../shared/core/queue';
import { dispatch } from './notifications.service';
import type { NotificationJobData } from '../../shared/core/queue';
import type { NotifTypeValue } from './notifications.types';

export function createNotificationWorker() {
  const worker = new Worker<NotificationJobData>(
    'notifications',
    async (job) => {
      const { userId, type, data } = job.data;
      await dispatch(userId, type as NotifTypeValue, data);
    },
    { connection: makeQueueRedis(), concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Notifications:Worker] job ${job?.id} falhou (tentativa ${job?.attemptsMade ?? 0}):`, err.message);
  });

  return worker;
}
