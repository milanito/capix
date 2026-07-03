import jwt from 'jsonwebtoken';
import { defineGuard, defaultErrors, defineContext } from '@capixjs/core';
import type { BaseContext, RawRequest, ContextBuilder } from '@capixjs/core';
import { JWTCache } from './jwt-cache.js';
import type { JWTCacheOptions } from './jwt-cache.js';
import { JwksKeyResolver } from './jwks.js';
import type { JwksOptions } from './jwks.js';

export { JWTCache, JwksKeyResolver };
export type { JWTCacheOptions, JwksOptions };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const HS_ALGORITHMS: jwt.Algorithm[] = ['HS256', 'HS384', 'HS512'];
const ASYMMETRIC_ALGORITHMS: jwt.Algorithm[] = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256', 'PS384', 'PS512'];

export type JWTAuthOptions<TUser> = {
  /**
   * Shared secret for HS256-family sign and verify.
   * Provide exactly one of `secret`, `publicKey`, or `jwks`.
   */
  readonly secret?: string;
  /**
   * PEM-encoded public key for RS/ES/PS-family verification.
   * Pair with `privateKey` to also sign tokens.
   */
  readonly publicKey?: string;
  /** PEM-encoded private key for signing when using `publicKey`. */
  readonly privateKey?: string;
  /**
   * Verify against an issuer's JWKS endpoint (Auth0, Clerk, Cognito,
   * Keycloak, ...). Keys are resolved by the token's `kid` header and
   * cached; rotation triggers a rate-limited refetch. Verify-only —
   * the issuer holds the private keys.
   */
  readonly jwks?: JwksOptions;
  /**
   * Accepted verification algorithms. Always pinned — a token whose `alg`
   * is not in this list is rejected, which blocks algorithm-confusion
   * attacks (e.g. an RS256 public key replayed as an HS256 secret).
   * Defaults: HS256/384/512 for `secret`; RS/ES/PS families for
   * `publicKey` and `jwks`.
   */
  readonly algorithms?: readonly jwt.Algorithm[];
  /** Token expiry passed to jwt.sign (e.g. '7d', 3600). Defaults to '7d'. */
  readonly expiresIn?: string | number;
  /**
   * Extract and validate a user object from the verified token payload.
   * Return null to reject the token (treated as unauthenticated).
   */
  readonly userFromToken: (payload: jwt.JwtPayload) => TUser | null | Promise<TUser | null>;
  /**
   * Enable in-memory caching of JWT verification results.
   *
   * **Security tradeoff**: A revoked token remains accepted for the TTL duration
   * (default 30s). Only enable this when `userFromToken` does no I/O (pure
   * in-memory lookup). For database-backed lookups, the DB round-trip dominates —
   * caching helps less and the revocation risk increases. Use a blocklist for
   * immediate revocation.
   *
   * Pass `true` for defaults (TTL: 30s, maxSize: 1000), or a {@link JWTCacheOptions}
   * object to configure TTL and max entries.
   */
  readonly cache?: boolean | JWTCacheOptions;
};

/** Shape added to the context by authPlugin. */
export type AuthContext<TUser> = BaseContext & {
  readonly user: TUser | null;
};

/** Shape after mustBeAuthenticated narrows the context. */
export type AuthenticatedContext<TUser> = BaseContext & {
  readonly user: TUser;
};

// ---------------------------------------------------------------------------
// JWT helpers (standalone — usable without the plugin)
// ---------------------------------------------------------------------------

export type JWTHelpers<TUser> = {
  /**
   * Sign a payload and return a JWT string.
   * Throws for JWKS-configured helpers — the issuer holds the private keys.
   */
  sign(payload: jwt.JwtPayload): string;
  /**
   * Verify a token string. Returns the user (via `userFromToken`) or null if
   * the token is invalid, expired, or userFromToken returns null.
   * Results are served from cache when `cache` is configured.
   */
  verify(token: string): Promise<TUser | null>;
  /**
   * The verification cache, if `cache` was configured. Useful for testing
   * or manual cache invalidation (e.g. on logout).
   */
  readonly cache: JWTCache<TUser | null> | null;
};

/**
 * Create standalone JWT sign/verify helpers.
 * Useful for login endpoints that need to issue tokens without the full plugin.
 *
 * @example
 * const jwt = createJWTHelpers({ secret: process.env.JWT_SECRET!, userFromToken });
 * const token = jwt.sign({ sub: user.id, role: user.role });
 */
export function createJWTHelpers<TUser>(options: JWTAuthOptions<TUser>): JWTHelpers<TUser> {
  const { secret, publicKey, privateKey, jwks, expiresIn = '7d', userFromToken } = options;

  const modes = [secret, publicKey, jwks].filter((m) => m !== undefined).length;
  if (modes !== 1) {
    throw new Error(
      "[capix:auth] Provide exactly one of 'secret' (HS256), 'publicKey' (RS/ES/PS), or 'jwks' (issuer endpoint).",
    );
  }

  const algorithms = [...(options.algorithms ?? (secret !== undefined ? HS_ALGORITHMS : ASYMMETRIC_ALGORITHMS))];
  const jwksResolver = jwks !== undefined ? new JwksKeyResolver(jwks) : null;

  const verifyCache: JWTCache<TUser | null> | null = options.cache
    ? new JWTCache<TUser | null>(typeof options.cache === 'object' ? options.cache : {})
    : null;

  const signOptions = (alg?: jwt.Algorithm): jwt.SignOptions => ({
    ...(alg !== undefined ? { algorithm: alg } : {}),
    ...(expiresIn !== undefined ? { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] & {} } : {}),
  });

  async function verifyToken(token: string): Promise<jwt.JwtPayload> {
    if (secret !== undefined) {
      return jwt.verify(token, secret, { algorithms }) as jwt.JwtPayload;
    }
    if (publicKey !== undefined) {
      return jwt.verify(token, publicKey, { algorithms }) as jwt.JwtPayload;
    }
    // JWKS — resolve the key by the token's kid header
    const decoded = jwt.decode(token, { complete: true });
    const kid = decoded?.header.kid;
    if (typeof kid !== 'string') throw new Error('token has no kid header');
    const key = await jwksResolver!.getKey(kid);
    if (key === null) throw new Error(`no JWKS key for kid '${kid}'`);
    return jwt.verify(token, key, { algorithms }) as jwt.JwtPayload;
  }

  return {
    sign(payload) {
      if (secret !== undefined) {
        return jwt.sign(payload, secret, signOptions());
      }
      if (privateKey !== undefined) {
        const alg = (options.algorithms?.[0] ?? 'RS256') as jwt.Algorithm;
        return jwt.sign(payload, privateKey, signOptions(alg));
      }
      throw new Error(
        '[capix:auth] Cannot sign: JWKS-configured helpers are verify-only (the issuer holds the private keys). ' +
        "Provide 'privateKey' with 'publicKey', or use 'secret'.",
      );
    },

    async verify(token) {
      if (verifyCache !== null) {
        const cached = verifyCache.get(token);
        if (cached !== undefined) return cached;
      }
      try {
        const payload = await verifyToken(token);
        const user = await userFromToken(payload);
        verifyCache?.set(token, user);
        return user;
      } catch {
        verifyCache?.set(token, null);
        return null;
      }
    },

    cache: verifyCache,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractBearerToken(headers: RawRequest['headers']): string | null {
  const raw = headers['authorization'] ?? headers['Authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * JWT authentication plugin for Capix.
 *
 * Reads the `Authorization: Bearer <token>` header on every request,
 * verifies the JWT, and sets `ctx.user` to the result of `userFromToken`.
 * `ctx.user` is null for unauthenticated or invalid requests.
 *
 * Use `mustBeAuthenticated` to guard capabilities that require a logged-in user.
 *
 * @example
 * // src/auth.ts
 * import { authPlugin } from '@capixjs/plugin-auth';
 *
 * type AppUser = { id: string; email: string; role: string };
 *
 * export const {
 *   plugin: jwtPlugin,
 *   mustBeAuthenticated,
 *   helpers: jwt,
 * } = authPlugin<AppUser>({
 *   secret: process.env.JWT_SECRET!,
 *   userFromToken: (payload) => ({
 *     id: payload['sub']!,
 *     email: payload['email'] as string,
 *     role: payload['role'] as string,
 *   }),
 * });
 *
 * // src/server.ts
 * const server = createServer({ context, capabilities, plugins: [jwtPlugin], transports });
 *
 * // src/capabilities/profile.ts
 * import { mustBeAuthenticated } from '../auth.js';
 * type AuthCtx = AppContext & { user: AppUser };
 * const authCap = capability.withContext<AuthCtx>();
 *
 * export const getProfile = authCap(schema, resolver).guard(mustBeAuthenticated);
 */
export function authPlugin<TUser>(options: JWTAuthOptions<TUser>): {
  plugin: {
    name: string;
    context(base: BaseContext, req: RawRequest): Promise<AuthContext<TUser>>;
  };
  mustBeAuthenticated: (ctx: AuthContext<TUser>) => asserts ctx is AuthenticatedContext<TUser>;
  helpers: JWTHelpers<TUser>;
} {
  const helpers = createJWTHelpers(options);

  const plugin = {
    name: 'capix-plugin-auth',
    async context(base: BaseContext, req: RawRequest): Promise<AuthContext<TUser>> {
      const token = extractBearerToken(req.headers);
      const user = token ? await helpers.verify(token) : null;
      return { ...base, user };
    },
  };

  const mustBeAuthenticated = defineGuard(
    (ctx: AuthContext<TUser>): asserts ctx is AuthenticatedContext<TUser> => {
      if (!ctx.user) {
        throw defaultErrors.Unauthorized();
      }
    },
  );

  return { plugin, mustBeAuthenticated, helpers };
}

// ---------------------------------------------------------------------------
// jwtContextBuilder — standalone ContextBuilder with optional extra context
// ---------------------------------------------------------------------------

export type JWTContextBuilderOptions<TUser, TExtra extends Record<string, unknown> = Record<never, never>> =
  JWTAuthOptions<TUser> & {
    /** Build additional context fields from the raw request. Called once per request. */
    readonly extraContext?: (req: RawRequest) => TExtra | Promise<TExtra>;
  };

/**
 * Builds a full `ContextBuilder` that handles JWT verification and any additional
 * context fields in a single function. Use this when you want full type safety
 * for a context that includes both `user` and custom fields (`db`, `jobs`, etc.)
 * without needing to wire up the plugin system separately.
 *
 * @example
 * import { jwtContextBuilder } from '@capixjs/plugin-auth';
 *
 * export const buildContext = jwtContextBuilder<Customer, { db: DB; jobs: JobQueue }>({
 *   secret:          process.env.JWT_SECRET!,
 *   userFromToken:   async (p) => db.customers.get(p['sub']!),
 *   extraContext:    async () => ({ db, jobs: jobQueue }),
 * });
 * // buildContext returns: { requestId, user: Customer | null, db: DB, jobs: JobQueue }
 */
export function jwtContextBuilder<
  TUser,
  TExtra extends Record<string, unknown> = Record<never, never>,
>(
  options: JWTContextBuilderOptions<TUser, TExtra>,
): ContextBuilder<{ requestId: string; user: TUser | null } & TExtra> {
  const helpers = createJWTHelpers(options);

  return defineContext(async (req) => {
    const token = extractBearerToken(req.headers);
    const user = token ? await helpers.verify(token) : null;
    const extra = options.extraContext ? await options.extraContext(req) : ({} as TExtra);
    return {
      requestId: crypto.randomUUID(),
      user,
      ...extra,
    } as { requestId: string; user: TUser | null } & TExtra;
  });
}
