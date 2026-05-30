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
  withRollback,
  withMetrics,
  withCircuitBreaker,
  consoleMetricsCollector,
} from './enhancers.js';
import type { MetricsCollector } from './enhancers.js';

const ctx = { requestId: 'test' };

async function tryResolve(cap: AnyCapability, c: unknown = ctx): Promise<unknown> {
  try {
    return await (cap as AnyCapability).resolve(undefined, c as { requestId: string });
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
  beforeEach(() => { vi.useFakeTimers(); });
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

  it('rejects with status 504 when resolver exceeds timeout', async () => {
    const cap = capability(async () => {
      await new Promise((r) => setTimeout(r, 500));
      return 'late';
    }).enhance(withTimeout(100));
    const promise = cap.resolve(undefined, ctx);
    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toMatchObject({ status: 504 });
  });

  it('clears timer when resolver completes before timeout', async () => {
    const cap = capability(async () => 'fast').enhance(withTimeout(1000));
    await cap.resolve(undefined, ctx);
    expect(vi.getTimerCount()).toBe(0);
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

describe('withCache isolation', () => {
  it('two withCache enhancers do not share state', async () => {
    const cache1 = withCache(60);
    const cache2 = withCache(60);
    const cap1 = capability(async () => 'a').enhance(cache1);
    const cap2 = capability(async () => 'b').enhance(cache2);

    await cap1.resolve(undefined, ctx);
    const result = await cap2.resolve(undefined, ctx);

    expect(result).toBe('b');
  });
});

describe('withRateLimit', () => {
  beforeEach(() => { vi.useFakeTimers(); });
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

// ---------------------------------------------------------------------------
// withRollback
// ---------------------------------------------------------------------------

type RollbackCtx = { requestId: string; onRollback: (fn: () => void | Promise<void>) => void };

// Capability receives the enhanced context (with onRollback) as a parameter
function makeTxCap<T>(resolver: (txCtx: RollbackCtx) => T) {
  return capability((_input: undefined, c: unknown) => resolver(c as RollbackCtx)).enhance(withRollback);
}

describe('withRollback', () => {
  it('does not call rollbacks on success', async () => {
    const rb = vi.fn();
    const cap = makeTxCap((c) => { c.onRollback(rb); return 'ok'; });
    await cap.resolve(undefined, ctx);
    expect(rb).not.toHaveBeenCalled();
  });

  it('calls rollbacks in reverse order on failure', async () => {
    const order: number[] = [];
    const cap = makeTxCap((c) => {
      c.onRollback(() => { order.push(1); });
      c.onRollback(() => { order.push(2); });
      c.onRollback(() => { order.push(3); });
      throw new Error('boom');
    });
    await tryResolve(cap);
    expect(order).toEqual([3, 2, 1]);
  });

  it('re-throws the original error after rollbacks', async () => {
    const cap = capability(() => { throw new Error('original'); }).enhance(withRollback);
    const err = await tryResolve(cap);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('original');
  });

  it('continues rollbacks even if one fails', async () => {
    const order: number[] = [];
    const cap = makeTxCap((c) => {
      c.onRollback(() => { order.push(1); throw new Error('rb fail'); });
      c.onRollback(() => { order.push(2); });
      throw new Error('main fail');
    });
    await tryResolve(cap);
    // Both rollbacks ran despite the first one failing (reversed: 2 then 1)
    expect(order).toEqual([2, 1]);
  });

  it('rollback errors do not replace the original error', async () => {
    const cap = makeTxCap((c) => {
      c.onRollback(() => { throw new Error('rollback error'); });
      throw new Error('original error');
    });
    const err = await tryResolve(cap);
    expect((err as Error).message).toBe('original error');
  });

  it('ctx.onRollback is available in resolver when enhancer is applied', async () => {
    let hasOnRollback = false;
    const cap = makeTxCap((c) => { hasOnRollback = typeof c.onRollback === 'function'; return 'ok'; });
    await cap.resolve(undefined, ctx);
    expect(hasOnRollback).toBe(true);
  });

  it('async rollbacks are awaited in reverse order', async () => {
    const order: number[] = [];
    const cap = makeTxCap((c) => {
      c.onRollback(async () => { await Promise.resolve(); order.push(1); });
      c.onRollback(async () => { await Promise.resolve(); order.push(2); });
      throw new Error('fail');
    });
    await tryResolve(cap);
    expect(order).toEqual([2, 1]);
  });

  it('no rollbacks registered — failure still re-throws', async () => {
    const cap = capability(() => { throw new Error('plain fail'); }).enhance(withRollback);
    const err = await tryResolve(cap);
    expect((err as Error).message).toBe('plain fail');
  });
});

describe('withRateLimit isolation', () => {
  it('two withRateLimit enhancers do not share counters', async () => {
    const rl1 = withRateLimit({ limit: 1, windowMs: 60_000 });
    const rl2 = withRateLimit({ limit: 1, windowMs: 60_000 });
    const cap1 = capability(async () => 'ok').enhance(rl1);
    const cap2 = capability(async () => 'ok').enhance(rl2);

    await cap1.resolve(undefined, ctx); // exhausts rl1's counter

    // rl2 must still have its own counter at zero
    await expect(cap2.resolve(undefined, ctx)).resolves.toBe('ok');
  });
});
