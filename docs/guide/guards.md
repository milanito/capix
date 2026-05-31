# Guards

Guards are preconditions that run before a capability's resolver. They receive the request context and throw to reject. A capability can have multiple guards — they run in order, and the first failure stops execution.

## Defining guards

```ts
import { defineGuard, defineError } from '@capixjs/core';

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden:    defineError(403, 'Forbidden'),
};

const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});

const mustBeAdmin = defineGuard((ctx) => {
  if (ctx.user?.role !== 'admin') throw errors.Forbidden();
});
```

Apply guards to capabilities:

```ts
const adminCap = capability(schema, handler)
  .guard(mustBeUser)   // runs first
  .guard(mustBeAdmin); // runs second
```

Each `.guard()` returns a new capability. Originals are unchanged.

## Guard factories

For guards that need runtime parameters, return the guard from a function:

```ts
const mustHaveRole = (role: string) =>
  defineGuard((ctx) => {
    if (ctx.user?.role !== role) throw errors.Forbidden();
  });

const adminOnly = cap.guard(mustHaveRole('admin'));
const editorOrAdmin = cap
  .guard(mustHaveRole('editor'))  // or use a combined guard:
```

Or with an OR pattern:

```ts
const mustBeEditorOrAdmin = defineGuard((ctx) => {
  const role = ctx.user?.role;
  if (role !== 'editor' && role !== 'admin') throw errors.Forbidden();
});
```

## Narrowing guards

`defineGuardFor<T>()` creates a guard that asserts the context is a specific subtype. Subsequent guards in the chain receive the narrowed type:

```ts
import { defineGuardFor } from '@capixjs/core';

type AppContext = { requestId: string; user: User | null; db: Database };
type AuthContext = AppContext & { user: User };

const mustBeUser = defineGuardFor<AuthContext>()((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});

// After mustBeUser, ctx is narrowed to AuthContext for subsequent guards
const mustBeAdmin = defineGuardFor<AuthContext & { user: User & { role: 'admin' } }>()((ctx) => {
  if (ctx.user.role !== 'admin') throw errors.Forbidden(); // ctx.user is non-null here
});
```

This narrows the context **for subsequent guards only**. It does not narrow the resolver's `ctx` — use `capability.withContext<AuthContext>()` (the two-factory pattern) for that.

## Input guards

`defineInputGuard` creates guards that run after input validation, receiving `(input, ctx)`:

```ts
import { defineInputGuard } from '@capixjs/core';

const mustOwnResource = defineInputGuard((input: { id: string }, ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
  if (input.id !== ctx.user.id) throw errors.Forbidden({ resource: input.id });
});

const updateProfile = cap(
  z.object({ id: z.string(), bio: z.string() }),
  async ({ id, bio }, ctx) => ctx.db.users.update(id, { bio }),
  'update',
).inputGuard(mustOwnResource);
```

Input guards have access to the validated input object — they can check ownership, quota, and other business rules that depend on the specific input values.

## Guard ordering and privacy

The order of guards matters for privacy. Check coarse-grained access first (is the user logged in?) before fine-grained access (is this user allowed to view this specific resource?):

```ts
const mustBeFollowing = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
  // Only check the following relationship if the user is logged in
  // — otherwise the error would reveal that the target user exists
});

const getPrivateProfile = cap(schema, handler)
  .guard(mustBeFollowing)
  .guard(mustNotBeBlocked);
```

If `mustNotBeBlocked` ran first and queried the database before checking authentication, an unauthenticated caller could probe the blocked list.

## `withRollback` and guards

Guards run on `.resolve()` calls for internal composition. This means a guard can reject an internal call even when the outer capability already passed the same guard — each call is independent.

This is correct behavior. If you compose capabilities that share the same guard, the guard runs once per `.resolve()` call. No work is duplicated.

## Async guards

Guards can be async. The execution engine awaits them:

```ts
const mustHaveActiveSubscription = defineGuard(async (ctx) => {
  const sub = await ctx.db.subscriptions.findActive(ctx.user?.id);
  if (!sub) throw errors.Forbidden({ reason: 'No active subscription' });
});
```

The execution engine detects sync guards (those that return `void`, not a `Promise`) and skips the await, which is a small hot-path optimization.
