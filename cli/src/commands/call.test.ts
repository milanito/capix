import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Command } from 'commander';
import { capability, compileRegistry, defineError } from '@capixjs/core';
import type { CapabilityRegistry } from '@capixjs/core';
import { registerCall } from './call.js';
import { loadRegistry } from '../utils/loader.js';

vi.mock('../utils/loader.js', () => ({
  loadRegistry: vi.fn(),
}));

class ProcessExitError extends Error {
  constructor(public code: number) { super(`process.exit(${code})`); }
}

function mockRegistry(registry: CapabilityRegistry): void {
  vi.mocked(loadRegistry).mockResolvedValue({ registry });
}

async function runCall(args: string[]): Promise<{ logs: string; errors: string; exitCode: number | null }> {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new ProcessExitError(exitCode);
  }) as never);
  const program = new Command();
  registerCall(program);
  try {
    await program.parseAsync(['call', ...args], { from: 'user' });
  } catch (err) {
    if (!(err instanceof ProcessExitError)) throw err;
  }
  return { logs: logs.join('\n'), errors: errors.join('\n'), exitCode };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('call command', () => {
  it('invokes the capability and pretty-prints the result', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => ({ pong: true }), 'query') } }));
    const { logs, exitCode } = await runCall(['system.ping']);
    expect(exitCode).toBeNull();
    expect(logs).toContain('system.ping');
    expect(logs).toContain('"pong": true');
  });

  it('--json prints only raw JSON, no decoration', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => ({ pong: true }), 'query') } }));
    const { logs } = await runCall(['system.ping', '--json']);
    expect(logs.trim()).toBe(JSON.stringify({ pong: true }, null, 2));
  });

  it('parses JSON input and passes it to the resolver', async () => {
    mockRegistry(compileRegistry({
      items: { getItem: capability(z.object({ id: z.string() }), ({ id }) => ({ id }), 'query') },
    }));
    const { logs } = await runCall(['items.getItem', '{"id":"42"}', '--json']);
    expect(JSON.parse(logs)).toEqual({ id: '42' });
  });

  it('unknown capability: error + exit(1)', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const { errors, exitCode } = await runCall(['system.pong']);
    expect(errors).toMatch(/not found/i);
    expect(exitCode).toBe(1);
  });

  it('invalid JSON input: fatal error + exit(1)', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const { errors, exitCode } = await runCall(['system.ping', '{not valid json']);
    expect(errors).toMatch(/Invalid JSON input/);
    expect(exitCode).toBe(1);
  });

  it('capability throws a typed FrameworkError: prints status/message, exit(1)', async () => {
    const NotFound = defineError(404, 'Not found');
    mockRegistry(compileRegistry({
      items: { getItem: capability(() => { throw NotFound(); }, 'query') },
    }));
    const { errors, exitCode } = await runCall(['items.getItem']);
    expect(errors).toMatch(/404/);
    expect(errors).toMatch(/Not found/);
    expect(exitCode).toBe(1);
  });

  it('capability throws a FrameworkError with meta: meta is printed', async () => {
    const RateLimited = defineError(429, 'Too many requests');
    mockRegistry(compileRegistry({
      items: { getItem: capability(() => { throw RateLimited({ retryAfter: 30 }); }, 'query') },
    }));
    const { logs, exitCode } = await runCall(['items.getItem']);
    expect(logs).toContain('"retryAfter": 30');
    expect(exitCode).toBe(1);
  });

  it('--json + error response: prints error as JSON on stderr, exit(1)', async () => {
    const Forbidden = defineError(403, 'Forbidden');
    mockRegistry(compileRegistry({
      items: { getItem: capability(() => { throw Forbidden(); }, 'query') },
    }));
    const { errors, exitCode } = await runCall(['items.getItem', '--json']);
    const parsed = JSON.parse(errors) as { status: number; error: string };
    expect(parsed.status).toBe(403);
    expect(exitCode).toBe(1);
  });

  it('no input arg defaults to an empty object', async () => {
    mockRegistry(compileRegistry({
      items: { list: capability(z.object({}), () => ({ ok: true }), 'query') },
    }));
    const { logs, exitCode } = await runCall(['items.list', '--json']);
    expect(exitCode).toBeNull();
    expect(JSON.parse(logs)).toEqual({ ok: true });
  });
});
