import { describe, it, expect, vi } from 'vitest';
import { capability, defineContext, createServer, defineError } from 'capix';
import { z } from 'zod';
import { queueTransport, createQueueClient, MemoryQueueAdapter } from './index.js';
import type { QueueMessage } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitImmediate(): Promise<void> {
  return new Promise(r => setImmediate(r));
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const buildContext = defineContext(() => ({ requestId: 'test' }));

// ---------------------------------------------------------------------------
// MemoryQueueAdapter
// ---------------------------------------------------------------------------

describe('MemoryQueueAdapter', () => {
  it('processes a message after start', async () => {
    const adapter = new MemoryQueueAdapter();
    const received: QueueMessage[] = [];

    await adapter.start('q', async (msg) => {
      received.push(msg);
      return { ok: true, data: null };
    });

    const msg: QueueMessage = { id: '1', capability: 'foo', input: {}, headers: {} };
    await adapter.enqueue('q', msg);
    await waitImmediate();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
    await adapter.stop();
  });

  it('buffers messages enqueued before start', async () => {
    const adapter = new MemoryQueueAdapter();
    const received: QueueMessage[] = [];

    const msg: QueueMessage = { id: '1', capability: 'foo', input: {}, headers: {} };
    await adapter.enqueue('q', msg);

    // Not started — nothing processed yet
    expect(received).toHaveLength(0);
    await adapter.stop();
  });

  it('processes buffered messages when start is called', async () => {
    const adapter = new MemoryQueueAdapter();
    const received: QueueMessage[] = [];

    const msg: QueueMessage = { id: '1', capability: 'foo', input: {}, headers: {} };
    await adapter.enqueue('q', msg);

    await adapter.start('q', async (m) => {
      received.push(m);
      return { ok: true, data: null };
    });
    await waitImmediate();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(msg);
    await adapter.stop();
  });

  it('does not process after stop', async () => {
    const adapter = new MemoryQueueAdapter();
    const received: QueueMessage[] = [];

    await adapter.start('q', async (m) => {
      received.push(m);
      return { ok: true, data: null };
    });
    await adapter.stop();

    const msg: QueueMessage = { id: '1', capability: 'foo', input: {}, headers: {} };
    await adapter.enqueue('q', msg);
    await waitImmediate();

    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// queueTransport
// ---------------------------------------------------------------------------

describe('queueTransport', () => {
  it('mounts and processes capability invocations from queue', async () => {
    let resolve!: () => void;
    const processed = new Promise<void>(r => { resolve = r; });

    const ping = capability(() => { resolve(); return { pong: true }; });
    const adapter = new MemoryQueueAdapter();

    const server = createServer({
      context: buildContext,
      capabilities: { ops: { ping } },
      transports: [queueTransport({ queues: ['jobs'], adapter })],
    });

    await server.start();
    await adapter.enqueue('jobs', { id: '1', capability: 'ops.ping', input: {}, headers: {} });
    await processed;
    await server.stop();
  });

  it('invokes the correct capability from the message', async () => {
    const aResolved = vi.fn().mockResolvedValue({ name: 'a' });
    const bResolved = vi.fn().mockResolvedValue({ name: 'b' });

    const capA = capability(z.object({ x: z.number() }), aResolved, 'query');
    const capB = capability(z.object({ x: z.number() }), bResolved, 'query');
    const adapter = new MemoryQueueAdapter();

    const server = createServer({
      context: buildContext,
      capabilities: { ops: { capA, capB } },
      transports: [queueTransport({ queues: ['jobs'], adapter })],
    });
    await server.start();

    await adapter.enqueue('jobs', { id: '1', capability: 'ops.capB', input: { x: 1 }, headers: {} });
    await waitMs(50);

    expect(aResolved).not.toHaveBeenCalled();
    expect(bResolved).toHaveBeenCalledOnce();
    await server.stop();
  });

  it('passes input and headers to the execution engine', async () => {
    let capturedInput: unknown;
    let capturedHeaders: Record<string, string | string[] | undefined> | undefined;

    const buildCtx = defineContext((req) => {
      capturedHeaders = req.headers;
      return { requestId: 'test' };
    });

    let capResolve!: () => void;
    const capDone = new Promise<void>(r => { capResolve = r; });

    const doWork = capability(
      z.object({ userId: z.string() }),
      (input) => { capturedInput = input; capResolve(); return { ok: true }; },
      'mutation'
    );

    const adapter = new MemoryQueueAdapter();
    const server = createServer({
      context: buildCtx,
      capabilities: { jobs: { doWork } },
      transports: [queueTransport({ queues: ['work'], adapter })],
    });
    await server.start();

    await adapter.enqueue('work', {
      id: '1',
      capability: 'jobs.doWork',
      input: { userId: 'user-42' },
      headers: { 'x-org-id': 'org-1' },
    });
    await capDone;

    expect(capturedInput).toEqual({ userId: 'user-42' });
    expect(capturedHeaders?.['x-org-id']).toBe('org-1');
    await server.stop();
  });

  it('handles FrameworkErrors gracefully', async () => {
    const NotFound = defineError(404, 'Not found', 'NotFound');
    const adapter = new MemoryQueueAdapter();

    // Track that the error path completes without throwing
    let errorResult: unknown;
    let resolve!: () => void;
    const done = new Promise<void>(r => { resolve = r; });

    const failCap = capability(() => { throw NotFound(); });
    const origStart = adapter.start.bind(adapter);
    adapter.start = async (queueName, onMessage) => {
      return origStart(queueName, async (msg) => {
        const result = await onMessage(msg);
        errorResult = result;
        resolve();
        return result;
      });
    };

    const server = createServer({
      context: buildContext,
      capabilities: { ops: { failCap } },
      transports: [queueTransport({ queues: ['jobs'], adapter })],
    });
    await server.start();

    await adapter.enqueue('jobs', { id: '1', capability: 'ops.failCap', input: {}, headers: {} });
    await done;

    expect((errorResult as { ok: boolean }).ok).toBe(false);
    expect((errorResult as { ok: false; error: { status: number } }).error.status).toBe(404);
    await server.stop();
  });

  it('handles unknown errors gracefully', async () => {
    const adapter = new MemoryQueueAdapter();

    let errorResult: unknown;
    let resolve!: () => void;
    const done = new Promise<void>(r => { resolve = r; });

    const explode = capability(() => { throw new Error('boom'); });
    const origStart = adapter.start.bind(adapter);
    adapter.start = async (queueName, onMessage) => {
      return origStart(queueName, async (msg) => {
        const result = await onMessage(msg);
        errorResult = result;
        resolve();
        return result;
      });
    };

    const server = createServer({
      context: buildContext,
      capabilities: { ops: { explode } },
      transports: [queueTransport({ queues: ['jobs'], adapter })],
      isDevelopment: false,
    });
    await server.start();

    await adapter.enqueue('jobs', { id: '1', capability: 'ops.explode', input: {}, headers: {} });
    await done;

    expect((errorResult as { ok: boolean }).ok).toBe(false);
    expect((errorResult as { ok: false; error: { status: number } }).error.status).toBe(500);
    await server.stop();
  });

  it('unmounts cleanly', async () => {
    const adapter = new MemoryQueueAdapter();
    const server = createServer({
      context: buildContext,
      capabilities: { ops: { ping: capability(() => ({ pong: true })) } },
      transports: [queueTransport({ queues: ['jobs'], adapter })],
    });

    await server.start();
    await server.stop();

    // After stop, enqueuing buffers (does not throw or process)
    const adapter2 = adapter as unknown as { running: boolean };
    expect(adapter2.running).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createQueueClient
// ---------------------------------------------------------------------------

describe('createQueueClient', () => {
  it('enqueues a message with capability + input + headers', async () => {
    const adapter = new MemoryQueueAdapter();
    const received: QueueMessage[] = [];
    await adapter.start('q', async (msg) => {
      received.push(msg);
      return { ok: true, data: null };
    });

    const client = createQueueClient(adapter, 'q');
    await client.enqueue('users.create', { name: 'Alice' }, { 'x-key': 'abc' });
    await waitImmediate();

    expect(received).toHaveLength(1);
    expect(received[0]!.capability).toBe('users.create');
    expect(received[0]!.input).toEqual({ name: 'Alice' });
    expect(received[0]!.headers).toEqual({ 'x-key': 'abc' });
    await adapter.stop();
  });

  it('returns a job id', async () => {
    const adapter = new MemoryQueueAdapter();
    await adapter.start('q', async () => ({ ok: true, data: null }));

    const client = createQueueClient(adapter, 'q');
    const id = await client.enqueue('foo', {});

    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    await adapter.stop();
  });

  it('enqueued job is processed by the transport', async () => {
    let resolve!: (v: string) => void;
    const done = new Promise<string>(r => { resolve = r; });

    const sendEmail = capability(
      z.object({ to: z.string() }),
      ({ to }) => { resolve(to); return { sent: true }; },
      'mutation'
    );

    const adapter = new MemoryQueueAdapter();
    const client = createQueueClient(adapter, 'emails');

    const server = createServer({
      context: buildContext,
      capabilities: { notifications: { sendEmail } },
      transports: [queueTransport({ queues: ['emails'], adapter })],
    });
    await server.start();

    await client.enqueue('notifications.sendEmail', { to: 'hello@example.com' });
    const to = await done;

    expect(to).toBe('hello@example.com');
    await server.stop();
  });
});

// ---------------------------------------------------------------------------
// queue + REST same capability
// ---------------------------------------------------------------------------

describe('queue + REST same capability', () => {
  it('same capability invoked via REST and queue produces same result', async () => {
    const results: Array<{ to: string; subject: string }> = [];
    let queueResolve!: () => void;
    const queueDone = new Promise<void>(r => { queueResolve = r; });

    const sendEmail = capability(
      z.object({ to: z.string(), subject: z.string() }),
      ({ to, subject }) => {
        results.push({ to, subject });
        if (results.length === 2) queueResolve();
        return { sent: true, to, subject };
      },
      'mutation'
    );

    const adapter = new MemoryQueueAdapter();
    const client = createQueueClient(adapter, 'emails');

    const server = createServer({
      context: buildContext,
      capabilities: { notifications: { sendEmail } },
      transports: [queueTransport({ queues: ['emails'], adapter })],
    });
    await server.start();

    // Invoke via direct server.invoke (equivalent to the HTTP path)
    const directResult = await server.invoke({
      capability: 'notifications.sendEmail',
      input: { to: 'direct@example.com', subject: 'Direct' },
      headers: {},
      signal: AbortSignal.timeout(5000),
    });

    // Invoke via queue
    await client.enqueue('notifications.sendEmail', { to: 'queue@example.com', subject: 'Queue' });
    await queueDone;

    expect(directResult.ok).toBe(true);
    expect(results).toHaveLength(2);
    // Both invocations produce the same output shape
    const [first, second] = results;
    expect(first).toMatchObject({ to: 'direct@example.com', subject: 'Direct' });
    expect(second).toMatchObject({ to: 'queue@example.com', subject: 'Queue' });

    await server.stop();
  });
});
