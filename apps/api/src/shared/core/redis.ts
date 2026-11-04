import Redis from 'ioredis';
import { env } from './env';

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: env.NODE_ENV === 'test',
});

redis.on('error', (err) => {
  console.error('[Redis] erro de ligação:', err.message);
});

redis.on('connect', () => {
  console.log('[Redis] ligado');
});

export default redis;
