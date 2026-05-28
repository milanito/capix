/**
 * guards.ts — guard types and execution
 * Depends on: context.ts
 */

import type { BaseContext } from './context.js';

/** A guard that passes silently or throws. May be async. */
export type Guard<TContext extends BaseContext> = (
  ctx: TContext,
) => void | Promise<void>;

/**
 * A guard that narrows the context type via TypeScript asserts.
 *
 * `TNarrowed extends TContext` ensures the asserted type is always a subtype of
 * the parameter type, satisfying TS2677 without requiring @ts-ignore.
 * `TNarrowed` is the full narrowed type — e.g. `AppContext & { user: User }`.
 */
export type NarrowingGuard<TContext extends BaseContext, TNarrowed extends TContext> = (
  ctx: TContext,
) => asserts ctx is TNarrowed;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** Any guard — uses `any` context so guards typed for specific contexts are assignable. */
export type AnyGuard = (ctx: any) => void | Promise<void>;

/**
 * Utility type: if TGuard is a NarrowingGuard, extract the narrowed type.
 * Otherwise return TContext unchanged.
 *
 * KNOWN LIMITATION: NarrowContext uses 'any' due to TypeScript's function-parameter
 * contravariance. Guards are often typed for a specific AppContext, but a capability
 * starts with TContext = BaseContext. Matching on `(ctx: TContext)` fails because
 * `(ctx: AppContext)` is not assignable to `(ctx: BaseContext)` — the guard demands
 * a more specific type than the capability provides at definition time.
 * Using `any` as the match parameter bypasses contravariance and correctly infers
 * TNarrowed from the asserted type. Track: GitHub issue #1
 * Attempted fixes: explicit generic `(ctx: TContext)` — breaks guards with specific
 * contexts; `(ctx: unknown)` — same failure. Revisit when TypeScript improves
 * conditional assertion inference.
 */
export type NarrowContext<
  TContext extends BaseContext,
  TGuard,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> = TGuard extends (ctx: any) => asserts ctx is infer TNarrowed
  ? TNarrowed extends TContext
    ? TNarrowed
    : TContext
  : TContext;

/**
 * Pass-through for type inference.
 * Wrap your guard function with this for proper TypeScript narrowing.
 *
 * Two forms:
 *  - `defineGuard(fn)` — infers types from the function signature (common case)
 *  - `defineGuard<TContext, TNarrowed>(fn)` — explicit narrowing when TypeScript
 *    can't infer the asserted type (e.g. guards stored in variables before use)
 */
export function defineGuard<
  TContext extends BaseContext,
  TNarrowed extends TContext,
>(fn: (ctx: TContext) => asserts ctx is TNarrowed): (ctx: TContext) => asserts ctx is TNarrowed;
export function defineGuard<TFn extends AnyGuard>(fn: TFn): TFn;
export function defineGuard(fn: AnyGuard): AnyGuard {
  return fn;
}

/**
 * Returns a guard factory pre-bound to a specific context type.
 * Avoids repeating the context type annotation on every guard.
 *
 * @example
 * const defineAppGuard = defineGuardFor<AppContext>();
 * const mustBeAdmin = defineAppGuard((ctx): asserts ctx is AppContext & { user: Admin } => {
 *   if (!ctx.user?.admin) throw Errors.Forbidden();
 * });
 */
export function defineGuardFor<TContext extends BaseContext>() {
  return function <TFn extends (ctx: TContext) => any>(fn: TFn): TFn {
    return fn;
  };
}

/**
 * Runs guards in order. Stops at the first guard that throws.
 * Supports async guards.
 */
export async function runGuards(
  guards: ReadonlyArray<AnyGuard>,
  ctx: BaseContext,
): Promise<void> {
  for (const guard of guards) {
    await guard(ctx);
  }
}

// ---------------------------------------------------------------------------
// InputGuard — guard that receives both the validated input and context.
// Runs after input validation, before the resolver.
// ---------------------------------------------------------------------------

/** A guard that receives both validated input and context. May be async. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InputGuard<TInput = any, TContext extends BaseContext = BaseContext> = (
  input: TInput,
  ctx: TContext,
) => void | Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyInputGuard = InputGuard<any, any>;

/**
 * Pass-through for type inference.
 *
 * @example
 * const mustOwnOrder = defineInputGuard(async ({ id }: { id: string }, ctx: AuthContext) => {
 *   const order = ctx.db.orders.get(id);
 *   if (!order || order.customerId !== ctx.user.id) throw errors.Forbidden();
 * });
 *
 * export const cancelOrder = authCap(Input, resolver).inputGuard(mustOwnOrder);
 */
export function defineInputGuard<TInput, TContext extends BaseContext>(
  fn: InputGuard<TInput, TContext>,
): InputGuard<TInput, TContext> {
  return fn;
}

/** Runs input guards in order. */
export async function runInputGuards(
  guards: ReadonlyArray<AnyInputGuard>,
  input: unknown,
  ctx: BaseContext,
): Promise<void> {
  for (const guard of guards) {
    await guard(input, ctx);
  }
}
