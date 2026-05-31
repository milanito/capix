/**
 * transport.ts — WebSocket transport using the 'ws' package
 * Depends on: capix core, ws
 */

import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Transport, MountOptions, InvokeFn, GroupTree, TransportWithCapabilities } from '@capixjs/core';
import type { EventBus, EventMap } from './event-bus.js';

export type WsTransportOptions = {
  readonly port: number;
  readonly host?: string;
  readonly eventBus?: EventBus<EventMap>;
  /** Capability registry for this transport only. Overrides the server-level default. */
  readonly capabilities?: GroupTree;
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

  function send(ws: WebSocket, payload: Record<string, unknown>): void {
    ws.send(JSON.stringify(payload));
  }

  function handleConnection(ws: WebSocket, req: IncomingMessage, invoke: InvokeFn): void {
    const clientId = randomUUID();
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

      const signal = AbortSignal.timeout(30_000);
      const response = await invoke({
        capability: msg.capability,
        input: msg.input,
        headers: rawHeaders,
        signal,
      });

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
        wss = new WebSocketServer({ port: options.port, host: options.host });

        wss.on('error', reject);

        wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
          handleConnection(ws, req, invoke);
        });

        wss.on('listening', () => {
          console.log(`  ✓ WS     ws://localhost:${options.port}`);
          resolve();
        });
      });
    },

    async unmount(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!wss) return resolve();
        wss.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
