import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Command } from 'commander';
import { capability, compileRegistry } from '@capixjs/core';
import type { CapabilityRegistry } from '@capixjs/core';
import { registerCheck } from './check.js';
import { loadRegistry } from '../utils/loader.js';
import { renderCapabilityTs } from '../templates/generate.js';

vi.mock('../utils/loader.js', () => ({
  loadRegistry: vi.fn(),
}));

class ProcessExitError extends Error {
  constructor(public code: number) { super(`process.exit(${code})`); }
}

function mockRegistry(registry: CapabilityRegistry): void {
  vi.mocked(loadRegistry).mockResolvedValue({ registry });
}

async function runCheck(): Promise<{ logs: string; exitCode: number | null }> {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args) => { logs.push(args.join(' ')); });
  let exitCode: number | null = null;
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new ProcessExitError(exitCode);
  }) as never);
  const program = new Command();
  registerCheck(program);
  try {
    await program.parseAsync(['check'], { from: 'user' });
  } catch (err) {
    if (!(err instanceof ProcessExitError)) throw err;
  }
  return { logs: logs.join('\n'), exitCode };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('check command', () => {
  it('passes cleanly for a well-formed registry, no exit', async () => {
    mockRegistry(compileRegistry({
      items: { getItem: capability(z.object({ id: z.string() }), (i) => i, 'query') },
    }));
    const { logs, exitCode } = await runCheck();
    expect(logs).toMatch(/All checks passed/);
    expect(exitCode).toBeNull();
  });

  it('warns (but does not exit) when a mutation has no input schema', async () => {
    mockRegistry(compileRegistry({ items: { createItem: capability(() => ({}), 'mutation') } }));
    const { logs, exitCode } = await runCheck();
    expect(logs).toMatch(/has no input schema/);
    expect(exitCode).toBeNull();
  });

  it('does not warn about missing input schema for query capabilities', async () => {
    mockRegistry(compileRegistry({ items: { getItem: capability(() => ({}), 'query') } }));
    const { logs } = await runCheck();
    expect(logs).not.toMatch(/has no input schema/);
  });

  it('flags a scaffold placeholder resolver', async () => {
    mockRegistry(compileRegistry({
      items: {
        getItem: capability(() => { throw new Error('TODO: implement'); }, 'query'),
      },
    }));
    const { logs } = await runCheck();
    expect(logs).toMatch(/scaffold placeholder/);
  });

  it('flags a capability freshly scaffolded by `capix generate capability`, untouched', async () => {
    // Derives the resolver from the actual template output (not a hand-typed
    // stand-in) so this test breaks if renderCapabilityTs's placeholder marker
    // and check's PLACEHOLDER_PATTERNS ever drift apart.
    const source = renderCapabilityTs('getItem', false);
    const captured = source.match(/capability\((async[\s\S]*)\);\n$/)?.[1];
    if (captured === undefined) throw new Error('renderCapabilityTs output shape changed — update this test');
    // eslint-disable-next-line no-eval
    const resolver = (0, eval)(captured) as (input: unknown, ctx: unknown) => unknown;
    mockRegistry(compileRegistry({ items: { getItem: capability(resolver, 'query') } }));
    const { logs } = await runCheck();
    expect(logs).toMatch(/scaffold placeholder/);
  });

  it('flags a non-camelCase key segment', async () => {
    // 'Get' with an uppercase leading letter passes compileRegistry's VALID_KEY
    // check (which only requires starting with any letter) but fails check's
    // stricter camelCase convention (must start lowercase).
    mockRegistry(compileRegistry({ items: { Get: capability(() => 1, 'query') } }));
    const { logs } = await runCheck();
    expect(logs).toMatch(/should be camelCase/);
  });

  it('flags a nested-resource-shaped key name', async () => {
    mockRegistry(compileRegistry({ projects: { listProjectTasks: capability(() => [], 'query') } }));
    const { logs } = await runCheck();
    expect(logs).toMatch(/nested resource/);
  });

  it('exits 1 on a real route conflict', async () => {
    mockRegistry(compileRegistry({
      items: {
        // Two DELETE capabilities that both infer to DELETE /items/:id — a genuine router conflict.
        deleteItem: capability(z.object({ id: z.string() }), () => null, 'delete'),
        removeItem: capability(z.object({ id: z.string() }), () => null, 'delete'),
      },
    }));
    const { logs, exitCode } = await runCheck();
    expect(logs).toMatch(/Route conflict|conflict/i);
    expect(exitCode).toBe(1);
  });
});
