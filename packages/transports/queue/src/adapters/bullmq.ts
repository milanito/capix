import type { QueueAdapter, QueueMessage, QueueResult } from '../types.js';

async function loadBullMQ() {
  try {
    return await import('bullmq');
  } catch {
    throw new Error(
      '[capix] capix-transport-queue BullMQ adapter requires bullmq and ioredis.\n' +
      'Install them: pnpm add bullmq ioredis'
    );
  }
}

export type BullMQAdapterOptions = {
  connection: { host: string; port: number } | { url: string };
  concurrency?: number;
  removeOnComplete?: number;
  removeOnFail?: number;
};

type QueueLike = {
  add(name: string, data: unknown, opts: { jobId: string }): Promise<unknown>;
  close(): Promise<void>;
};

export class BullMQAdapter implements QueueAdapter {
  private options: BullMQAdapterOptions;
  private workers = new Map<string, { close(): Promise<void> }>();
  // One Queue (and Redis connection) per queue name, reused across enqueues.
  // Creating and closing a Queue per enqueue opens a new Redis connection per
  // job — connection churn that collapses enqueue throughput under load.
  // Stored as promises so concurrent first enqueues share one instance.
  private queues = new Map<string, Promise<QueueLike>>();

  constructor(options: BullMQAdapterOptions) {
    this.options = options;
  }

  async start(
    queueName: string,
    onMessage: (msg: QueueMessage) => Promise<QueueResult>
  ): Promise<void> {
    const { Worker } = await loadBullMQ();

    const worker = new Worker(
      queueName,
      async (job: { data: QueueMessage }) => {
        const result = await onMessage(job.data);
        if (!result.ok) {
          throw new Error(JSON.stringify(result.error));
        }
        return result.data;
      },
      {
        connection:       this.options.connection,
        concurrency:      this.options.concurrency ?? 10,
        removeOnComplete: { count: this.options.removeOnComplete ?? 100 },
        removeOnFail:     { count: this.options.removeOnFail ?? 1000 },
      }
    );

    this.workers.set(queueName, worker as { close(): Promise<void> });
    console.log(`[capix] Queue transport processing: ${queueName}`);
  }

  private getQueue(queueName: string): Promise<QueueLike> {
    let queue = this.queues.get(queueName);
    if (queue === undefined) {
      queue = loadBullMQ().then(
        ({ Queue }) =>
          new Queue(queueName, { connection: this.options.connection }) as unknown as QueueLike,
      );
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  async enqueue(queueName: string, msg: QueueMessage): Promise<void> {
    const queue = await this.getQueue(queueName);
    await queue.add(msg.capability, msg, { jobId: msg.id });
  }

  async stop(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    this.workers.clear();
    for (const queuePromise of this.queues.values()) {
      const queue = await queuePromise.catch(() => null);
      if (queue !== null) await queue.close();
    }
    this.queues.clear();
  }
}
