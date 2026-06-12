import type { QueueAdapter, QueueMessage, QueueResult } from '../types.js';

type PendingJob = {
  msg: QueueMessage;
};

export type MemoryQueueAdapterOptions = {
  /**
   * Called with the result of every processed message — including failed
   * capability invocations (`result.ok === false`), which produce a result
   * rather than a thrown error. Use this to observe validation failures,
   * guard rejections, and resolver errors in background jobs.
   */
  onResult?: (msg: QueueMessage, result: QueueResult) => void;
  /**
   * Called when the message handler itself throws (unexpected — the
   * execution engine returns errors as `ok: false` results).
   * Defaults to logging via console.error.
   */
  onError?: (msg: QueueMessage, err: unknown) => void;
};

export class MemoryQueueAdapter implements QueueAdapter {
  private queues   = new Map<string, PendingJob[]>();
  private handlers = new Map<string, (msg: QueueMessage) => Promise<QueueResult>>();
  private running  = false;
  private options: MemoryQueueAdapterOptions;

  constructor(options: MemoryQueueAdapterOptions = {}) {
    this.options = options;
  }

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
      this.dispatch(handler, msg);
    } else {
      if (!this.queues.has(queueName)) this.queues.set(queueName, []);
      this.queues.get(queueName)!.push({ msg });
    }
  }

  private dispatch(
    handler: (msg: QueueMessage) => Promise<QueueResult>,
    msg: QueueMessage,
  ): void {
    setImmediate(() => {
      handler(msg).then(
        (result) => {
          this.options.onResult?.(msg, result);
        },
        (err) => {
          if (this.options.onError) {
            this.options.onError(msg, err);
          } else {
            console.error(`[capix:queue] Job '${msg.capability}' (${msg.id}) threw:`, err);
          }
        },
      );
    });
  }

  private processQueue(queueName: string): void {
    const pending = this.queues.get(queueName);
    if (!pending || pending.length === 0) return;
    const handler = this.handlers.get(queueName);
    if (!handler) return;

    this.queues.set(queueName, []);
    for (const job of pending) {
      this.dispatch(handler, job.msg);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.handlers.clear();
  }
}
