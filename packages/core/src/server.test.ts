import { describe, it, expect, vi } from 'vitest';
import { createServer, defineConfig } from './server.js';
import { defineContext } from './context.js';
import { capability, compileRegistry } from './capability.js';
import { definePlugin } from './plugin.js';
import type { Transport, MountOptions, TransportWithCapabilities } from './server.js';
import type { InvokeFn } from './execution-engine.js';
import type { CapabilityRegistry } from './capability.js';

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

function capturingTransport(caps?: TransportWithCapabilities['_capabilities']): TransportWithCapabilities & {
  capturedRegistry: CapabilityRegistry | null;
  capturedInvoke: InvokeFn | null;
} {
  const t = {
    ...(caps !== undefined ? { _capabilities: caps } : {}),
    capturedRegistry: null as CapabilityRegistry | null,
    capturedInvoke:   null as InvokeFn | null,
    async mount(invoke: InvokeFn, opts: MountOptions): Promise<void> {
      t.capturedRegistry = opts.registry;
      t.capturedInvoke   = invoke;
    },
    async unmount(): Promise<void> {},
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

  it('throws when a plugin capability collides with a per-transport capability, not just the server default', () => {
    const health = capability(() => ({ status: 'ok' }));
    const plugin = definePlugin({ name: 'health', capabilities: { ping: health } });
    // No server-level 'ping' here — only this transport declares one. The
    // collision check must still catch it instead of letting the plugin
    // capability silently shadow it once start() merges the two trees.
    const t = capturingTransport({ ping });
    expect(() =>
      createServer({
        context: buildCtx,
        transports: [t],
        plugins: [plugin],
      }),
    ).toThrow(/Capability name collision.*ping.*transport #0/);
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

describe('per-transport capabilities', () => {
  const restCap  = capability(() => 'rest-only',  'query');
  const queueCap = capability(() => 'queue-only', 'mutation');
  const sharedCap = capability(() => 'shared',    'query');

  it('transport-specific capabilities override server-level default', async () => {
    const t = capturingTransport({ rest: { restCap } });
    const server = createServer({
      context:      buildCtx,
      capabilities: { queue: { queueCap } },
      transports:   [t],
    });
    await server.start();

    expect(t.capturedRegistry?.has('rest.restCap')).toBe(true);
    expect(t.capturedRegistry?.has('queue.queueCap')).toBe(false);
    await server.stop();
  });

  it('server-level capabilities used when transport has none', async () => {
    const t = capturingTransport();  // no _capabilities
    const server = createServer({
      context:      buildCtx,
      capabilities: { queue: { queueCap } },
      transports:   [t],
    });
    await server.start();

    expect(t.capturedRegistry?.has('queue.queueCap')).toBe(true);
    await server.stop();
  });

  it('two transports receive separate registries', async () => {
    const t1 = capturingTransport({ rest:  { restCap }  });
    const t2 = capturingTransport({ queue: { queueCap } });
    const server = createServer({ context: buildCtx, transports: [t1, t2] });
    await server.start();

    expect(t1.capturedRegistry?.has('rest.restCap')).toBe(true);
    expect(t1.capturedRegistry?.has('queue.queueCap')).toBe(false);

    expect(t2.capturedRegistry?.has('queue.queueCap')).toBe(true);
    expect(t2.capturedRegistry?.has('rest.restCap')).toBe(false);

    expect(t1.capturedRegistry).not.toBe(t2.capturedRegistry);
    await server.stop();
  });

  it('same capability object in multiple transports is valid', async () => {
    const t1 = capturingTransport({ shared: { sharedCap } });
    const t2 = capturingTransport({ shared: { sharedCap } });
    const server = createServer({ context: buildCtx, transports: [t1, t2] });
    await server.start();

    expect(t1.capturedRegistry?.has('shared.sharedCap')).toBe(true);
    expect(t2.capturedRegistry?.has('shared.sharedCap')).toBe(true);
    await server.stop();
  });

  it('throws at startup when transport has no capabilities and no server default', async () => {
    const t = capturingTransport();  // no _capabilities
    const server = createServer({ context: buildCtx, transports: [t] });

    await expect(server.start()).rejects.toThrow(/no capabilities/);
  });

  it('per-transport invoke resolves from the transport registry', async () => {
    const t = capturingTransport({ rest: { restCap } });
    const server = createServer({ context: buildCtx, transports: [t] });
    await server.start();

    const res = await t.capturedInvoke!({
      capability: 'rest.restCap',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res).toEqual({ ok: true, data: 'rest-only' });
    await server.stop();
  });

  it('per-transport invoke returns 404 for capability outside its registry', async () => {
    const t = capturingTransport({ rest: { restCap } });
    const server = createServer({ context: buildCtx, transports: [t] });
    await server.start();

    const res = await t.capturedInvoke!({
      capability: 'queue.queueCap',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.status).toBe(404);
    await server.stop();
  });

  it('plugin capabilities merged into per-transport registries', async () => {
    const health = capability(() => ({ status: 'ok' }));
    const plugin = definePlugin({ name: 'health', capabilities: { health } });
    const t = capturingTransport({ rest: { restCap } });
    const server = createServer({ context: buildCtx, transports: [t], plugins: [plugin] });
    await server.start();

    expect(t.capturedRegistry?.has('rest.restCap')).toBe(true);
    expect(t.capturedRegistry?.has('health')).toBe(true);
    await server.stop();
  });
});

describe('createServer backwards compatibility', () => {
  it('existing code with top-level capabilities still works unchanged', async () => {
    const t = capturingTransport();
    const server = createServer({
      context:      buildCtx,
      capabilities: { ping },
      transports:   [t],
    });
    await server.start();

    expect(t.capturedRegistry?.has('ping')).toBe(true);
    const res = await t.capturedInvoke!({
      capability: 'ping',
      input: {},
      headers: {},
      signal: AbortSignal.timeout(5000),
    });
    expect(res).toEqual({ ok: true, data: { pong: true } });
    await server.stop();
  });

  it('all transports receive same registry when only top-level capabilities set', async () => {
    const t1 = capturingTransport();
    const t2 = capturingTransport();
    const server = createServer({
      context:      buildCtx,
      capabilities: { ping },
      transports:   [t1, t2],
    });
    await server.start();

    expect(t1.capturedRegistry?.has('ping')).toBe(true);
    expect(t2.capturedRegistry?.has('ping')).toBe(true);
    // Each transport gets a freshly compiled registry (same content, different Map instance)
    expect(t1.capturedRegistry?.size).toBe(t2.capturedRegistry?.size);
    await server.stop();
  });

  it('capabilities field optional when all transports specify their own', async () => {
    const t = capturingTransport({ ping: { } as never });
    // No top-level capabilities — should NOT throw
    const server = createServer({ context: buildCtx, transports: [t] });
    await expect(server.start()).resolves.toBeUndefined();
    await server.stop();
  });
});
