import { describe, it, expect, vi } from 'vitest';

// Isolated from ai-context.test.ts because it needs generateRoutes to throw —
// mocking it here would otherwise affect every other test in that file.
vi.mock('@capixjs/transport-rest', () => ({
  generateRoutes: () => {
    throw new Error('[capix] Duplicate route: GET /items/:id (capability: items.b)');
  },
}));

describe('buildAiContext — route generation failure', () => {
  it('degrades gracefully (no http fields) instead of throwing when generateRoutes throws', async () => {
    const { capability, compileRegistry } = await import('@capixjs/core');
    const { buildAiContext } = await import('./ai-context.js');

    const registry = compileRegistry({ items: { getItem: capability(() => null, 'query') } });

    let doc: { capabilities: Array<{ http?: unknown }> } | undefined;
    expect(() => {
      doc = JSON.parse(buildAiContext(registry, 'app')) as typeof doc;
    }).not.toThrow();
    expect(doc?.capabilities[0]?.http).toBeUndefined();
  });
});
