import type { QueueAdapter, QueueMessage, QueueResult } from '../types.js';

type PendingJob = {
  msg: QueueMessage;
};

export class MemoryQueueAdapter implements QueueAdapter {
  private queues   = new Map<string, PendingJob[]>();
  private handlers = new Map<string, (msg: QueueMessage) => Promise<QueueResult>>();
  private running  = false;

  async start(
    queueName: string,
    onMessage: (msg: QueueMessage) => Promise<QueueResult>
  ): Promise<void> {
    this.handlers.set(queueName, onMessage);
    this.running = true;
    this.processQueue(queueName);
  }

  async enqueue(queueName: string, msg: QueueMessage): Promise<void> {
    const handler = this.handlers.get(queueName);

    if (handler && this.running) {
      setImmediate(() => {
        handler(msg).catch(() => {
          // Silently drop failed jobs — caller should handle errors in onMessage
        });
      });
    } else {
      if (!this.queues.has(queueName)) this.queues.set(queueName, []);
      this.queues.get(queueName)!.push({ msg });
    }
  }

  private processQueue(queueName: string): void {
    const pending = this.queues.get(queueName);
    if (!pending || pending.length === 0) return;
    const handler = this.handlers.get(queueName);
    if (!handler) return;

    this.queues.set(queueName, []);
    for (const job of pending) {
      setImmediate(() => {
        handler(job.msg).catch(() => {});
      });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.handlers.clear();
  }
}
