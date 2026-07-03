# WebSocket transport

The WebSocket transport exposes capabilities over persistent WebSocket connections and delivers server-push events to subscribed clients.

See the [package README](../../packages/transports/ws/README.md) for the full API.

## Message protocol

All messages are JSON.

**Client → server (capability call):**

```json
{ "id": "msg-1", "capability": "chat.sendMessage", "input": { "text": "hello" } }
```

With headers:

```json
{
  "id": "msg-1",
  "capability": "chat.sendMessage",
  "input": { "text": "hello" },
  "headers": { "authorization": "Bearer token" }
}
```

**Server → client (success):**

```json
{ "id": "msg-1", "ok": true, "status": 200, "data": { "messageId": "abc" } }
```

**Server → client (error):**

```json
{ "id": "msg-1", "ok": false, "status": 401, "error": "Unauthorized", "message": "Unauthorized" }
```

**Client → server (subscribe to event):**

```json
{ "id": "msg-2", "action": "subscribe", "event": "chat:message" }
```

Server confirms:

```json
{ "id": "msg-2", "ok": true, "event": "chat:message", "subscribed": true }
```

**Server → client (server-push event):**

```json
{ "event": "chat:message", "data": { "text": "hello", "from": "Alice" } }
```

**Client → server (unsubscribe):**

```json
{ "id": "msg-3", "action": "unsubscribe", "event": "chat:message" }
```

Subscriptions are cleaned up automatically on disconnect.

## Auth over WebSocket

Authentication uses the headers from the HTTP upgrade request — send your token when opening the connection:

```ts
const ws = new WebSocket('ws://localhost:3001', {
  headers: { authorization: 'Bearer eyJ...' },
});
```

`buildContext` is called for each message and receives those connection headers, so guards behave exactly as they do over REST. Browsers cannot set custom WebSocket headers — pass the token as a query parameter (`ws://host/?token=...`) and read it in `buildContext`, or use a cookie.

## Connection hardening

```ts
wsTransport({
  port: 3001,
  maxPayloadBytes: 256 * 1024,      // close oversized senders with 1009 (default 1 MiB)
  heartbeatIntervalMs: 30_000,      // terminate dead connections (default 30s, false to disable)
  authorizeSubscribe: (event, headers) =>
    !event.startsWith('admin:') || headers['x-role'] === 'admin',
})
```

- **`maxPayloadBytes`** — inbound frames larger than this close the connection with `1009` (message too big). Defaults to 1 MiB, matching the REST body limit.
- **`heartbeatIntervalMs`** — the server pings every client each interval and terminates clients that missed the previous ping. Without it, crashed clients and dropped networks hold their subscriptions forever.
- **`authorizeSubscribe(event, headers)`** — called before a `subscribe` message takes effect, with the upgrade-request headers. Return `false` (or throw) to reject with a `Forbidden` reply. Without it, any connected client may subscribe to any event.

## Event bus

Use `createEventBus` to connect REST capabilities to WS clients:

```ts
// src/events.ts
import { createEventBus } from '@capixjs/core';

export type AppEvents = {
  'order:paid':   { orderId: string; amount: number };
  'task:updated': { id: string; status: string };
};

export const eventBus = createEventBus<AppEvents>();
```

```ts
// src/server.ts
import { wsTransport } from '@capixjs/transport-ws';
import { eventBus } from './events.js';

createServer({
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001, eventBus }),
  ],
  ...
});
```

### Multiple instances

`createEventBus` is in-memory: behind a load balancer, an event published on instance A never reaches WebSocket clients connected to instance B. Swap in the Redis-backed bus from [`@capixjs/store-redis`](https://github.com/milanito/capix/tree/master/packages/stores/redis) — same interface, cross-instance delivery via Redis pub/sub:

```ts
import Redis from 'ioredis';
import { createRedisEventBus } from '@capixjs/store-redis';

export const eventBus = createRedisEventBus<AppEvents>(
  new Redis(process.env.REDIS_URL),  // publisher connection
  new Redis(process.env.REDIS_URL),  // dedicated subscriber connection
);
```

Everything else — `wsTransport({ eventBus })`, `eventBus.publish(...)` in resolvers, client subscribe messages — stays identical.

```ts
// src/capabilities/orders/pay.ts
import { eventBus } from '../../events.js';

export const payOrder = authCap(z.object({ id: z.string() }), async ({ id }, ctx) => {
  const order = await ctx.db.orders.markPaid(id);
  eventBus.publish('order:paid', { orderId: id, amount: order.total }); // typed
  return order;
}, 'mutation').guard(mustBeUser);
```

Now any WS client that subscribed to `order:paid` receives the event when `payOrder` runs over REST.

## Server-side subscription

Subscribe from within your server code (e.g. in a plugin or startup hook):

```ts
eventBus.subscribe('task:updated', (data) => {
  // Process task update server-side
  auditLog.record({ event: 'task:updated', ...data });
});
```
