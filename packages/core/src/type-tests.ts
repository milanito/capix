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
import { defineError, defineGuard } from './index.js';
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
// This is the KNOWN LIMITATION documented in guards.ts and capability.ts.
// Workarounds attempted: explicit generic TNarrowed, NoInfer<TContext> — both
// break guard usage for contexts more specific than TContext.
