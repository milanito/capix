import type { Transport, MountOptions, InvokeFn, GroupTree, TransportWithCapabilities } from '@capixjs/core';
import type { QueueAdapter, QueueMessage }                                               from './types.js';
import { randomUUID }                                                                    from 'node:crypto';

export type QueueTransportOptions = {
  queues:   string[];
  adapter:  QueueAdapter;
  /** Capability registry for this transport only. Overrides the server-level default. */
  capabilities?: GroupTree;
};

export function queueTransport(options: QueueTransportOptions): TransportWithCapabilities {
  return {
    ...(options.capabilities !== undefined ? { _capabilities: options.capabilities } : {}),

    async mount(invoke: InvokeFn, _mountOptions: MountOptions): Promise<void> {
      for (const queueName of options.queues) {
        await options.adapter.start(queueName, async (msg: QueueMessage) => {
          return invoke({
            capability: msg.capability,
            input:      msg.input,
            headers:    msg.headers,
            signal:     AbortSignal.timeout(300_000),
          });
        });
      }
    },

    async unmount(): Promise<void> {
      await options.adapter.stop();
    },
  };
}

export function createQueueClient(adapter: QueueAdapter, queueName: string) {
  return {
    async enqueue(
      capability: string,
      input:      unknown,
      headers:    Record<string, string> = {}
    ): Promise<string> {
      const id = randomUUID();
      await adapter.enqueue(queueName, { id, capability, input, headers });
      return id;
    },
  };
}
