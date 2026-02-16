import IORedis from 'ioredis';
import { config } from './env';

let sharedRedis: IORedis | null = null;

export function getSharedRedis(): IORedis {
  if (!sharedRedis) {
    sharedRedis = new IORedis(
      config.redis.url,
      config.redis.password ? { password: config.redis.password } : {}
    );
  }
  return sharedRedis;
}

export async function closeSharedRedis(): Promise<void> {
  if (sharedRedis) {
    await sharedRedis.quit();
    sharedRedis = null;
  }
}
