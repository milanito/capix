/**
 * with-graphql example — Capix capabilities exposed over GraphQL.
 *
 * Start: pnpm start (from examples/with-graphql)
 * Playground: http://localhost:4000/graphql/playground
 *
 * Example queries:
 *   { users_getUser(id: "1") }
 *   { users_listUsers }
 *   mutation { users_createUser(name: "Charlie", email: "charlie@example.com") }
 */

import { z } from 'zod';
import { capability, defineContext, defineGuard, defineError, createServer, getHeader } from '@capixjs/core';
import type { BaseContext } from '@capixjs/core';
import { graphqlTransport } from '@capixjs/transport-graphql';

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

type User = { id: string; name: string; email: string; role: 'user' | 'admin' };

const USERS: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', role: 'user' },
  { id: '2', name: 'Bob', email: 'bob@example.com', role: 'admin' },
];

// ---------------------------------------------------------------------------
// Errors + context
// ---------------------------------------------------------------------------

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
  Conflict: defineError(409, 'Conflict'),
};

type Context = BaseContext & { user: User | null };

const buildContext = defineContext(async (req): Promise<Context> => {
  const token = getHeader(req, 'authorization')?.replace('Bearer ', '') ?? null;
  const user = token ? (USERS.find((u) => u.id === token) ?? null) : null;
  return { requestId: crypto.randomUUID(), user };
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const mustBeUser = defineGuard((ctx: BaseContext): asserts ctx is Context & { user: User } => {
  const user = (ctx as Context).user;
  if (!user) throw errors.Unauthorized();
});

const mustBeAdmin = defineGuard(
  (ctx: BaseContext): asserts ctx is Context & { user: User & { role: 'admin' } } => {
    const user = (ctx as Context).user;
    if (!user) throw errors.Unauthorized();
    if (user.role !== 'admin') throw errors.Forbidden();
  },
);

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['user', 'admin']),
});

const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = USERS.find((u) => u.id === id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
).guard(mustBeUser).output(UserSchema);

const listUsers = capability(
  async (_, ctx) => {
    void ctx;
    return USERS;
  },
  'query',
).guard(mustBeUser);

const createUser = capability(
  z.object({ name: z.string(), email: z.string() }),
  async ({ name, email }) => {
    if (USERS.some((u) => u.email === email)) throw errors.Conflict();
    const user: User = { id: String(USERS.length + 1), name, email, role: 'user' };
    USERS.push(user);
    return user;
  },
  'mutation',
).guard(mustBeAdmin);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer({
  context: buildContext,
  capabilities: {
    users: { getUser, listUsers, createUser },
  },
  transports: [
    graphqlTransport({ port: 4000 }),
  ],
});

server.start().catch(console.error);
