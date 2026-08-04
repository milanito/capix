# TypeScript workarounds

This document explains the known TypeScript limitation in Capix's guard system, the recommended fix, and the reasoning behind the design.

## The limitation

Guards narrow the context type for *subsequent guards* in the chain. They do **not** retroactively narrow the resolver's `ctx` parameter — **if the resolver is written before `.guard()` is called**:

```ts
const getProfile = capability(
  z.object({}),
  async (_, ctx) => {
    return ctx.user.id; // ← TypeScript error: ctx.user is AppUser | null
  },
).guard(mustBeUser); // ← mustBeUser ensures ctx.user is non-null at runtime
```

From TypeScript's perspective, the resolver is defined *before* `.guard()` is called — it can't infer what guards will be added later. This is a fundamental constraint of the method-chaining model when guards come *after* the resolver: the resolver's type is fixed at the point the function literal is written.

## The fix: `capability.guard(...)` — declare guards before the resolver

Declare guards first, and the resolver is only written once its `ctx` type is already fully narrowed — no annotation, no factory, no `.withContext<T>()` setup:

```ts
const getProfile = capability
  .guard(mustBeUser)
  .guard(mustBeAdmin)(
    z.object({}),
    (_, ctx) => ctx.user.role, // ctx: AppContext & { user: AppUser & { role: 'admin' } } — inferred, no annotation
    'query',
  );
```

This isn't retroactive narrowing (TypeScript still can't do that) — it sidesteps the problem entirely. `capability.guard(g)` and each subsequent `.guard(g)` are ordinary generic calls evaluated *before* the resolver argument, so by the time the resolver function literal is contextually typed, `ctx` has already been through the same `NarrowContext` narrowing that guard-to-guard chaining has always used correctly. It's purely additive: `capability()`, `.guard()` (postfix), and `capability.withContext()` are unchanged, and this is not required — use whichever reads best for a given capability.

**This also closes the two-factory pattern's footgun** (see below): narrowing here is *earned* by actually calling `.guard()`. There's no factory that grants a narrowed `ctx` type before any guard has run, so forgetting a guard is still a compile error — see `type-tests.ts` (Test 14) for the proof.

**One caveat inherited from `NarrowContext` itself, independent of this feature:** each guard in a chain must declare its own parameter type as (a supertype of) what the *previous* guard narrowed to — the same convention the "Guard chain narrowing does work" section below already documents (`mustBeAdmin` takes `AppContext & { user: AppUser }`, not bare `AppContext`). Two guards that each independently narrow *different* fields of the same wide starting context (e.g. one written for `AppContext` narrowing `token`, another separately written for `AppContext` narrowing `user`, neither depending on the other) won't accumulate both narrowings when chained — TypeScript falls back to the wider unnarrowed type rather than merging them. This is a preexisting `NarrowContext` characteristic, present identically whether guards are chained via this builder or via postfix `.guard()`; write dependent guards as a real sequence (each declaring the prior guard's output as its own input) and this doesn't come up.

## The two-factory pattern — still valid, useful for shared factories

Use `capability.withContext<AuthContext>()` to create a factory pre-typed with the narrowed context:

```ts
// src/capabilities.ts
import { capability } from '@capixjs/core';
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

A lint rule or code review check is the practical enforcement mechanism — or use `capability.guard(...)` (above) instead, where this footgun can't happen by construction.

## Background: how `capability.guard(...)` was arrived at

The root cause of the original limitation is TypeScript's inability to express "the type of `ctx` in this resolver depends on guards that will be chained later" when guards are chained *after* the resolver. Three fixes were considered:

1. **Retroactive type narrowing** — TypeScript re-inferring the resolver's parameter type when a later `.guard()` is called. Not how TypeScript's inference model works, and still isn't; this remains impossible for the postfix `capability(resolver).guard(g)` order.

2. **Deferred generic binding** via `NoInfer` — doesn't apply to this pattern; `NoInfer` prevents a type parameter from being inferred from one particular argument, it doesn't defer inference across separate chained calls.

3. **A builder API where guards come first** — this is what `capability.guard(...)` is. It turned out not to require a breaking change: it's a new, additive entry point (`capability.guard`) alongside the unchanged `capability()` and `capability.withContext()`, reusing the exact `ScopedCapabilityFactory` overloads and the same `NarrowContext` mechanism that already worked for guard-to-guard chaining. Nothing about existing capabilities needed to change.

Use whichever of the three patterns above (postfix `.guard()` with explicit `ctx` annotation, the two-factory pattern, or `capability.guard(...)`) reads best for a given capability — `capability.guard(...)` is the only one of the three with no footgun and no per-module setup, so it's the default recommendation for new code.

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
