import { describe, it, expect, vi } from 'vitest';
import { createServer, defineConfig } from './server.js';
import { defineContext } from './context.js';
import { capability } from './capability.js';
import { definePlugin } from './plugin.js';
import type { Transport, MountOptions } from './server.js';
import type { InvokeFn } from './execution-engine.js';

function mockTransport(): Transport & { mounted: boolean; unmounted: boolean } {
  const t = {
    mounted: false,
    unmounted: false,
    async mount(_invoke: InvokeFn, _opts: MountOptions): Promise<void> {
      t.mounted = true;
    },
    async unmount(): Promise<void> {
      t.unmounted = true;
    },
  };
  return t;
}

const buildCtx = defineContext(async () => ({ requestId: 'test-id' }));
const ping = capability(() => ({ pong: true }));

describe('defineConfig', () => {
  it('returns the config unchanged', () => {
    const cfg = { context: buildCtx, capabilities: { ping }, transports: [] };
    expect(defineConfig(cfg)).toBe(cfg);
  });
});

describe('createServer', () => {
  it('start() mounts all transports', async () => {
    const t1 = mockTransport();
    const t2 = mockTransport();
    const server = createServer({ context: buildCtx, capabilities: { ping }, transports: [t1, t2] });
    await server.start();
    expect(t1.mounted).toBe(true);
    expect(t2.mounted).toBe(true);
    await server.stop();
  });

  it('stop() unmounts all transports', async () => {
    const t = mockTransport();
    const server = createServer({ context: buildCtx, capabilities: { ping }, transports: [t] });
    await server.start();
    await server.stop();
    expect(t.unmounted).toBe(true);
  });

  it('invoke() calls the execution engine', async () => {
    const server = createServer({ context: buildCtx, capabilities: { ping }, transports: [] });
    const res = await server.invoke({
      capability: 'ping',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res).toEqual({ ok: true, data: { pong: true } });
  });

  it('invoke() returns 404 for unknown capability', async () => {
    const server = createServer({ context: buildCtx, capabilities: { ping }, transports: [] });
    const res = await server.invoke({
      capability: 'nope',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(404);
  });

  it('merges plugin capabilities into the registry', async () => {
    const health = capability(() => ({ status: 'ok' }));
    const plugin = definePlugin({ name: 'health', capabilities: { health } });
    const server = createServer({
      context: buildCtx,
      capabilities: { ping },
      transports: [],
      plugins: [plugin],
    });
    const res = await server.invoke({
      capability: 'health',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res).toEqual({ ok: true, data: { status: 'ok' } });
  });

  it('warns when no transports registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = createServer({ context: buildCtx, capabilities: { ping }, transports: [] });
    await server.start();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no transports'));
    warn.mockRestore();
  });

  it('warns when no capabilities registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = createServer({ context: buildCtx, capabilities: {}, transports: [] });
    await server.start();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no capabilities'));
    warn.mockRestore();
  });

  it('throws when plugin capability name collides with user capability', () => {
    const health = capability(() => ({ status: 'ok' }));
    const plugin = definePlugin({ name: 'health', capabilities: { ping: health } });
    expect(() =>
      createServer({
        context: buildCtx,
        capabilities: { ping },
        transports: [],
        plugins: [plugin],
      }),
    ).toThrow(/Capability name collision.*ping/);
  });

  it('isDevelopment defaults to !NODE_ENV=production', async () => {
    const old = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    const prodServer = createServer({ context: buildCtx, capabilities: { ping }, transports: [] });
    const res = await prodServer.invoke({
      capability: 'ping',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res.ok).toBe(true);
    process.env['NODE_ENV'] = old;
  });

  it('explicit isDevelopment overrides NODE_ENV', async () => {
    const t = mockTransport();
    const server = createServer({
      context: buildCtx,
      capabilities: { ping },
      transports: [t],
      isDevelopment: true,
    });
    await server.start();
    const res = await server.invoke({
      capability: 'ping',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res.ok).toBe(true);
    await server.stop();
  });
});
