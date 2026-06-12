/**
 * enhancers.ts — built-in capability enhancers
 * Depends on: capability.ts
 */

import type { Enhancer, AnyCapability } from './capability.js';
import { defineError, isFrameworkError } from './errors.js';
import { defaultErrors } from './errors.js';

/** Pass-through for type inference. */
export function defineEnhancer(fn: Enhancer): Enhancer {
  return fn;
}

/** Logs capability name, duration, and outcome. Falls back to console if ctx has no logger. */
export const withLogging = defineEnhancer((cap) => ({
  ...cap,
  resolve: async (input: unknown, ctx: Record<string, unknown>) => {
    const start = Date.now();
    const logger =
      typeof ctx['logger'] === 'object' && ctx['logger'] !== null
        ? (ctx['logger'] as { info: (msg: string) => void; error: (msg: string) => void })
        : { info: console.info, error: console.error };
    try {
      const result = await (cap as AnyCapability)._resolverOnly(input, ctx);
      logger.info(`[capix] ${cap.name} ok (${Date.now() - start}ms)`);
      return result;
    } catch (err) {
      logger.error(`[capix] ${cap.name} error (${Date.now() - start}ms)`);
      throw err;
    }
  },
})) as Enhancer;

export type CacheOptions = {
  /**
   * Maximum number of cached entries. Least-recently-used entries are evicted
   * when the limit is reached. Default: 1_000.
   */
  readonly maxSize?: number;
  /**
   * Derives the cache key from input and context. Defaults to JSON(input).
   *
   * WARNING: The default key ignores the context. If the capability's output
   * depends on ctx (e.g. the current user), the default key serves one
   * caller's cached response to every other caller. Always provide a keyFn
   * for context-dependent outputs:
   *
   * @example Per-user cache key
   * withCache(30, { keyFn: (input, ctx) => `${(ctx as AppContext).user?.id}:${JSON.stringify(input)}` })
   */
  readonly keyFn?: (input: unknown, ctx: unknown) => string;
};

/** In-memory LRU cache. Key = capabilityName:keyFn(input, ctx). TTL in seconds. */
export function withCache(ttlSeconds: number, options: CacheOptions = {}): Enhancer {
  const maxSize = options.maxSize ?? 1_000;
  const keyFn = options.keyFn;
  const store = new Map<string, { value: unknown; expiresAt: number }>();

  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      const key = `${cap.name}:${keyFn ? keyFn(input, ctx) : JSON.stringify(input)}`;
      const cached = store.get(key);
      if (cached !== undefined) {
        if (cached.expiresAt > Date.now()) {
          // Refresh recency for LRU ordering
          store.delete(key);
          store.set(key, cached);
          return cached.value;
        }
        store.delete(key); // expired — don't let dead entries occupy capacity
      }
      const result = await (cap as AnyCapability)._resolverOnly(input, ctx);
      if (store.size >= maxSize) {
        // Evict least-recently-used (first key in Map insertion order)
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value: result, expiresAt: Date.now() + ttlSeconds * 1000 });
      return result;
    },
  })) as Enhancer;
}

/** Rejects if the resolver exceeds the given milliseconds. */
export function withTimeout(ms: number): Enhancer {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: (input: unknown, ctx: unknown) => {
      let handle: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        handle = setTimeout(
          () => reject(defaultErrors.Timeout({ capability: cap.name, ms })),
          ms,
        );
      });

      return Promise.race([
        (cap as AnyCapability)._resolverOnly(input, ctx),
        timeoutPromise,
      ]).finally(() => {
        if (handle !== undefined) clearTimeout(handle);
      });
    },
  })) as Enhancer;
}

/** Retries on non-FrameworkError failures with exponential backoff. */
export function withRetry(maxAttempts: number, delayMs = 100): Enhancer {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await (cap as AnyCapability)._resolverOnly(input, ctx);
        } catch (err) {
          // Don't retry FrameworkErrors — they are intentional
          if (isFrameworkError(err)) throw err;
          lastError = err;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
          }
        }
      }
      throw lastError;
    },
  })) as Enhancer;
}

// ---------------------------------------------------------------------------
// withRateLimit
// ---------------------------------------------------------------------------

export type RateLimitOptions = {
  readonly limit: number;
  readonly windowMs: number;
  /**
   * Derives the rate limit key from input and context.
   *
   * WARNING: Defaults to the capability name — a GLOBAL limit shared across all callers.
   * For production use, always provide a keyFn to limit per-user or per-IP:
   *
   * @example Per-user rate limit
   * withRateLimit({ limit: 100, windowMs: 60_000, keyFn: (_input, ctx) => (ctx as AppContext).user?.id ?? 'anon' })
   *
   * @example Per-IP rate limit
   * withRateLimit({ limit: 10, windowMs: 60_000, keyFn: (_input, ctx) => (ctx as AppContext).ip ?? 'unknown' })
   */
  readonly keyFn?: (input: unknown, ctx: unknown) => string;
  /**
   * Maximum number of distinct keys tracked. Default: 10_000.
   *
   * When exceeded, keys with no activity in the current window are swept;
   * if every key is still active, the oldest-tracked keys are evicted (their
   * rate-limit state resets). This bounds memory when keyFn has unbounded
   * cardinality (per-user, per-IP).
   */
  readonly maxKeys?: number;
};

/** Sliding-window in-memory rate limiter. Throws 429 when limit exceeded. */
export function withRateLimit(options: RateLimitOptions): Enhancer {
  const { limit, windowMs, keyFn } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const store = new Map<string, number[]>();

  function evictStale(now: number): void {
    const cutoff = now - windowMs;
    for (const [k, ts] of store) {
      const last = ts[ts.length - 1];
      if (last === undefined || last <= cutoff) store.delete(k);
    }
    // Every key still active — hard-cap by evicting oldest-tracked keys
    if (store.size > maxKeys) {
      for (const k of store.keys()) {
        store.delete(k);
        if (store.size <= maxKeys) break;
      }
    }
  }

  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      const key = keyFn ? keyFn(input, ctx) : cap.name;
      const now = Date.now();
      const windowStart = now - windowMs;

      if (store.size > maxKeys) evictStale(now);

      let timestamps = store.get(key) ?? [];
      timestamps = timestamps.filter((t) => t > windowStart);

      if (timestamps.length >= limit) {
        // Find the oldest timestamp in the window — client can retry after it expires
        const oldestInWindow = timestamps[0] ?? now;
        const resetAt = oldestInWindow + windowMs;
        const retryAfter = Math.ceil((resetAt - now) / 1000);
        throw defaultErrors.TooManyRequests({
          retryAfter,
          resetAt: new Date(resetAt).toISOString(),
          limit,
        });
      }

      timestamps.push(now);
      store.set(key, timestamps);

      return (cap as AnyCapability)._resolverOnly(input, ctx);
    },
  })) as Enhancer;
}

// ---------------------------------------------------------------------------
// withRollback
// ---------------------------------------------------------------------------

export type RollbackFn = () => unknown;

/**
 * Extends a context type with the `onRollback` method added by {@link withRollback}.
 * Use this to type capabilities that need compensation actions.
 *
 * @example
 * const cap = capability(schema, async (input, ctx: WithRollback<AppContext>) => {
 *   ctx.onRollback(() => cleanup());
 * }).enhance(withRollback);
 */
export type WithRollback<T> = T & {
  readonly onRollback: (fn: RollbackFn) => void;
};

/**
 * Adds explicit rollback support to a capability.
 *
 * Use ctx.onRollback(fn) to register compensation actions that run in reverse
 * order if the resolver throws after one or more steps have already executed.
 *
 * This is NOT a database transaction. It does not provide atomicity,
 * isolation, or durability. For real transactions, use your database's
 * transaction API directly inside the resolver.
 *
 * Use this for: in-memory stores, multi-step operations where each step can
 * be independently compensated (undone).
 *
 * @example
 * export const checkout = cap(z.object({}), async (_, ctx) => {
 *   const order = ctx.db.orders.create({ ... });
 *   ctx.onRollback(() => ctx.db.orders.delete(order.id));
 *
 *   ctx.db.inventory.decrement(item.id);
 *   ctx.onRollback(() => ctx.db.inventory.increment(item.id));
 *
 *   return order;
 * }).enhance(withRollback);
 */
export const withRollback = defineEnhancer((cap) => ({
  ...cap,
  resolve: async (input: unknown, ctx: unknown) => {
    const rollbacks: RollbackFn[] = [];
    const txCtx = {
      ...(ctx as object),
      onRollback: (fn: RollbackFn) => { rollbacks.push(fn); },
    };

    try {
      return await (cap as AnyCapability)._resolverOnly(input, txCtx);
    } catch (err) {
      for (const rollback of rollbacks.reverse()) {
        try {
          await rollback();
        } catch (rollbackErr) {
          console.error('[capix] Rollback failed:', rollbackErr);
        }
      }
      throw err;
    }
  },
})) as Enhancer;

// ---------------------------------------------------------------------------
// withMetrics
// ---------------------------------------------------------------------------

export interface MetricsCollector {
  increment(name: string, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
}

/** Metrics collector that logs to console. */
export const consoleMetricsCollector: MetricsCollector = {
  increment(name, tags) {
    console.log(`[capix:metrics] ${name}`, tags ?? {});
  },
  histogram(name, value, tags) {
    console.log(`[capix:metrics] ${name}=${value}ms`, tags ?? {});
  },
};

/** Wraps a capability to emit duration and success/error metrics. */
export function withMetrics(collector: MetricsCollector): Enhancer {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      const start = Date.now();
      const tags = { capability: cap.name };
      try {
        const result = await (cap as AnyCapability)._resolverOnly(input, ctx);
        collector.histogram('capability.duration', Date.now() - start, tags);
        collector.increment('capability.success', tags);
        return result;
      } catch (err) {
        collector.histogram('capability.duration', Date.now() - start, tags);
        collector.increment('capability.error', tags);
        throw err;
      }
    },
  })) as Enhancer;
}

// ---------------------------------------------------------------------------
// withCircuitBreaker
// ---------------------------------------------------------------------------

export type CircuitBreakerOptions = {
  readonly failureThreshold: number;
  readonly successThreshold: number;
  readonly timeoutMs: number;
};

type CircuitState = 'closed' | 'open' | 'half-open';

const circuitUnavailable = defineError(503, 'Service unavailable');

/**
 * Circuit breaker with closed/open/half-open states.
 * State is closure-captured per capability application.
 * FrameworkErrors do not count toward the failure threshold.
 */
export function withCircuitBreaker(options: CircuitBreakerOptions): Enhancer {
  const { failureThreshold, successThreshold, timeoutMs } = options;

  return defineEnhancer((cap) => {
    let state: CircuitState = 'closed';
    let failures = 0;
    let successes = 0;
    let openedAt = 0;

    return {
      ...cap,
      resolve: async (input: unknown, ctx: unknown) => {
        if (state === 'open') {
          if (Date.now() - openedAt >= timeoutMs) {
            state = 'half-open';
            successes = 0;
          } else {
            throw circuitUnavailable({ reason: `Circuit open for '${cap.name}'` });
          }
        }

        try {
          const result = await (cap as AnyCapability)._resolverOnly(input, ctx);
          if (state === 'half-open') {
            successes++;
            if (successes >= successThreshold) {
              state = 'closed';
              failures = 0;
            }
          } else {
            failures = 0;
          }
          return result;
        } catch (err) {
          if (!isFrameworkError(err)) {
            failures++;
            if (state === 'half-open' || failures >= failureThreshold) {
              state = 'open';
              openedAt = Date.now();
              failures = 0;
            }
          }
          throw err;
        }
      },
    };
  }) as Enhancer;
}
