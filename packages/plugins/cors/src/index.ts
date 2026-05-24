import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RestTransportOptions } from 'capix-transport-rest';

export type CorsOptions = {
  /** Allowed origins. String for exact match, function for dynamic matching, '*' for any. */
  readonly origin?: string | string[] | ((origin: string) => boolean);
  /** Allowed methods (default: GET, POST, PATCH, PUT, DELETE, OPTIONS) */
  readonly methods?: string;
  /** Allowed headers (default: Content-Type, Authorization) */
  readonly headers?: string;
  /** Whether to reflect Vary: Origin header when origin is dynamic */
  readonly varyOrigin?: boolean;
};

/**
 * Builds cors options compatible with RestTransportOptions.
 * Pass the returned hooks and cors values to restTransport().
 */
export function cors(options: CorsOptions = {}): Pick<RestTransportOptions, 'cors' | 'hooks'> {
  const { origin = '*', methods, headers, varyOrigin = true } = options;

  let originFn: string | ((o: string) => boolean);

  if (Array.isArray(origin)) {
    const set = new Set(origin);
    originFn = (o: string) => set.has(o);
  } else {
    originFn = origin;
  }

  return {
    cors: {
      origin: originFn,
      ...(methods !== undefined ? { methods } : {}),
      ...(headers !== undefined ? { headers } : {}),
    },
    hooks: {
      onRequest: (_req: IncomingMessage, res: ServerResponse) => {
        if (varyOrigin && typeof originFn === 'function') {
          res.setHeader('Vary', 'Origin');
        }
      },
    },
  };
}
