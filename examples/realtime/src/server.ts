/**
 * realtime example — createEventBus for server-push over WebSocket.
 *
 * Architecture:
 * - REST transport handles mutations (POST, PATCH, DELETE)
 * - WS transport handles both capability invocations AND server-push events
 * - eventBus (from capix-transport-ws) bridges REST mutations to WS clients
 *
 * Flow:
 *   REST client  → POST /tasks → createTask resolver → eventBus.publish(...)
 *   WS client    → { action: "subscribe", event: "task:created" }
 *                ← { event: "task:created", data: { id, title, status } }
 */

import { z } from 'zod';
import { capability, defineContext, defineError, createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { wsTransport } from '@capixjs/transport-ws';
import { eventBus } from './events.js';

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

type Task = { id: string; title: string; status: 'todo' | 'in_progress' | 'done' };

const tasks: Task[] = [
  { id: '1', title: 'Buy milk', status: 'todo' },
];

const errors = {
  NotFound: defineError(404, 'Not found'),
};

const buildContext = defineContext(async (_req) => ({
  requestId: crypto.randomUUID(),
}));

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const listTasks = capability(
  z.object({}),
  async () => tasks,
  'query',
);

const createTask = capability(
  z.object({ title: z.string().min(1) }),
  async ({ title }) => {
    const task: Task = { id: `${Date.now()}`, title, status: 'todo' };
    tasks.push(task);
    eventBus.publish('task:created', { id: task.id, title: task.title, status: task.status });
    return task;
  },
);

const updateTask = capability(
  z.object({
    id:     z.string(),
    title:  z.string().min(1).optional(),
    status: z.enum(['todo', 'in_progress', 'done']).optional(),
  }),
  async ({ id, title, status }) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw errors.NotFound();
    if (title !== undefined) task.title = title;
    if (status !== undefined) task.status = status;
    eventBus.publish('task:updated', {
      id,
      ...(title !== undefined ? { title } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    return task;
  },
);

const deleteTask = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw errors.NotFound();
    tasks.splice(idx, 1);
    eventBus.publish('task:deleted', { id });
    return null;
  },
);

// ---------------------------------------------------------------------------
// Server — single WS transport handles both capability calls and push events
// ---------------------------------------------------------------------------

const server = createServer({
  context: buildContext,
  capabilities: {
    tasks: { listTasks, createTask, updateTask, deleteTask },
  },
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001, eventBus }),
  ],
});

await server.start();

console.log('REST:  http://localhost:3000');
console.log('WS:    ws://localhost:3001');
console.log('');
console.log('WS capability call:');
console.log('  → { "id": "1", "capability": "tasks.listTasks", "input": {} }');
console.log('');
console.log('WS event subscription:');
console.log('  → { "id": "2", "action": "subscribe", "event": "task:created" }');
console.log('  ← { "event": "task:created", "data": { ... } }  (when REST creates a task)');
