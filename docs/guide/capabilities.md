# Capabilities

The `capability()` function is the core primitive. This document covers every overload, option, and method.

## Basic usage

```ts
import { capability } from 'capix';
import { z } from 'zod';

// No schema — accepts any input, typed as unknown
const ping = capability(() => ({ ok: true }));

// With input schema — validates and types input
const greet = capability(
  z.object({ name: z.string() }),
  ({ name }) => `Hello, ${name}`,
);

// With explicit intent
const searchPosts = capability(
  z.object({ q: z.string(), limit: z.coerce.number().default(20) }),
  ({ q, limit }) => db.posts.search(q, limit),
  'query',
);
```

## Signature

```ts
capability(resolver)
capability(inputSchema, resolver)
capability(inputSchema, resolver, intent)
```

| Parameter | Type | Description |
|---|---|---|
| `inputSchema` | `ZodSchema \| null` | Optional Zod schema. Omit for no validation. |
| `resolver` | `(input, ctx) => output \| Promise<output>` | The resolver function |
| `intent` | `Intent \| undefined` | Explicit intent. Inferred from name when omitted. |

## Intent

Intent determines how the REST transport maps the capability to an HTTP route.

| Intent | HTTP method | When inferred |
|---|---|---|
| `'query'` | GET | `get*`, `list*`, `find*`, `fetch*`, `read*`, `search*`, `filter*`, `all*`, `me`, `status`, `health`, `count`, `check` |
| `'mutation'` | POST | `create*`, `add*`, `new*`, and anything else |
| `'update'` | PATCH | `update*`, `edit*`, `patch*`, `modify*` |
| `'replace'` | PUT | `replace*`, `set*`, `put*` |
| `'delete'` | DELETE | `delete*`, `remove*`, `destroy*`, `cancel*` |

Pass intent explicitly when the name does not follow these conventions:

```ts
// 'register' would infer 'mutation' but also uses POST — fine
// 'sync' would infer 'mutation' — correct, no need to override
// 'export' would infer 'mutation' — but if you want GET:
const exportData = capability(schema, handler, 'query');
```

## Context-typed factory

`capability.withContext<TContext>()` returns a factory pre-bound to your context type. Define it once per application:

```ts
// src/capabilities.ts
import { capability } from 'capix';
import type { AppContext } from './context.js';

export const cap = capability.withContext<AppContext>();
```

Use it everywhere:

```ts
// src/capabilities/users/get.ts
import { cap } from '../../capabilities.js';

export const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => {
    // ctx.user, ctx.db — all typed correctly
    const user = await ctx.db.users.findById(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
).guard(mustBeUser);
```

Without `withContext`, `ctx` is typed as `BaseContext = { requestId: string }`.

## The two-factory pattern

TypeScript cannot retroactively narrow the resolver's `ctx` type based on guards added via `.guard()`. The workaround is a second factory with the narrowed context type:

```ts
type AppContext  = { requestId: string; user: User | null; db: Database };
type AuthContext = AppContext & { user: User }; // user is non-null

export const cap     = capability.withContext<AppContext>();   // public endpoints
export const authCap = capability.withContext<AuthContext>();  // authenticated endpoints
```

```ts
// ctx.user is User (non-null) — no null check needed in the resolver
export const getProfile = authCap(
  z.object({}),
  async (_, ctx) => ctx.user, // ✓ typed correctly
  'query',
).guard(mustBeUser);
```

The guard still runs at runtime. The factory only affects TypeScript types. Always pair `authCap` with `.guard(mustBeUser)`. See [TypeScript workarounds](../../docs/ts-workarounds.md) for the full explanation.

## Output schema

`.output(schema)` validates the resolver's return value in development mode and generates the GraphQL type in the GraphQL transport:

```ts
const UserSchema = z.object({
  id:    z.string(),
  name:  z.string(),
  email: z.string().email(),
});

const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }) => db.users.find(id),
  'query',
).output(UserSchema);
```

In production (`NODE_ENV=production`), output validation is skipped for performance.

## Guards

`.guard(guard)` appends a guard to the capability's guard list. Guards run in order:

```ts
const getSecret = cap(schema, handler)
  .guard(mustBeLoggedIn)  // runs first
  .guard(mustBeAdmin);    // runs second, only if first passes
```

Each `.guard()` call returns a new capability. The original is unchanged.

## Input guards

`.inputGuard(guard)` adds a guard that runs after input validation, receiving `(input, ctx)`:

```ts
const mustOwnPost = defineInputGuard((input: { id: string }, ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
  const post = ctx.db.posts.find(input.id);
  if (post?.authorId !== ctx.user.id) throw errors.Forbidden();
});

const updatePost = cap(
  z.object({ id: z.string(), title: z.string() }),
  handler,
  'update',
).inputGuard(mustOwnPost);
```

## Enhancers

`.enhance(enhancer)` wraps the resolver:

```ts
const cachedGetUser = cap(schema, handler, 'query')
  .guard(mustBeUser)
  .enhance(withCache(30))
  .enhance(withTimeout(5000));
```

## Internal composition with `.resolve()`

`.resolve(input, ctx)` invokes the capability's guards and resolver directly from inside another capability:

```ts
const getOrder = cap(z.object({ id: z.string() }), async ({ id }, ctx) => {
  const order = await ctx.db.orders.find(id);
  if (!order) throw errors.NotFound();
  return order;
}, 'query').guard(mustBeUser);

const cancelOrder = cap(z.object({ id: z.string() }), async ({ id }, ctx) => {
  const order = await getOrder.resolve({ id }, ctx); // guards re-run
  if (order.status !== 'pending') throw errors.Conflict({ reason: 'Cannot cancel' });
  return ctx.db.orders.cancel(id);
}, 'mutation').guard(mustBeUser);
```

Guards always re-run when calling `.resolve()`. This is correct — the inner capability's access rules always apply, regardless of where it's called from.

## Immutability

Every method returns a new capability. The original is unchanged:

```ts
const base = cap(schema, handler);
const withAuth = base.guard(mustBeUser);       // new capability
const withAuthAndCache = withAuth.enhance(withCache(30)); // new capability

// base, withAuth, withAuthAndCache are all distinct
```

This makes it safe to share base capabilities across your codebase and apply different guards or enhancers for different contexts.

## Capability types

For TypeScript utilities, `InferInput<Cap>`, `InferOutput<Cap>`, and `InferContext<Cap>` extract the capability's type parameters:

```ts
import type { InferInput, InferOutput } from 'capix';

type GetUserInput  = InferInput<typeof getUser>;   // { id: string }
type GetUserOutput = InferOutput<typeof getUser>;  // User
```
