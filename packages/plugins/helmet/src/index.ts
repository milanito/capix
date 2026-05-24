import type { ServerResponse } from 'node:http';
import type { RestTransportOptions } from 'capix-transport-rest';

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
 * Merges multiple RestTransportOptions hook sets into one.
 * Use when combining cors() + helmet() hooks.
 */
export function mergeHooks(
  ...hookSets: Array<Pick<RestTransportOptions, 'hooks'>>
): Pick<RestTransportOptions, 'hooks'> {
  const fns = hookSets
    .map((h) => h.hooks?.onRequest)
    .filter((fn): fn is NonNullable<typeof fn> => fn !== undefined);

  if (fns.length === 0) return {};
  return {
    hooks: {
      onRequest: (req, res) => {
        for (const fn of fns) fn(req, res);
      },
    },
  };
}
