import { describe, it, expect, vi } from 'vitest';
import { defineGuard, runGuards } from './guards.js';
import { defaultErrors } from './errors.js';

const baseCtx = { requestId: 'test' };

describe('defineGuard', () => {
  it('is a pass-through', () => {
    const fn = (ctx: typeof baseCtx) => {
      if (!('requestId' in ctx)) throw defaultErrors.Unauthorized();
    };
    expect(defineGuard(fn)).toBe(fn);
  });
});

describe('runGuards', () => {
  it('passes silently when all guards pass', async () => {
    const g1 = vi.fn();
    const g2 = vi.fn();
    await expect(runGuards([g1, g2], baseCtx)).resolves.toBeUndefined();
    expect(g1).toHaveBeenCalledWith(baseCtx);
    expect(g2).toHaveBeenCalledWith(baseCtx);
  });

  it('resolves with empty guard array', async () => {
    await expect(runGuards([], baseCtx)).resolves.toBeUndefined();
  });

  it('resolves with single passing guard', async () => {
    const g = vi.fn();
    await expect(runGuards([g], baseCtx)).resolves.toBeUndefined();
    expect(g).toHaveBeenCalledWith(baseCtx);
  });

  it('rejects with single failing guard', async () => {
    const g = vi.fn(() => { throw defaultErrors.Unauthorized(); });
    await expect(runGuards([g], baseCtx)).rejects.toBeDefined();
  });

  it('stops at first failing guard', async () => {
    const g1 = vi.fn(() => { throw defaultErrors.Unauthorized(); });
    const g2 = vi.fn();
    await expect(runGuards([g1, g2], baseCtx)).rejects.toBeDefined();
    expect(g2).not.toHaveBeenCalled();
  });

  it('works with async guards', async () => {
    const g1 = vi.fn(async () => { /* pass */ });
    const g2 = vi.fn(async () => { throw defaultErrors.Forbidden(); });
    const g3 = vi.fn();
    await expect(runGuards([g1, g2, g3], baseCtx)).rejects.toBeDefined();
    expect(g1).toHaveBeenCalled();
    expect(g2).toHaveBeenCalled();
    expect(g3).not.toHaveBeenCalled();
  });

  it('runs all guards in order when none fail', async () => {
    const order: number[] = [];
    const g1 = vi.fn(() => { order.push(1); });
    const g2 = vi.fn(() => { order.push(2); });
    const g3 = vi.fn(() => { order.push(3); });
    await runGuards([g1, g2, g3], baseCtx);
    expect(order).toEqual([1, 2, 3]);
  });

  it('propagates non-FrameworkError from a guard', async () => {
    const err = new Error('unexpected');
    const g = vi.fn(() => { throw err; });
    await expect(runGuards([g], baseCtx)).rejects.toBe(err);
  });

  it('sync guard that throws FrameworkError is rejected correctly', async () => {
    const guard = vi.fn(() => { throw defaultErrors.Forbidden(); });
    const result = await runGuards([guard], baseCtx).catch((e) => e);
    expect(result).toBeDefined();
    expect(result.status).toBe(403);
  });
});
