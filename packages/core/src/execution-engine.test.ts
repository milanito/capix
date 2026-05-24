import { describe, it, expect } from 'vitest';
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
});
