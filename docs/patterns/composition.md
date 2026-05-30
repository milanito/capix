# Composition

Capabilities compose cleanly because they are plain functions.

## Internal composition with `.resolve()`

Call one capability from inside another with `.resolve(input, ctx)`:

```ts
const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
).guard(mustBeUser);

const updateUser = cap(
  z.object({ id: z.string(), name: z.string() }),
  async ({ id, name }, ctx) => {
    // getUser's guards re-run — this is correct
    const existing = await getUser.resolve({ id }, ctx);
    return db.users.update(id, { name });
  },
  'update',
).guard(mustBeUser);
```

Guards always re-run in `.resolve()`. This is intentional — each capability's access rules apply unconditionally, regardless of the caller. You cannot use internal composition to bypass a guard.

## When to compose vs when to extract

Use `.resolve()` when:
- You need the guard enforcement of the inner capability
- The inner capability is also exposed as a standalone endpoint
- You want the inner capability's output schema validated

Extract a plain function when:
- You do not need guard enforcement (internal helper)
- The shared logic is not a public endpoint
- You want the simplest possible code

```ts
// Shared logic without guard enforcement — plain function
async function findUserById(id: string, db: Database) {
  const user = await db.users.find(id);
  if (!user) throw errors.NotFound();
  return user;
}

// Used by multiple capabilities
const getUser   = cap(z.object({ id: z.string() }), ({ id }, ctx) => findUserById(id, ctx.db), 'query').guard(mustBeUser);
const adminView = cap(z.object({ id: z.string() }), ({ id }, ctx) => findUserById(id, ctx.db), 'query').guard(mustBeAdmin);
```

## Parallel composition

When independent calls can run concurrently, use `Promise.all`:

```ts
const getDashboard = authCap(z.object({}), async (_, ctx) => {
  const [user, recentOrders, notifications] = await Promise.all([
    getProfile.resolve({}, ctx),
    listOrders.resolve({ limit: 5 }, ctx),
    getNotifications.resolve({ unreadOnly: true }, ctx),
  ]);
  return { user, recentOrders, notifications };
}, 'query').guard(mustBeUser);
```

All three capabilities run in parallel. Each capability's guards still run (also in parallel, via `Promise.all` — they all resolve before the resolver starts).

## Composing groups

Groups are plain objects. Merge them with object spread:

```ts
import { getUser, listUsers, createUser } from './users/index.js';
import { getPost, listPosts } from './posts/index.js';

export const capabilities = {
  users: { getUser, listUsers, createUser },
  posts: { getPost, listPosts },
};
```

There are no decorators, no registration calls, no magic. The group tree is assembled at the point you call `createServer`.

## Sharing capabilities across transports

Capabilities are plain objects — pass the same reference to multiple transports:

```ts
const publicCaps = { items: { list: listItems, get: getItem } };

createServer({
  transports: [
    restTransport({ port: 3000, capabilities: publicCaps }),
    graphqlTransport({ port: 4000, capabilities: publicCaps }),
  ],
  ...
});
```

No duplication, no sync required.
