/**
 * event-bus.ts — typed event bus for server-push notifications
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

export type SubscribeOptions<TData = unknown> = {
  /** When provided, the handler is only called when this returns true. */
  filter?: (data: TData) => boolean;
};

export type EventBus<TEvents extends EventMap> = {
  /** Deliver an event to all clients currently subscribed to it. */
  publish<K extends keyof TEvents & string>(event: K, data: TEvents[K]): void;

  subscribe: {
    /**
     * Server-internal subscription (no client context).
     * Not removed by unsubscribeAll — use the returned unsubscribe fn to clean up.
     *
     * @param handler - Called synchronously when the event is published.
     *   If the handler is async, the returned Promise is NOT awaited by `publish()`.
     *   This is intentional fire-and-forget behavior — suitable for webhooks and
     *   notifications where failures should be handled independently.
     *
     *   Always wrap async subscriber logic in try/catch:
     *   ```ts
     *   eventBus.subscribe('order:completed', async (data) => {
     *     try {
     *       await sendWebhook(data);
     *     } catch (err) {
     *       logger.error('Webhook delivery failed', err);
     *     }
     *   });
     *   ```
     */
    <K extends keyof TEvents & string>(
      event: K,
      handler: (data: TEvents[K]) => void,
      options?: SubscribeOptions<TEvents[K]>,
    ): () => void;
    /**
     * Client subscription — removed when unsubscribeAll(clientId) is called on disconnect.
     *
     * @param handler - Called synchronously when the event is published.
     *   Async handlers are fire-and-forget — errors do not propagate to the publisher.
     */
    <K extends keyof TEvents & string>(
      clientId: string,
      event: K,
      handler: (data: TEvents[K]) => void,
      options?: SubscribeOptions<TEvents[K]>,
    ): () => void;
  };

  /** Remove every subscription held by a client (call on disconnect). */
  unsubscribeAll(clientId: string): void;

  /** Used internally by wsTransport to look up a handler for a specific client+event. */
  _getHandler(clientId: string, event: string): ((data: unknown) => void) | undefined;
};

type Sub = {
  handler: (data: unknown) => void;
  filter: ((data: unknown) => boolean) | undefined;
};

export function createEventBus<TEvents extends EventMap>(): EventBus<TEvents> {
  // Map<event, Map<clientId | Symbol, Sub>>
  const listeners = new Map<string, Map<string | symbol, Sub>>();

  function subscribeImpl(
    clientId: string | symbol,
    event: string,
    handler: (data: unknown) => void,
    filter: ((data: unknown) => boolean) | undefined,
  ): () => void {
    if (!listeners.has(event)) listeners.set(event, new Map());
    listeners.get(event)!.set(clientId, { handler, filter });
    return () => {
      listeners.get(event)?.delete(clientId);
    };
  }

  return {
    publish(event: string, data: unknown) {
      const eventListeners = listeners.get(event);
      if (!eventListeners) return;
      for (const sub of eventListeners.values()) {
        if (!sub.filter || sub.filter(data)) {
          sub.handler(data);
        }
      }
    },

    subscribe(
      clientIdOrEvent: string,
      eventOrHandler: string | ((data: unknown) => void),
      handlerOrOptions?: ((data: unknown) => void) | SubscribeOptions<unknown>,
      maybeOptions?: SubscribeOptions<unknown>,
    ): () => void {
      if (typeof eventOrHandler === 'function') {
        const opts = handlerOrOptions as SubscribeOptions<unknown> | undefined;
        return subscribeImpl(Symbol(), clientIdOrEvent, eventOrHandler, opts?.filter);
      }
      return subscribeImpl(
        clientIdOrEvent,
        eventOrHandler,
        handlerOrOptions as (data: unknown) => void,
        maybeOptions?.filter,
      );
    },

    unsubscribeAll(clientId: string) {
      for (const eventListeners of listeners.values()) {
        eventListeners.delete(clientId);
      }
    },

    _getHandler(clientId: string, event: string) {
      return listeners.get(event)?.get(clientId)?.handler;
    },
  } as unknown as EventBus<TEvents>;
}
