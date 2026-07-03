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
import { closeHttpServerGracefully } from '@capixjs/core';
import type { Transport, MountOptions, InvokeFn, CapabilityResponse, GroupTree, TransportWithCapabilities } from '@capixjs/core';
import { compileRouter, generateRoutes } from './router.js';
import type { Router, HttpOverride } from './router.js';
import { parseMultipart } from './multipart-parser.js';
import type { MultipartOptions } from './multipart.js';
import { buildSerializers, defaultSerializer } from './serializer.js';
import type { ResponseSerializer } from './serializer.js';
import { buildCoercionMaps, coerceFields, coerceValue } from './coercion.js';
import type { CoercionMaps, CoercionKind } from './coercion.js';

const DEFAULT_MAX_BODY_SIZE = 1024 * 1024; // 1MB
const EMPTY_INPUT: Record<string, unknown> = {};

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
  /** Enable multipart/form-data parsing. Pass true or an options object. */
  readonly multipart?: boolean | MultipartOptions;
  /** Case style for inferred URL segments. Default: 'kebab' (bulkStatus → bulk-status). */
  readonly urlCase?: 'kebab' | 'camel' | 'snake';
  /**
   * Per-request timeout in milliseconds. Default: 30_000 (30 seconds).
   *
   * Set to `false` to disable timeouts entirely. **Only use this in benchmarks
   * or tests — never in production.** A hung capability will hold its connection
   * and resources indefinitely, causing connection exhaustion under load.
   */
  readonly timeout?: number | false;
  /**
   * HTTP route overrides keyed by capability dot-path.
   * Use for nested resource routes that URL inference cannot produce.
   *
   * @example
   * overrides: {
   *   'tasks.listProjectTasks': { method: 'GET', path: '/v1/projects/:projectId/tasks' },
   *   'tasks.createProjectTask': { method: 'POST', path: '/v1/projects/:projectId/tasks' },
   * }
   */
  readonly overrides?: Record<string, HttpOverride>;
  /**
   * Capability registry for this transport only.
   * When set, overrides the server-level `capabilities` default for REST routes.
   * Use to prevent non-REST capabilities from getting HTTP endpoints.
   */
  readonly capabilities?: GroupTree;
  /**
   * How long unmount() waits for in-flight requests before force-closing
   * their connections, in milliseconds. Idle keep-alive connections are
   * dropped immediately. Default: 10_000.
   */
  readonly shutdownTimeoutMs?: number;
};

/** Creates a REST transport using node:http. */
export function restTransport(options: RestTransportOptions): TransportWithCapabilities {
  let server: http.Server | null = null;
  let router: Router | null = null;
  let invokeFn: InvokeFn | null = null;
  let serializers: Map<string, ResponseSerializer> | null = null;
  let coercers: CoercionMaps | null = null;

  const corsOriginOpt = options.cors?.origin ?? '*';
  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
  const corsMethodsValue = options.cors?.methods ?? 'GET, POST, PATCH, PUT, DELETE, OPTIONS';
  const corsHeadersValue = options.cors?.headers ?? 'Content-Type, Authorization';
  const hasDynamicOrigin = typeof corsOriginOpt === 'function';
  const requestTimeout = options.timeout === undefined ? 30_000 : options.timeout;
  // When timeout: false — share one never-aborted signal per transport instance.
  const _noTimeoutSignal = requestTimeout === false ? new AbortController().signal : null;
  if (requestTimeout === false) {
    console.warn(
      '[capix] WARNING: timeout: false disables request timeouts. ' +
      'Hung capabilities will hold resources indefinitely. ' +
      'Do not use this in production.',
    );
  }

  // Pre-built headers for the fast path (static CORS origin).
  // When origin is a function, fall back to per-request setCorsHeaders.
  let _jsonHeaders200: Record<string, string> | null = null;
  let _jsonHeadersErr: Record<string, string> | null = null;
  let _preflightHeaders: Record<string, string> | null = null;

  if (!hasDynamicOrigin) {
    const corsBase: Record<string, string> = {
      'Access-Control-Allow-Methods': corsMethodsValue,
      'Access-Control-Allow-Headers': corsHeadersValue,
    };
    if (corsOriginOpt) corsBase['Access-Control-Allow-Origin'] = corsOriginOpt;
    _jsonHeaders200  = { 'Content-Type': 'application/json', ...corsBase };
    _jsonHeadersErr  = { 'Content-Type': 'application/json', ...corsBase };
    _preflightHeaders = { ...corsBase };
  }

  function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const reqOrigin = req.headers['origin'] ?? '';
    const allowOrigin = (corsOriginOpt as (o: string) => boolean)(reqOrigin) ? reqOrigin : '';
    if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', corsMethodsValue);
    res.setHeader('Access-Control-Allow-Headers', corsHeadersValue);
  }

  async function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBodySize) {
          req.resume(); // drain remaining data without closing socket so we can still respond
          reject(new Error('PAYLOAD_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // Malformed percent-encoding falls back to the raw text (WHATWG URLSearchParams
  // behavior) instead of throwing out of the synchronous request path.
  function safeDecode(s: string): string {
    if (!s.includes('%')) return s;
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }

  // Values stay raw strings here; schema-aware coercion is applied afterwards
  // using the matched capability's coercion map (see coercion.ts).
  function parseQueryString(url: string): Record<string, unknown> | null {
    const idx = url.indexOf('?');
    if (idx === -1) return null;
    const qs = url.slice(idx + 1);
    const result: Record<string, unknown> = {};
    for (const part of qs.split('&')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const key = safeDecode(part.slice(0, eqIdx));
      if (key === '__proto__') continue; // never allow prototype-setting keys into input
      result[key] = safeDecode(part.slice(eqIdx + 1));
    }
    return result;
  }

  /** Object.assign with [[Set]]-semantics '__proto__' assignment excluded. */
  function assignSafe(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const key of Object.keys(source)) {
      if (key === '__proto__') continue;
      target[key] = source[key];
    }
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, _jsonHeadersErr ?? { 'Content-Type': 'application/json' });
    res.end(json);
  }

  // Defense in depth: a synchronous throw in the request path would otherwise
  // escape node:http as an uncaughtException and kill the process.
  function handler(req: IncomingMessage, res: ServerResponse): void {
    try {
      handleRequest(req, res);
    } catch (err) {
      console.error('[capix:rest] Unhandled synchronous error in handler:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal', message: 'Internal server error' });
      }
    }
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Fast path: pre-built static headers avoid per-request setHeader calls.
    // Dynamic origin functions still use setCorsHeaders.
    if (hasDynamicOrigin) setCorsHeaders(req, res);
    options.hooks?.onRequest?.(req, res);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      if (_preflightHeaders) {
        res.writeHead(204, _preflightHeaders);
      } else {
        res.writeHead(204);
      }
      res.end();
      return;
    }

    if (!router || !invokeFn) {
      sendJson(res, 503, { error: 'ServiceUnavailable', message: 'Server not ready' });
      return;
    }

    const url = req.url ?? '/';
    // Node.js provides uppercase methods per RFC 7230; explicit toUpperCase() documents the contract.
    const method = (req.method ?? 'GET').toUpperCase();

    const match = router.match(method, url);

    if (!match.found) {
      if (match.malformed === true) {
        sendJson(res, 400, { error: 'BadRequest', message: 'Malformed URL encoding' });
      } else if (match.allowedMethods !== undefined) {
        res.setHeader('Allow', match.allowedMethods.join(', '));
        sendJson(res, 405, { error: 'MethodNotAllowed', message: 'Method not allowed' });
      } else {
        sendJson(res, 404, { error: 'NotFound', message: 'Not found' });
      }
      return;
    }

    // Schema-derived coercion targets for this capability (null → leave strings raw)
    const fieldKinds = coercers?.get(match.capability) ?? null;

    const queryParams = parseQueryString(url);
    if (queryParams !== null && fieldKinds !== null) coerceFields(queryParams, fieldKinds);
    const pathParams = match.params;
    const noBody = method === 'GET' || method === 'HEAD' || method === 'DELETE';

    // Async continuation to keep handler signature synchronous (avoids unhandled rejection)
    const finish = async (): Promise<void> => {
      let bodyParams: Record<string, unknown> = {};
      let rawBodyForContext: Buffer | undefined;

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
          rawBodyForContext = rawBody;
          const contentType = req.headers['content-type'] ?? '';
          if (contentType.includes('multipart/form-data') && options.multipart) {
            const multipartOpts: MultipartOptions =
              typeof options.multipart === 'object' ? options.multipart : {};
            try {
              const parsed = await parseMultipart(req.headers, rawBody, multipartOpts);
              for (const [k, v] of Object.entries(parsed.fields)) {
                if (k === '__proto__') continue;
                const kind: CoercionKind | undefined = fieldKinds?.get(k);
                bodyParams[k] = kind !== undefined ? coerceValue(v, kind) : v;
              }
              for (const [k, f] of Object.entries(parsed.files)) {
                if (k !== '__proto__') bodyParams[k] = f;
              }
            } catch (err) {
              const status = (err as { status?: number }).status ?? 400;
              const message = err instanceof Error ? err.message : 'Failed to parse multipart body';
              sendJson(res, status, { error: status === 413 ? 'PayloadTooLarge' : 'BadRequest', message });
              return;
            }
          } else if (contentType.includes('application/json')) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(rawBody.toString('utf8'));
            } catch {
              sendJson(res, 400, { error: 'BadRequest', message: 'Invalid JSON body' });
              return;
            }
            // Arrays and primitives cannot merge into the input object — reject
            // instead of producing index-keyed garbage ({ '0': ..., '1': ... }).
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              sendJson(res, 400, { error: 'BadRequest', message: 'JSON body must be an object' });
              return;
            }
            bodyParams = parsed as Record<string, unknown>;
          }
        }
      }

      // Merge: query params < body params < path params (path wins).
      // Router returns null for params when no path params exist (avoids allocation).
      // For the common case (GET with no query and no path params), reuse EMPTY_INPUT.
      let input: Record<string, unknown>;
      if (pathParams === null && noBody && queryParams === null) {
        input = EMPTY_INPUT;
      } else {
        input = {};
        if (queryParams !== null) Object.assign(input, queryParams);
        // JSON.parse can produce an own '__proto__' data property — Object.assign
        // would turn that into a prototype write on input. assignSafe skips it.
        // JSON body values are deliberately NOT coerced: JSON expresses numbers
        // and booleans itself, so a string where a number belongs is a real error.
        assignSafe(input, bodyParams);
        if (pathParams !== null) {
          for (const k of Object.keys(pathParams)) {
            const kind: CoercionKind | undefined = fieldKinds?.get(k);
            input[k] = kind !== undefined ? coerceValue(pathParams[k]!, kind) : pathParams[k];
          }
        }
      }

      // Build flat headers map using for..in (avoids Object.entries array allocation).
      const headers: Record<string, string> = {};
      for (const k in req.headers) {
        const v = req.headers[k];
        if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
      }

      // Manual controller + timer instead of AbortSignal.timeout: the timer is
      // cleared as soon as the invocation settles. AbortSignal.timeout would keep
      // its timer (and the race's abort-listener closure) alive for the full
      // timeout window after every completed request — at high RPS that retains
      // hundreds of thousands of dead closures at steady state.
      const controller = requestTimeout === false ? null : new AbortController();
      const signal = controller?.signal ?? _noTimeoutSignal!;

      const invocation = invokeFn!({
        capability: match.capability,
        input,
        headers,
        signal,
        ...(rawBodyForContext !== undefined ? { rawBody: rawBodyForContext } : {}),
      });

      // Race invocation against the timeout so hung capabilities don't hold the
      // connection. When timeout: false there is no timer, so we await directly.
      let response: CapabilityResponse;
      if (controller === null) {
        response = await invocation;
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<CapabilityResponse>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({
              ok: false,
              error: { status: 504, error: 'GatewayTimeout', message: 'Request timed out' },
            });
          }, requestTimeout as number);
        });
        try {
          response = await Promise.race([invocation, timeoutPromise]);
        } finally {
          clearTimeout(timer);
        }
      }

      if (response.ok) {
        if (response.data === null || response.data === undefined) {
          res.writeHead(204, _preflightHeaders ?? undefined);
          res.end();
        } else {
          const serialize = serializers?.get(match.capability) ?? defaultSerializer;
          const json = serialize(response.data);
          res.writeHead(200, _jsonHeaders200 ?? { 'Content-Type': 'application/json' });
          res.end(json);
        }
      } else {
        const { status, error, message, meta } = response.error;
        const body: Record<string, unknown> = { error, message };
        if (meta !== undefined) body['meta'] = meta;
        // Add Retry-After header for rate limit responses per RFC 6585
        if (status === 429 && typeof (meta as { retryAfter?: unknown } | undefined)?.retryAfter === 'number') {
          res.setHeader('Retry-After', String((meta as { retryAfter: number }).retryAfter));
        }
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
    ...(options.capabilities !== undefined ? { _capabilities: options.capabilities } : {}),

    async mount(invoke: InvokeFn, mountOptions: MountOptions): Promise<void> {
      invokeFn = invoke;
      const routeOpts = {
        ...(options.urlCase !== undefined ? { urlCase: options.urlCase } : {}),
        ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
      };
      const routes = generateRoutes(mountOptions.registry, routeOpts);
      router = compileRouter(routes);
      serializers = buildSerializers(mountOptions.registry);
      coercers = buildCoercionMaps(mountOptions.registry);

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
      if (!server) return;
      const s = server;
      server = null;
      await closeHttpServerGracefully(s, options.shutdownTimeoutMs ?? 10_000);
    },
  };
}
