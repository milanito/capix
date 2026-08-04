import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry, defineGuard } from '@capixjs/core';
import { buildAiContext, schemaToObject } from './ai-context.js';

const g = defineGuard((_ctx: { requestId: string }) => {});

describe('schemaToObject', () => {
  it('maps zod object shape to field -> type-name', () => {
    const schema = z.object({ id: z.string(), age: z.number() });
    expect(schemaToObject(schema)).toEqual({ id: 'string', age: 'number' });
  });

  it('returns null for null/undefined schema', () => {
    expect(schemaToObject(null)).toBeNull();
    expect(schemaToObject(undefined)).toBeNull();
  });

  it('returns null when the schema has no shape (not an object schema)', () => {
    expect(schemaToObject(z.string())).toBeNull();
  });
});

describe('buildAiContext', () => {
  it('includes project name and a generated timestamp', () => {
    const registry = compileRegistry({ system: { ping: capability(() => 'pong', 'query') } });
    const doc = JSON.parse(buildAiContext(registry, 'my-app')) as {
      project: string;
      generated: string;
      capabilities: unknown[];
    };
    expect(doc.project).toBe('my-app');
    expect(() => new Date(doc.generated).toISOString()).not.toThrow();
  });

  it('one entry per capability with intent, guards, and input', () => {
    const registry = compileRegistry({
      items: {
        getItem: capability(z.object({ id: z.string() }), (i) => i, 'query').guard(g),
      },
    });
    const doc = JSON.parse(buildAiContext(registry, 'app')) as {
      capabilities: Array<{ name: string; intent: string; guards: number; input: unknown; http?: unknown }>;
    };
    expect(doc.capabilities).toHaveLength(1);
    expect(doc.capabilities[0]).toMatchObject({
      name: 'items.getItem',
      intent: 'query',
      guards: 1,
      input: { id: 'string' },
    });
  });

  it('includes an http route when one is inferrable', () => {
    const registry = compileRegistry({ items: { getItem: capability(z.object({ id: z.string() }), (i) => i, 'query') } });
    const doc = JSON.parse(buildAiContext(registry, 'app')) as {
      capabilities: Array<{ http?: { method: string; path: string } }>;
    };
    expect(doc.capabilities[0]?.http).toEqual({ method: 'GET', path: '/items/:id' });
  });

  it('input is null for no-schema capabilities', () => {
    const registry = compileRegistry({ system: { ping: capability(() => 'pong', 'query') } });
    const doc = JSON.parse(buildAiContext(registry, 'app')) as { capabilities: Array<{ input: unknown }> };
    expect(doc.capabilities[0]?.input).toBeNull();
  });
});
