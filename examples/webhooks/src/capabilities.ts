import { z } from 'zod';
import { capability, defineError } from '@capixjs/core';

export const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  BadRequest: defineError(400, 'Bad request'),
};

// Discriminated union for webhook event types
const UserCreatedEvent = z.object({
  type: z.literal('user.created'),
  data: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    createdAt: z.string(),
  }),
});

const UserDeletedEvent = z.object({
  type: z.literal('user.deleted'),
  data: z.object({
    id: z.string(),
    deletedAt: z.string(),
    reason: z.string().optional(),
  }),
});

const PaymentSucceededEvent = z.object({
  type: z.literal('payment.succeeded'),
  data: z.object({
    paymentId: z.string(),
    amountUsd: z.number(),
    currency: z.string(),
    customerId: z.string(),
  }),
});

const PaymentFailedEvent = z.object({
  type: z.literal('payment.failed'),
  data: z.object({
    paymentId: z.string(),
    amountUsd: z.number(),
    reason: z.string(),
    customerId: z.string(),
  }),
});

export const WebhookEventSchema = z.discriminatedUnion('type', [
  UserCreatedEvent,
  UserDeletedEvent,
  PaymentSucceededEvent,
  PaymentFailedEvent,
]);

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

// In-memory event log for demonstration
const eventLog: Array<{ id: string; receivedAt: string; event: WebhookEvent }> = [];

export const receiveWebhook = capability(
  WebhookEventSchema,
  (event) => {
    const entry = { id: crypto.randomUUID(), receivedAt: new Date().toISOString(), event };
    eventLog.push(entry);

    // Dispatch based on event type
    switch (event.type) {
      case 'user.created':
        console.log(`[webhook] New user: ${event.data.email}`);
        break;
      case 'user.deleted':
        console.log(`[webhook] User deleted: ${event.data.id}`);
        break;
      case 'payment.succeeded':
        console.log(`[webhook] Payment succeeded: $${event.data.amountUsd} from ${event.data.customerId}`);
        break;
      case 'payment.failed':
        console.log(`[webhook] Payment failed: ${event.data.reason} for ${event.data.customerId}`);
        break;
    }

    return { received: true, id: entry.id };
  },
);

export const listWebhookEvents = capability(
  z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
  ({ limit }) => eventLog.slice(-limit).reverse(),
  'query',
);

export const capabilities = {
  webhooks: { receiveWebhook, listWebhookEvents },
};
