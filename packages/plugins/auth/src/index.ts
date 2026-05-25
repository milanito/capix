import jwt from 'jsonwebtoken';
import { defineGuard, defaultErrors } from 'capix';
import type { BaseContext, RawRequest } from 'capix';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JWTAuthOptions<TUser> = {
  /** Secret used to sign and verify tokens. */
  readonly secret: string;
  /** Token expiry passed to jwt.sign (e.g. '7d', 3600). Defaults to '7d'. */
  readonly expiresIn?: string | number;
  /**
   * Extract and validate a user object from the verified token payload.
   * Return null to reject the token (treated as unauthenticated).
   */
  readonly userFromToken: (payload: jwt.JwtPayload) => TUser | null | Promise<TUser | null>;
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
   */
  sign(payload: jwt.JwtPayload): string;
  /**
   * Verify a token string. Returns the user (via `userFromToken`) or null if
   * the token is invalid, expired, or userFromToken returns null.
   */
  verify(token: string): Promise<TUser | null>;
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
  const { secret, expiresIn = '7d', userFromToken } = options;

  return {
    sign(payload) {
      if (expiresIn !== undefined) {
        return jwt.sign(payload, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] & {} });
      }
      return jwt.sign(payload, secret);
    },

    async verify(token) {
      try {
        const payload = jwt.verify(token, secret) as jwt.JwtPayload;
        return await userFromToken(payload);
      } catch {
        return null;
      }
    },
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
 * import { authPlugin } from 'capix-plugin-auth';
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
