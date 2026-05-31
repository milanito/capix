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
