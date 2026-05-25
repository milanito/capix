/**
 * transport.ts — WebSocket transport using the 'ws' package
 * Depends on: capix core, ws
 */

import { WebSocketServer } from 'ws';
import type { WebSocket, RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Transport, MountOptions, InvokeFn } from 'capix';

export type WsTransportOptions = {
  readonly port: number;
  readonly host?: string;
};

type IncomingMessage_ = {
  readonly id?: string;
  readonly capability: string;
  readonly input: unknown;
};

/** Creates a WebSocket transport using the 'ws' package. */
export function wsTransport(options: WsTransportOptions): Transport {
  let wss: WebSocketServer | null = null;

  function send(ws: WebSocket, payload: Record<string, unknown>): void {
    ws.send(JSON.stringify(payload));
  }

  function handleConnection(ws: WebSocket, req: IncomingMessage, invoke: InvokeFn): void {
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

      if (!msg.capability || typeof msg.capability !== 'string') {
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

    ws.on('error', (err) => {
      console.error('[capix:ws] connection error:', err);
    });
  }

  return {
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
