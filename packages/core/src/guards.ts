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
 * TContext & TNarrowed is always a structural subtype of TContext; TypeScript's
 * generic variance check incorrectly rejects this in type-alias definitions (TS2677).
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS2677
// prettier-ignore
export type NarrowingGuard<TContext extends BaseContext, TNarrowed> = (ctx: TContext) => asserts ctx is TContext & TNarrowed;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** Any guard — uses `any` context so guards typed for specific contexts are assignable. */
export type AnyGuard = (ctx: any) => void | Promise<void>;

/**
 * Utility type: if TGuard is a NarrowingGuard, extract the narrowed type.
 * Otherwise return TContext unchanged.
 */
export type NarrowContext<
  TContext extends BaseContext,
  TGuard,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // TS 5.5+ requires the asserted type to be assignable to the ctx parameter type,
  // which fails in generic conditional types. Using `any` as the param avoids this.
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
