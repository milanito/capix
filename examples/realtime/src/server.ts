/**
 * realtime example — EventEmitter broadcast pattern for WebSocket push.
 *
 * Architecture:
 * - REST transport handles mutations (POST, PATCH, DELETE)
 * - WS transport handles queries and receives push events
 * - A module-level EventEmitter (taskEvents) bridges the two
 *
 * Flow:
 *   REST client → POST /tasks → createTask capability → taskEvents.emit('task', ...)
 *   WS client   → receives broadcast from taskEvents listener
 *
 * The WS transport is request/response. Push delivery happens via the
 * raw ws.Server, which Capix exposes after mounting.
 */

import { z } from 'zod';
import { WebSocketServer } from 'ws';
import { capability, defineContext, defineError, createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';
import { wsTransport } from 'capix-transport-ws';
import { taskEvents, type TaskEvent } from './events.js';

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
    // Broadcast to all WebSocket clients
    taskEvents.emit('task', { type: 'task.created', taskId: task.id, data: task });
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
    // Broadcast to all WebSocket clients
    taskEvents.emit('task', { type: 'task.updated', taskId: id, data: task });
    return task;
  },
);

const deleteTask = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw errors.NotFound();
    tasks.splice(idx, 1);
    // Broadcast to all WebSocket clients
    taskEvents.emit('task', { type: 'task.deleted', taskId: id });
    return null;
  },
);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer({
  context: buildContext,
  capabilities: {
    tasks: { listTasks, createTask, updateTask, deleteTask },
  },
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001 }),
  ],
});

await server.start();

// ---------------------------------------------------------------------------
// WebSocket broadcast
//
// After server.start(), the WS transport's underlying ws.Server is available.
// Subscribe to taskEvents and forward each event to all connected clients.
//
// The WS transport uses port 3001. We create a second ws.Server that shares
// the same port by attaching to the HTTP server directly (or use a separate
// port as shown here for simplicity).
// ---------------------------------------------------------------------------

// Broadcast via a dedicated broadcast WebSocket server on port 3002.
// WS clients that want push events connect to ws://localhost:3002.
// Clients that want request/response capabilities connect to ws://localhost:3001.
const broadcastServer = new WebSocketServer({ port: 3002 });

taskEvents.on('task', (event: TaskEvent) => {
  const msg = JSON.stringify(event);
  for (const client of broadcastServer.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(msg);
    }
  }
});

console.log('REST transport:      http://localhost:3000');
console.log('WS transport:        ws://localhost:3001');
console.log('WS broadcast:        ws://localhost:3002');
console.log('');
console.log('Connect a WS client to ws://localhost:3002 to receive live task events.');
console.log('Mutate tasks via REST and watch events arrive on the WS client.');
