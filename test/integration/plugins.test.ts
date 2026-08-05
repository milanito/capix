import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import { capability, defineContext, createServer, defaultErrors } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { cors } from '@capixjs/plugin-cors';
import { helmet, mergeHooks } from '@capixjs/plugin-helmet';
import { loggingEnhancer, createLogger } from '@capixjs/plugin-logging';
import type { Server } from '@capixjs/core';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

const buildContext = defineContext(async () => ({ requestId: crypto.randomUUID() }));
const ping = capability(() => ({ ok: true }));

// ---------------------------------------------------------------------------
// CORS plugin
// ---------------------------------------------------------------------------

describe('cors plugin — string origin', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://localhost:${port}`;
    const corsOptions = cors({ origin: 'https://example.com' });
    server = createServer({
      context: buildContext,
      capabilities: { system: { ping } },
      transports: [restTransport({ port, ...corsOptions })],
    });
    await server.start();
  });

  afterAll(async () => { await server.stop(); });

  it('sets Access-Control-Allow-Origin to the configured origin', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });

  it('string origin does NOT set Vary (not dynamic)', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://other.com' },
    });
    expect(res.headers.get('Vary')).toBeNull();
  });
});

describe('cors plugin — function origin', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://localhost:${port}`;
    const corsOptions = cors({ origin: (o) => o === 'https://allowed.com' });
    server = createServer({
      context: buildContext,
      capabilities: { system: { ping } },
      transports: [restTransport({ port, ...corsOptions })],
    });
    await server.start();
  });

  afterAll(async () => { await server.stop(); });

  it('allows matching origin', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://allowed.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.com');
  });

  it('blocks non-matching origin', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://blocked.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeFalsy();
  });

  it('sets Vary: Origin header for dynamic origins', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://allowed.com' },
    });
    expect(res.headers.get('Vary')).toBe('Origin');
  });
});

describe('cors plugin — array origin', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    port = await getFreePort();
    const corsOptions = cors({ origin: ['https://a.com', 'https://b.com'] });
    server = createServer({
      context: buildContext,
      capabilities: { system: { ping } },
      transports: [restTransport({ port, ...corsOptions })],
    });
    await server.start();
  });

  afterAll(async () => { await server.stop(); });

  it('allows origin in array', async () => {
    const res = await fetch(`http://localhost:${port}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://a.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://a.com');
  });

  it('blocks origin not in array', async () => {
    const res = await fetch(`http://localhost:${port}/system/ping`, {
      method: 'POST',
      headers: { Origin: 'https://c.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Helmet plugin
// ---------------------------------------------------------------------------

describe('helmet plugin', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://localhost:${port}`;
    const helmetOpts = helmet();
    server = createServer({
      context: buildContext,
      capabilities: { system: { ping } },
      transports: [restTransport({ port, ...helmetOpts })],
    });
    await server.start();
  });

  afterAll(async () => { await server.stop(); });

  it('adds X-Frame-Options: SAMEORIGIN', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('adds X-Content-Type-Options: nosniff', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('adds Content-Security-Policy', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('adds Referrer-Policy', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('custom options override defaults', async () => {
    const port2 = await getFreePort();
    const customHelmet = helmet({ frameOptions: 'DENY', noSniff: false });
    const s = createServer({
      context: buildContext,
      capabilities: { system: { ping } },
      transports: [restTransport({ port: port2, ...customHelmet })],
    });
    await s.start();
    const res = await fetch(`http://localhost:${port2}/system/ping`, { method: 'POST' });
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBeNull();
    await s.stop();
  });
});

// ---------------------------------------------------------------------------
// Logging plugin
// ---------------------------------------------------------------------------

describe('logging plugin', () => {
  it('logs successful capability invocations without throwing', async () => {
    // Use a real pino logger piped to nowhere (silent level)
    const logger = createLogger({ level: 'silent' });

    const loggedPing = ping.enhance(loggingEnhancer({ logger }));

    const port = await getFreePort();
    const server = createServer({
      context: buildContext,
      capabilities: { system: { ping: loggedPing } },
      transports: [restTransport({ port })],
    });
    await server.start();

    const res = await fetch(`http://localhost:${port}/system/ping`, { method: 'POST' });
    expect(res.status).toBe(200);
    await server.stop();
  });

  it('loggingEnhancer applied to capability still resolves correctly', async () => {
    const logger = createLogger({ level: 'silent' });
    const loggedPing = ping.enhance(loggingEnhancer({ logger }));
    const result = await loggedPing.resolve(undefined, { requestId: 'test' });
    expect(result).toEqual({ ok: true });
  });

  it('logs FrameworkErrors at info level, not error', async () => {
    let infoCount = 0;
    let errorCount = 0;
    const mockChild = {
      info: () => { infoCount++; },
      error: () => { errorCount++; },
    };
    const mockLogger = { child: () => mockChild } as unknown as ReturnType<typeof createLogger>;

    const cap = capability(() => { throw defaultErrors.Unauthorized(); })
      .enhance(loggingEnhancer({ logger: mockLogger }));

    try { await cap.resolve(undefined, { requestId: 'test' }); } catch { /* expected */ }

    expect(infoCount).toBe(1);
    expect(errorCount).toBe(0);
  });

  it('logs 401 Unauthorized at info level', async () => {
    let infoCount = 0;
    let errorCount = 0;
    const mockChild = {
      info: () => { infoCount++; },
      error: () => { errorCount++; },
    };
    const mockLogger = { child: () => mockChild } as unknown as ReturnType<typeof createLogger>;

    const cap = capability(() => { throw defaultErrors.Unauthorized(); })
      .enhance(loggingEnhancer({ logger: mockLogger }));

    try { await cap.resolve(undefined, { requestId: 'test' }); } catch { /* expected */ }

    expect(infoCount).toBe(1);
    expect(errorCount).toBe(0);
  });

  it('logs 404 Not Found at info level', async () => {
    let infoCount = 0;
    let errorCount = 0;
    const mockChild = {
      info: () => { infoCount++; },
      error: () => { errorCount++; },
    };
    const mockLogger = { child: () => mockChild } as unknown as ReturnType<typeof createLogger>;

    const cap = capability(() => { throw defaultErrors.NotFound(); })
      .enhance(loggingEnhancer({ logger: mockLogger }));

    try { await cap.resolve(undefined, { requestId: 'test' }); } catch { /* expected */ }

    expect(infoCount).toBe(1);
    expect(errorCount).toBe(0);
  });

  it('logs unknown errors at error level', async () => {
    let infoCount = 0;
    let errorCount = 0;
    const mockChild = {
      info: () => { infoCount++; },
      error: () => { errorCount++; },
    };
    const mockLogger = { child: () => mockChild } as unknown as ReturnType<typeof createLogger>;

    const cap = capability(() => { throw new Error('unexpected'); })
      .enhance(loggingEnhancer({ logger: mockLogger }));

    try { await cap.resolve(undefined, { requestId: 'test' }); } catch { /* expected */ }

    expect(infoCount).toBe(0);
    expect(errorCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mergeHooks — cors + helmet combined
// ---------------------------------------------------------------------------

describe('mergeHooks', () => {
  it('combines cors and helmet hooks on same transport', async () => {
    const port = await getFreePort();
    // A restricted, non-wildcard origin — '*' would happen to match the
    // transport's own fallback default and mask a regression where
    // mergeHooks() drops the `cors` field entirely (it used to).
    const corsOpts = cors({ origin: 'https://allowed.example.com' });
    const helmetOpts = helmet();
    const combined = mergeHooks(corsOpts, helmetOpts);

    const server = createServer({
      context: buildContext,
      capabilities: { system: { ping } },
      transports: [restTransport({ port, ...combined })],
    });
    await server.start();

    const res = await fetch(`http://localhost:${port}/system/ping`, { method: 'POST' });
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    // The regression: mergeHooks() used to drop `cors` entirely, so this
    // fell back to the transport's default '*' instead of the configured origin.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example.com');

    await server.stop();
  });
});
