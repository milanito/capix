import { describe, it, expect, vi } from 'vitest';
import { createRedisEventBus } from './index.js';
import type { RedisPublisherClient, RedisSubscriberClient } from './index.js';

type Events = { 'order:paid': { orderId: string }; 'user:joined': { name: string } };

/**
 * Fake broker: every client pair shares one listener list, mimicking a Redis
 * server fanning messages out to all subscribed connections — including the
 * publisher's own instance.
 */
function fakeBroker(): { clients(): { pub: RedisPublisherClient; sub: RedisSubscriberClient } } {
  const listeners: Array<{ channels: Set<string>; fn: (ch: string, msg: string) => void }> = [];

  return {
    clients() {
      const entry = { channels: new Set<string>(), fn: (_ch: string, _msg: string) => {} };
      return {
        pub: {
          async publish(channel, message) {
            for (const l of listeners) {
              if (l.channels.has(channel)) l.fn(channel, message);
            }
            return 1;
          },
        },
        sub: {
          async subscribe(...channels) {
            for (const c of channels) entry.channels.add(c);
          },
          on(_event, listener) {
            entry.fn = listener;
            listeners.push(entry);
            return this;
          },
        },
      };
    },
  };
}

function twoInstances(): { a: ReturnType<typeof createRedisEventBus<Events>>; b: ReturnType<typeof createRedisEventBus<Events>> } {
  const broker = fakeBroker();
  const ca = broker.clients();
  const cb = broker.clients();
  return {
    a: createRedisEventBus<Events>(ca.pub, ca.sub),
    b: createRedisEventBus<Events>(cb.pub, cb.sub),
  };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('createRedisEventBus', () => {
  it('delivers events published on one instance to subscribers on another', async () => {
    const { a, b } = twoInstances();
    const received: unknown[] = [];
    b.subscribe('client-1', 'order:paid', (data) => received.push(data));

    a.publish('order:paid', { orderId: 'o1' });
    await tick();

    expect(received).toEqual([{ orderId: 'o1' }]);
  });

  it('delivers to the publishing instance too, via the broker round-trip', async () => {
    const { a } = twoInstances();
    const received: unknown[] = [];
    a.subscribe('order:paid', (data) => received.push(data)); // server-internal sub

    a.publish('order:paid', { orderId: 'o2' });
    await tick();

    expect(received).toEqual([{ orderId: 'o2' }]);
  });

  it('unsubscribeAll removes a client everywhere but leaves server subscriptions', async () => {
    const { a, b } = twoInstances();
    const clientHits: unknown[] = [];
    const serverHits: unknown[] = [];
    b.subscribe('ws-client', 'user:joined', (d) => clientHits.push(d));
    b.subscribe('user:joined', (d) => serverHits.push(d));

    b.unsubscribeAll('ws-client');
    a.publish('user:joined', { name: 'Ada' });
    await tick();

    expect(clientHits).toEqual([]);
    expect(serverHits).toEqual([{ name: 'Ada' }]);
  });

  it('honors subscription filters across instances', async () => {
    const { a, b } = twoInstances();
    const received: Array<{ orderId: string }> = [];
    b.subscribe('c1', 'order:paid', (d) => received.push(d), {
      filter: (d) => d.orderId.startsWith('vip-'),
    });

    a.publish('order:paid', { orderId: 'plain-1' });
    a.publish('order:paid', { orderId: 'vip-2' });
    await tick();

    expect(received).toEqual([{ orderId: 'vip-2' }]);
  });

  it('ignores foreign or malformed traffic on the channel', async () => {
    const broker = fakeBroker();
    const c = broker.clients();
    const raw = broker.clients();
    const bus = createRedisEventBus<Events>(c.pub, c.sub);
    const received: unknown[] = [];
    bus.subscribe('order:paid', (d) => received.push(d));

    await raw.pub.publish('capix:events', 'not-json{');
    await raw.pub.publish('capix:events', JSON.stringify({ nope: true }));
    await raw.pub.publish('other:channel', JSON.stringify({ event: 'order:paid', data: {} }));
    await tick();

    expect(received).toEqual([]);
  });

  it('respects a custom prefix so apps sharing Redis stay isolated', async () => {
    const broker = fakeBroker();
    const c1 = broker.clients();
    const c2 = broker.clients();
    const appA = createRedisEventBus<Events>(c1.pub, c1.sub, { prefix: 'app-a:' });
    const appB = createRedisEventBus<Events>(c2.pub, c2.sub, { prefix: 'app-b:' });

    const hitsB: unknown[] = [];
    appB.subscribe('order:paid', (d) => hitsB.push(d));
    appA.publish('order:paid', { orderId: 'o1' });
    await tick();

    expect(hitsB).toEqual([]);
  });

  it('publish failures are logged, never thrown into the publisher', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broker = fakeBroker();
    const c = broker.clients();
    const bus = createRedisEventBus<Events>(
      { publish: async () => { throw new Error('redis down'); } },
      c.sub,
    );

    expect(() => bus.publish('order:paid', { orderId: 'o1' })).not.toThrow();
    await tick();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
