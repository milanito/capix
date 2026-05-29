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

export class BullMQAdapter implements QueueAdapter {
  private options: BullMQAdapterOptions;
  private workers = new Map<string, { close(): Promise<void> }>();

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

  async enqueue(queueName: string, msg: QueueMessage): Promise<void> {
    const { Queue } = await loadBullMQ();
    const queue = new Queue(queueName, { connection: this.options.connection });
    await queue.add(msg.capability, msg, { jobId: msg.id });
    await queue.close();
  }

  async stop(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    this.workers.clear();
  }
}
