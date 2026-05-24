/**
 * index.ts — Capix testing utilities
 * mockContext, mockRequest, mockCapability, testServer
 */

import { z } from 'zod';
import { capability, compileRegistry, createExecutionEngine } from 'capix';
import type {
  AnyCapability,
  BaseContext,
  RawRequest,
  ContextBuilder,
  InvokeFn,
  GroupTree,
} from 'capix';

/** Creates a mock context with sensible defaults merged with any overrides. */
export function mockContext<TContext extends BaseContext = BaseContext>(
  overrides: Partial<TContext> = {},
): TContext {
  const base: BaseContext = { requestId: 'test-request-id' };
  return { ...base, ...overrides } as TContext;
}

/** Creates a mock RawRequest with sensible defaults. */
export function mockRequest(overrides: Partial<RawRequest> = {}): RawRequest {
  return {
    headers: {},
    method: 'POST',
    url: '/test',
    signal: AbortSignal.timeout(5000),
    ...overrides,
  };
}

/** Creates a minimal capability stub from a resolver function, for enhancer testing. */
export function mockCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolver: (input: unknown, ctx: BaseContext) => any,
): AnyCapability {
  return capability(z.unknown(), resolver);
}

// ---------------------------------------------------------------------------
// testServer
// ---------------------------------------------------------------------------

export type TestRequest = {
  readonly capability: string;
  readonly input?: unknown;
  readonly headers?: Record<string, string>;
};

export type TestResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly data?: unknown;
  readonly error?: string;
  readonly message?: string;
  readonly meta?: Record<string, unknown>;
};

export type TestServerOptions = {
  readonly context: ContextBuilder;
  readonly capabilities: Record<string, AnyCapability | Record<string, unknown>>;
  readonly isDevelopment?: boolean;
};

export type TestServer = {
  call(req: TestRequest): Promise<TestResponse>;
  readonly invoke: InvokeFn;
};

/** Creates an execution engine directly (no HTTP server) for integration testing. */
export function testServer(options: TestServerOptions): TestServer {
  const registry = compileRegistry(options.capabilities as GroupTree);

  const invoke = createExecutionEngine({
    registry,
    buildContext: options.context,
    isDevelopment: options.isDevelopment ?? true,
  });

  return {
    invoke,

    async call(req: TestRequest): Promise<TestResponse> {
      const signal = AbortSignal.timeout(5000);
      const response = await invoke({
        capability: req.capability,
        input: req.input ?? {},
        headers: req.headers ?? {},
        signal,
      });

      if (response.ok) {
        return { ok: true, status: 200, data: response.data };
      } else {
        const { status, error, message, meta } = response.error;
        return { ok: false, status, error, message, ...(meta !== undefined ? { meta } : {}) };
      }
    },
  };
}
