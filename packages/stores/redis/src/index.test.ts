import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { capability, withCache, withRateLimit } from '@capixjs/core';
import { redisCacheStore, redisRateLimitStore } from './index.js';
import type { RedisLikeClient } from './index.js';

/**
 * In-memory fake implementing the RedisLikeClient surface, including the
 * semantics our Lua script relies on (INCR / PEXPIRE-on-first / PTTL).
 * The Lua itself only runs against real Redis; what these tests pin down is
 * the store logic — key prefixing, serialization, and decision mapping.
 */
function fakeRedis(): RedisLikeClient & { data: Map<string, { value: string; expiresAt: number }> } {
  const data = new Map<string, { value: string; expiresAt: number }>();

  const live = (key: string): { value: string; expiresAt: number } | undefined => {
    const e = data.get(key);
    if (e !== undefined && e.expiresAt !== -1 && e.expiresAt <= Date.now()) {
      data.delete(key);
      return undefined;
    }
    return e;
  };

  return {
    data,
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, _px, ttlMs) {
      data.set(key, { value, expiresAt: Date.now() + ttlMs });
      return 'OK';
    },
    async eval(_script, _numKeys, key, windowMs) {
      const k = String(key);
      const entry = live(k);
      const count = entry === undefined ? 1 : Number(entry.value) + 1;
      const expiresAt = entry === undefined ? Date.now() + Number(windowMs) : entry.expiresAt;
      data.set(k, { value: String(count), expiresAt });
      return [count, expiresAt - Date.now()];
    },
  };
}

const ctx = { requestId: 't' };

describe('redisCacheStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('round-trips JSON values under a prefixed key with TTL', async () => {
    const redis = fakeRedis();
    const store = redisCacheStore(redis);

    await store.set('users.get:{"id":"1"}', { id: '1', tags: ['a'] }, 30_000);
    expect([...redis.data.keys()][0]).toBe('capix:cache:users.get:{"id":"1"}');
    expect(await store.get('users.get:{"id":"1"}')).toEqual({ id: '1', tags: ['a'] });

    vi.advanceTimersByTime(30_001);
    expect(await store.get('users.get:{"id":"1"}')).toBeUndefined();
  });

  it('returns undefined for misses and unparseable entries', async () => {
    const redis = fakeRedis();
    const store = redisCacheStore(redis);
    expect(await store.get('missing')).toBeUndefined();

    redis.data.set('capix:cache:bad', { value: 'not-json{', expiresAt: -1 });
    expect(await store.get('bad')).toBeUndefined();
  });

  it('honors a custom prefix', async () => {
    const redis = fakeRedis();
    const store = redisCacheStore(redis, { prefix: 'myapp:' });
    await store.set('k', 1, 1000);
    expect(redis.data.has('myapp:cache:k')).toBe(true);
  });

  it('serves withCache hits across two enhancer instances sharing one client', async () => {
    const redis = fakeRedis();
    let resolves = 0;
    const make = () =>
      capability(z.object({ id: z.string() }), ({ id }) => {
        resolves++;
        return { id };
      }).enhance(withCache(30, { store: redisCacheStore(redis) }));

    // Two enhancer instances = two "server instances" sharing Redis
    await make().resolve({ id: '1' }, ctx);
    const second = await make().resolve({ id: '1' }, ctx);

    expect(second).toEqual({ id: '1' });
    expect(resolves).toBe(1);
  });
});

describe('redisRateLimitStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows up to the limit and rejects with the window TTL', async () => {
    const store = redisRateLimitStore(fakeRedis());
    expect(await store.hit('u1', 2, 60_000)).toEqual({ allowed: true });
    expect(await store.hit('u1', 2, 60_000)).toEqual({ allowed: true });

    vi.advanceTimersByTime(15_000);
    const denied = await store.hit('u1', 2, 60_000);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterMs).toBe(45_000);
  });

  it('resets the counter after the window expires (fixed window)', async () => {
    const store = redisRateLimitStore(fakeRedis());
    await store.hit('u1', 1, 1000);
    expect((await store.hit('u1', 1, 1000)).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(await store.hit('u1', 1, 1000)).toEqual({ allowed: true });
  });

  it('counts keys independently and enforces one shared limit across instances', async () => {
    const redis = fakeRedis();
    // Two store instances = two "server instances" sharing Redis
    const a = redisRateLimitStore(redis);
    const b = redisRateLimitStore(redis);

    expect(await a.hit('user-1', 2, 60_000)).toEqual({ allowed: true });
    expect(await b.hit('user-1', 2, 60_000)).toEqual({ allowed: true });
    expect((await a.hit('user-1', 2, 60_000)).allowed).toBe(false);
    expect(await b.hit('user-2', 2, 60_000)).toEqual({ allowed: true });
  });

  it('maps to a 429 with retryAfter through withRateLimit', async () => {
    const store = redisRateLimitStore(fakeRedis());
    const ping = capability(z.object({}), () => 'pong')
      .enhance(withRateLimit({ limit: 1, windowMs: 60_000, keyFn: () => 'k', store }));

    await ping.resolve({}, ctx);
    await expect(ping.resolve({}, ctx)).rejects.toMatchObject({
      status: 429,
      meta: expect.objectContaining({ retryAfter: 60, limit: 1 }),
    });
  });
});
