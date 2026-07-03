import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { capability } from './capability.js';
import { withCache, withRateLimit } from './enhancers.js';
import { createMemoryCacheStore, createMemoryRateLimitStore } from './stores.js';
import type { CacheStore, RateLimitStore } from './stores.js';

const ctx = { requestId: 't' };

describe('createMemoryCacheStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns undefined for missing and expired entries', () => {
    const store = createMemoryCacheStore();
    expect(store.get('nope')).toBeUndefined();
    store.set('k', 'v', 1000);
    expect(store.get('k')).toBe('v');
    vi.advanceTimersByTime(1001);
    expect(store.get('k')).toBeUndefined();
  });

  it('evicts the least-recently-used entry at capacity', () => {
    const store = createMemoryCacheStore({ maxSize: 2 });
    store.set('a', 1, 10_000);
    store.set('b', 2, 10_000);
    store.get('a'); // refresh a's recency — b is now LRU
    store.set('c', 3, 10_000);
    expect(store.get('a')).toBe(1);
    expect(store.get('b')).toBeUndefined();
    expect(store.get('c')).toBe(3);
  });
});

describe('createMemoryRateLimitStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows up to the limit, then rejects with time until a slot frees', async () => {
    const store = createMemoryRateLimitStore();
    expect(store.hit('k', 2, 1000)).toEqual({ allowed: true });
    expect(store.hit('k', 2, 1000)).toEqual({ allowed: true });
    const denied = await store.hit('k', 2, 1000);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryAfterMs).toBe(1000);
  });

  it('slides the window — old hits stop counting', () => {
    const store = createMemoryRateLimitStore();
    store.hit('k', 2, 1000);
    vi.advanceTimersByTime(600);
    store.hit('k', 2, 1000);
    vi.advanceTimersByTime(500); // first hit is now outside the window
    expect(store.hit('k', 2, 1000)).toEqual({ allowed: true });
  });

  it('tracks keys independently', async () => {
    const store = createMemoryRateLimitStore();
    expect(store.hit('a', 1, 1000)).toEqual({ allowed: true });
    expect(store.hit('b', 1, 1000)).toEqual({ allowed: true });
    expect((await store.hit('a', 1, 1000)).allowed).toBe(false);
  });
});

describe('custom stores through the enhancers', () => {
  it('withCache uses the provided store, including async backends', async () => {
    const backing = new Map<string, unknown>();
    const calls: string[] = [];
    const store: CacheStore = {
      async get(key) {
        calls.push(`get:${key}`);
        return backing.get(key);
      },
      async set(key, value) {
        calls.push(`set:${key}`);
        backing.set(key, value);
      },
    };

    let resolves = 0;
    const getThing = capability(z.object({ id: z.string() }), ({ id }) => {
      resolves++;
      return { id };
    }).enhance(withCache(30, { store }));

    await getThing.resolve({ id: '1' }, ctx);
    const second = await getThing.resolve({ id: '1' }, ctx);

    expect(second).toEqual({ id: '1' });
    expect(resolves).toBe(1); // second call served from the custom store
    expect(calls[0]).toMatch(/^get:/);
    expect(calls).toContainEqual(expect.stringMatching(/^set:/));
  });

  it('withRateLimit uses the provided store and maps the rejection to 429 meta', async () => {
    const store: RateLimitStore = {
      async hit() {
        return { allowed: false, retryAfterMs: 4200 };
      },
    };
    const ping = capability(z.object({}), () => 'pong')
      .enhance(withRateLimit({ limit: 1, windowMs: 1000, store }));

    await expect(ping.resolve({}, ctx)).rejects.toMatchObject({
      status: 429,
      meta: expect.objectContaining({ retryAfter: 5, limit: 1 }),
    });
  });

  it('withRateLimit passes key, limit, and window to the store', async () => {
    const hits: Array<[string, number, number]> = [];
    const store: RateLimitStore = {
      hit(key, limit, windowMs) {
        hits.push([key, limit, windowMs]);
        return { allowed: true };
      },
    };
    const ping = capability(z.object({}), () => 'pong').enhance(
      withRateLimit({ limit: 7, windowMs: 60_000, keyFn: () => 'user-1', store }),
    );

    await ping.resolve({}, ctx);
    expect(hits).toEqual([['user-1', 7, 60_000]]);
  });
});
