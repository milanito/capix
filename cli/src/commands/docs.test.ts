import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry, defineGuard } from '@capixjs/core';
import { generateRoutes } from '@capixjs/transport-rest';
import { capabilityToMarkdown } from './docs.js';

const g = defineGuard((_ctx: { requestId: string }) => {});

describe('capabilityToMarkdown', () => {
  it('renders name, intent, and "none" input for a no-schema capability', () => {
    const registry = compileRegistry({ system: { ping: capability(() => 'pong', 'query') } });
    const cap = registry.get('system.ping')!;
    const md = capabilityToMarkdown('system.ping', cap, []);
    expect(md).toContain('### `system.ping`');
    expect(md).toContain('**Intent:** query');
    expect(md).toContain('**Input:** none');
  });

  it('renders the HTTP route when one is found in the routes list', () => {
    const registry = compileRegistry({ items: { getItem: capability(z.object({ id: z.string() }), (i) => i, 'query') } });
    const cap = registry.get('items.getItem')!;
    const routes = generateRoutes(registry);
    const md = capabilityToMarkdown('items.getItem', cap, routes);
    expect(md).toContain('**HTTP:** `GET /items/:id`');
  });

  it('omits the HTTP line when no matching route is found', () => {
    const registry = compileRegistry({ system: { ping: capability(() => 'pong', 'query') } });
    const cap = registry.get('system.ping')!;
    const md = capabilityToMarkdown('system.ping', cap, []);
    expect(md).not.toContain('**HTTP:**');
  });

  it('renders guard count, pluralized correctly', () => {
    const registry = compileRegistry({ items: { doThing: capability(() => 1).guard(g).guard(g) } });
    const cap = registry.get('items.doThing')!;
    const md = capabilityToMarkdown('items.doThing', cap, []);
    expect(md).toContain('**Guards:** 2 guards');
  });

  it('omits the guards line entirely when there are no guards', () => {
    const registry = compileRegistry({ items: { doThing: capability(() => 1) } });
    const cap = registry.get('items.doThing')!;
    const md = capabilityToMarkdown('items.doThing', cap, []);
    expect(md).not.toContain('**Guards:**');
  });

  it('renders the input schema as a readable type, not raw Zod internals', () => {
    const registry = compileRegistry({ items: { create: capability(z.object({ name: z.string() }), (i) => i) } });
    const cap = registry.get('items.create')!;
    const md = capabilityToMarkdown('items.create', cap, []);
    expect(md).toContain('**Input:**');
    expect(md).not.toContain('ZodObject');
    expect(md).not.toContain('_def');
  });

  it('renders an output line only when .output() was set', () => {
    const withOutput = compileRegistry({
      items: { getItem: capability(() => ({ id: '1' }), 'query').output(z.object({ id: z.string() })) },
    }).get('items.getItem')!;
    const withoutOutput = compileRegistry({ items: { getItem: capability(() => ({ id: '1' }), 'query') } }).get(
      'items.getItem',
    )!;

    expect(capabilityToMarkdown('items.getItem', withOutput, [])).toContain('**Output:**');
    expect(capabilityToMarkdown('items.getItem', withoutOutput, [])).not.toContain('**Output:**');
  });
});
