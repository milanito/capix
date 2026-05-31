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

const ping = capability(() => ({ message: 'pong', timestamp: Date.now() }));

const getProfile = capability(z.object({}), async (_, ctx: Context) => {
  return { id: ctx.user?.id, email: ctx.user?.email, role: ctx.user?.role };
}).guard(mustBeAuthenticated);

const listPosts = capability(
  z.object({ page: z.number().int().min(1).default(1) }),
  async ({ page }, _ctx: Context) => {
    return { posts: [`Post ${page}-1`, `Post ${page}-2`], page };
  },
).guard(mustBeUser);

const deletePost = capability(
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
