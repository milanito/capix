# Background jobs

Use the queue transport to run capabilities as background workers — no HTTP, no WebSocket.

## Pattern: enqueue from REST, process in worker

```ts
// src/server.ts — REST server + queue worker in one process (dev)
// In production, run workers as separate processes

import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { queueTransport, MemoryQueueAdapter, createQueueClient } from '@capixjs/transport-queue';
import { buildContext } from './context.js';

const adapter  = new MemoryQueueAdapter();
const jobQueue = createQueueClient(adapter, 'jobs');

createServer({
  context: buildContext,
  transports: [
    restTransport({ port: 3000, capabilities: { orders, users } }),
    queueTransport({ queues: ['jobs'], adapter, capabilities: { jobs } }),
  ],
}).start();

// Export for use in REST capabilities:
export { jobQueue };
```

```ts
// src/capabilities/orders/create.ts
import { z } from 'zod';
import { authCap } from '../../capabilities.js';
import { mustBeUser } from '../../guards.js';
import { jobQueue } from '../../server.js';

export const createOrder = authCap(
  z.object({ items: z.array(z.object({ productId: z.string(), qty: z.number() })) }),
  async ({ items }, ctx) => {
    const order = await ctx.db.orders.create({ userId: ctx.user.id, items });

    // Enqueue background work — not in the request hot path
    await jobQueue.enqueue('jobs.sendConfirmationEmail', { orderId: order.id, userId: ctx.user.id });
    await jobQueue.enqueue('jobs.updateInventory', { items });

    return order;
  },
  'mutation',
).guard(mustBeUser);
```

```ts
// src/capabilities/jobs/send-confirmation-email.ts
import { z } from 'zod';
import { cap } from '../../capabilities.js';

export const sendConfirmationEmail = cap(
  z.object({ orderId: z.string(), userId: z.string() }),
  async ({ orderId, userId }, ctx) => {
    const user  = await ctx.db.users.find(userId);
    const order = await ctx.db.orders.find(orderId);
    await ctx.email.send({
      to:      user.email,
      subject: `Order #${orderId} confirmed`,
      html:    renderOrderConfirmation(order),
    });
    return { sent: true };
  },
);
```

## Scaling: separate worker process

In production, run the worker separately from the API:

```ts
// src/worker.ts — worker entry point
import { createServer } from '@capixjs/core';
import { queueTransport, BullMQAdapter } from '@capixjs/transport-queue';
import { buildContext } from './context.js';
import { jobs } from './capabilities/jobs/index.js';

const adapter = new BullMQAdapter({ redis: process.env.REDIS_URL! });

createServer({
  context:    buildContext,
  transports: [queueTransport({ queues: ['jobs', 'emails'], adapter, capabilities: { jobs } })],
}).start();
```

```ts
// src/server.ts — API entry point
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { BullMQAdapter, createQueueClient } from '@capixjs/transport-queue';
import { buildContext } from './context.js';
import { capabilities } from './capabilities/index.js';

const adapter  = new BullMQAdapter({ redis: process.env.REDIS_URL! });
export const jobQueue = createQueueClient(adapter, 'jobs');

createServer({
  context: buildContext,
  capabilities,
  transports: [restTransport({ port: 3000 })],
}).start();
```

The API server enqueues jobs. The worker server processes them. Both use the same `buildContext` and the same capability implementations — no code duplication.

## Idempotency

Background jobs can be retried by the queue system (BullMQ, SQS, etc.) on failure. Make job capabilities idempotent:

```ts
export const updateInventory = cap(
  z.object({ orderId: z.string(), items: z.array(...) }),
  async ({ orderId, items }, ctx) => {
    // Use upsert to handle duplicate deliveries safely
    await ctx.db.inventory.upsertReservation(orderId, items);
    return { ok: true };
  },
);
```

## Priority queues

Create multiple queues for different priorities:

```ts
const highPriorityQueue = createQueueClient(adapter, 'high-priority');
const lowPriorityQueue  = createQueueClient(adapter, 'low-priority');

// Critical path
await highPriorityQueue.enqueue('jobs.sendTransactionalEmail', { ... });

// Can wait
await lowPriorityQueue.enqueue('jobs.generateMonthlyReport', { ... });
```

Register both in the queue transport:

```ts
queueTransport({ queues: ['high-priority', 'low-priority'], adapter, capabilities: { jobs } })
```
