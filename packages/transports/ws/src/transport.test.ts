import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';
import { capability, defineContext, createServer } from '@capixjs/core';
import { wsTransport } from './transport.js';
import { createEventBus } from './event-bus.js';

type TestEvents = {
  'ping': { ts: number };
  'order:paid': { orderId: string };
};

const buildContext = defineContext(async () => ({ requestId: 'test' }));

let port = 39100; // start from a high port to avoid conflicts
function nextPort(): number { return port++; }

function makeWsTransport(p: number, eventBus?: ReturnType<typeof createEventBus<TestEvents>>) {
  const opts: Parameters<typeof wsTransport>[0] = eventBus
    ? { port: p, eventBus }
    : { port: p };
  return wsTransport(opts);
}

async function makeServer(p: number, eventBus?: ReturnType<typeof createEventBus<TestEvents>>) {
  const server = createServer({
    context: buildContext,
    capabilities: { echo: capability(z.object({ msg: z.string() }), ({ msg }) => ({ echoed: msg })) },
    transports: [makeWsTransport(p, eventBus)],
  });
  await server.start();
  return server;
}

function connect(p: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${p}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function sendAndReceive(ws: WebSocket, payload: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
    ws.send(JSON.stringify(payload));
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

const servers: Awaited<ReturnType<typeof makeServer>>[] = [];
afterEach(async () => {
  for (const s of servers) await s.stop().catch(() => {});
  servers.length = 0;
});

describe('wsTransport — capability invocation', () => {
  it('invokes a capability and returns the result', async () => {
    const p = nextPort();
    servers.push(await makeServer(p));
    const ws = connect(p);
    const client = await ws;
    const res = await sendAndReceive(client, { id: '1', capability: 'echo', input: { msg: 'hi' } });
    expect(res).toMatchObject({ id: '1', ok: true, data: { echoed: 'hi' } });
    client.close();
  });
});

describe('wsTransport with eventBus', () => {
  it('client receives event after subscribing', async () => {
    const p = nextPort();
    const bus = createEventBus<TestEvents>();
    servers.push(await makeServer(p, bus));
    const client = await connect(p);

    const subRes = await sendAndReceive(client, { id: '1', action: 'subscribe', event: 'ping' });
    expect(subRes).toMatchObject({ id: '1', ok: true, subscribed: true });

    const push = nextMessage(client);
    bus.publish('ping', { ts: 42 });
    const msg = await push;
    expect(msg).toMatchObject({ event: 'ping', data: { ts: 42 } });
    client.close();
  });

  it('client does not receive event before subscribing', async () => {
    const p = nextPort();
    const bus = createEventBus<TestEvents>();
    servers.push(await makeServer(p, bus));
    const client = await connect(p);

    const received: unknown[] = [];
    client.on('message', (data) => received.push(JSON.parse(data.toString())));

    bus.publish('ping', { ts: 1 });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(0);
    client.close();
  });

  it('client does not receive event after unsubscribing', async () => {
    const p = nextPort();
    const bus = createEventBus<TestEvents>();
    servers.push(await makeServer(p, bus));
    const client = await connect(p);

    await sendAndReceive(client, { id: '1', action: 'subscribe', event: 'ping' });

    // Verify it works first
    const firstPush = nextMessage(client);
    bus.publish('ping', { ts: 1 });
    await firstPush;

    // Now unsubscribe
    await sendAndReceive(client, { id: '2', action: 'unsubscribe', event: 'ping' });

    const received: unknown[] = [];
    client.on('message', (data) => received.push(JSON.parse(data.toString())));
    bus.publish('ping', { ts: 2 });
    await new Promise((r) => setTimeout(r, 50));

    // Nothing should arrive after unsubscribe
    expect(received).toHaveLength(0);
    client.close();
  });

  it('client listeners cleaned up on disconnect', async () => {
    const p = nextPort();
    const bus = createEventBus<TestEvents>();
    servers.push(await makeServer(p, bus));
    const client = await connect(p);

    await sendAndReceive(client, { id: '1', action: 'subscribe', event: 'ping' });
    client.close();
    await new Promise((r) => setTimeout(r, 100)); // let close propagate

    // No handler should be left in the bus
    expect(bus._getHandler('anything', 'ping')).toBeUndefined();
    // Publishing should not throw
    expect(() => bus.publish('ping', { ts: 1 })).not.toThrow();
  });

  it('multiple clients subscribe independently', async () => {
    const p = nextPort();
    const bus = createEventBus<TestEvents>();
    servers.push(await makeServer(p, bus));

    const c1 = await connect(p);
    const c2 = await connect(p);

    await sendAndReceive(c1, { id: '1', action: 'subscribe', event: 'ping' });
    // c2 does NOT subscribe

    const push1 = nextMessage(c1);
    bus.publish('ping', { ts: 99 });
    const msg1 = await push1;
    expect(msg1).toMatchObject({ event: 'ping', data: { ts: 99 } });

    const received2: unknown[] = [];
    c2.on('message', (d) => received2.push(d));
    await new Promise((r) => setTimeout(r, 50));
    expect(received2).toHaveLength(0);

    c1.close();
    c2.close();
  });

  it('subscribe without eventBus returns error', async () => {
    const p = nextPort();
    servers.push(await makeServer(p)); // no eventBus
    const client = await connect(p);

    const res = await sendAndReceive(client, { id: '1', action: 'subscribe', event: 'ping' });
    expect(res).toMatchObject({ ok: false, error: 'BadRequest' });
    client.close();
  });
});

describe('graceful shutdown', () => {
  it('closes connected clients with 1001 going-away and unmount resolves', async () => {
    const p = nextPort();
    const server = await makeServer(p);
    const ws = await connect(p);

    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    const started = Date.now();
    await server.stop();
    const elapsed = Date.now() - started;

    const { code, reason } = await closed;
    expect(code).toBe(1001);
    expect(reason).toBe('Server shutting down');
    // A connected client must not stall shutdown for the full drain window
    expect(elapsed).toBeLessThan(5000);
  });

  it('unmount resolves with no clients connected', async () => {
    const p = nextPort();
    const server = await makeServer(p);
    await server.stop();
    // Second stop is a no-op, not a hang or throw
    await server.stop();
  });
});

describe('hardening', () => {
  it('closes connections that exceed maxPayloadBytes with 1009', async () => {
    const p = nextPort();
    const server = createServer({
      context: buildContext,
      capabilities: { echo: capability(z.object({ msg: z.string() }), ({ msg }) => ({ echoed: msg })) },
      transports: [wsTransport({ port: p, maxPayloadBytes: 1024 })],
    });
    await server.start();

    const ws = await connect(p);
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ capability: 'echo', input: { msg: 'x'.repeat(4096) } }));

    expect(await closed).toBe(1009);
    await server.stop();
  });

  it('rejects unauthorized subscriptions with Forbidden', async () => {
    const p = nextPort();
    const eventBus = createEventBus<TestEvents>();
    const server = createServer({
      context: buildContext,
      capabilities: { echo: capability(z.object({ msg: z.string() }), ({ msg }) => ({ echoed: msg })) },
      transports: [wsTransport({
        port: p,
        eventBus,
        authorizeSubscribe: (event, headers) => event !== 'order:paid' || headers['x-role'] === 'admin',
      })],
    });
    await server.start();

    // No admin header — order:paid denied, ping allowed
    const ws = await connect(p);
    const replies: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => replies.push(JSON.parse(d.toString()) as Record<string, unknown>));

    ws.send(JSON.stringify({ id: '1', action: 'subscribe', event: 'order:paid' }));
    ws.send(JSON.stringify({ id: '2', action: 'subscribe', event: 'ping' }));
    await new Promise((r) => setTimeout(r, 150));

    const denied = replies.find((m) => m['id'] === '1')!;
    expect(denied['ok']).toBe(false);
    expect(denied['error']).toBe('Forbidden');
    const allowed = replies.find((m) => m['id'] === '2')!;
    expect(allowed['ok']).toBe(true);

    // Denied subscription must not receive events
    eventBus.publish('order:paid', { orderId: 'o1' });
    await new Promise((r) => setTimeout(r, 100));
    expect(replies.find((m) => m['event'] === 'order:paid')).toBeUndefined();

    // Admin header passes
    const admin = await new Promise<WebSocket>((resolve, reject) => {
      const c = new WebSocket(`ws://localhost:${p}`, { headers: { 'x-role': 'admin' } });
      c.once('open', () => resolve(c));
      c.once('error', reject);
    });
    const adminReplies: Array<Record<string, unknown>> = [];
    admin.on('message', (d) => adminReplies.push(JSON.parse(d.toString()) as Record<string, unknown>));
    admin.send(JSON.stringify({ id: '3', action: 'subscribe', event: 'order:paid' }));
    await new Promise((r) => setTimeout(r, 150));
    expect(adminReplies.find((m) => m['id'] === '3')!['ok']).toBe(true);

    await server.stop();
  });

  it('pings clients on the heartbeat interval and keeps responsive ones alive', async () => {
    const p = nextPort();
    const server = createServer({
      context: buildContext,
      capabilities: { echo: capability(z.object({ msg: z.string() }), ({ msg }) => ({ echoed: msg })) },
      transports: [wsTransport({ port: p, heartbeatIntervalMs: 100 })],
    });
    await server.start();

    const ws = await connect(p);
    let pings = 0;
    ws.on('ping', () => pings++);
    await new Promise((r) => setTimeout(r, 450));

    expect(pings).toBeGreaterThanOrEqual(2); // heartbeat is running
    expect(ws.readyState).toBe(WebSocket.OPEN); // responsive client survives
    await server.stop();
  });

  it('terminates clients that stop answering pings', async () => {
    const p = nextPort();
    const server = createServer({
      context: buildContext,
      capabilities: { echo: capability(z.object({ msg: z.string() }), ({ msg }) => ({ echoed: msg })) },
      transports: [wsTransport({ port: p, heartbeatIntervalMs: 100 })],
    });
    await server.start();

    const ws = await connect(p);
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    ws.once('error', () => { /* ECONNRESET from the server-side terminate is expected */ });
    // Pause the client socket: it stops reading pings, so it never pongs —
    // simulates a dead connection the TCP layer hasn't noticed yet
    const socket = (ws as unknown as { _socket: { pause(): void; resume(): void } })._socket;
    socket.pause();

    // Several heartbeat cycles pass; the server terminates the silent client
    await new Promise((r) => setTimeout(r, 500));
    // Resume so the client-side socket can observe the termination
    socket.resume();

    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('client was not terminated')), 2000)),
    ]);

    await server.stop();
  });
});
