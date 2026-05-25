import { z } from 'zod';
import { capability, defineError, defineGuard } from 'capix';

export const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
};

export type JwtPayload = {
  sub: string;
  name: string;
  role: 'user' | 'admin';
};

export type Context = {
  requestId: string;
  user: JwtPayload | null;
};

export const mustBeAuthenticated = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: JwtPayload } => {
    if (!ctx.user) throw errors.Unauthorized();
  },
);

export const mustBeAdmin = defineGuard(
  (ctx: Context & { user: JwtPayload }): asserts ctx is Context & { user: JwtPayload & { role: 'admin' } } => {
    if (ctx.user.role !== 'admin') throw errors.Forbidden();
  },
);

const getProfile = capability(
  (_input: undefined, ctx: Context & { user: JwtPayload }) => ({
    id: ctx.user.sub,
    name: ctx.user.name,
    role: ctx.user.role,
  }),
).guard(mustBeAuthenticated);

const getAdminStats = capability(
  () => ({ totalUsers: 42, activeToday: 7, revenueUsd: 12340 }),
)
  .guard(mustBeAuthenticated)
  .guard(mustBeAdmin);

const listRoles = capability(() => ['user', 'admin'] as const);

export const capabilities = {
  auth: { getProfile, getAdminStats, listRoles },
};
