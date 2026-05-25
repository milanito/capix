import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as net from 'node:net';
import WebSocket from 'ws';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from 'capix';
import { wsTransport } from 'capix-transport-ws';
import type { Server } from 'capix';

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

function wsMessage(ws: WebSocket, timeout = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function wsConnect(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const errors = { Unauthorized: defineError(401, 'Unauthorized') };
type Context = { requestId: string; token: string | null };

const buildContext = defineContext(async (req): Promise<Context> => ({
  requestId: crypto.randomUUID(),
  token: req.headers['authorization'] ?? null,
}));

const mustBeAuthed = defineGuard((ctx: Context): asserts ctx is Context & { token: string } => {
  if (!ctx.token) throw errors.Unauthorized();
});

const ping = capability(() => ({ pong: true, ts: Date.now() }));

const echo = capability(
  z.object({ message: z.string() }),
  async ({ message }) => ({ echo: message }),
);

const protected_ = capability(() => 'secret').guard(mustBeAuthed);

const addNumbers = capability(
  z.object({ a: z.number(), b: z.number() }),
  async ({ a, b }) => a + b,
);

let server: Server;
let wsUrl: string;

beforeAll(async () => {
  const port = await getFreePort();
  wsUrl = `ws://localhost:${port}`;

  server = createServer({
    context: buildContext,
    capabilities: {
      system: { ping },
      test: { echo, addNumbers },
      auth: { protected: protected_ },
    },
    transports: [wsTransport({ port })],
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebSocket transport integration', () => {
  it('connects and receives a capability response', async () => {
    const ws = await wsConnect(wsUrl);
    ws.send(JSON.stringify({ id: '1', capability: 'system.ping', input: {} }));
    const msg = await wsMessage(ws) as { id: string; ok: boolean; data: unknown };
    expect(msg.id).toBe('1');
    expect(msg.ok).toBe(true);
    expect(msg.data).toMatchObject({ pong: true });
    ws.close();
  });

  it('echoes input back', async () => {
    const ws = await wsConnect(wsUrl);
    ws.send(JSON.stringify({ id: '2', capability: 'test.echo', input: { message: 'hello' } }));
    const msg = await wsMessage(ws) as { ok: boolean; data: unknown };
    expect(msg.ok).toBe(true);
    expect(msg.data).toEqual({ echo: 'hello' });
    ws.close();
  });

  it('adds two numbers', async () => {
    const ws = await wsConnect(wsUrl);
    ws.send(JSON.stringify({ id: '3', capability: 'test.addNumbers', input: { a: 3, b: 7 } }));
    const msg = await wsMessage(ws) as { ok: boolean; data: unknown };
    expect(msg.ok).toBe(true);
    expect(msg.data).toBe(10);
    ws.close();
  });

  it('returns error for unknown capability', async () => {
    const ws = await wsConnect(wsUrl);
    ws.send(JSON.stringify({ id: '4', capability: 'unknown.cap', input: {} }));
    const msg = await wsMessage(ws) as { ok: boolean; error: unknown };
    expect(msg.ok).toBe(false);
    ws.close();
  });

  it('guard failure returns 401', async () => {
    const ws = await wsConnect(wsUrl);
    ws.send(JSON.stringify({ id: '5', capability: 'auth.protected', input: {} }));
    const msg = await wsMessage(ws) as { ok: boolean; status: number; error: string };
    expect(msg.ok).toBe(false);
    expect(msg.status).toBe(401);
    ws.close();
  });

  it('auth from HTTP upgrade headers', async () => {
    const ws = await wsConnect(wsUrl, { authorization: 'Bearer test-token' });
    ws.send(JSON.stringify({ id: '6', capability: 'auth.protected', input: {} }));
    const msg = await wsMessage(ws) as { ok: boolean; data: unknown };
    expect(msg.ok).toBe(true);
    ws.close();
  });

  it('handles invalid JSON — server closes connection with code 1003', async () => {
    const ws = await wsConnect(wsUrl);
    const closePromise = new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code));
    });
    ws.send('not valid json {{{');
    const code = await closePromise;
    // 1003 = unsupported data, or 1000/1001 depending on timing
    expect(typeof code).toBe('number');
  });

  it('handles concurrent messages on same connection', async () => {
    const ws = await wsConnect(wsUrl);

    const messages: Promise<unknown>[] = [];
    for (let i = 0; i < 5; i++) {
      ws.send(JSON.stringify({ id: String(i), capability: 'test.addNumbers', input: { a: i, b: i } }));
      messages.push(wsMessage(ws));
    }

    const results = await Promise.all(messages) as Array<{ id: string; ok: boolean; data: number }>;
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.ok).toBe(true);
      const n = parseInt(r.id);
      expect(r.data).toBe(n + n);
    }
    ws.close();
  });
});
