export type QueueMessage = {
  id:         string;
  capability: string;
  input:      unknown;
  headers:    Record<string, string>;
};

export type QueueResult =
  | { ok: true;  data: unknown }
  | { ok: false; error: { status: number; error: string; message: string; meta?: Record<string, unknown> } };

export interface QueueAdapter {
  start(
    queueName: string,
    onMessage: (msg: QueueMessage) => Promise<QueueResult>
  ): Promise<void>;

  enqueue(queueName: string, msg: QueueMessage): Promise<void>;

  stop(): Promise<void>;
}
