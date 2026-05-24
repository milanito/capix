/**
 * errors.ts — typed framework errors
 * No dependencies. Foundation for everything else.
 */

const FRAMEWORK_ERROR_BRAND = Symbol('capix.FrameworkError');

/** Typed error produced by defineError factories. */
export type FrameworkError = {
  readonly status: number;
  readonly error: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
  readonly [FRAMEWORK_ERROR_BRAND]: true;
};

/** A callable factory that produces FrameworkError instances. */
export type ErrorFactory = (meta?: Record<string, unknown>) => FrameworkError;

/**
 * Derives a PascalCase error name from a human-readable message.
 * 'Not found' → 'NotFound', 'Internal server error' → 'InternalServerError'
 */
function deriveErrorName(message: string): string {
  return message
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * Creates a typed error factory for a given HTTP status code and message.
 * The returned factory is callable and produces objects identifiable by isFrameworkError().
 */
export function defineError(status: number, message: string): ErrorFactory {
  const errorName = deriveErrorName(message);
  return (meta?: Record<string, unknown>): FrameworkError => {
    const err: FrameworkError = {
      status,
      error: errorName,
      message,
      [FRAMEWORK_ERROR_BRAND]: true,
      ...(meta !== undefined ? { meta } : {}),
    };
    return err;
  };
}

/**
 * Returns true only for FrameworkError values created by defineError factories.
 * Plain objects that happen to have the right shape return false.
 */
export function isFrameworkError(value: unknown): value is FrameworkError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[FRAMEWORK_ERROR_BRAND] === true
  );
}

/** Standard error set shipped with Capix. */
export const defaultErrors = {
  BadRequest: defineError(400, 'Bad request'),
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
  Conflict: defineError(409, 'Conflict'),
  TooManyRequests: defineError(429, 'Too many requests'),
  Internal: defineError(500, 'Internal server error'),
  Timeout: defineError(504, 'Timeout'),
} as const;
