# capix-example-realtime

Demonstrates the **EventEmitter broadcast pattern** for pushing server events to WebSocket clients when REST mutations happen.

## The pattern

Capix's WebSocket transport is **request/response** — clients send a capability invocation and receive a response. It does not push unsolicited messages.

For server push (broadcasting a mutation to all connected clients), use a module-level `EventEmitter` as a bridge:

```
REST client → PATCH /tasks/:id → updateTask capability → taskEvents.emit(...)
                                                                    ↓
                               WS broadcast server ← taskEvents.on(...)
                                                                    ↓
                                           all connected WS clients ← broadcast
```

## Files

- `src/events.ts` — typed `TaskEventBus` (EventEmitter subclass)
- `src/server.ts` — REST + WS transports + broadcast server wired to events

## Ports

| Port | Protocol | Purpose |
|---|---|---|
| 3000 | HTTP | REST capabilities (CRUD) |
| 3001 | WS | Request/response capabilities |
| 3002 | WS | Push broadcast (live task events) |

## Run

```bash
pnpm install
pnpm start
```

In another terminal, open a WebSocket connection to receive events:

```bash
# Using wscat (npm install -g wscat)
wscat -c ws://localhost:3002
```

Then mutate a task via REST and watch the event arrive:

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "new task"}'
# → WS client receives: {"type":"task.created","taskId":"...","data":{...}}

curl -X PATCH http://localhost:3000/tasks/1 \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
# → WS client receives: {"type":"task.updated","taskId":"1","data":{...}}
```

## Why this pattern?

1. **No framework coupling** — the EventEmitter lives in your app, not in Capix. No special transport API needed.
2. **Cross-transport** — REST mutations trigger events that reach WS clients. Works across any number of transports.
3. **Idiomatic Node.js** — `EventEmitter` is the standard pattern for intra-process pub/sub.
4. **Easy to test** — emit events directly in tests, no transport layer needed.

## Future

Capix may eventually add a subscription primitive (streaming capability) that makes this pattern first-class. Until then, the EventEmitter approach is the recommended pattern.
