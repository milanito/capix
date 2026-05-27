# capix-transport-ws

WebSocket transport for Capix. Exposes your capabilities over a persistent WebSocket connection and delivers server-push events to subscribed clients.

## Install

```bash
npm install capix capix-transport-ws
```

## Usage

```ts
import { createServer } from 'capix';
import { wsTransport } from 'capix-transport-ws';

createServer({
  context: buildContext,
  capabilities: {
    chat: { sendMessage, getHistory },
  },
  transports: [wsTransport({ port: 3001 })],
}).start();
```

## Message protocol

Clients send JSON frames:

```json
{ "id": "1", "capability": "chat.sendMessage", "input": { "text": "hello" } }
```

The server responds:

```json
{ "id": "1", "ok": true, "data": { "messageId": "abc" } }
```

On error:

```json
{ "id": "1", "ok": false, "status": 403, "error": "Forbidden", "message": "Forbidden" }
```

The `id` field is optional but echoed back so clients can match responses to requests.

## Server-push events with `createEventBus`

`createEventBus<TEvents>()` creates a typed pub/sub hub. REST capabilities publish events; connected WS clients subscribe to receive them.

### 1. Define events

```ts
// src/events.ts
import { createEventBus } from 'capix-transport-ws';

type AppEvents = {
  'order:paid':   { orderId: string; amount: number };
  'task:updated': { id: string; status: string };
};

export const eventBus = createEventBus<AppEvents>();
```

### 2. Wire into wsTransport

```ts
// src/server.ts
import { wsTransport } from 'capix-transport-ws';
import { eventBus } from './events.js';

createServer({
  context: buildContext,
  capabilities,
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001, eventBus }),
  ],
}).start();
```

### 3. Publish from any capability

```ts
import { eventBus } from '../events.js';

export const payOrder = cap(z.object({ id: z.string() }), async ({ id }, ctx) => {
  const order = await ctx.db.orders.markPaid(id);
  eventBus.publish('order:paid', { orderId: id, amount: order.total }); // typed
  return order;
}, 'mutation').guard(mustBeUser);
```

### 4. Subscribe from a WS client

```json
{ "id": "2", "action": "subscribe", "event": "order:paid" }
```

Server confirms:

```json
{ "id": "2", "ok": true, "event": "order:paid", "subscribed": true }
```

When the event fires, the server pushes (no `id` — server-initiated):

```json
{ "event": "order:paid", "data": { "orderId": "abc", "amount": 99 } }
```

Unsubscribe:

```json
{ "id": "3", "action": "unsubscribe", "event": "order:paid" }
```

Client subscriptions are automatically cleaned up on disconnect.

## Options

```ts
wsTransport({
  port:     3001,             // required
  host:     '0.0.0.0',       // optional
  eventBus: createEventBus(), // optional — enables server push
})
```

## Exports

| Export | Description |
|---|---|
| `wsTransport(opts)` | Creates a WebSocket transport |
| `createEventBus<TEvents>()` | Creates a typed event bus for server push |
| `WsTransportOptions` | Options type for `wsTransport` |
| `EventBus<TEvents>` | Event bus interface |
| `EventMap` | Base type for event maps |

## License

MIT
