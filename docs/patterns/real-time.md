# Real-time updates

Capix's WebSocket transport is request/response. For server-push (broadcasting mutations to connected WS clients), use an event bus.

## Setup

```ts
// src/events.ts — define the event map and create the bus
import { createEventBus } from '@capixjs/core';

export type AppEvents = {
  'task:created':  { id: string; title: string; assigneeId: string };
  'task:updated':  { id: string; status: string; updatedAt: string };
  'task:deleted':  { id: string };
  'comment:added': { taskId: string; comment: { id: string; text: string; authorId: string } };
};

export const eventBus = createEventBus<AppEvents>();
```

```ts
// src/server.ts — wire eventBus into wsTransport
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { wsTransport } from '@capixjs/transport-ws';
import { eventBus } from './events.js';

createServer({
  context:      buildContext,
  capabilities,
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001, eventBus }),
  ],
}).start();
```

## Emitting events from capabilities

```ts
// src/capabilities/tasks/update.ts
import { z } from 'zod';
import { authCap } from '../../capabilities.js';
import { mustBeUser } from '../../guards.js';
import { eventBus } from '../../events.js';

export const updateTask = authCap(
  z.object({ id: z.string(), status: z.enum(['todo', 'in_progress', 'done']) }),
  async ({ id, status }, ctx) => {
    const task = await ctx.db.tasks.update(id, { status, updatedAt: new Date().toISOString() });
    eventBus.publish('task:updated', { id, status, updatedAt: task.updatedAt }); // typed
    return task;
  },
  'update',
).guard(mustBeUser);
```

## Client subscribing to events

```json
{ "id": "1", "action": "subscribe", "event": "task:updated" }
```

Server confirms:

```json
{ "id": "1", "ok": true, "event": "task:updated", "subscribed": true }
```

When `updateTask` fires, connected subscribers receive:

```json
{ "event": "task:updated", "data": { "id": "t-1", "status": "done", "updatedAt": "2026-05-30T..." } }
```

## Filtering events

Subscribe with a filter to only receive events matching a predicate — useful when the client only cares about a specific resource:

```ts
// Server-side: define a filterable event subscription
import { type SubscribeOptions } from '@capixjs/core';

const unsub = eventBus.subscribe('task:updated', handler, {
  filter: (data) => data.id === 'specific-task-id',
});
```

WS clients specify filters via `input` in the subscribe message (if your WS handler parses it).

## Pattern: REST + WS side-by-side

The most common pattern — REST for writes, WS for real-time push:

```
Client A ──── POST /tasks ────► restTransport ──► updateTask ──► eventBus.publish('task:updated')
                                                                            │
Client B ──── WS subscribe ──► wsTransport ◄──────────────────────────────┘
                                                push { event: 'task:updated', data: {...} }
```

The REST and WS transports share the same `buildContext`, the same capabilities, and the same event bus.

## Room-style filtering

For chat or collaborative apps where clients should only receive events for their room:

```ts
type AppEvents = {
  'message:sent': { roomId: string; text: string; from: string };
};

// REST capability publishes
eventBus.publish('message:sent', { roomId: 'room-1', text: 'Hello', from: ctx.user.id });

// WS client subscribes with a filter
eventBus.subscribe('message:sent', handler, {
  filter: (data) => data.roomId === clientRoomId,
});
```

The filtering runs server-side — clients only receive events for their room.
