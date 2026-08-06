/**
 * transport.ts — WebSocket transport using the 'ws' package
 * Depends on: capix core, ws
 */

import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type {
  Transport,
  MountOptions,
  InvokeFn,
  GroupTree,
  TransportWithCapabilities,
  CapabilityResponse,
} from '@capixjs/core';
import { createTimeoutSignal } from '@capixjs/core';
import type { EventBus, EventMap } from './event-bus.js';

export type WsTransportOptions = {
  readonly port: number;
  readonly host?: string;
  readonly eventBus?: EventBus<EventMap>;
  /** Capability registry for this transport only. Overrides the server-level default. */
  readonly capabilities?: GroupTree;
  /**
   * How long unmount() waits for clients to complete the close handshake
   * before terminating their sockets, in milliseconds. Default: 10_000.
   */
  readonly shutdownTimeoutMs?: number;
  /**
   * Maximum inbound message size in bytes. Connections sending larger frames
   * are closed with 1009 (message too big). Default: 1 MiB — matches the REST
   * transport's default body limit. (The `ws` library default is 100 MiB.)
   */
  readonly maxPayloadBytes?: number;
  /**
   * Heartbeat interval in milliseconds. Every interval the server pings each
   * client and terminates any client that did not answer the previous ping —
   * otherwise dead connections (crashed clients, dropped networks) hold their
   * subscriptions forever. Default: 30_000. Set `false` to disable.
   */
  readonly heartbeatIntervalMs?: number | false;
  /**
   * Authorizes subscribe messages. Called with the event name and the headers
   * from the HTTP upgrade request; return false (or throw) to reject the
   * subscription with a Forbidden error. Without this option any connected
   * client may subscribe to any event.
   */
  readonly authorizeSubscribe?: (
    event: string,
    headers: Record<string, string>,
  ) => boolean | Promise<boolean>;
};

type IncomingMessage_ =
  | { readonly id?: string; readonly capability: string; readonly input: unknown }
  | { readonly id?: string; readonly action: 'subscribe' | 'unsubscribe'; readonly event: string };

function isCapabilityMessage(msg: IncomingMessage_): msg is { id?: string; capability: string; input: unknown } {
  return 'capability' in msg;
}

/** Creates a WebSocket transport using the 'ws' package. */
export function wsTransport(options: WsTransportOptions): TransportWithCapabilities {
  let wss: WebSocketServer | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  // Clients that answered the last ping (or just connected/ponged)
  const alive = new WeakSet<WebSocket>();

  function send(ws: WebSocket, payload: Record<string, unknown>): void {
    ws.send(JSON.stringify(payload));
  }

  function handleConnection(ws: WebSocket, req: IncomingMessage, invoke: InvokeFn): void {
    const clientId = randomUUID();
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    // Track per-event unsubscribe fns so individual events can be removed
    const unsubscribeFns = new Map<string, () => void>();

    // Extract headers from the HTTP upgrade request for buildContext
    const rawHeaders: Record<string, string> = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i];
      const val = req.rawHeaders[i + 1];
      if (key !== undefined && val !== undefined) {
        rawHeaders[key.toLowerCase()] = val;
      }
    }

    ws.on('message', async (data: RawData) => {
      let msg: IncomingMessage_ | undefined;

      try {
        msg = JSON.parse(data.toString()) as IncomingMessage_;
      } catch {
        ws.close(1003, 'Invalid JSON');
        return;
      }

      // Handle subscribe/unsubscribe control messages
      if ('action' in msg) {
        if (!options.eventBus) {
          send(ws, { id: msg.id, ok: false, error: 'BadRequest', message: 'No event bus configured' });
          return;
        }
        if (msg.action === 'subscribe') {
          if (options.authorizeSubscribe !== undefined) {
            let allowed = false;
            try {
              allowed = await options.authorizeSubscribe(msg.event, rawHeaders);
            } catch {
              allowed = false;
            }
            if (!allowed) {
              send(ws, {
                id: msg.id,
                ok: false,
                error: 'Forbidden',
                message: `Subscription to '${msg.event}' denied`,
              });
              return;
            }
          }
          // Idempotent: replace any existing subscription for this event
          unsubscribeFns.get(msg.event)?.();
          const unsub = options.eventBus.subscribe(clientId, msg.event, (eventData) => {
            send(ws, { event: (msg as { event: string }).event, data: eventData });
          });
          unsubscribeFns.set(msg.event, unsub);
          send(ws, { id: msg.id, ok: true, event: msg.event, subscribed: true });
        } else if (msg.action === 'unsubscribe') {
          unsubscribeFns.get(msg.event)?.();
          unsubscribeFns.delete(msg.event);
          send(ws, { id: msg.id, ok: true, event: msg.event, subscribed: false });
        }
        return;
      }

      if (!isCapabilityMessage(msg) || !msg.capability || typeof msg.capability !== 'string') {
        send(ws, { id: msg?.id, ok: false, error: 'BadRequest', message: 'Missing capability field' });
        return;
      }

      const { signal, clear } = createTimeoutSignal(30_000);
      let response: CapabilityResponse;
      try {
        response = await invoke({
          capability: msg.capability,
          input: msg.input,
          headers: rawHeaders,
          signal,
        });
      } finally {
        clear();
      }

      if (response.ok) {
        send(ws, { id: msg.id, ok: true, data: response.data });
      } else {
        const { status, error, message, meta } = response.error;
        const payload: Record<string, unknown> = { id: msg.id, ok: false, status, error, message };
        if (meta !== undefined) payload['meta'] = meta;
        send(ws, payload);
      }
    });

    ws.on('close', () => {
      if (options.eventBus) options.eventBus.unsubscribeAll(clientId);
    });

    ws.on('error', (err) => {
      console.error('[capix:ws] connection error:', err);
    });
  }

  return {
    ...(options.capabilities !== undefined ? { _capabilities: options.capabilities } : {}),

    async mount(invoke: InvokeFn, _options: MountOptions): Promise<void> {
      return new Promise((resolve, reject) => {
        wss = new WebSocketServer({
          port: options.port,
          host: options.host,
          maxPayload: options.maxPayloadBytes ?? 1024 * 1024,
        });

        wss.on('error', reject);

        wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
          handleConnection(ws, req, invoke);
        });

        wss.on('listening', () => {
          console.log(`  ✓ WS     ws://localhost:${options.port}`);
          resolve();
        });

        const intervalMs = options.heartbeatIntervalMs ?? 30_000;
        if (intervalMs !== false) {
          const server = wss;
          heartbeat = setInterval(() => {
            for (const client of server.clients) {
              if (!alive.has(client)) {
                // Missed a full interval — the connection is dead
                client.terminate();
                continue;
              }
              alive.delete(client);
              client.ping();
            }
          }, intervalMs);
          heartbeat.unref();
        }
      });
    },

    async unmount(): Promise<void> {
      if (!wss) return;
      const server = wss;
      wss = null;
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

      // Ask every client to close cleanly (1001 = going away). wss.close()
      // only stops accepting connections — its callback waits for clients,
      // so without this the shutdown would hang on any connected client.
      for (const client of server.clients) {
        client.close(1001, 'Server shutting down');
      }

      // Terminate stragglers that never finish the close handshake
      const timer = setTimeout(() => {
        for (const client of server.clients) client.terminate();
      }, options.shutdownTimeoutMs ?? 10_000);
      timer.unref();

      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
