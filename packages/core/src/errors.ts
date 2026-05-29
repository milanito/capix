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
 * - Natural language: 'Not found' → 'NotFound', 'Too many requests' → 'TooManyRequests'
 * - Already PascalCase (no spaces, starts with uppercase): returned as-is
 *   e.g. 'QuotaExceeded' → 'QuotaExceeded'
 */
function deriveErrorName(message: string): string {
  if (!message.includes(' ') && /^[A-Z]/.test(message)) {
    return message;
  }
  return message
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Creates a typed error factory for a given HTTP status code and message.
 *
 * @param status  HTTP status code
 * @param message Human-readable error message
 * @param code    Machine-readable PascalCase error code (defaults to message-derived)
 *
 * The error code in responses is derived from the message:
 * - Natural language: 'Not found' → 'NotFound'
 * - Already PascalCase: 'QuotaExceeded' → 'QuotaExceeded' (preserved as-is)
 *
 * For full control over the error code, pass it explicitly:
 * `defineError(429, 'Quota exceeded for this resource', 'QuotaExceeded')`
 *
 * @example
 * // Explicit code — predictable, easy to test against:
 * const NotPurchased = defineError(403, 'You can only review products you have purchased', 'NotPurchased');
 * // → { error: 'NotPurchased', message: 'You can only review products you have purchased' }
 */
export function defineError(status: number, message: string, code?: string): ErrorFactory {
  const errorName = code ?? deriveErrorName(message);
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
  BadRequest:      defineError(400, 'Bad request',           'BadRequest'),
  Unauthorized:    defineError(401, 'Unauthorized',          'Unauthorized'),
  Forbidden:       defineError(403, 'Forbidden',             'Forbidden'),
  NotFound:        defineError(404, 'Not found',             'NotFound'),
  Conflict:        defineError(409, 'Conflict',              'Conflict'),
  TooManyRequests: defineError(429, 'Too many requests',     'TooManyRequests'),
  Internal:        defineError(500, 'Internal server error', 'Internal'),
  Timeout:         defineError(504, 'Timeout',               'Timeout'),
} as const;
