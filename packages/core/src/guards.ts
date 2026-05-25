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
 */
export function defineGuard<TFn extends AnyGuard>(fn: TFn): TFn {
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
