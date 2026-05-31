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

Headers are passed per-message, not per-connection. Include `headers.authorization` in each message that requires authentication, or set it once in a `connect` event and cache the result in a session store keyed by connection ID.

The simplest approach is per-message:

```json
{ "id": "1", "capability": "users.getProfile", "input": {}, "headers": { "authorization": "Bearer eyJ..." } }
```

`buildContext` is called for each message and receives the per-message headers.

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
