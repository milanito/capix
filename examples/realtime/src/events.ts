import { createEventBus } from '@capixjs/transport-ws';

export type AppEvents = {
  'task:created': { id: string; title: string; status: string };
  'task:updated': { id: string; title?: string; status?: string };
  'task:deleted': { id: string };
};

export const eventBus = createEventBus<AppEvents>();
