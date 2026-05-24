/**
 * transport.ts — HTTP/REST transport
 *
 * Uses node:http for HTTP/1.1. node:http2 requires TLS for HTTP/2 browser support
 * (ALPN negotiation); plain h2c is not usable by curl or browsers. For production
 * HTTP/2, wrap with http2.createSecureServer and pass your TLS certificates.
 *
 * Depends on: router.ts, capix core
 */

import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Transport, MountOptions, InvokeFn } from 'capix';
import { compileRouter, generateRoutes } from './router.js';
import type { Router } from './router.js';

const DEFAULT_MAX_BODY_SIZE = 1024 * 1024; // 1MB

export type RestTransportHooks = {
  /** Called on every response before headers are written. Use to inject additional headers. */
  readonly onRequest?: (req: IncomingMessage, res: ServerResponse) => void;
};

export type RestTransportOptions = {
  readonly port: number;
  readonly host?: string;
  readonly cors?: {
    readonly origin?: string | ((origin: string) => boolean);
    readonly methods?: string;
    readonly headers?: string;
  };
  readonly maxBodySize?: number;
  readonly hooks?: RestTransportHooks;
};

/** Creates a REST transport using node:http. */
export function restTransport(options: RestTransportOptions): Transport {
  let server: http.Server | null = null;
  let router: Router | null = null;
  let invokeFn: InvokeFn | null = null;

  const corsOriginOpt = options.cors?.origin ?? '*';
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const reqOrigin = req.headers['origin'] ?? '';
    let allowOrigin: string;
    if (typeof corsOriginOpt === 'function') {
      allowOrigin = corsOriginOpt(reqOrigin) ? reqOrigin : '';
    } else {
      allowOrigin = corsOriginOpt;
    }
    if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader(
      'Access-Control-Allow-Methods',
      options.cors?.methods ?? 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      options.cors?.headers ?? 'Content-Type, Authorization',
    );
  }

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBodySize) {
          req.destroy();
          reject(new Error('PAYLOAD_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function coerceQueryValue(val: string): unknown {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val !== '' && !isNaN(Number(val))) return Number(val);
    return val;
  }

  function parseQueryString(url: string): Record<string, unknown> {
    const idx = url.indexOf('?');
    if (idx === -1) return {};
    const qs = url.slice(idx + 1);
    const result: Record<string, unknown> = {};
    for (const part of qs.split('&')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(part.slice(0, eqIdx));
      const val = decodeURIComponent(part.slice(eqIdx + 1));
      result[key] = coerceQueryValue(val);
    }
    return result;
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(json);
  }

  function handler(req: IncomingMessage, res: ServerResponse): void {
    setCorsHeaders(req, res);
    options.hooks?.onRequest?.(req, res);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!router || !invokeFn) {
      sendJson(res, 503, { error: 'ServiceUnavailable', message: 'Server not ready' });
      return;
    }

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    const match = router.match(method, url);

    if (!match.found) {
      if (match.allowedMethods !== undefined) {
        res.setHeader('Allow', match.allowedMethods.join(', '));
        sendJson(res, 405, { error: 'MethodNotAllowed', message: 'Method not allowed' });
      } else {
        sendJson(res, 404, { error: 'NotFound', message: 'Not found' });
      }
      return;
    }

    const queryParams = parseQueryString(url);
    const pathParams = match.params;
    const noBody = method === 'GET' || method === 'HEAD' || method === 'DELETE';

    // Async continuation to keep handler signature synchronous (avoids unhandled rejection)
    const finish = async (): Promise<void> => {
      let bodyParams: Record<string, unknown> = {};

      if (!noBody) {
        let rawBody: Buffer;
        try {
          rawBody = await readBody(req);
        } catch (err) {
          if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
            sendJson(res, 413, { error: 'PayloadTooLarge', message: 'Request body exceeds size limit' });
            return;
          }
          sendJson(res, 400, { error: 'BadRequest', message: 'Failed to read request body' });
          return;
        }

        if (rawBody.length > 0) {
          const contentType = req.headers['content-type'] ?? '';
          if (contentType.includes('application/json')) {
            try {
              bodyParams = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
            } catch {
              sendJson(res, 400, { error: 'BadRequest', message: 'Invalid JSON body' });
              return;
            }
          }
        }
      }

      // Merge: query params < body params < path params (path wins)
      const input: Record<string, unknown> = { ...queryParams, ...bodyParams, ...pathParams };

      // Build flat headers map
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : v;
      }

      const signal = AbortSignal.timeout(30_000);

      const response = await invokeFn!({
        capability: match.capability,
        input,
        headers,
        signal,
      });

      if (response.ok) {
        if (response.data === null || response.data === undefined) {
          res.writeHead(204);
          res.end();
        } else {
          sendJson(res, 200, { data: response.data });
        }
      } else {
        const { status, error, message, meta } = response.error;
        const body: Record<string, unknown> = { error, message };
        if (meta !== undefined) body['meta'] = meta;
        sendJson(res, status, body);
      }
    };

    finish().catch((err) => {
      console.error('[capix:rest] Unhandled error in handler:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal', message: 'Internal server error' });
      }
    });
  }

  return {
    async mount(invoke: InvokeFn, mountOptions: MountOptions): Promise<void> {
      invokeFn = invoke;
      const routes = generateRoutes(mountOptions.registry);
      router = compileRouter(routes);

      console.log('\nCapix REST transport starting...');
      for (const route of routes) {
        console.log(`  ✓ ${route.method.padEnd(7)} ${route.path}`);
      }

      return new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.on('error', reject);
        server.listen(options.port, options.host ?? '0.0.0.0', () => {
          console.log(`\n  Listening on http://localhost:${options.port}\n`);
          resolve();
        });
      });
    },

    async unmount(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
