/**
 * events.ts — module-level event bus for cross-transport communication.
 *
 * This is the recommended pattern for broadcasting mutations from REST
 * capabilities to WebSocket clients. Import taskEvents in both the REST
 * capability (to emit) and the WS server setup (to subscribe).
 */

import { EventEmitter } from 'node:events';

export type TaskEvent =
  | { type: 'task.created'; taskId: string; data: unknown }
  | { type: 'task.updated'; taskId: string; data: unknown }
  | { type: 'task.deleted'; taskId: string };

// Typed emit/on wrappers so consumers don't need to cast
class TaskEventBus extends EventEmitter {
  emit(event: 'task', payload: TaskEvent): boolean {
    return super.emit('task', payload);
  }

  on(event: 'task', listener: (payload: TaskEvent) => void): this {
    return super.on('task', listener);
  }

  off(event: 'task', listener: (payload: TaskEvent) => void): this {
    return super.off('task', listener);
  }
}

export const taskEvents = new TaskEventBus();
