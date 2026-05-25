import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { capability } from './capability.js';
import type { AnyCapability } from './capability.js';
import { defineError, isFrameworkError } from './errors.js';
import {
  withLogging,
  withCache,
  withTimeout,
  withRetry,
  withRateLimit,
  withMetrics,
  withCircuitBreaker,
  consoleMetricsCollector,
  rateLimitStore,
  cacheStore,
} from './enhancers.js';
import type { MetricsCollector } from './enhancers.js';

const ctx = { requestId: 'test' };

async function tryResolve(cap: AnyCapability, c: unknown = ctx): Promise<unknown> {
  try {
    return await (cap as AnyCapability).resolve(undefined, c);
  } catch (err) {
    return err;
  }
}

// ---------------------------------------------------------------------------
// withLogging
// ---------------------------------------------------------------------------

describe('withLogging', () => {
  it('calls resolve and returns result', async () => {
    const cap = capability(() => 42).enhance(withLogging);
    const result = await cap.resolve(undefined, ctx);
    expect(result).toBe(42);
  });

  it('uses ctx.logger when available', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const ctxWithLogger = { ...ctx, logger } as typeof ctx;
    const cap = capability(() => 'ok').enhance(withLogging);
    await cap.resolve(undefined, ctxWithLogger);
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('logs error and re-throws', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const ctxWithLogger = { ...ctx, logger } as typeof ctx;
    const cap = capability(() => { throw new Error('boom'); }).enhance(withLogging);
    await expect(cap.resolve(undefined, ctxWithLogger)).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('falls back to console when ctx has no logger', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const cap = capability(() => 'ok').enhance(withLogging);
    await cap.resolve(undefined, ctx);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// withCache
// ---------------------------------------------------------------------------

describe('withCache', () => {
  beforeEach(() => { cacheStore.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('caches result for TTL seconds', async () => {
    const resolver = vi.fn(() => 'value');
    const cap = capability(resolver).enhance(withCache(10));
    await cap.resolve(undefined, ctx);
    await cap.resolve(undefined, ctx);
    expect(resolver).toHaveBeenCalledOnce();
  });

  it('re-calls resolver after TTL expires', async () => {
    const resolver = vi.fn(() => 'value');
    const cap = capability(resolver).enhance(withCache(1));
    await cap.resolve(undefined, ctx);
    vi.advanceTimersByTime(1500);
    await cap.resolve(undefined, ctx);
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves normally when under timeout', async () => {
    const cap = capability(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'done';
    }).enhance(withTimeout(200));
    const promise = cap.resolve(undefined, ctx);
    vi.advanceTimersByTime(60);
    await expect(promise).resolves.toBe('done');
  });

  it('rejects when resolver exceeds timeout', async () => {
    const cap = capability(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return 'late';
    }).enhance(withTimeout(100));
    const promise = cap.resolve(undefined, ctx);
    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toThrow(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('returns on first success', async () => {
    const resolver = vi.fn(() => 'ok');
    const cap = capability(resolver).enhance(withRetry(3, 0));
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
    expect(resolver).toHaveBeenCalledOnce();
  });

  it('retries on unexpected error and eventually succeeds', async () => {
    let attempts = 0;
    const cap = capability(() => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'recovered';
    }).enhance(withRetry(3, 0));
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('recovered');
    expect(attempts).toBe(3);
  });

  it('throws after maxAttempts exhausted', async () => {
    const cap = capability(() => { throw new Error('always fails'); }).enhance(withRetry(2, 0));
    await expect(cap.resolve(undefined, ctx)).rejects.toThrow('always fails');
  });

  it('does not retry FrameworkErrors', async () => {
    const Err = defineError(403, 'Forbidden');
    const resolver = vi.fn(() => { throw Err(); });
    const cap = capability(resolver).enhance(withRetry(3, 0));
    const err = await tryResolve(cap);
    expect(isFrameworkError(err)).toBe(true);
    expect(resolver).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// withRateLimit
// ---------------------------------------------------------------------------

describe('withRateLimit', () => {
  beforeEach(() => {
    rateLimitStore.clear();
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('allows requests under the limit', async () => {
    const cap = capability(() => 'ok').enhance(withRateLimit({ limit: 3, windowMs: 1000 }));
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
  });

  it('throws 429 when limit exceeded', async () => {
    const cap = capability(() => 'ok').enhance(withRateLimit({ limit: 2, windowMs: 1000 }));
    await cap.resolve(undefined, ctx);
    await cap.resolve(undefined, ctx);
    const err = await tryResolve(cap);
    expect(isFrameworkError(err)).toBe(true);
    expect((err as { status: number }).status).toBe(429);
  });

  it('resets after window expires', async () => {
    const cap = capability(() => 'ok').enhance(withRateLimit({ limit: 1, windowMs: 1000 }));
    await cap.resolve(undefined, ctx);
    vi.advanceTimersByTime(1500);
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
  });

  it('uses custom keyFn for per-user limits', async () => {
    const cap = capability(() => 'ok').enhance(
      withRateLimit({
        limit: 1,
        windowMs: 1000,
        keyFn: (_input, c) => (c as { requestId: string }).requestId,
      }),
    );
    const ctxA = { requestId: 'user-a' };
    const ctxB = { requestId: 'user-b' };
    await expect(cap.resolve(undefined, ctxA)).resolves.toBe('ok');
    await expect(cap.resolve(undefined, ctxB)).resolves.toBe('ok');
    const err = await tryResolve(cap, ctxA);
    expect(isFrameworkError(err)).toBe(true);
    expect((err as { status: number }).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// withMetrics
// ---------------------------------------------------------------------------

describe('withMetrics', () => {
  it('calls increment and histogram on success', async () => {
    const collector: MetricsCollector = { increment: vi.fn(), histogram: vi.fn() };
    const cap = capability(() => 'ok').enhance(withMetrics(collector));
    await cap.resolve(undefined, ctx);
    expect(collector.increment).toHaveBeenCalledWith('capability.success', expect.any(Object));
    expect(collector.histogram).toHaveBeenCalledWith('capability.duration', expect.any(Number), expect.any(Object));
  });

  it('calls capability.error on failure and re-throws', async () => {
    const collector: MetricsCollector = { increment: vi.fn(), histogram: vi.fn() };
    const cap = capability(() => { throw new Error('oops'); }).enhance(withMetrics(collector));
    await expect(cap.resolve(undefined, ctx)).rejects.toThrow('oops');
    expect(collector.increment).toHaveBeenCalledWith('capability.error', expect.any(Object));
    expect(collector.histogram).toHaveBeenCalledOnce();
  });

  it('includes capability name in tags', async () => {
    const collector: MetricsCollector = { increment: vi.fn(), histogram: vi.fn() };
    const cap = capability(() => 'ok').enhance(withMetrics(collector));
    await cap.resolve(undefined, ctx);
    const incrementFn = collector.increment as ReturnType<typeof vi.fn>;
    const tags = incrementFn.mock.calls[0]?.[1] as Record<string, string>;
    expect(tags).toHaveProperty('capability');
  });

  it('consoleMetricsCollector does not throw', () => {
    expect(() => consoleMetricsCollector.increment('test.count', { env: 'test' })).not.toThrow();
    expect(() => consoleMetricsCollector.histogram('test.duration', 42, { env: 'test' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// withCircuitBreaker
// ---------------------------------------------------------------------------

describe('withCircuitBreaker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows requests while closed', async () => {
    const cap = capability(() => 'ok').enhance(
      withCircuitBreaker({ failureThreshold: 3, successThreshold: 2, timeoutMs: 1000 }),
    );
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
  });

  it('trips open after failureThreshold unexpected errors', async () => {
    const cap = capability(() => { throw new Error('failure'); }).enhance(
      withCircuitBreaker({ failureThreshold: 2, successThreshold: 1, timeoutMs: 1000 }),
    );
    await tryResolve(cap);
    await tryResolve(cap);
    const err = await tryResolve(cap);
    expect(isFrameworkError(err)).toBe(true);
    expect((err as { status: number }).status).toBe(503);
  });

  it('does not count FrameworkErrors toward failure threshold', async () => {
    const Err = defineError(422, 'Unprocessable');
    const cap = capability(() => { throw Err(); }).enhance(
      withCircuitBreaker({ failureThreshold: 2, successThreshold: 1, timeoutMs: 1000 }),
    );
    for (let i = 0; i < 5; i++) {
      const err = await tryResolve(cap);
      expect((err as { status: number }).status).toBe(422);
    }
  });

  it('transitions to half-open after timeoutMs and succeeds', async () => {
    let calls = 0;
    const cap = capability(() => {
      calls++;
      if (calls <= 2) throw new Error('fail');
      return 'recovered';
    }).enhance(
      withCircuitBreaker({ failureThreshold: 2, successThreshold: 1, timeoutMs: 500 }),
    );
    await tryResolve(cap);
    await tryResolve(cap);
    const openErr = await tryResolve(cap);
    expect((openErr as { status: number }).status).toBe(503);
    vi.advanceTimersByTime(600);
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('recovered');
  });

  it('resets to closed after successThreshold successes in half-open', async () => {
    let calls = 0;
    const cap = capability(() => {
      calls++;
      if (calls <= 2) throw new Error('fail');
      return 'ok';
    }).enhance(
      withCircuitBreaker({ failureThreshold: 2, successThreshold: 2, timeoutMs: 500 }),
    );
    await tryResolve(cap);
    await tryResolve(cap);
    vi.advanceTimersByTime(600);
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
    await expect(cap.resolve(undefined, ctx)).resolves.toBe('ok');
  });

  it('each enhanced capability gets independent circuit state', async () => {
    const breaker = withCircuitBreaker({ failureThreshold: 1, successThreshold: 1, timeoutMs: 1000 });
    const capA = capability(() => { throw new Error('always fails'); }).enhance(breaker);
    const capB = capability(() => 'healthy').enhance(breaker);
    await tryResolve(capA);
    await expect(capB.resolve(undefined, ctx)).resolves.toBe('healthy');
  });
});
