# TypeScript workarounds

This document explains the known TypeScript limitation in Capix's guard system, the recommended workaround, and the reasoning behind the design.

## The limitation

Guards narrow the context type for *subsequent guards* in the chain. They do **not** retroactively narrow the resolver's `ctx` parameter.

```ts
const getProfile = capability(
  z.object({}),
  async (_, ctx) => {
    return ctx.user.id; // ← TypeScript error: ctx.user is AppUser | null
  },
).guard(mustBeUser); // ← mustBeUser ensures ctx.user is non-null at runtime
```

From TypeScript's perspective, the resolver is defined *before* `.guard()` is called — it can't infer what guards will be added later. This is a fundamental constraint of the method-chaining model: the resolver's type is fixed at the point the function literal is written.

## The workaround: two-factory pattern

Use `capability.withContext<AuthContext>()` to create a factory pre-typed with the narrowed context:

```ts
// src/capabilities.ts
import { capability } from 'capix';
import type { AppContext } from './context.js';

export type AppUser = { id: string; email: string; role: string };
export type AppContext = { requestId: string; user: AppUser | null; db: Database };
export type AuthContext = AppContext & { user: AppUser }; // user is non-null

export const cap     = capability.withContext<AppContext>();  // public endpoints
export const authCap = capability.withContext<AuthContext>(); // authenticated endpoints
```

```ts
// src/capabilities/users/profile.ts
import { authCap } from '../../capabilities.js';
import { mustBeUser } from '../../guards.js';

export const getProfile = authCap(
  z.object({}),
  async (_, ctx) => {
    return ctx.user.id; // ✓ ctx.user is AppUser (non-null) — no cast needed
  },
  'query',
).guard(mustBeUser); // still required for runtime enforcement
```

## How this works

`authCap` is the `capability()` function with `TContext` fixed to `AuthContext`. The resolver's `ctx` parameter is typed as `AuthContext` from the start — before any guards are applied. TypeScript doesn't need to infer the narrowed type from guards; it's already provided by the factory.

The guard still runs at runtime and rejects unauthenticated requests with a 403. The TypeScript type just reflects what the resolver can safely assume.

## The footgun: factory without guard

Because the narrowed type comes from the factory, not the guard, TypeScript will not complain if you use `authCap` without `.guard(mustBeUser)`:

```ts
// TypeScript does NOT error here, but this will throw at runtime for unauthenticated requests
export const getProfile = authCap(z.object({}), async (_, ctx) => ctx.user.id, 'query');
// Missing: .guard(mustBeUser)
```

**Convention:** Always pair `authCap` with `.guard(mustBeUser)`. Treat `authCap` as a declaration of intent — the resolver assumes the guard has run.

A lint rule or code review check is the practical enforcement mechanism.

## What a future fix would look like

The root cause is TypeScript's inability to express "the type of `ctx` in this resolver depends on guards that will be chained later." Fixing this properly would require one of:

1. **Retroactive type narrowing** — TypeScript would need to re-infer the resolver's parameter type when `.guard()` is called. This isn't how TypeScript's inference model works today.

2. **Deferred generic binding** — something like `capability<TContext>(resolver: (ctx: NoInfer<TContext>) => ...).guard(...)` where `TContext` is inferred from the guards. TypeScript's `NoInfer` utility (added in TS 5.4) helps in some cases but not this specific pattern.

3. **A builder API** — `capability.guards(mustBeUser).resolver((_, ctx) => ctx.user.id)` where guards are declared first and resolver comes last, so `ctx`'s type is known when the resolver is written. This would be a breaking API change.

Until TypeScript improves conditional type inference for method chains, the two-factory pattern is the recommended approach.

## Guard chain narrowing does work

Guards *do* narrow the context for subsequent guards, which is useful for multi-step validation:

```ts
const mustBeUser = defineGuard(
  (ctx: AppContext): asserts ctx is AppContext & { user: AppUser } => {
    if (!ctx.user) throw errors.Unauthorized();
  },
);

const mustBeAdmin = defineGuard(
  // ctx is already narrowed by mustBeUser — ctx.user is AppUser here
  (ctx: AppContext & { user: AppUser }): asserts ctx is AppContext & { user: AppUser & { role: 'admin' } } => {
    if (ctx.user.role !== 'admin') throw errors.Forbidden();
  },
);

const adminCap = authCap(schema, handler).guard(mustBeUser).guard(mustBeAdmin);
// After both guards: ctx._context = AppContext & { user: AppUser & { role: 'admin' } }
```

This guard-to-guard narrowing works correctly because each guard's type signature narrows the input for the next one in the chain.
