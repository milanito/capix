/**
 * sqs.ts — Amazon SQS adapter for the queue transport.
 *
 * Structurally typed against the AWS SDK v3 aggregated client
 * (`new SQS({ region })` from @aws-sdk/client-sqs) — nothing is bundled.
 *
 * Semantics:
 * - success           → the message is deleted
 * - failed result     → the message is NOT deleted; SQS redelivers it after
 *   the queue's visibility timeout, and the queue's redrive policy / DLQ
 *   caps the retries (same retry-by-requeue model as the BullMQ adapter)
 * - handler throw     → not deleted (retry), reported via onError
 * - unparseable body  → deleted and reported — a poison message would
 *   otherwise redeliver forever
 * - FIFO queues (URL ends in .fifo) get MessageGroupId = capability and
 *   MessageDeduplicationId = message id automatically
 */

import type { QueueAdapter, QueueMessage, QueueResult } from '../types.js';

/** The subset of @aws-sdk/client-sqs's aggregated SQS client the adapter uses. */
export type SqsClientLike = {
  sendMessage(params: {
    QueueUrl: string;
    MessageBody: string;
    MessageGroupId?: string;
    MessageDeduplicationId?: string;
  }): Promise<unknown>;
  receiveMessage(params: {
    QueueUrl: string;
    MaxNumberOfMessages?: number;
    WaitTimeSeconds?: number;
  }): Promise<{ Messages?: Array<{ Body?: string; ReceiptHandle?: string }> }>;
  deleteMessage(params: { QueueUrl: string; ReceiptHandle: string }): Promise<unknown>;
};

export type SqsQueueAdapterOptions = {
  /** An @aws-sdk/client-sqs aggregated client (or anything shaped like one). */
  client: SqsClientLike;
  /** Capix queue name → SQS queue URL. Every queue used must be mapped. */
  queueUrls: Record<string, string>;
  /** Long-poll wait per receive, in seconds. Default: 20 (SQS maximum). */
  waitTimeSeconds?: number;
  /** Messages fetched per receive (processed concurrently). Default: 10. */
  maxMessages?: number;
  /** Pause after a failed receive before retrying, in ms. Default: 5_000. */
  errorBackoffMs?: number;
  /**
   * Called with the result of every processed message — including failed
   * capability invocations (`result.ok === false`), which stay in the queue
   * for redelivery. Use this to observe background-job failures.
   */
  onResult?: (msg: QueueMessage, result: QueueResult) => void;
  /**
   * Called for infrastructure-level failures: receive errors (msg is null),
   * unparseable message bodies, or a throwing handler.
   * Defaults to logging via console.error.
   */
  onError?: (msg: QueueMessage | null, err: unknown) => void;
};

export class SqsQueueAdapter implements QueueAdapter {
  private readonly options: SqsQueueAdapterOptions;
  private running = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: SqsQueueAdapterOptions) {
    this.options = options;
  }

  private url(queueName: string): string {
    const url = this.options.queueUrls[queueName];
    if (url === undefined) {
      throw new Error(
        `[capix] SqsQueueAdapter: no queue URL configured for '${queueName}'. ` +
        `Add it to queueUrls: { '${queueName}': 'https://sqs.<region>.amazonaws.com/...' }`,
      );
    }
    return url;
  }

  private reportError(msg: QueueMessage | null, err: unknown): void {
    if (this.options.onError) {
      this.options.onError(msg, err);
    } else {
      console.error('[capix:sqs] Error:', err);
    }
  }

  async enqueue(queueName: string, msg: QueueMessage): Promise<void> {
    const QueueUrl = this.url(queueName);
    await this.options.client.sendMessage({
      QueueUrl,
      MessageBody: JSON.stringify(msg),
      // FIFO queues require a group id and deduplication id
      ...(QueueUrl.endsWith('.fifo')
        ? { MessageGroupId: msg.capability, MessageDeduplicationId: msg.id }
        : {}),
    });
  }

  async start(
    queueName: string,
    onMessage: (msg: QueueMessage) => Promise<QueueResult>,
  ): Promise<void> {
    const QueueUrl = this.url(queueName); // fail fast on unmapped queues
    this.running = true;
    // The loop runs detached; stop() flips `running` and drains inFlight.
    void this.pollLoop(QueueUrl, onMessage);
    console.log(`[capix] Queue transport processing: ${queueName} (SQS)`);
  }

  private async pollLoop(
    QueueUrl: string,
    onMessage: (msg: QueueMessage) => Promise<QueueResult>,
  ): Promise<void> {
    while (this.running) {
      let received: Awaited<ReturnType<SqsClientLike['receiveMessage']>>;
      try {
        received = await this.options.client.receiveMessage({
          QueueUrl,
          MaxNumberOfMessages: this.options.maxMessages ?? 10,
          WaitTimeSeconds: this.options.waitTimeSeconds ?? 20,
        });
      } catch (err) {
        this.reportError(null, err);
        await new Promise((r) => setTimeout(r, this.options.errorBackoffMs ?? 5_000));
        continue;
      }

      // Stopped while the long poll was in flight: leave the messages
      // untouched — SQS redelivers them after the visibility timeout.
      if (!this.running) return;

      const messages = received.Messages ?? [];
      if (messages.length === 0) continue;

      const batch = Promise.all(
        messages.map((m) => this.handleMessage(QueueUrl, m, onMessage)),
      ).then(() => undefined);
      this.inFlight.add(batch);
      try {
        await batch;
      } finally {
        this.inFlight.delete(batch);
      }
    }
  }

  private async handleMessage(
    QueueUrl: string,
    raw: { Body?: string; ReceiptHandle?: string },
    onMessage: (msg: QueueMessage) => Promise<QueueResult>,
  ): Promise<void> {
    const ReceiptHandle = raw.ReceiptHandle;
    if (ReceiptHandle === undefined) return;

    let msg: QueueMessage;
    try {
      const parsed = JSON.parse(raw.Body ?? '') as QueueMessage;
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.capability !== 'string') {
        throw new Error('message body is not a QueueMessage');
      }
      msg = parsed;
    } catch (err) {
      // Poison message: delete it or it redelivers forever
      this.reportError(null, err);
      await this.options.client.deleteMessage({ QueueUrl, ReceiptHandle }).catch((e: unknown) => {
        this.reportError(null, e);
      });
      return;
    }

    try {
      const result = await onMessage(msg);
      this.options.onResult?.(msg, result);
      if (result.ok) {
        await this.options.client.deleteMessage({ QueueUrl, ReceiptHandle });
      }
      // ok: false → leave in the queue; visibility timeout drives the retry
    } catch (err) {
      // Unexpected handler throw (the engine returns errors as results) —
      // leave the message for redelivery and report
      this.reportError(msg, err);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    // Drain messages whose handlers are mid-flight; do NOT wait for the
    // long poll itself — that could take waitTimeSeconds to return, and
    // any messages it delivers after stop are left for redelivery.
    await Promise.all([...this.inFlight]);
  }
}
