# @capixjs/transport-queue

Queue transport for [Capix](https://github.com/capix/capix). Process background jobs by routing queue messages to capability resolvers — no HTTP, no WebSocket, just workers consuming from a queue adapter.

## Install

```bash
npm install @capixjs/core @capixjs/transport-queue zod
```

## Usage

```ts
import { createServer } from '@capixjs/core';
import { queueTransport, MemoryQueueAdapter, createQueueClient } from '@capixjs/transport-queue';
import { buildContext, capabilities } from './capabilities.js';

const adapter  = new MemoryQueueAdapter();
const jobQueue = createQueueClient(adapter, 'jobs');

createServer({
  context: buildContext,
  capabilities,
  transports: [
    queueTransport({ queues: ['jobs'], adapter }),
  ],
}).start();

// Enqueue a job from anywhere in your application:
await jobQueue.enqueue('jobs.processOrder', { orderId: '123' });
```

## Adapters

### `MemoryQueueAdapter`

In-process queue, suitable for development and testing. Jobs are not persisted — they are lost if the process restarts.

```ts
import { MemoryQueueAdapter } from '@capixjs/transport-queue';
const adapter = new MemoryQueueAdapter();
```

### BullMQ adapter (Redis)

```ts
import { Queue, Worker } from 'bullmq';
import type { QueueAdapter, QueueMessage } from '@capixjs/transport-queue';

class BullMQAdapter implements QueueAdapter {
  private workers = new Map<string, Worker>();
  private queues  = new Map<string, Queue>();

  async start(queue: string, handler: (msg: QueueMessage) => Promise<unknown>): Promise<void> {
    const worker = new Worker(queue, async (job) => handler(job.data as QueueMessage), {
      connection: { host: 'localhost', port: 6379 },
    });
    this.workers.set(queue, worker);
  }

  async enqueue(queue: string, msg: QueueMessage): Promise<void> {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, new Queue(queue, { connection: { host: 'localhost', port: 6379 } }));
    }
    await this.queues.get(queue)!.add(msg.capability, msg);
  }

  async stop(): Promise<void> {
    await Promise.all([
      ...[...this.workers.values()].map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
  }
}
```

### Custom adapters

Implement the `QueueAdapter` interface to connect to SQS, Faktory, or any queue system:

```ts
import type { QueueAdapter, QueueMessage } from '@capixjs/transport-queue';

class BullMQAdapter implements QueueAdapter {
  async start(queue: string, handler: (msg: QueueMessage) => Promise<unknown>): Promise<void> {
    // Subscribe to the BullMQ queue and call handler for each job
  }
  async enqueue(queue: string, msg: QueueMessage): Promise<void> {
    // Add job to BullMQ queue
  }
  async stop(): Promise<void> {
    // Drain and close connections
  }
}
```

## `createQueueClient`

Creates a typed client for enqueueing jobs:

```ts
const jobQueue = createQueueClient(adapter, 'jobs');

// Enqueue with capability name and input
const jobId = await jobQueue.enqueue('jobs.sendEmail', { to: 'user@example.com' });
```

## Queue transport vs HTTP

The queue transport invokes capabilities through the same execution engine as REST and WebSocket — guards run, input is validated, context is built. The key difference: the caller is the queue adapter, not an HTTP client.

```ts
// jobs-only capabilities never exposed over HTTP
createServer({
  context: buildContext,
  transports: [
    restTransport({ port: 3000, capabilities: publicCaps }),
    queueTransport({ queues: ['jobs'], adapter, capabilities: jobCaps }),
  ],
});
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `queues` | `string[]` | Queue names to listen on |
| `adapter` | `QueueAdapter` | Queue backend implementation |
| `capabilities` | `GroupTree` | Per-transport capability registry (optional) |

## Message format

The wire format is the `QueueMessage` type. Any system that can enqueue a JSON object to your queue can trigger Capix capabilities:

```ts
type QueueMessage = {
  capability: string;  // dot-path, e.g. 'jobs.processOrder'
  input:      unknown; // passed to the capability's input validator
};
```

## Security note

The queue transport does **not** enforce authentication by default. Jobs arrive with a minimal context (just `requestId`) — there is no `Authorization` header. Guards using `ctx.user` will always see `null` for queue-originated jobs unless you explicitly populate the user field in your context builder by reading from the job input or a service account.

For queue jobs that should run with service-account privileges, pattern the context builder to check for a job-specific header or trust flag:

```ts
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: req.headers['x-service-account'] === process.env.QUEUE_SECRET
    ? SERVICE_ACCOUNT
    : await verifyJwt(req.headers.authorization),
}));
```

## License

MIT
