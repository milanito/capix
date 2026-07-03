/**
 * multi-instance-ws.test.ts — cross-instance WebSocket broadcast.
 *
 * Two full Capix servers ("instance A" and "instance B"), each with its own
 * wsTransport, share an event bus backed by a pub/sub broker (a faithful
 * in-memory stand-in for Redis — the real adapter's wire logic is unit-tested
 * in @capixjs/store-redis). A REST mutation on instance A must reach a
 * WebSocket client connected to instance B.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as net from 'node:net';
import WebSocket from 'ws';
import { capability, defineContext, createServer } from '@capixjs/core';
import type { Server } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { wsTransport } from '@capixjs/transport-ws';
import { createRedisEventBus } from '@capixjs/store-redis';
import type { RedisPublisherClient, RedisSubscriberClient } from '@capixjs/store-redis';

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

// In-memory pub/sub broker with the Redis fan-out contract
function fakeBroker(): { clients(): { pub: RedisPublisherClient; sub: RedisSubscriberClient } } {
  const listeners: Array<{ channels: Set<string>; fn: (ch: string, msg: string) => void }> = [];
  return {
    clients() {
      const entry = { channels: new Set<string>(), fn: (_c: string, _m: string) => {} };
      return {
        pub: {
          async publish(channel, message) {
            for (const l of listeners) if (l.channels.has(channel)) l.fn(channel, message);
            return 1;
          },
        },
        sub: {
          async subscribe(...channels) {
            for (const c of channels) entry.channels.add(c);
          },
          on(_e, listener) {
            entry.fn = listener;
            listeners.push(entry);
            return this;
          },
        },
      };
    },
  };
}

type Events = { 'order:paid': { orderId: string } };

let instanceA: Server;
let instanceB: Server;
let restPortA: number;
let wsPortB: number;

beforeAll(async () => {
  const broker = fakeBroker();
  const clientsA = broker.clients();
  const clientsB = broker.clients();
  const busA = createRedisEventBus<Events>(clientsA.pub, clientsA.sub);
  const busB = createRedisEventBus<Events>(clientsB.pub, clientsB.sub);

  const context = defineContext(async () => ({ requestId: crypto.randomUUID() }));

  // Instance A: REST + WS, publishes to busA on payOrder
  const payOrder = capability(z.object({ orderId: z.string() }), ({ orderId }) => {
    busA.publish('order:paid', { orderId });
    return { paid: orderId };
  });

  restPortA = await getFreePort();
  const wsPortA = await getFreePort();
  instanceA = createServer({
    context,
    capabilities: { orders: { payOrder } },
    transports: [
      restTransport({ port: restPortA }),
      wsTransport({ port: wsPortA, eventBus: busA }),
    ],
  });

  // Instance B: separate process in spirit — own registry copy, own transports, own bus client
  wsPortB = await getFreePort();
  const restPortB = await getFreePort();
  instanceB = createServer({
    context,
    capabilities: { orders: { payOrder } },
    transports: [
      restTransport({ port: restPortB }),
      wsTransport({ port: wsPortB, eventBus: busB }),
    ],
  });

  await instanceA.start();
  await instanceB.start();
});

afterAll(async () => {
  await instanceA.stop();
  await instanceB.stop();
});

describe('cross-instance WebSocket broadcast', () => {
  it('a REST mutation on instance A reaches a WS subscriber on instance B', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPortB}`);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString()) as Record<string, unknown>));
    ws.send(JSON.stringify({ id: 's1', action: 'subscribe', event: 'order:paid' }));
    await new Promise((r) => setTimeout(r, 150));

    // The mutation runs on the OTHER instance
    const res = await fetch(`http://127.0.0.1:${restPortA}/orders/pay-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'o-77' }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));
    const event = messages.find((m) => m['event'] === 'order:paid' && m['data'] !== undefined);
    expect(event).toBeDefined();
    expect(event!['data']).toEqual({ orderId: 'o-77' });
    ws.close();
  });

  it('unsubscribed clients on instance B receive nothing', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPortB}`);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString()) as Record<string, unknown>));

    await fetch(`http://127.0.0.1:${restPortA}/orders/pay-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'o-88' }),
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(messages.filter((m) => m['event'] === 'order:paid')).toEqual([]);
    ws.close();
  });
});
