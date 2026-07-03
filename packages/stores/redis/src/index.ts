/**
 * index.ts — Redis-backed stores for Capix enhancers.
 *
 * Both stores accept any client with an ioredis-compatible surface (get /
 * set with PX / eval) — pass an ioredis instance directly. node-redis v4
 * users can adapt with a thin wrapper; see the README.
 *
 * Unlike the in-memory defaults, these stores are shared across every
 * instance pointing at the same Redis, so caches are consistent and rate
 * limits are enforced globally behind a load balancer.
 */

import type { CacheStore, RateLimitStore } from '@capixjs/core';

export { createRedisEventBus } from './event-bus.js';
export type {
  RedisPublisherClient,
  RedisSubscriberClient,
  RedisEventBusOptions,
} from './event-bus.js';

/**
 * The subset of a Redis client the stores need — structurally compatible
 * with ioredis. No Redis library is bundled or required by this package.
 */
export type RedisLikeClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: 'PX', ttlMs: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
};

export type RedisStoreOptions = {
  /** Key prefix, so multiple apps can share one Redis. Default: 'capix:'. */
  readonly prefix?: string;
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Redis-backed CacheStore for withCache. Values are JSON-serialized; expiry
 * is Redis-native (PX), so entries vanish server-side at TTL.
 *
 * @example
 * import Redis from 'ioredis';
 * const redis = new Redis(process.env.REDIS_URL);
 * const getStats = capability(schema, resolver)
 *   .enhance(withCache(30, { store: redisCacheStore(redis) }));
 */
export function redisCacheStore(client: RedisLikeClient, options: RedisStoreOptions = {}): CacheStore {
  const prefix = (options.prefix ?? 'capix:') + 'cache:';

  return {
    async get(key) {
      const raw = await client.get(prefix + key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return undefined; // foreign or corrupted entry — treat as a miss
      }
    },

    async set(key, value, ttlMs) {
      // JSON cannot represent undefined; the engine forbids undefined
      // resolver outputs anyway, so nothing cacheable is lost.
      if (value === undefined) return;
      await client.set(prefix + key, JSON.stringify(value), 'PX', Math.max(1, ttlMs));
    },
  };
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

/**
 * Atomic fixed-window counter: INCR the key, arm its expiry on first hit,
 * report the count and time left in the window. Runs as one Lua script so
 * concurrent hits across instances cannot race past the limit.
 */
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`.trim();

/**
 * Redis-backed RateLimitStore for withRateLimit.
 *
 * Uses a fixed window (counter resets windowMs after the window's first
 * hit) rather than the in-memory default's sliding window — the standard
 * Redis pattern, one round-trip per request, atomic across instances.
 * Rejected attempts do not increment the counter's expiry.
 *
 * @example
 * withRateLimit({
 *   limit: 100,
 *   windowMs: 60_000,
 *   keyFn: (_i, ctx) => ctx.user?.id ?? ctx.ip,
 *   store: redisRateLimitStore(redis),
 * })
 */
export function redisRateLimitStore(client: RedisLikeClient, options: RedisStoreOptions = {}): RateLimitStore {
  const prefix = (options.prefix ?? 'capix:') + 'ratelimit:';

  return {
    async hit(key, limit, windowMs) {
      const result = (await client.eval(RATE_LIMIT_SCRIPT, 1, prefix + key, windowMs)) as [number, number];
      const count = result[0];
      const ttlMs = result[1];

      if (count <= limit) return { allowed: true };
      // PTTL is -1 only if PEXPIRE was somehow lost; fall back to a full window
      return { allowed: false, retryAfterMs: ttlMs > 0 ? ttlMs : windowMs };
    },
  };
}
