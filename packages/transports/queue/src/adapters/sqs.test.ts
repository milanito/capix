import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry, createExecutionEngine, defineContext, defineError } from '@capixjs/core';
import { SqsQueueAdapter } from './sqs.js';
import type { SqsClientLike } from './sqs.js';
import { queueTransport, createQueueClient } from '../transport.js';
import type { QueueMessage, QueueResult } from '../types.js';

// ---------------------------------------------------------------------------
// Fake SQS with real visibility semantics: received messages become
// invisible; deleteMessage removes them; expireVisibility() puts undeleted
// messages back — exactly the redelivery contract the adapter relies on.
// ---------------------------------------------------------------------------

type StoredMessage = { Body: string; ReceiptHandle: string };

function fakeSqs(): SqsClientLike & {
  queues: Map<string, StoredMessage[]>;
  invisible: Map<string, StoredMessage>;
  deleted: string[];
  sent: Array<{ QueueUrl: string; MessageBody: string; MessageGroupId?: string; MessageDeduplicationId?: string }>;
  expireVisibility(): void;
  failNextReceive(err: Error): void;
} {
  const queues = new Map<string, StoredMessage[]>();
  const invisible = new Map<string, StoredMessage>();
  const deleted: string[] = [];
  const sent: Array<{ QueueUrl: string; MessageBody: string; MessageGroupId?: string; MessageDeduplicationId?: string }> = [];
  let receiveFailure: Error | null = null;
  let handleSeq = 0;

  return {
    queues, invisible, deleted, sent,

    expireVisibility() {
      for (const [handle, m] of invisible) {
        const url = handle.split('#')[0]!;
        queues.get(url)?.push({ ...m, ReceiptHandle: `${url}#rh-${handleSeq++}` });
        invisible.delete(handle);
      }
    },

    failNextReceive(err) {
      receiveFailure = err;
    },

    async sendMessage(params) {
      sent.push(params);
      const list = queues.get(params.QueueUrl) ?? [];
      list.push({ Body: params.MessageBody, ReceiptHandle: `${params.QueueUrl}#rh-${handleSeq++}` });
      queues.set(params.QueueUrl, list);
      return {};
    },

    async receiveMessage(params) {
      if (receiveFailure !== null) {
        const err = receiveFailure;
        receiveFailure = null;
        throw err;
      }
      const list = queues.get(params.QueueUrl) ?? [];
      const batch = list.splice(0, params.MaxNumberOfMessages ?? 10);
      for (const m of batch) invisible.set(m.ReceiptHandle, m);
      if (batch.length === 0) {
        // emulate a (shortened) long poll so the adapter loop doesn't spin
        await new Promise((r) => setTimeout(r, 5));
      }
      return { Messages: batch.map((m) => ({ Body: m.Body, ReceiptHandle: m.ReceiptHandle })) };
    },

    async deleteMessage(params) {
      invisible.delete(params.ReceiptHandle);
      deleted.push(params.ReceiptHandle);
      return {};
    },
  };
}

const URL_STD = 'https://sqs.eu-west-1.amazonaws.com/1/jobs';
const URL_FIFO = 'https://sqs.eu-west-1.amazonaws.com/1/jobs.fifo';

const msg = (over: Partial<QueueMessage> = {}): QueueMessage => ({
  id: 'm1',
  capability: 'jobs.process',
  input: { n: 1 },
  headers: {},
  ...over,
});

const flush = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 5));
};

function adapterWith(sqs: SqsClientLike, extra: Partial<ConstructorParameters<typeof SqsQueueAdapter>[0]> = {}): SqsQueueAdapter {
  return new SqsQueueAdapter({
    client: sqs,
    queueUrls: { jobs: URL_STD, 'jobs-fifo': URL_FIFO },
    waitTimeSeconds: 0,
    errorBackoffMs: 1,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe('SqsQueueAdapter — enqueue', () => {
  it('serializes the QueueMessage to the mapped queue URL', async () => {
    const sqs = fakeSqs();
    await adapterWith(sqs).enqueue('jobs', msg());

    expect(sqs.sent).toHaveLength(1);
    expect(sqs.sent[0]!.QueueUrl).toBe(URL_STD);
    expect(JSON.parse(sqs.sent[0]!.MessageBody)).toEqual(msg());
    expect(sqs.sent[0]!.MessageGroupId).toBeUndefined();
  });

  it('adds FIFO group and deduplication ids for .fifo queues', async () => {
    const sqs = fakeSqs();
    await adapterWith(sqs).enqueue('jobs-fifo', msg({ id: 'dedup-1' }));

    expect(sqs.sent[0]!.MessageGroupId).toBe('jobs.process');
    expect(sqs.sent[0]!.MessageDeduplicationId).toBe('dedup-1');
  });

  it('throws a helpful error for unmapped queue names', async () => {
    await expect(adapterWith(fakeSqs()).enqueue('ghost', msg()))
      .rejects.toThrow(/no queue URL configured for 'ghost'/);
  });
});

// ---------------------------------------------------------------------------
// message lifecycle
// ---------------------------------------------------------------------------

describe('SqsQueueAdapter — lifecycle', () => {
  it('processes a message and deletes it on success', async () => {
    const sqs = fakeSqs();
    const adapter = adapterWith(sqs);
    const handled: QueueMessage[] = [];

    await adapter.enqueue('jobs', msg());
    await adapter.start('jobs', async (m) => {
      handled.push(m);
      return { ok: true, data: 'done' };
    });
    await flush();
    await adapter.stop();

    expect(handled).toEqual([msg()]);
    expect(sqs.deleted).toHaveLength(1);
    expect(sqs.invisible.size).toBe(0);
  });

  it('keeps failed messages for redelivery — visibility timeout drives the retry', async () => {
    const sqs = fakeSqs();
    const results: QueueResult[] = [];
    const adapter = adapterWith(sqs, { onResult: (_m, r) => void results.push(r) });

    let attempts = 0;
    await adapter.enqueue('jobs', msg());
    await adapter.start('jobs', async () => {
      attempts++;
      return attempts === 1
        ? { ok: false, error: { status: 500, error: 'Internal', message: 'boom' } }
        : { ok: true, data: 'recovered' };
    });
    await flush();

    // First attempt failed: nothing deleted, message parked invisible
    expect(attempts).toBe(1);
    expect(sqs.deleted).toHaveLength(0);
    expect(sqs.invisible.size).toBe(1);

    // Visibility expires → SQS redelivers → second attempt succeeds
    sqs.expireVisibility();
    await flush();
    await adapter.stop();

    expect(attempts).toBe(2);
    expect(sqs.deleted).toHaveLength(1);
    expect(results.map((r) => r.ok)).toEqual([false, true]);
  });

  it('leaves the message for redelivery when the handler throws, and reports it', async () => {
    const sqs = fakeSqs();
    const errors: unknown[] = [];
    const adapter = adapterWith(sqs, { onError: (_m, e) => void errors.push(e) });

    await adapter.enqueue('jobs', msg());
    await adapter.start('jobs', async () => {
      throw new Error('handler exploded');
    });
    await flush();
    await adapter.stop();

    expect(sqs.deleted).toHaveLength(0);
    expect(sqs.invisible.size).toBe(1);
    expect(String(errors[0])).toContain('handler exploded');
  });

  it('deletes unparseable messages instead of redelivering them forever', async () => {
    const sqs = fakeSqs();
    const errors: unknown[] = [];
    const adapter = adapterWith(sqs, { onError: (_m, e) => void errors.push(e) });

    await sqs.sendMessage({ QueueUrl: URL_STD, MessageBody: 'not-json{' });
    await sqs.sendMessage({ QueueUrl: URL_STD, MessageBody: JSON.stringify({ noCapability: true }) });

    const handled: QueueMessage[] = [];
    await adapter.start('jobs', async (m) => {
      handled.push(m);
      return { ok: true, data: null };
    });
    await flush();
    await adapter.stop();

    expect(handled).toEqual([]); // never reached the handler
    expect(sqs.deleted).toHaveLength(2); // both poison messages removed
    expect(errors).toHaveLength(2);
  });

  it('processes a batch concurrently', async () => {
    const sqs = fakeSqs();
    const adapter = adapterWith(sqs);
    let concurrent = 0;
    let peak = 0;

    await adapter.enqueue('jobs', msg({ id: 'a' }));
    await adapter.enqueue('jobs', msg({ id: 'b' }));
    await adapter.enqueue('jobs', msg({ id: 'c' }));

    await adapter.start('jobs', async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return { ok: true, data: null };
    });
    await flush(12);
    await adapter.stop();

    expect(sqs.deleted).toHaveLength(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('survives receive failures: reports, backs off, keeps polling', async () => {
    const sqs = fakeSqs();
    const errors: Array<[QueueMessage | null, unknown]> = [];
    const adapter = adapterWith(sqs, { onError: (m, e) => void errors.push([m, e]) });

    sqs.failNextReceive(new Error('network down'));
    await adapter.enqueue('jobs', msg());
    await adapter.start('jobs', async () => ({ ok: true, data: null }));
    await flush();
    await adapter.stop();

    expect(errors[0]![0]).toBeNull(); // infrastructure error, no message context
    expect(String(errors[0]![1])).toContain('network down');
    expect(sqs.deleted).toHaveLength(1); // the loop recovered and processed
  });

  it('fails fast when started on an unmapped queue', async () => {
    await expect(adapterWith(fakeSqs()).start('ghost', async () => ({ ok: true, data: null })))
      .rejects.toThrow(/no queue URL configured/);
  });
});

// ---------------------------------------------------------------------------
// graceful stop
// ---------------------------------------------------------------------------

describe('SqsQueueAdapter — stop', () => {
  it('drains in-flight handlers before resolving', async () => {
    const sqs = fakeSqs();
    const adapter = adapterWith(sqs);
    let finished = false;

    await adapter.enqueue('jobs', msg());
    await adapter.start('jobs', async () => {
      await new Promise((r) => setTimeout(r, 60));
      finished = true;
      return { ok: true, data: null };
    });
    await new Promise((r) => setTimeout(r, 20)); // handler is mid-flight

    await adapter.stop();

    expect(finished).toBe(true); // stop waited for the handler
    expect(sqs.deleted).toHaveLength(1); // and for the delete
  });

  it('processes nothing new after stop', async () => {
    const sqs = fakeSqs();
    const adapter = adapterWith(sqs);
    const handled: string[] = [];

    await adapter.start('jobs', async (m) => {
      handled.push(m.id);
      return { ok: true, data: null };
    });
    await flush();
    await adapter.stop();

    await adapter.enqueue('jobs', msg({ id: 'late' }));
    await flush();

    expect(handled).toEqual([]);
    expect(sqs.queues.get(URL_STD)).toHaveLength(1); // still queued for the next start
  });
});

// ---------------------------------------------------------------------------
// End to end through queueTransport — the real engine, guards and all
// ---------------------------------------------------------------------------

describe('SqsQueueAdapter — through queueTransport', () => {
  it('runs enqueued jobs through the execution engine with validation', async () => {
    const sqs = fakeSqs();
    const results: QueueResult[] = [];
    const adapter = adapterWith(sqs, { onResult: (_m, r) => void results.push(r) });

    const sendEmail = capability(
      z.object({ to: z.string().email() }),
      ({ to }) => ({ sent: to }),
    );
    const registry = compileRegistry({ jobs: { sendEmail } });
    const invoke = createExecutionEngine({
      registry,
      buildContext: defineContext(async () => ({ requestId: 'job' })),
    });

    const transport = queueTransport({ queues: ['jobs'], adapter });
    await transport.mount(invoke, { registry, invoke });

    const client = createQueueClient(adapter, 'jobs');
    await client.enqueue('jobs.sendEmail', { to: 'ada@example.com' });
    await client.enqueue('jobs.sendEmail', { to: 'not-an-email' }); // fails validation
    await flush(12);
    await transport.unmount();

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect((ok[0] as { data: unknown }).data).toEqual({ sent: 'ada@example.com' });
    expect(failed).toHaveLength(1);
    expect((failed[0] as { error: { status: number } }).error.status).toBe(400);
    // valid job deleted; invalid one parked for redelivery/DLQ
    expect(sqs.deleted).toHaveLength(1);
    expect(sqs.invisible.size).toBe(1);
  });
});
