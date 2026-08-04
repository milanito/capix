import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry, defineGuard } from '@capixjs/core';
import { registrySnapshot, computeDiff } from './diff.js';

const g = defineGuard((_ctx: { requestId: string }) => {});

describe('registrySnapshot', () => {
  it('captures intent, guard count, and schema presence', () => {
    const registry = compileRegistry({
      users: {
        getUser: capability(z.object({ id: z.string() }), (i) => i, 'query').guard(g),
      },
    });
    const snap = registrySnapshot(registry);
    expect(snap.get('users.getUser')).toEqual({
      intent: 'query',
      guards: 1,
      hasInput: true,
      hasOutput: false,
    });
  });

  it('infers intent from key name when not explicit', () => {
    const registry = compileRegistry({ items: { deleteItem: capability(() => null) } });
    const snap = registrySnapshot(registry);
    expect(snap.get('items.deleteItem')?.intent).toBe('delete');
  });

  it('hasOutput reflects .output() schema', () => {
    const registry = compileRegistry({
      items: { getItem: capability(() => ({ id: '1' }), 'query').output(z.object({ id: z.string() })) },
    });
    const snap = registrySnapshot(registry);
    expect(snap.get('items.getItem')?.hasOutput).toBe(true);
  });
});

describe('computeDiff', () => {
  it('reports no differences for identical registries', () => {
    const build = () => compileRegistry({ system: { ping: capability(() => 'pong', 'query') } });
    const diff = computeDiff(build(), build());
    expect(diff).toEqual({ added: [], removed: [], changed: [] });
  });

  it('detects added capabilities', () => {
    const regA = compileRegistry({ system: { ping: capability(() => 1) } });
    const regB = compileRegistry({ system: { ping: capability(() => 1), health: capability(() => 2) } });
    const diff = computeDiff(regA, regB);
    expect(diff.added).toEqual(['system.health']);
    expect(diff.removed).toEqual([]);
  });

  it('detects removed capabilities', () => {
    const regA = compileRegistry({ system: { ping: capability(() => 1), health: capability(() => 2) } });
    const regB = compileRegistry({ system: { ping: capability(() => 1) } });
    const diff = computeDiff(regA, regB);
    expect(diff.removed).toEqual(['system.health']);
    expect(diff.added).toEqual([]);
  });

  it('detects an intent change', () => {
    const regA = compileRegistry({ items: { doThing: capability(() => 1, 'query') } });
    const regB = compileRegistry({ items: { doThing: capability(() => 1, 'mutation') } });
    const diff = computeDiff(regA, regB);
    expect(diff.changed).toEqual([['items.doThing', 'intent: query → mutation']]);
  });

  it('detects a guard count change', () => {
    const regA = compileRegistry({ items: { doThing: capability(() => 1) } });
    const regB = compileRegistry({ items: { doThing: capability(() => 1).guard(g) } });
    const diff = computeDiff(regA, regB);
    expect(diff.changed).toEqual([['items.doThing', 'guards: 0 → 1']]);
  });

  it('detects input/output schema presence changes', () => {
    const regA = compileRegistry({ items: { doThing: capability(() => 1) } });
    const regB = compileRegistry({
      items: { doThing: capability(z.object({ id: z.string() }), () => 1).output(z.object({ ok: z.boolean() })) },
    });
    const diff = computeDiff(regA, regB);
    expect(diff.changed).toEqual([['items.doThing', 'input: false → true, output: false → true']]);
  });

  it('unchanged capabilities do not appear in changed', () => {
    const build = () => compileRegistry({ items: { doThing: capability(z.object({ id: z.string() }), () => 1) } });
    const diff = computeDiff(build(), build());
    expect(diff.changed).toEqual([]);
  });
});
