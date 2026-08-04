import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Command } from 'commander';
import { capability, compileRegistry, defineGuard } from '@capixjs/core';
import type { CapabilityRegistry } from '@capixjs/core';
import { registerShow } from './show.js';
import { loadRegistry } from '../utils/loader.js';

vi.mock('../utils/loader.js', () => ({
  loadRegistry: vi.fn(),
}));

class ProcessExitError extends Error {
  constructor(public code: number) { super(`process.exit(${code})`); }
}

const g = defineGuard((_ctx: { requestId: string }) => {});

function mockRegistry(registry: CapabilityRegistry): void {
  vi.mocked(loadRegistry).mockResolvedValue({ registry });
}

async function runShow(capName: string): Promise<{ logs: string; errors: string }> {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as never);
  const program = new Command();
  registerShow(program);
  try {
    await program.parseAsync(['show', capName], { from: 'user' });
  } catch (err) {
    if (!(err instanceof ProcessExitError)) throw err;
  }
  return { logs: logs.join('\n'), errors: errors.join('\n') };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('show command', () => {
  it('prints intent and guard count for a found capability', async () => {
    mockRegistry(compileRegistry({ items: { getItem: capability(() => 1, 'query').guard(g) } }));
    const { logs } = await runShow('items.getItem');
    expect(logs).toContain('items.getItem');
    expect(logs).toMatch(/intent/);
    expect(logs).toMatch(/query/);
    expect(logs).toMatch(/guards/);
    expect(logs).toContain('1');
  });

  it('prints "input: none" for a no-schema capability', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const { logs } = await runShow('system.ping');
    expect(logs).toMatch(/input/);
    expect(logs).toMatch(/none/);
  });

  it('lists each input field with its readable type', async () => {
    mockRegistry(compileRegistry({
      items: { create: capability(z.object({ name: z.string(), count: z.number() }), (i) => i) },
    }));
    const { logs } = await runShow('items.create');
    expect(logs).toContain('name');
    expect(logs).toContain('count');
    expect(logs).not.toContain('ZodObject');
  });

  it('mentions the output schema when one is set', async () => {
    mockRegistry(compileRegistry({
      items: { getItem: capability(() => ({ id: '1' }), 'query').output(z.object({ id: z.string() })) },
    }));
    const { logs } = await runShow('items.getItem');
    expect(logs).toMatch(/output schema/);
  });

  it('exits 1 and prints an error for an unknown capability', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const { errors } = await runShow('system.pong');
    expect(errors).toMatch(/not found/i);
  });

  it('suggests close matches (fuzzy) for a near-miss capability name', async () => {
    mockRegistry(compileRegistry({ items: { getItem: capability(() => 1, 'query') } }));
    const { errors, logs } = await runShow('getItem');
    expect(errors).toMatch(/Did you mean/i);
    expect(logs).toContain('items.getItem');
  });

  it('actually calls process.exit(1) when the capability is not found', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ProcessExitError(code ?? 0);
    }) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const program = new Command();
    registerShow(program);
    await expect(program.parseAsync(['show', 'nope'], { from: 'user' })).rejects.toThrow(ProcessExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
