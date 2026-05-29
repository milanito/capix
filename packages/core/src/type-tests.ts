/**
 * type-tests.ts — compile-time verification of type narrowing behavior.
 *
 * These are NOT runtime tests. Each block verifies a specific TypeScript
 * inference guarantee. Lines marked @ts-expect-error must produce a type
 * error; if they stop producing an error, tsc will fail, alerting us that
 * behavior changed.
 *
 * Run: pnpm --filter capix build (tsc covers this file automatically)
 */

import { z } from 'zod';
import { capability } from './capability.js';
import { defineContext } from './context.js';
import { defineError, defineGuard, defineGuardFor } from './index.js';
import type { InferContext, InferInput, InferOutput } from './capability.js';
import type { NarrowingGuard } from './guards.js';

// ---------------------------------------------------------------------------
// Context and guard setup
// ---------------------------------------------------------------------------

type AppContext = {
  readonly requestId: string;
  readonly user: { id: string; name: string } | null;
  readonly token: string | null;
};

const buildContext = defineContext(async (): Promise<AppContext> => ({
  requestId: 'test',
  user: null,
  token: null,
}));

void buildContext;

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
};

void errors;

const mustBeAuthenticated = defineGuard(
  (ctx: AppContext): asserts ctx is AppContext & { token: string } => {
    if (!ctx.token) throw errors.Unauthorized();
  },
);

const mustHaveUser = defineGuard(
  (ctx: AppContext): asserts ctx is AppContext & { user: { id: string; name: string } } => {
    if (!ctx.user) throw errors.Unauthorized();
  },
);

// ---------------------------------------------------------------------------
// Test 1: NarrowingGuard with TNarrowed extends TContext
// ---------------------------------------------------------------------------

// Valid: TNarrowed = AppContext & { token: string } which extends AppContext
type _ValidNarrowingGuard = NarrowingGuard<AppContext, AppContext & { token: string }>;
declare const _vng: _ValidNarrowingGuard;
void _vng;

// @ts-expect-error — TNarrowed must extend TContext; { token: string } alone does not
type _InvalidNarrowingGuard = NarrowingGuard<AppContext, { token: string }>;
declare const _invng: _InvalidNarrowingGuard;
void _invng;

// ---------------------------------------------------------------------------
// Test 2: defineGuard preserves the asserts type
// ---------------------------------------------------------------------------

// checkedGuard should be assignable to the correct NarrowingGuard type
type _CheckedGuardIsNarrowingGuard = typeof mustBeAuthenticated extends
  NarrowingGuard<AppContext, AppContext & { token: string }>
  ? true : false;
const _narrowingCheck: _CheckedGuardIsNarrowingGuard = true;
void _narrowingCheck;

// ---------------------------------------------------------------------------
// Test 3: Single guard narrows capability context type
// ---------------------------------------------------------------------------

const Input = z.object({ id: z.string() });

const capWithGuard = capability(
  Input,
  (_input, ctx: AppContext & { token: string }) => ctx.token.toUpperCase(),
).guard(mustBeAuthenticated);

// _context phantom field carries the narrowed TContext
type _GuardedContext = typeof capWithGuard['_context'];
// Verify the narrowed type has token as non-null
const _guardedCtxCheck: _GuardedContext = { requestId: '', user: null, token: 'tok' };
void _guardedCtxCheck;

// @ts-expect-error — token must be string, not null, in the narrowed context
const _guardedCtxBad: _GuardedContext = { requestId: '', user: null, token: null };
void _guardedCtxBad;

// ---------------------------------------------------------------------------
// Test 4: Chained guards narrow progressively
// ---------------------------------------------------------------------------

const capChained = capability(
  Input,
  (_input, ctx: AppContext & { token: string } & { user: { id: string; name: string } }) =>
    `${ctx.token}-${ctx.user.id}`,
)
  .guard(mustBeAuthenticated)
  .guard(mustHaveUser);

type _ChainedContext = typeof capChained['_context'];
// Both token (string) and user (non-null) must be present
const _chainedCtxCheck: _ChainedContext = {
  requestId: '',
  user: { id: '1', name: 'Alice' },
  token: 'tok',
};
void _chainedCtxCheck;

// @ts-expect-error — token must be string (non-null) in the chained context
const _chainedCtxBad: _ChainedContext = { requestId: '', user: { id: '1', name: 'A' }, token: null };
void _chainedCtxBad;

// ---------------------------------------------------------------------------
// Test 5: Non-narrowing (void) guard preserves TContext
// ---------------------------------------------------------------------------

const rateGuard = defineGuard((_ctx: AppContext) => {
  // plain void guard — no narrowing
});

const capWithVoidGuard = capability(
  Input,
  (_input, ctx: AppContext) => ctx.requestId,
).guard(rateGuard);

type _VoidGuardContext = typeof capWithVoidGuard['_context'];
// TContext should remain AppContext — token is still string | null
const _voidCtxCheck: _VoidGuardContext = { requestId: '', user: null, token: null };
void _voidCtxCheck;

// ---------------------------------------------------------------------------
// Test 6: KNOWN LIMITATION — resolver ctx is not inferred backward from .guard()
//
// TypeScript cannot retroactively narrow the resolver's ctx parameter based on
// guards added via method chaining. You must explicitly annotate ctx in the
// resolver or provide an explicit type parameter to capability().
//
// This WORKS (explicit ctx annotation):
// ---------------------------------------------------------------------------

const capExplicit = capability(
  Input,
  (_input, ctx: AppContext & { token: string }) => ctx.token.toUpperCase(),
).guard(mustBeAuthenticated);

void capExplicit;

// This does NOT work without annotation:
// capability(Input, (_input, ctx) => ctx.token.toUpperCase()).guard(mustBeAuthenticated)
//                                          ^^^^^^^^^^^^^^^^^
//                   Error: 'token' does not exist on type 'BaseContext'
//
// Solution: use capability.withContext<AppContext>() (see Test 7 below).

// ---------------------------------------------------------------------------
// Test 7: capability.withContext pre-binds TContext — no resolver annotation needed
// ---------------------------------------------------------------------------

const appCapability = capability.withContext<AppContext>();

const capViaFactory = appCapability(
  Input,
  (_input, ctx) => {
    // ctx is AppContext — no annotation required
    return ctx.requestId;
  },
);

// _context is AppContext
type _FactoryContext = typeof capViaFactory['_context'];
const _factoryCtxCheck: _FactoryContext = { requestId: '', user: null, token: null };
void _factoryCtxCheck;

// Guards work directly — no `any` escape hatch needed
const capFactoryWithGuard = appCapability(
  Input,
  (_input, ctx) => ctx.requestId,
).guard(mustBeAuthenticated);

// Context is narrowed after guard
type _FactoryGuardedContext = typeof capFactoryWithGuard['_context'];
const _factoryGuardedCheck: _FactoryGuardedContext = { requestId: '', user: null, token: 'tok' };
void _factoryGuardedCheck;

// @ts-expect-error — token must be non-null in the narrowed context
const _factoryGuardedBad: _FactoryGuardedContext = { requestId: '', user: null, token: null };
void _factoryGuardedBad;

// ---------------------------------------------------------------------------
// Test 8: InferInput / InferOutput / InferContext utility types
// ---------------------------------------------------------------------------

const TypedCap = capability(
  z.object({ id: z.string(), count: z.number() }),
  (_input, _ctx: AppContext) => ({ result: 'ok' as const }),
);

type _InferredInput = InferInput<typeof TypedCap>;
type _InferredOutput = InferOutput<typeof TypedCap>;
type _InferredContext = InferContext<typeof TypedCap>;

const _inputCheck: _InferredInput = { id: 'x', count: 1 };
void _inputCheck;

const _outputCheck: _InferredOutput = { result: 'ok' };
void _outputCheck;

const _contextCheck: _InferredContext = { requestId: '', user: null, token: null };
void _contextCheck;

// @ts-expect-error — id must be string, not number
const _inputBad: _InferredInput = { id: 42, count: 1 };
void _inputBad;

// InferContext after .guard() reflects the narrowed context
const GuardedTypedCap = TypedCap.guard(mustBeAuthenticated);
type _GuardedInferredContext = InferContext<typeof GuardedTypedCap>;
const _guardedInferred: _GuardedInferredContext = { requestId: '', user: null, token: 'tok' };
void _guardedInferred;

// @ts-expect-error — token must be string after guard
const _guardedInferredBad: _GuardedInferredContext = { requestId: '', user: null, token: null };
void _guardedInferredBad;

// ---------------------------------------------------------------------------
// Test 9: defineGuardFor — typed guard factory without repeated annotation
// ---------------------------------------------------------------------------

const defineAppGuard = defineGuardFor<AppContext>();

// Plain void guard
const appRateGuard = defineAppGuard((_ctx) => {
  // _ctx is AppContext — no annotation needed
});

void appRateGuard;

// Narrowing guard — assertion types are preserved
const appAuthGuard = defineAppGuard(
  (ctx): asserts ctx is AppContext & { token: string } => {
    if (!ctx.token) throw errors.Unauthorized();
  },
);

// Should be assignable to the correct NarrowingGuard type
type _AppAuthGuardType = typeof appAuthGuard extends
  NarrowingGuard<AppContext, AppContext & { token: string }>
  ? true : false;
const _appAuthGuardCheck: _AppAuthGuardType = true;
void _appAuthGuardCheck;

// defineGuardFor validates context type — wrong context errors
// @ts-expect-error — guard must accept AppContext, not an incompatible shape
defineGuardFor<AppContext>()((ctx: { somethingElse: number }) => { void ctx; });

// ---------------------------------------------------------------------------
// Test 10: .guard() requires guard to be compatible with current TContext
// ---------------------------------------------------------------------------

// Guard typed for BaseContext works with any capability (it's more permissive)
const baseGuard = defineGuard((_ctx: { requestId: string }) => {});
const capWithBaseGuard = appCapability(Input, (_input, _ctx) => 'ok').guard(baseGuard);
void capWithBaseGuard;

// Guard typed for AppContext works when TContext = AppContext
const capWithAppGuard = appCapability(Input, (_input, _ctx) => 'ok').guard(mustBeAuthenticated);
void capWithAppGuard;

// Guard typed for AppContext does NOT work when TContext = BaseContext
// (default TContext when no resolver annotation and no withContext)
// @ts-expect-error — mustBeAuthenticated requires AppContext but TContext = BaseContext here
capability(Input, (_input, _ctx) => 'ok').guard(mustBeAuthenticated);

// ---------------------------------------------------------------------------
// Test 11: ScopedCapabilityFactory supports (resolver, intent) and (resolver, intent, opts)
// ---------------------------------------------------------------------------

type MinContext = { readonly requestId: string };
const minCap = capability.withContext<MinContext>();

// no-schema, no intent
const _t11a = minCap(() => 42);
void _t11a;

// no-schema + intent
const _t11b = minCap(() => 42, 'query');
void _t11b;

// schema + resolver
const _t11d = minCap(z.object({ id: z.string() }), ({ id }) => id);
void _t11d;

// schema + resolver + intent
const _t11e = minCap(z.object({ id: z.string() }), ({ id }) => id, 'query');
void _t11e;
