import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RestTransportOptions } from '@capixjs/transport-rest';

export type HelmetOptions = {
  /** Content-Security-Policy value (false to disable) */
  readonly contentSecurityPolicy?: string | false;
  /** X-Frame-Options value (false to disable, default: SAMEORIGIN) */
  readonly frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** Strict-Transport-Security value (false to disable) */
  readonly hsts?: string | false;
  /** X-Content-Type-Options (false to disable, default: nosniff) */
  readonly noSniff?: boolean;
  /** Referrer-Policy value (false to disable) */
  readonly referrerPolicy?: string | false;
  /** Permissions-Policy value (false to disable) */
  readonly permissionsPolicy?: string | false;
};

const DEFAULTS: Required<HelmetOptions> = {
  contentSecurityPolicy: "default-src 'self'",
  frameOptions: 'SAMEORIGIN',
  hsts: 'max-age=31536000; includeSubDomains',
  noSniff: true,
  referrerPolicy: 'no-referrer',
  permissionsPolicy: false,
};

/**
 * Returns RestTransportOptions hooks that set common security headers.
 * Merge the returned object with your restTransport options.
 *
 * @example
 * restTransport({ port: 3000, ...helmet() })
 */
export function helmet(options: HelmetOptions = {}): Pick<RestTransportOptions, 'hooks'> {
  const merged: Required<HelmetOptions> = { ...DEFAULTS, ...options };

  return {
    hooks: {
      onRequest: (_req, res: ServerResponse) => {
        if (merged.contentSecurityPolicy !== false) {
          res.setHeader('Content-Security-Policy', merged.contentSecurityPolicy);
        }
        if (merged.frameOptions !== false) {
          res.setHeader('X-Frame-Options', merged.frameOptions);
        }
        if (merged.hsts !== false) {
          res.setHeader('Strict-Transport-Security', merged.hsts);
        }
        if (merged.noSniff) {
          res.setHeader('X-Content-Type-Options', 'nosniff');
        }
        if (merged.referrerPolicy !== false) {
          res.setHeader('Referrer-Policy', merged.referrerPolicy);
        }
        if (merged.permissionsPolicy !== false) {
          res.setHeader('Permissions-Policy', merged.permissionsPolicy);
        }
      },
    },
  };
}

/**
 * Merges multiple RestTransportOptions hook/cors sets into one.
 * Use when combining cors() + helmet() (+ optionally your own custom hooks).
 *
 * `hooks.onRequest` from every argument runs, in argument order. `cors` is
 * carried through too — the last argument that defines it wins, so passing
 * more than one non-empty `cors` is almost certainly a mistake (only cors()
 * itself should ever provide one in practice).
 *
 * @example
 * const corsOpts = cors({ origin: 'https://app.example.com' });
 * restTransport({ port: 3000, ...mergeHooks(corsOpts, helmet()) })
 */
export function mergeHooks(
  ...optionSets: Array<Pick<RestTransportOptions, 'hooks' | 'cors'>>
): Pick<RestTransportOptions, 'hooks' | 'cors'> {
  const fns = optionSets
    .map((o) => o.hooks?.onRequest)
    .filter((fn): fn is NonNullable<typeof fn> => fn !== undefined);

  const cors = optionSets.reduce<RestTransportOptions['cors'] | undefined>(
    (acc, o) => o.cors ?? acc,
    undefined,
  );

  return {
    ...(cors !== undefined ? { cors } : {}),
    ...(fns.length > 0
      ? {
          hooks: {
            onRequest: (req: IncomingMessage, res: ServerResponse) => {
              for (const fn of fns) fn(req, res);
            },
          },
        }
      : {}),
  };
}
