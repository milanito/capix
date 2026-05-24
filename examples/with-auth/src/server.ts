/**
 * with-auth example — JWT-style auth in buildContext, multi-role guards,
 * protected and public capabilities in the same group.
 */

import { z } from 'zod';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from 'capix';
import { restTransport } from 'capix-transport-rest';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

type Role = 'guest' | 'user' | 'admin';

type AuthUser = {
  id: string;
  email: string;
  role: Role;
};

// Simulated token store (in real apps, verify a real JWT here)
const TOKEN_STORE: Record<string, AuthUser> = {
  'guest-token': { id: 'g1', email: 'guest@example.com', role: 'guest' },
  'user-token': { id: 'u1', email: 'user@example.com', role: 'user' },
  'admin-token': { id: 'a1', email: 'admin@example.com', role: 'admin' },
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type Context = {
  requestId: string;
  user: AuthUser | null;
};

const buildContext = defineContext(async (req): Promise<Context> => {
  const authorization = req.headers['authorization'];
  const token =
    typeof authorization === 'string'
      ? authorization.replace(/^Bearer\s+/i, '')
      : null;

  const user = token ? (TOKEN_STORE[token] ?? null) : null;

  return { requestId: crypto.randomUUID(), user };
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const mustBeAuthenticated = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: AuthUser } => {
    if (!ctx.user) throw errors.Unauthorized();
  },
);

const mustBeUser = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: AuthUser & { role: 'user' | 'admin' } } => {
    if (!ctx.user) throw errors.Unauthorized();
    if (ctx.user.role === 'guest') throw errors.Forbidden();
  },
);

const mustBeAdmin = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: AuthUser & { role: 'admin' } } => {
    if (!ctx.user) throw errors.Unauthorized();
    if (ctx.user.role !== 'admin') throw errors.Forbidden();
  },
);

// ---------------------------------------------------------------------------
// Capabilities — public, user-only, and admin-only in the same group
// ---------------------------------------------------------------------------

// Public: no guard
const ping = capability(() => ({ message: 'pong', timestamp: Date.now() }));

// Authenticated users only
const getProfile = capability(z.object({}), async (_, ctx: Context) => {
  return { id: ctx.user?.id, email: ctx.user?.email, role: ctx.user?.role };
}).guard(mustBeAuthenticated);

// User-level access
const listPosts = capability(
  z.object({ page: z.number().int().min(1).default(1) }),
  async ({ page }, _ctx: Context) => {
    return { posts: [`Post ${page}-1`, `Post ${page}-2`], page };
  },
).guard(mustBeUser);

// Admin only
const deletePost = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    return { deleted: id };
  },
).guard(mustBeAdmin);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer({
  context: buildContext,
  capabilities: {
    system: { ping },
    profile: { get: getProfile },
    posts: { list: listPosts, delete: deletePost },
  },
  transports: [restTransport({ port: 3001 })],
});

server.start().catch(console.error);
