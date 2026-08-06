import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQAdapter } from './bullmq.js';
import type { QueueMessage } from '../types.js';

const queueInstances: MockQueue[] = [];
const workerInstances: MockWorker[] = [];

class MockQueue {
  name: string;
  add = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);

  constructor(name: string) {
    this.name = name;
    queueInstances.push(this);
  }
}

type Processor = (job: { data: QueueMessage }) => Promise<unknown>;

class MockWorker {
  close = vi.fn().mockResolvedValue(undefined);
  processor: Processor;

  constructor(_queueName: string, processor: Processor) {
    this.processor = processor;
    workerInstances.push(this);
  }
}

vi.mock('bullmq', () => ({
  Queue: MockQueue,
  Worker: MockWorker,
}));

function msg(id: string): QueueMessage {
  return { id, capability: 'jobs.process', input: { id }, headers: {} };
}

describe('BullMQAdapter', () => {
  beforeEach(() => {
    queueInstances.length = 0;
    workerInstances.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('reuses one Queue instance per queue name across enqueues', async () => {
    const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });

    await adapter.enqueue('jobs', msg('1'));
    await adapter.enqueue('jobs', msg('2'));
    await adapter.enqueue('jobs', msg('3'));

    expect(queueInstances).toHaveLength(1);
    expect(queueInstances[0]!.add).toHaveBeenCalledTimes(3);
    // The Queue must NOT be closed between enqueues (old behavior opened and
    // closed a Redis connection per job)
    expect(queueInstances[0]!.close).not.toHaveBeenCalled();
  });

  it('concurrent first enqueues share a single Queue instance', async () => {
    const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });

    await Promise.all([
      adapter.enqueue('jobs', msg('1')),
      adapter.enqueue('jobs', msg('2')),
      adapter.enqueue('jobs', msg('3')),
    ]);

    expect(queueInstances).toHaveLength(1);
    expect(queueInstances[0]!.add).toHaveBeenCalledTimes(3);
  });

  it('creates separate Queue instances per queue name', async () => {
    const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });

    await adapter.enqueue('emails', msg('1'));
    await adapter.enqueue('reports', msg('2'));

    expect(queueInstances).toHaveLength(2);
    expect(queueInstances.map((q) => q.name).sort()).toEqual(['emails', 'reports']);
  });

  it('stop() closes cached Queues and Workers', async () => {
    const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });

    await adapter.start('jobs', async () => ({ ok: true, data: null }));
    await adapter.enqueue('jobs', msg('1'));
    await adapter.stop();

    expect(queueInstances).toHaveLength(1);
    expect(queueInstances[0]!.close).toHaveBeenCalledOnce();

    // After stop, a new enqueue creates a fresh Queue
    await adapter.enqueue('jobs', msg('2'));
    expect(queueInstances).toHaveLength(2);
  });

  it('passes jobId and message payload to Queue.add', async () => {
    const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });
    const m = msg('job-42');

    await adapter.enqueue('jobs', m);

    expect(queueInstances[0]!.add).toHaveBeenCalledWith('jobs.process', m, { jobId: 'job-42' });
  });

  describe('Worker processor', () => {
    it('returns the capability result data on success', async () => {
      const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });
      await adapter.start('jobs', async () => ({ ok: true, data: { processed: true } }));

      const result = await workerInstances[0]!.processor({ data: msg('1') });

      expect(result).toEqual({ processed: true });
    });

    it('throws to trigger BullMQ retry when the capability invocation fails', async () => {
      // BullMQ's own retry/backoff only kicks in when the processor function
      // throws — a resolved result, even one describing a failure, is treated
      // as job success. This is the path that actually drives redelivery.
      const adapter = new BullMQAdapter({ connection: { host: 'localhost', port: 6379 } });
      const error = { status: 500, error: 'Internal', message: 'boom' };
      await adapter.start('jobs', async () => ({ ok: false, error }));

      await expect(workerInstances[0]!.processor({ data: msg('1') })).rejects.toThrow(JSON.stringify(error));
    });
  });
});
