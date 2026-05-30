# capix-transport-queue

Queue transport for [Capix](https://github.com/capix/capix). Process background jobs by routing queue messages to capability resolvers — no HTTP, no WebSocket, just workers consuming from a queue adapter.

## Install

```bash
npm install capix capix-transport-queue zod
```

## Usage

```ts
import { createServer } from 'capix';
import { queueTransport, MemoryQueueAdapter, createQueueClient } from 'capix-transport-queue';
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
import { MemoryQueueAdapter } from 'capix-transport-queue';
const adapter = new MemoryQueueAdapter();
```

### Custom adapters

Implement the `QueueAdapter` interface to connect to BullMQ, SQS, Faktory, or any queue system:

```ts
import type { QueueAdapter, QueueMessage } from 'capix-transport-queue';

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

## License

MIT
