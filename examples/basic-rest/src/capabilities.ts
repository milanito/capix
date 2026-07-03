import { z } from 'zod';
import { capability, defineError, defineGuard } from '@capixjs/core';

type User = { id: string; name: string; email: string; role: 'user' | 'admin' };

const USERS: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'user' },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'admin' },
];

export const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
  Conflict: defineError(409, 'Conflict'),
};

type Context = {
  requestId: string;
  user: User | null;
};

// Pre-bind the context type so guards typed for Context are accepted
// without annotation — see "Typing your context" in the README.
const cap = capability.withContext<Context>();

const mustBeUser = defineGuard((ctx: Context): asserts ctx is Context & { user: User } => {
  if (!ctx.user) throw errors.Unauthorized();
});

const mustBeAdmin = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: User & { role: 'admin' } } => {
    if (!ctx.user) throw errors.Unauthorized();
    if (ctx.user.role !== 'admin') throw errors.Forbidden();
  },
);

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
});

const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = USERS.find((u) => u.id === id);
    if (!user) throw errors.NotFound({ resource: 'user', id });
    return user;
  },
)
  .guard(mustBeUser)
  .output(UserSchema);

const listUsers = cap(z.object({}), async () => USERS).guard(mustBeUser);

const createUser = cap(
  z.object({ name: z.string(), email: z.string() }),
  async ({ name, email }) => {
    if (USERS.some((u) => u.email === email)) throw errors.Conflict({ email });
    const newUser: User = { id: String(USERS.length + 1), name, email, role: 'user' };
    USERS.push(newUser);
    return newUser;
  },
).guard(mustBeAdmin);

const updateUser = cap(
  z.object({ id: z.string(), name: z.string().optional(), email: z.string().optional() }),
  async ({ id, name, email }) => {
    const user = USERS.find((u) => u.id === id);
    if (!user) throw errors.NotFound({ resource: 'user', id });
    if (name !== undefined) user.name = name;
    if (email !== undefined) user.email = email;
    return user;
  },
).guard(mustBeAdmin);

const deleteUser = cap(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const idx = USERS.findIndex((u) => u.id === id);
    if (idx === -1) throw errors.NotFound({ resource: 'user', id });
    USERS.splice(idx, 1);
    return { deleted: true };
  },
).guard(mustBeAdmin);

export const capabilities = {
  users: { get: getUser, list: listUsers, create: createUser, update: updateUser, delete: deleteUser },
};
