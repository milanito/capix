/**
 * queue.test.ts — Queue transport end to end, mounted alongside REST.
 *
 * packages/transports/queue/src/index.test.ts already covers the adapter and
 * transport in isolation. This file is the missing piece: one createServer
 * with REST and Queue mounted together against the same registry and the
 * same in-memory store, proving a job enqueued on the queue produces the
 * exact same guard/validation/error behavior — and visible state — as the
 * equivalent REST call. MemoryQueueAdapter is used because CI has no live
 * broker; BullMQ/SQS adapters remain covered by their own mocked unit tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as net from 'node:net';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { queueTransport, createQueueClient, MemoryQueueAdapter } from '@capixjs/transport-queue';
import type { Server } from '@capixjs/core';
import type { QueueMessage, QueueResult } from '@capixjs/transport-queue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * getFreePort() closes its probe socket before the real server binds to that
 * port number — under CI-level parallelism, another test file's probe can
 * claim the same ephemeral port in that gap, so the real bind then fails
 * with EADDRINUSE. Retries with a fresh port on that specific failure.
 */
async function startOnFreePort<T extends { start: () => Promise<void> }>(
  build: (port: number) => T,
  maxAttempts = 5,
): Promise<{ server: T; port: number }> {
  for (let attempt = 1; ; attempt++) {
    const port = await getFreePort();
    const server = build(port);
    try {
      await server.start();
      return { server, port };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE' || attempt >= maxAttempts) throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Setup — one registry, two transports (REST + Queue), one store
// ---------------------------------------------------------------------------

type Note = { id: string; title: string };
let NOTES: Note[];

const errors = {
  Forbidden: defineError(403, 'Forbidden'),
};

type Ctx = { requestId: string; role: string | null };

const buildContext = defineContext(async (req): Promise<Ctx> => ({
  requestId: crypto.randomUUID(),
  role: (req.headers['x-role'] as string | undefined) ?? null,
}));

const mustBeAdmin = defineGuard((ctx: Ctx): asserts ctx is Ctx & { role: 'admin' } => {
  if (ctx.role !== 'admin') throw errors.Forbidden();
});

const createNote = capability(
  z.object({ title: z.string().min(1) }),
  ({ title }) => {
    const note: Note = { id: String(NOTES.length + 1), title };
    NOTES.push(note);
    return note;
  },
  'mutation',
).guard(mustBeAdmin);

const listNotes = capability(z.object({}), () => NOTES, 'query');

let server: Server;
let baseUrl: string;
let adapter: MemoryQueueAdapter;
let queueClient: ReturnType<typeof createQueueClient>;
let results: Array<{ msg: QueueMessage; result: QueueResult }>;

async function waitForResults(count: number, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (results.length < count) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${count} results`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeAll(async () => {
  NOTES = [];
  results = [];

  adapter = new MemoryQueueAdapter({
    onResult: (msg, result) => { results.push({ msg, result }); },
  });
  queueClient = createQueueClient(adapter, 'jobs');

  let port: number;
  ({ server, port } = await startOnFreePort((p) => createServer({
    context: buildContext,
    capabilities: { notes: { createNote, listNotes } },
    transports: [
      restTransport({ port: p }),
      queueTransport({ queues: ['jobs'], adapter }),
    ],
    isDevelopment: false,
  })));
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await server.stop();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue transport integration (mounted alongside REST)', () => {
  it('an enqueued mutation is applied and visible via REST', async () => {
    await queueClient.enqueue('notes.createNote', { title: 'from-queue' }, { 'x-role': 'admin' });
    await waitForResults(1);

    expect(results[0]!.result.ok).toBe(true);

    const res = await fetch(`${baseUrl}/notes`);
    const body = await res.json() as { data: Note[] };
    expect(body.data.some((n) => n.title === 'from-queue')).toBe(true);
  });

  it('guard rejection from queue message headers matches REST — same status and error code', async () => {
    await queueClient.enqueue('notes.createNote', { title: 'no-auth' }, {});
    await waitForResults(2);

    const queueResult = results[1]!.result;
    expect(queueResult.ok).toBe(false);
    if (!queueResult.ok) {
      expect(queueResult.error.status).toBe(403);
      expect(queueResult.error.error).toBe('Forbidden');
    }

    const restRes = await fetch(`${baseUrl}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'no-auth' }),
    });
    expect(restRes.status).toBe(403);
    const restBody = await restRes.json() as { error: string };
    expect(restBody.error).toBe('Forbidden');
  });

  it('input validation failure from queue matches REST — same status, code, and issues shape', async () => {
    await queueClient.enqueue('notes.createNote', { title: '' }, { 'x-role': 'admin' });
    await waitForResults(3);

    const queueResult = results[2]!.result;
    expect(queueResult.ok).toBe(false);
    if (!queueResult.ok) {
      expect(queueResult.error.status).toBe(400);
      expect(queueResult.error.error).toBe('BadRequest');
      expect(Array.isArray(queueResult.error.meta?.['issues'])).toBe(true);
    }

    const restRes = await fetch(`${baseUrl}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'admin' },
      body: JSON.stringify({ title: '' }),
    });
    expect(restRes.status).toBe(400);
    const restBody = await restRes.json() as { error: string; meta: { issues: unknown[] } };
    expect(restBody.error).toBe('BadRequest');
    expect(Array.isArray(restBody.meta.issues)).toBe(true);
  });

  it('unknown capability name from a queue message resolves the same 404/NotFound as an unmapped REST route', async () => {
    await queueClient.enqueue('notes.doesNotExist', {}, { 'x-role': 'admin' });
    await waitForResults(4);

    const queueResult = results[3]!.result;
    expect(queueResult.ok).toBe(false);
    if (!queueResult.ok) {
      expect(queueResult.error.status).toBe(404);
      expect(queueResult.error.error).toBe('NotFound');
    }
  });

  it('processes many concurrently enqueued jobs independently, with no cross-talk', async () => {
    const before = NOTES.length;
    const titles = Array.from({ length: 20 }, (_, i) => `bulk-${i}`);

    await Promise.all(titles.map((title) => queueClient.enqueue('notes.createNote', { title }, { 'x-role': 'admin' })));
    await waitForResults(4 + 20);

    const res = await fetch(`${baseUrl}/notes`);
    const body = await res.json() as { data: Note[] };
    for (const title of titles) {
      expect(body.data.filter((n) => n.title === title)).toHaveLength(1);
    }
    expect(body.data.length).toBe(before + 20);
  });
});

describe('Queue transport — shutdown behavior', () => {
  it('stops processing after server.stop() without throwing', async () => {
    NOTES = [];
    const localAdapter = new MemoryQueueAdapter();
    const localClient = createQueueClient(localAdapter, 'jobs');

    const { server: localServer } = await startOnFreePort((port) => createServer({
      context: buildContext,
      capabilities: { notes: { createNote, listNotes } },
      transports: [
        restTransport({ port }),
        queueTransport({ queues: ['jobs'], adapter: localAdapter }),
      ],
    }));
    await localServer.stop();

    // Enqueuing after shutdown must not throw and must not process the job.
    await localClient.enqueue('notes.createNote', { title: 'late' }, { 'x-role': 'admin' });
    await new Promise((r) => setTimeout(r, 50));
    expect(NOTES.some((n) => n.title === 'late')).toBe(false);
  });
});
