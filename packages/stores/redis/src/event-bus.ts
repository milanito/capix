/**
 * event-bus.ts — Redis pub/sub event bus for multi-instance deployments.
 *
 * The in-memory event bus delivers only within one process: an event
 * published on instance A never reaches WebSocket clients connected to
 * instance B. This bus routes publish() through a Redis channel and feeds
 * incoming messages into a local bus, so every instance — including the
 * publisher's own — receives every event through the same path.
 *
 * Redis pub/sub requires a dedicated subscriber connection (a connection in
 * subscribe mode cannot issue other commands), so the factory takes two
 * clients. With ioredis: `new Redis(url)` for each.
 */

import { createEventBus } from '@capixjs/core';
import type { EventBus, EventMap } from '@capixjs/core';

/** Publishing side — any client with an ioredis-compatible publish(). */
export type RedisPublisherClient = {
  publish(channel: string, message: string): Promise<unknown>;
};

/** Subscribing side — a dedicated connection in subscribe mode. */
export type RedisSubscriberClient = {
  subscribe(...channels: string[]): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
};

export type RedisEventBusOptions = {
  /** Channel prefix, so multiple apps can share one Redis. Default: 'capix:'. */
  readonly prefix?: string;
};

type WireMessage = { event: string; data: unknown };

/**
 * Creates an EventBus whose events cross instance boundaries via Redis
 * pub/sub. Drop-in for `createEventBus` everywhere a bus is accepted
 * (`wsTransport({ eventBus })`, resolver publishes, server-internal
 * subscriptions).
 *
 * Delivery semantics:
 * - `publish()` sends through Redis; the local instance receives its own
 *   events via the broker round-trip, so ordering and delivery are uniform
 *   across instances (at the cost of one broker hop locally).
 * - Payloads are JSON-serialized — Dates, Maps, and class instances degrade
 *   to their JSON form on the receiving side.
 * - Fire-and-forget like the in-memory bus: publish failures are logged,
 *   never thrown into the publisher.
 *
 * @example
 * import Redis from 'ioredis';
 * const events = createRedisEventBus<AppEvents>(
 *   new Redis(process.env.REDIS_URL),  // publisher
 *   new Redis(process.env.REDIS_URL),  // dedicated subscriber connection
 * );
 * // instance A (REST resolver): events.publish('order:paid', { orderId })
 * // instance B (wsTransport({ eventBus: events })): WS clients receive it
 */
export function createRedisEventBus<TEvents extends EventMap>(
  pub: RedisPublisherClient,
  sub: RedisSubscriberClient,
  options: RedisEventBusOptions = {},
): EventBus<TEvents> {
  const channel = (options.prefix ?? 'capix:') + 'events';
  const local = createEventBus<TEvents>();

  sub.on('message', (ch, message) => {
    if (ch !== channel) return;
    let parsed: WireMessage;
    try {
      parsed = JSON.parse(message) as WireMessage;
    } catch {
      return; // foreign traffic on the channel — ignore
    }
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.event !== 'string') return;
    // Local-only delivery: this is the receiving end of the broker hop
    local.publish(parsed.event as keyof TEvents & string, parsed.data as TEvents[keyof TEvents & string]);
  });

  void Promise.resolve(sub.subscribe(channel)).catch((err: unknown) => {
    console.error(`[capix:redis-bus] Failed to subscribe to '${channel}':`, err);
  });

  return {
    publish(event, data) {
      void Promise.resolve(pub.publish(channel, JSON.stringify({ event, data }))).catch((err: unknown) => {
        console.error(`[capix:redis-bus] Failed to publish '${event}':`, err);
      });
    },
    subscribe: local.subscribe,
    unsubscribeAll: local.unsubscribeAll,
    _getHandler: local._getHandler,
  };
}
