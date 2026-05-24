/**
 * execution-engine.ts — the heart of the framework
 * Depends on: capability.ts, context.ts, guards.ts, errors.ts
 */

import type { CapabilityRegistry } from './capability.js';
import type { ContextBuilder, RawRequest } from './context.js';
import { runGuards } from './guards.js';
import { isFrameworkError, defaultErrors } from './errors.js';

export type CapabilityRequest = {
  readonly capability: string;
  readonly input: unknown;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
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

export type ExecutionEngineOptions = {
  readonly registry: CapabilityRegistry;
  readonly buildContext: ContextBuilder;
  readonly isDevelopment?: boolean;
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

  return async function invoke(req: CapabilityRequest): Promise<CapabilityResponse> {
    // 1. Look up capability
    const cap = registry.get(req.capability);
    if (!cap) {
      return {
        ok: false,
        error: {
          status: 404,
          error: 'NotFound',
          message: `Capability '${req.capability}' not found`,
        },
      };
    }

    // 2. Build context
    let ctx: ReturnType<ContextBuilder>;
    try {
      const rawReq: RawRequest = {
        headers: req.headers,
        method: 'POST',
        url: `/${req.capability.replace(/\./g, '/')}`,
        signal: req.signal,
      };
      ctx = await buildContext(rawReq);
    } catch (err) {
      if (isDevelopment) console.error('[capix] buildContext error:', err);
      return {
        ok: false,
        error: { status: 500, error: 'Internal', message: 'Failed to build request context' },
      };
    }

    // 3. Run guards
    try {
      await runGuards(cap.guards, ctx);
    } catch (err) {
      return toErrorResponse(err, isDevelopment);
    }

    // 4. Validate input
    let validatedInput: unknown;
    if (cap.inputSchema !== null) {
      const result = await cap.inputSchema.safeParseAsync(req.input);
      if (!result.success) {
        return {
          ok: false,
          error: {
            status: 400,
            error: 'BadRequest',
            message: 'Input validation failed',
            meta: { issues: result.error.issues },
          },
        };
      }
      validatedInput = result.data;
    } else {
      validatedInput = undefined;
    }

    // 5. Resolve
    let output: unknown;
    try {
      output = await cap.resolve(validatedInput, ctx);
    } catch (err) {
      return toErrorResponse(err, isDevelopment);
    }

    // 6. Check for undefined return
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

    // 7. Validate output (internal error if schema fails)
    if (cap.outputSchema !== null) {
      const result = await cap.outputSchema.safeParseAsync(output);
      if (!result.success) {
        if (isDevelopment) {
          console.error(`[capix] Output validation failed for '${req.capability}':`, result.error.issues);
        }
        return {
          ok: false,
          error: {
            status: 500,
            error: 'Internal',
            message: `Capability '${req.capability}' returned invalid output`,
            ...(isDevelopment ? { meta: { issues: result.error.issues } } : {}),
          },
        };
      }
      output = result.data;
    }

    return { ok: true, data: output };
  };
}
