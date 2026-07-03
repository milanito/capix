/**
 * stores.ts — pluggable backends for withCache and withRateLimit.
 *
 * The in-memory implementations below are the defaults and are correct for a
 * single process. Behind a load balancer they silently diverge: each instance
 * keeps its own cache and its own rate-limit counters (N instances = N times
 * the intended limit). For multi-instance deployments plug in a shared
 * backend — see @capixjs/store-redis.
 */

// ---------------------------------------------------------------------------
// CacheStore
// ---------------------------------------------------------------------------

/**
 * Pluggable cache backend for {@link withCache}.
 * Implementations own expiry and capacity policy.
 */
export type CacheStore = {
  /** Returns the cached value, or undefined when missing or expired. */
  get(key: string): unknown | undefined | Promise<unknown | undefined>;
  /** Stores a value for ttlMs milliseconds. */
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
};

export type MemoryCacheStoreOptions = {
  /** Maximum number of entries; least-recently-used are evicted. Default: 1_000. */
  readonly maxSize?: number;
};

/** In-memory LRU cache store — the withCache default. Single-process only. */
export function createMemoryCacheStore(options: MemoryCacheStoreOptions = {}): CacheStore {
  const maxSize = options.maxSize ?? 1_000;
  const entries = new Map<string, { value: unknown; expiresAt: number }>();

  return {
    get(key) {
      const cached = entries.get(key);
      if (cached === undefined) return undefined;
      if (cached.expiresAt <= Date.now()) {
        entries.delete(key); // expired — don't let dead entries occupy capacity
        return undefined;
      }
      // Refresh recency for LRU ordering
      entries.delete(key);
      entries.set(key, cached);
      return cached.value;
    },

    set(key, value, ttlMs) {
      if (entries.size >= maxSize && !entries.has(key)) {
        // Evict least-recently-used (first key in Map insertion order)
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.delete(key);
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}

// ---------------------------------------------------------------------------
// RateLimitStore
// ---------------------------------------------------------------------------

export type RateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

/**
 * Pluggable rate-limit backend for {@link withRateLimit}.
 *
 * `hit` records an attempt and decides in one call; implementations must make
 * that atomic per key (a check-then-set race would admit bursts over the
 * limit). Window semantics belong to the store: the in-memory default uses a
 * sliding window, the Redis adapter a fixed window.
 */
export type RateLimitStore = {
  hit(key: string, limit: number, windowMs: number): RateLimitResult | Promise<RateLimitResult>;
};

export type MemoryRateLimitStoreOptions = {
  /**
   * Maximum number of distinct keys tracked. Default: 10_000.
   * When exceeded, keys with no activity in the current window are swept;
   * if every key is still active, the oldest-tracked keys are evicted.
   */
  readonly maxKeys?: number;
};

/** In-memory sliding-window rate-limit store — the withRateLimit default. Single-process only. */
export function createMemoryRateLimitStore(options: MemoryRateLimitStoreOptions = {}): RateLimitStore {
  const maxKeys = options.maxKeys ?? 10_000;
  const buckets = new Map<string, number[]>();

  function evictStale(now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    for (const [k, ts] of buckets) {
      const last = ts[ts.length - 1];
      if (last === undefined || last <= cutoff) buckets.delete(k);
    }
    // Every key still active — hard-cap by evicting oldest-tracked keys
    if (buckets.size > maxKeys) {
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (buckets.size <= maxKeys) break;
      }
    }
  }

  return {
    hit(key, limit, windowMs) {
      const now = Date.now();
      const windowStart = now - windowMs;

      if (buckets.size > maxKeys) evictStale(now, windowMs);

      let timestamps = buckets.get(key) ?? [];
      timestamps = timestamps.filter((t) => t > windowStart);

      if (timestamps.length >= limit) {
        // Oldest timestamp in the window determines when a slot frees up
        const oldestInWindow = timestamps[0] ?? now;
        buckets.set(key, timestamps);
        return { allowed: false, retryAfterMs: oldestInWindow + windowMs - now };
      }

      timestamps.push(now);
      buckets.set(key, timestamps);
      return { allowed: true };
    },
  };
}
