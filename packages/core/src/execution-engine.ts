/**
 * execution-engine.ts — the heart of the framework
 * Depends on: capability.ts, context.ts, guards.ts, errors.ts
 */

import type { CapabilityRegistry } from './capability.js';
import type { BaseContext, ContextBuilder, RawRequest } from './context.js';
import { runInputGuards } from './guards.js';
import { isFrameworkError } from './errors.js';

export type CapabilityRequest = {
  readonly capability: string;
  readonly input: unknown;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
  /** Raw body bytes forwarded from the transport. See RawRequest.rawBody. */
  readonly rawBody?: Buffer;
};

export type SerializedError = {
  readonly status: number;
  readonly error: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
};

export type CapabilityResponse =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: SerializedError };

export type InvokeFn = (req: CapabilityRequest) => Promise<CapabilityResponse>;

/**
 * Manual AbortController + timer instead of AbortSignal.timeout(ms): the
 * timer here is cleared as soon as the caller is done with the signal.
 * AbortSignal.timeout() keeps its internal timer (and abort-listener
 * closure) alive for the full timeout window after every invocation
 * settles — at high throughput that retains a large number of dead
 * closures at steady state. Call clear() once the invocation this signal
 * was created for has settled (in a try/finally).
 */
export function createTimeoutSignal(ms: number): { readonly signal: AbortSignal; readonly clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Lifecycle hooks observing every capability invocation on every transport.
 *
 * Hooks receive the same CapabilityRequest object across the request's
 * lifecycle — key a WeakMap on it to correlate onRequest with the outcome
 * (e.g. to close a tracing span). Hook errors are caught and logged; they
 * never affect the request.
 */
export type LifecycleHooks = {
  /** Fires when a request enters the engine, before lookup and validation. */
  readonly onRequest?: (req: CapabilityRequest) => void;
  /** Fires after a successful resolve. */
  readonly onResponse?: (req: CapabilityRequest, info: { durationMs: number; data: unknown }) => void;
  /** Fires on any failure: unknown capability, guard rejection, validation, resolver throw. */
  readonly onError?: (req: CapabilityRequest, info: { durationMs: number; error: SerializedError }) => void;
};

export type ExecutionEngineOptions = {
  readonly registry: CapabilityRegistry;
  readonly buildContext: ContextBuilder;
  readonly isDevelopment?: boolean;
  readonly hooks?: LifecycleHooks;
};

function toErrorResponse(err: unknown, isDevelopment: boolean): CapabilityResponse {
  if (isFrameworkError(err)) {
    return {
      ok: false,
      error: {
        status: err.status,
        error: err.error,
        message: err.message,
        ...(err.meta !== undefined ? { meta: err.meta } : {}),
      },
    };
  }

  if (isDevelopment) {
    console.error('[capix] Unexpected error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { status: 500, error: 'Internal', message },
    };
  }

  return {
    ok: false,
    error: { status: 500, error: 'Internal', message: 'Internal server error' },
  };
}

/**
 * Creates the invoke function that runs the full capability pipeline:
 * lookup → buildContext → guards → validate input → resolve → validate output
 */
export function createExecutionEngine(options: ExecutionEngineOptions): InvokeFn {
  const { registry, buildContext, isDevelopment = false } = options;

  const invoke = async function invoke(req: CapabilityRequest): Promise<CapabilityResponse> {
    // 1. Look up capability
    const cap = registry.get(req.capability);
    if (!cap) {
      return {
        ok: false,
        error: {
          status: 404,
          error: 'NotFound',
          message: `Capability '${req.capability}' not found. Did you register it in your capabilities tree?`,
        },
      };
    }

    // 2. Build context
    let ctx: BaseContext;
    try {
      const rawReq: RawRequest = {
        headers: req.headers,
        method: 'POST',
        url: `/${req.capability.replaceAll('.', '/')}`,
        signal: req.signal,
        ...(req.rawBody !== undefined ? { rawBody: req.rawBody } : {}),
      };
      // Async-detect: skip microtask tick for sync buildContext (common case)
      const ctxResult = buildContext(rawReq);
      ctx = (typeof ctxResult === 'object' && ctxResult !== null &&
        typeof (ctxResult as { then?: unknown }).then === 'function')
        ? await (ctxResult as Promise<BaseContext>)
        : ctxResult as BaseContext;
    } catch (err) {
      if (isFrameworkError(err)) {
        return toErrorResponse(err, isDevelopment);
      }
      if (isDevelopment) console.error('[capix] buildContext error:', err);
      return {
        ok: false,
        error: { status: 500, error: 'Internal', message: 'Failed to build request context' },
      };
    }

    // 3. Run guards (log guard name on unexpected errors in dev mode)
    try {
      for (const guard of cap.guards) {
        try {
          // Avoid microtask tick for sync guards (void return). Only await when the guard
          // actually returns a Promise (async guards or explicit return Promise<void>).
          const r = guard(ctx);
          if (r !== undefined && r !== null && typeof (r as { then?: unknown }).then === 'function') {
            await r;
          }
        } catch (err) {
          if (isDevelopment && !isFrameworkError(err)) {
            const name = (guard as { name?: string }).name || '(anonymous)';
            console.error(`[capix] Guard '${name}' threw an unexpected error:`, err);
          }
          throw err;
        }
      }
    } catch (err) {
      return toErrorResponse(err, isDevelopment);
    }

    // 4. Validate input
    let validatedInput: unknown;
    if (cap._skipValidation) {
      // z.object({}) — nothing to validate; pass through as empty object.
      validatedInput = req.input ?? {};
    } else if (cap.inputSchema !== null) {
      // Try sync parse first (no Promise overhead for the common case).
      // Falls back to safeParseAsync only when the schema has async refinements.
      let result: Awaited<ReturnType<typeof cap.inputSchema.safeParseAsync>>;
      try {
        result = cap.inputSchema.safeParse(req.input);
      } catch {
        result = await cap.inputSchema.safeParseAsync(req.input);
      }
      if (!result.success) {
        const issues = result.error.issues.map((i) => {
          const path = i.path.length > 0 ? i.path.join('.') + ': ' : '';
          return path + i.message;
        });
        return {
          ok: false,
          error: {
            status: 400,
            error: 'BadRequest',
            message: 'Input validation failed',
            meta: { issues },
          },
        };
      }
      validatedInput = result.data;
    } else {
      validatedInput = undefined;
    }

    // 5. Run input guards (run after validation so guards receive typed input)
    if (cap.inputGuards.length > 0) {
      try {
        await runInputGuards(cap.inputGuards, validatedInput, ctx);
      } catch (err) {
        return toErrorResponse(err, isDevelopment);
      }
    }

    // 6. Resolve — use _resolverOnly since guards already ran in step 3
    let output: unknown;
    try {
      output = await cap._resolverOnly(validatedInput, ctx as never);
    } catch (err) {
      return toErrorResponse(err, isDevelopment);
    }

    // 7. Check for streaming return (not supported)
    if (output != null && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
      if (isDevelopment) {
        console.error(`[capix] Capability '${req.capability}' returned an async iterable/stream.`);
      }
      return {
        ok: false,
        error: {
          status: 500,
          error: 'Internal',
          message: `Capability '${req.capability}' returned a stream or async iterable. Streaming responses are not supported. Return a plain object, string, or null instead.`,
        },
      };
    }

    // 8. Check for undefined return
    if (output === undefined) {
      if (isDevelopment) {
        console.error(`[capix] Capability '${req.capability}' returned undefined`);
      }
      return {
        ok: false,
        error: {
          status: 500,
          error: 'Internal',
          message: `Capability '${req.capability}' returned undefined. Resolvers must return a value or throw.`,
        },
      };
    }

    // 9. Validate output — development only. In production, TypeScript types and the
    //    compiled fjs serializer enforce the shape; Zod's runtime parse is redundant overhead.
    if (cap.outputSchema !== null && isDevelopment) {
      let result: { success: true; data: unknown } | { success: false; error: { issues: unknown[] } };
      try {
        result = cap.outputSchema.safeParse(output) as typeof result;
      } catch {
        result = await cap.outputSchema.safeParseAsync(output) as typeof result;
      }
      if (!result.success) {
        console.error(`[capix] Output validation failed for '${req.capability}':`, result.error.issues);
        return {
          ok: false,
          error: {
            status: 500,
            error: 'Internal',
            message: `Capability '${req.capability}' returned invalid output`,
            meta: { issues: result.error.issues },
          },
        };
      }
      output = result.data;
    }

    return { ok: true, data: output };
  };

  const hooks = options.hooks;
  if (hooks === undefined) return invoke;

  // Hook errors are isolated: observability must never fail a request.
  const fire = (fn: (() => void) | undefined, name: string): void => {
    if (fn === undefined) return;
    try {
      fn();
    } catch (err) {
      console.error(`[capix] Lifecycle hook '${name}' threw:`, err);
    }
  };

  return async function invokeWithHooks(req: CapabilityRequest): Promise<CapabilityResponse> {
    const start = Date.now();
    fire(hooks.onRequest && (() => hooks.onRequest!(req)), 'onRequest');

    const response = await invoke(req);
    const durationMs = Date.now() - start;

    if (response.ok) {
      fire(hooks.onResponse && (() => hooks.onResponse!(req, { durationMs, data: response.data })), 'onResponse');
    } else {
      fire(hooks.onError && (() => hooks.onError!(req, { durationMs, error: response.error })), 'onError');
    }
    return response;
  };
}
