import { describe, it, expect } from 'vitest';
import { definePlugin, mergePlugins } from './plugin.js';
import { capability } from './capability.js';
import type { BaseContext } from './context.js';

const ping = capability(() => 'pong');
const pong = capability(() => 'ping');

describe('definePlugin', () => {
  it('returns the plugin unchanged', () => {
    const plugin = { name: 'test', capabilities: { ping } };
    expect(definePlugin(plugin)).toBe(plugin);
  });
});

describe('mergePlugins', () => {
  it('no plugins — empty additionalCapabilities and identity wrapContext', async () => {
    const merged = mergePlugins([]);
    expect(merged.additionalCapabilities).toEqual({});
    const ctx: BaseContext = { requestId: 'r1' };
    const builder = merged.wrapContext(async () => ctx);
    expect(await builder({ headers: {}, method: 'GET', url: '/', signal: AbortSignal.timeout(100) })).toBe(ctx);
  });

  it('collects capabilities from plugins', () => {
    const plugin = definePlugin({ name: 'myPlugin', capabilities: { ping } });
    const merged = mergePlugins([plugin]);
    expect(merged.additionalCapabilities['ping']).toBe(ping);
  });

  it('merges capabilities from multiple plugins', () => {
    const a = definePlugin({ name: 'a', capabilities: { ping } });
    const b = definePlugin({ name: 'b', capabilities: { pong } });
    const merged = mergePlugins([a, b]);
    expect(merged.additionalCapabilities['ping']).toBe(ping);
    expect(merged.additionalCapabilities['pong']).toBe(pong);
  });

  it('throws on capability name collision across plugins', () => {
    const a = definePlugin({ name: 'a', capabilities: { ping } });
    const b = definePlugin({ name: 'b', capabilities: { ping } });
    expect(() => mergePlugins([a, b])).toThrow(/collision/i);
  });

  it('wrapContext applies context extensions in order', async () => {
    const log: string[] = [];
    const p1 = definePlugin({
      name: 'p1',
      context: (ctx) => { log.push('p1'); return ctx; },
    });
    const p2 = definePlugin({
      name: 'p2',
      context: (ctx) => { log.push('p2'); return ctx; },
    });
    const merged = mergePlugins([p1, p2]);
    const base: BaseContext = { requestId: 'x' };
    await merged.wrapContext(async () => base)(
      { headers: {}, method: 'GET', url: '/', signal: AbortSignal.timeout(100) },
    );
    expect(log).toEqual(['p1', 'p2']);
  });

  it('plugin with no context extension still wraps correctly', async () => {
    const plugin = definePlugin({ name: 'noop' });
    const merged = mergePlugins([plugin]);
    const ctx: BaseContext = { requestId: 'z' };
    const result = await merged.wrapContext(async () => ctx)(
      { headers: {}, method: 'GET', url: '/', signal: AbortSignal.timeout(100) },
    );
    expect(result).toBe(ctx);
  });
});
