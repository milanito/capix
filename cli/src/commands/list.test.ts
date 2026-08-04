import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { capability, compileRegistry, defineGuard } from '@capixjs/core';
import type { CapabilityRegistry } from '@capixjs/core';
import { registerList } from './list.js';
import { loadRegistry } from '../utils/loader.js';

vi.mock('../utils/loader.js', () => ({
  loadRegistry: vi.fn(),
}));

const g = defineGuard((_ctx: { requestId: string }) => {});

function mockRegistry(registry: CapabilityRegistry): void {
  vi.mocked(loadRegistry).mockResolvedValue({ registry });
}

async function runList(): Promise<string> {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { logs.push(args.join(' ')); });
  const program = new Command();
  registerList(program);
  await program.parseAsync(['list'], { from: 'user' });
  return logs.join('\n');
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list command', () => {
  it('warns and prints nothing else when the registry is empty', async () => {
    mockRegistry(compileRegistry({}) as CapabilityRegistry);
    const out = await runList();
    expect(out).toMatch(/No capabilities found/);
  });

  it('prints a header with the capability count', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const out = await runList();
    expect(out).toMatch(/Capabilities \(1\)/);
  });

  it('labels an unguarded capability as public', async () => {
    mockRegistry(compileRegistry({ system: { ping: capability(() => 1, 'query') } }));
    const out = await runList();
    expect(out).toContain('public');
  });

  it('labels a guarded capability with its guard count', async () => {
    mockRegistry(compileRegistry({ items: { doThing: capability(() => 1).guard(g).guard(g) } }));
    const out = await runList();
    expect(out).toMatch(/2 guards/);
  });

  it('shows the inferred HTTP method and path', async () => {
    mockRegistry(compileRegistry({ items: { getItem: capability(() => 1, 'query') } }));
    const out = await runList();
    expect(out).toContain('items.getItem');
    expect(out).toContain('GET');
  });
});
