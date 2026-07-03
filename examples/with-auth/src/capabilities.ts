import { z } from 'zod';
import { capability, defineError, defineGuard } from '@capixjs/core';

type Role = 'guest' | 'user' | 'admin';

type AuthUser = {
  id: string;
  email: string;
  role: Role;
};

type Context = {
  requestId: string;
  user: AuthUser | null;
};

// Pre-bind the context type so guards typed for Context are accepted
// without annotation — see "Typing your context" in the README.
const cap = capability.withContext<Context>();

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
};

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

const ping = cap(() => ({ message: 'pong', timestamp: Date.now() }));

const getProfile = cap(z.object({}), async (_, ctx: Context) => {
  return { id: ctx.user?.id, email: ctx.user?.email, role: ctx.user?.role };
}).guard(mustBeAuthenticated);

const listPosts = cap(
  z.object({ page: z.number().int().min(1).default(1) }),
  async ({ page }, _ctx: Context) => {
    return { posts: [`Post ${page}-1`, `Post ${page}-2`], page };
  },
).guard(mustBeUser);

const deletePost = cap(
  z.object({ id: z.string() }),
  async ({ id }) => {
    return { deleted: id };
  },
).guard(mustBeAdmin);

export const capabilities = {
  system: { ping },
  profile: { get: getProfile },
  posts: { list: listPosts, delete: deletePost },
};
