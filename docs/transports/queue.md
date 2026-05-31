# Queue transport

The queue transport routes background jobs to capability resolvers. No HTTP, no WebSocket — workers consume from a queue adapter and the execution engine processes each job.

See the [package README](../../packages/transports/queue/README.md) for the full API.

## When to use the queue transport

- CPU-heavy tasks that should not block a request: report generation, image processing
- Side effects that can be deferred: sending emails, syncing external systems
- Capabilities that must not be exposed over HTTP
- Fan-out patterns: one REST call enqueues many jobs

## Setup

```ts
import { createServer } from '@capixjs/core';
import { queueTransport, MemoryQueueAdapter, createQueueClient } from '@capixjs/transport-queue';

const adapter  = new MemoryQueueAdapter();
const jobQueue = createQueueClient(adapter, 'jobs');

createServer({
  context: buildContext,
  transports: [
    queueTransport({ queues: ['jobs'], adapter }),
  ],
  capabilities: {
    jobs: { processOrder, generateReport },
  },
}).start();

// Enqueue a job from anywhere in your application:
await jobQueue.enqueue('jobs.processOrder', { orderId: '123' });
```

## Adapters

| Adapter | Description |
|---|---|
| `MemoryQueueAdapter` | In-process queue. Jobs lost on restart. For dev and testing. |
| Custom adapters | Implement `QueueAdapter` to use BullMQ, SQS, Faktory, etc. |

## Message format

Any system that can publish JSON to your queue can trigger Capix capabilities:

```json
{
  "capability": "jobs.processOrder",
  "input": { "orderId": "123" }
}
```

## Mixing REST and queue

Keep job-only capabilities off HTTP by using per-transport capabilities:

```ts
createServer({
  context: buildContext,
  transports: [
    restTransport({ port: 3000, capabilities: { users, items } }),
    queueTransport({ queues: ['jobs'], adapter, capabilities: { jobs: { processOrder, generateReport } } }),
  ],
});
```

`processOrder` and `generateReport` are never exposed over HTTP.

## Auth and guards

Jobs arrive with a minimal context — no real `Authorization` header. Guards that check `ctx.user` will see `null` unless you populate the context from the job input or a service account:

```ts
const buildContext = defineContext(async (req) => {
  const serviceKey = getHeader(req, 'x-service-key');
  const user = serviceKey === process.env.QUEUE_SECRET
    ? SERVICE_ACCOUNT
    : await verifyJwt(getHeader(req, 'authorization'));
  return { requestId: crypto.randomUUID(), user, db };
});
```

The queue adapter can set `x-service-key` in the job metadata to signal that this is a trusted background job.
