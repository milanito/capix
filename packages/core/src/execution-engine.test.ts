import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { capability } from './capability.js';
import { compileRegistry } from './capability.js';
import { createExecutionEngine } from './execution-engine.js';
import { defineError, defaultErrors } from './errors.js';

const buildContext = async () => ({ requestId: 'test-id', user: null as null | { id: string } });
const signal = AbortSignal.timeout(5000);

function makeEngine(caps: Record<string, unknown>, isDevelopment = true) {
  const registry = compileRegistry(caps as Parameters<typeof compileRegistry>[0]);
  return createExecutionEngine({ registry, buildContext, isDevelopment });
}

describe('execution engine', () => {
  it('happy path returns ok: true with data', async () => {
    const invoke = makeEngine({ ping: capability(() => ({ pong: true })) });
    const res = await invoke({ capability: 'ping', input: {}, headers: {}, signal });
    expect(res).toEqual({ ok: true, data: { pong: true } });
  });

  it('unknown capability returns 404', async () => {
    const invoke = makeEngine({});
    const res = await invoke({ capability: 'nope', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(404);
  });

  it('Zod validation failure returns 400 with issues', async () => {
    const cap = capability(z.object({ id: z.string() }), ({ id }) => id);
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: { id: 123 }, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(400);
      expect(res.error.meta).toBeDefined();
    }
  });

  it('guard failure returns correct status', async () => {
    const cap = capability(() => 1).guard(() => {
      throw defaultErrors.Unauthorized();
    });
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(401);
  });

  it('resolver FrameworkError maps to correct status', async () => {
    const NotFound = defineError(404, 'Not found');
    const cap = capability(() => { throw NotFound({ id: '1' }); });
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(404);
      expect(res.error.error).toBe('NotFound');
    }
  });

  it('unknown resolver error returns 500 (detail suppressed in production)', async () => {
    const cap = capability(() => { throw new Error('db crash'); });
    const invoke = makeEngine({ cap }, false);
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(500);
      expect(res.error.message).toBe('Internal server error');
    }
  });

  it('output schema validation failure returns 500 (not 400)', async () => {
    const cap = capability(() => ({ name: 'Alice' })).output(z.object({ id: z.string() }));
    const invoke = makeEngine({ cap }, true);
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
  });

  it('returning undefined from resolver returns 500', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = capability(() => undefined as any);
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
  });

  it('resolver returning null returns 200 with data: null', async () => {
    const cap = capability(() => null);
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res).toEqual({ ok: true, data: null });
  });

  it('output schema valid — 200 with validated data', async () => {
    const cap = capability(() => ({ id: '1', name: 'Alice' }))
      .output(z.object({ id: z.string(), name: z.string() }));
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ id: '1', name: 'Alice' });
  });

  it('no input schema — resolver called with raw input', async () => {
    const received = vi.fn();
    const cap = capability((input: undefined) => { received(input); return 'ok'; });
    const invoke = makeEngine({ cap });
    await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(received).toHaveBeenCalledWith(undefined);
  });

  it('zod .transform() — transformed value reaches resolver', async () => {
    const cap = capability(
      z.object({ n: z.string().transform(Number) }),
      ({ n }) => n * 2,
    );
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: { n: '5' }, headers: {}, signal });
    expect(res).toEqual({ ok: true, data: 10 });
  });

  it('buildContext FrameworkError maps to correct status', async () => {
    const registry = compileRegistry({ cap: capability(() => 'ok') });
    const invoke = createExecutionEngine({
      registry,
      buildContext: async () => { throw defaultErrors.Unauthorized(); },
      isDevelopment: true,
    });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(401);
  });

  it('buildContext unknown Error returns 500', async () => {
    const registry = compileRegistry({ cap: capability(() => 'ok') });
    const invoke = createExecutionEngine({
      registry,
      buildContext: async () => { throw new Error('db down'); },
      isDevelopment: false,
    });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
  });

  it('guard unknown Error returns 500', async () => {
    const cap = capability(() => 1).guard(() => { throw new Error('guard crash'); });
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
  });

  it('development mode includes error detail in 500', async () => {
    const cap = capability(() => { throw new Error('secret crash detail'); });
    const invoke = makeEngine({ cap }, true);
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(500);
      expect(res.error.message).toContain('secret crash detail');
    }
  });

  it('two guards — first passes, second fails', async () => {
    const cap = capability(() => 1)
      .guard(() => { /* pass */ })
      .guard(() => { throw defaultErrors.Forbidden(); });
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(403);
  });

  it('two guards both pass — resolver called', async () => {
    const cap = capability(() => 'success')
      .guard(() => { /* pass */ })
      .guard(() => { /* pass */ });
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res).toEqual({ ok: true, data: 'success' });
  });

  it('returning async iterable from resolver returns 500', async () => {
    const cap = capability(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { async *[Symbol.asyncIterator]() { yield 1; } } as any;
    });
    const invoke = makeEngine({ cap });
    const res = await invoke({ capability: 'cap', input: {}, headers: {}, signal });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(500);
  });

  it('concurrent invocations do not share state', async () => {
    const cap = capability(
      z.object({ n: z.number() }),
      async ({ n }) => {
        await new Promise((r) => setTimeout(r, 10));
        return n;
      },
    );
    const invoke = makeEngine({ cap });
    const [r1, r2, r3] = await Promise.all([
      invoke({ capability: 'cap', input: { n: 1 }, headers: {}, signal }),
      invoke({ capability: 'cap', input: { n: 2 }, headers: {}, signal }),
      invoke({ capability: 'cap', input: { n: 3 }, headers: {}, signal }),
    ]);
    expect(r1).toEqual({ ok: true, data: 1 });
    expect(r2).toEqual({ ok: true, data: 2 });
    expect(r3).toEqual({ ok: true, data: 3 });
  });
});
