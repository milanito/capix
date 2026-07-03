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

### `BullMQAdapter` (Redis)

Ships with the package; requires `bullmq` and `ioredis` at runtime:

```ts
import { BullMQAdapter } from '@capixjs/transport-queue';

const adapter = new BullMQAdapter({
  connection: { host: 'localhost', port: 6379 },
  concurrency: 10,
});
```

### `SqsQueueAdapter` (Amazon SQS)

Ships with the package; pass an [`@aws-sdk/client-sqs`](https://www.npmjs.com/package/@aws-sdk/client-sqs) aggregated client (nothing is bundled):

```ts
import { SQS } from '@aws-sdk/client-sqs';
import { SqsQueueAdapter } from '@capixjs/transport-queue';

const adapter = new SqsQueueAdapter({
  client: new SQS({ region: 'eu-west-1' }),
  queueUrls: { jobs: process.env.JOBS_QUEUE_URL! },
  onResult: (msg, result) => {
    if (!result.ok) console.error(`job ${msg.id} failed:`, result.error);
  },
});
```

Semantics:
- **Success** → the message is deleted.
- **Failed result** (validation, guard, resolver error) → the message is *not* deleted; SQS redelivers it after the visibility timeout, and your queue's redrive policy / dead-letter queue caps the retries.
- **Unparseable body** → deleted and reported via `onError` — a poison message would otherwise redeliver forever.
- **FIFO queues** (`.fifo` URLs) automatically get `MessageGroupId` (the capability name) and `MessageDeduplicationId` (the message id).
- **`stop()`** drains in-flight handlers, then leaves anything the long poll delivers late for redelivery.

### Custom adapters

Implement the `QueueAdapter` interface to connect to Faktory, NATS, or any queue system:

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
