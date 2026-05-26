/**
 * context.ts — request context types and builder
 * No dependencies.
 */

/** Raw request data passed to buildContext. */
export type RawRequest = {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method: string;
  readonly url: string;
  readonly signal: AbortSignal;
  /**
   * Raw request body bytes, populated by the transport when a body is present.
   * Useful for HMAC webhook signature verification where re-serializing parsed
   * JSON is not safe (key order and whitespace may differ).
   * Undefined for GET/HEAD requests and empty-body requests.
   */
  readonly rawBody?: Buffer;
};

/** Minimum fields guaranteed on every context object. */
export type BaseContext = {
  readonly requestId: string;
};

/** A function that builds the application context from a raw request. */
export type ContextBuilder<TContext extends BaseContext = BaseContext> = (
  req: RawRequest,
) => TContext | Promise<TContext>;

/**
 * Pass-through function for type inference and readability.
 * Use this to define your buildContext function with full type checking.
 */
export function defineContext<TContext extends BaseContext>(
  builder: ContextBuilder<TContext>,
): ContextBuilder<TContext> {
  return builder;
}

/**
 * Case-insensitive header lookup.
 * Returns the first value if the header is an array.
 */
export function getHeader(req: RawRequest, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(req.headers)) {
    if (key.toLowerCase() === lower) {
      const val = req.headers[key];
      if (val === undefined) return undefined;
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return undefined;
}
