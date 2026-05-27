/**
 * event-bus.ts — typed event bus for server-push over WebSocket
 *
 * createEventBus<TEvents>() produces a pub/sub hub that any code can publish
 * to, while wsTransport delivers those events to subscribed WS clients.
 *
 * Usage:
 *   const bus = createEventBus<{ 'order:paid': { orderId: string } }>();
 *   bus.publish('order:paid', { orderId: 'abc' }); // called from REST resolver
 *   // wsTransport wires subscribe/unsubscribe from WS client messages
 */

export type EventMap = Record<string, unknown>;

export type EventBus<TEvents extends EventMap> = {
  /** Deliver an event to all clients currently subscribed to it. */
  publish<K extends keyof TEvents & string>(event: K, data: TEvents[K]): void;

  /**
   * Register a handler for a client+event pair.
   * Returns an unsubscribe function.
   */
  subscribe<K extends keyof TEvents & string>(
    clientId: string,
    event: K,
    handler: (data: TEvents[K]) => void,
  ): () => void;

  /** Remove every subscription held by a client (call on disconnect). */
  unsubscribeAll(clientId: string): void;

  /** Used internally by wsTransport to look up a handler for a specific client+event. */
  _getHandler(clientId: string, event: string): ((data: unknown) => void) | undefined;
};

export function createEventBus<TEvents extends EventMap>(): EventBus<TEvents> {
  // Map<event, Map<clientId, handler>>
  const listeners = new Map<string, Map<string, (data: unknown) => void>>();

  return {
    publish(event, data) {
      const eventListeners = listeners.get(event);
      if (!eventListeners) return;
      for (const handler of eventListeners.values()) {
        handler(data as unknown);
      }
    },

    subscribe(clientId, event, handler) {
      const key = event as string;
      if (!listeners.has(key)) listeners.set(key, new Map());
      listeners.get(key)!.set(clientId, handler as (data: unknown) => void);
      return () => {
        listeners.get(key)?.delete(clientId);
      };
    },

    unsubscribeAll(clientId) {
      for (const eventListeners of listeners.values()) {
        eventListeners.delete(clientId);
      }
    },

    _getHandler(clientId, event) {
      return listeners.get(event)?.get(clientId);
    },
  };
}
