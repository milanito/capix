/**
 * capability.ts — the core capability primitive
 * Depends on: errors.ts, context.ts, guards.ts, zod
 */

import type { ZodType, output as ZodOutput } from 'zod';
import type { BaseContext } from './context.js';
import { runInputGuards } from './guards.js';
import type { AnyGuard, AnyInputGuard, Guard, InputGuard, NarrowContext } from './guards.js';

const CAPABILITY_BRAND = Symbol.for('capix.Capability');

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export type Intent = 'query' | 'mutation' | 'update' | 'replace' | 'delete';

const QUERY_PREFIXES = ['get', 'find', 'fetch', 'read', 'list', 'search', 'filter', 'me', 'status', 'health', 'count', 'check'] as const;
const MUTATION_PREFIXES = ['create', 'add', 'new'] as const;
const UPDATE_PREFIXES = ['update', 'edit', 'patch', 'modify'] as const;
const REPLACE_PREFIXES = ['replace', 'set', 'put'] as const;
const DELETE_PREFIXES = ['delete', 'remove', 'destroy', 'cancel'] as const;

/**
 * Resolves a capability's effective intent: an intent passed explicitly to
 * `capability()` wins; otherwise it is inferred from the capability's key
 * name in the group tree (`getUser` → query, `deleteUser` → delete).
 *
 * This is the rule every transport uses — REST for route methods, MCP for
 * tool annotations, GraphQL for query/mutation placement. Transport authors
 * should call this instead of reading `intent` directly, so explicit and
 * inferred intents behave identically across transports.
 */
export function resolveIntent(cap: AnyCapability, key: string): Intent {
  return cap._intentExplicit ? cap.intent : inferIntent(key);
}

/** Infers capability intent from its key name in the parent group. */
export function inferIntent(key: string): Intent {
  const lower = key.toLowerCase();
  for (const p of QUERY_PREFIXES) {
    if (lower.startsWith(p)) return 'query';
  }
  for (const p of MUTATION_PREFIXES) {
    if (lower.startsWith(p)) return 'mutation';
  }
  for (const p of UPDATE_PREFIXES) {
    if (lower.startsWith(p)) return 'update';
  }
  for (const p of REPLACE_PREFIXES) {
    if (lower.startsWith(p)) return 'replace';
  }
  for (const p of DELETE_PREFIXES) {
    if (lower.startsWith(p)) return 'delete';
  }
  return 'mutation';
}

// ---------------------------------------------------------------------------
// Enhancer
// ---------------------------------------------------------------------------

export type Enhancer = <TInput, TOutput, TContext extends BaseContext>(
  cap: Capability<TInput, TOutput, TContext>,
) => Capability<TInput, TOutput, TContext>;

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export type Resolver<TInput, TOutput, TContext extends BaseContext> = (
  input: TInput,
  ctx: TContext,
) => TOutput | Promise<TOutput>;

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

export type Capability<
  TInput,
  TOutput,
  TContext extends BaseContext,
> = {
  /** @internal Brand field — use {@link isCapability} instead of reading this. */
  readonly _capix: true;
  readonly [CAPABILITY_BRAND]: true;
  readonly name: string;
  /** @internal Phantom type field for inference — never set at runtime. Use {@link InferInput}. */
  readonly _input: TInput;
  /** @internal Phantom type field for inference — never set at runtime. Use {@link InferOutput}. */
  readonly _output: TOutput;
  /** @internal Phantom type field for inference — never set at runtime. Use {@link InferContext}. */
  readonly _context: TContext;
  readonly inputSchema: ZodType | null;
  readonly outputSchema: ZodType | null;
  readonly guards: ReadonlyArray<AnyGuard>;
  readonly inputGuards: ReadonlyArray<AnyInputGuard>;
  /**
   * The intent passed to capability(), or 'mutation' when defaulted.
   * Transports should use {@link resolveIntent} rather than reading this —
   * it applies key-name inference when no explicit intent was given.
   */
  readonly intent: Intent;
  /** @internal True when intent was explicitly passed to capability(). Use {@link resolveIntent}. */
  readonly _intentExplicit: boolean;
  /**
   * @internal Set by compileRegistry when inputSchema is a z.object({}) with no
   * keys — the execution engine skips input validation entirely.
   */
  readonly _skipValidation: boolean;

  /**
   * Invoke this capability's guards and resolver directly.
   *
   * Guards always re-run — this is safe to call from any context.
   * If the context does not satisfy the guards, they throw as normal.
   *
   * TypeScript does not verify at the call site that the provided context
   * satisfies this capability's guard requirements — guards enforce this
   * at runtime. This enables capability composition without escape hatches:
   *
   * ```ts
   * const getDashboard = cap(z.object({}), async (_, ctx) => {
   *   const [log, projects] = await Promise.all([
   *     listAuditLog.resolve({ limit: 10 }, ctx),  // mustBeAdmin runs — throws if not admin
   *     listProjects.resolve({ limit: 5 },  ctx),  // mustBeAuthenticated runs
   *   ]);
   *   return { log, projects };
   * }, 'query').guard(mustBeAuthenticated);
   * ```
   *
   * For HTTP/GraphQL/queue invocation, the execution engine uses _resolverOnly
   * after running guards itself — guards run exactly once per external request.
   */
  resolve: (input: TInput, ctx: BaseContext) => Promise<TOutput>;

  /**
   * Raw resolver — no guards. Extension-author API: enhancers wrap this to
   * avoid re-running guards, and the execution engine calls it after running
   * guards itself. Do not call from application code — use resolve() instead.
   */
  _resolverOnly: (input: TInput, ctx: TContext) => Promise<TOutput>;

  /**
   * Adds a guard to this capability.
   *
   * The guard must accept the capability's current TContext (or a supertype of it).
   * Function-parameter contravariance means a guard typed for a broader context
   * (e.g. BaseContext) is always assignable, while a guard typed for a more specific
   * context (e.g. AppContext) requires TContext to already be at least that specific.
   * Use `capability.withContext<AppContext>()` to start with TContext = AppContext so
   * all AppContext guards are accepted without explicit resolver annotation.
   */
  guard<G extends (ctx: TContext) => any>(
    g: G,
  ): Capability<TInput, TOutput, NarrowContext<TContext, G>>;

  /**
   * Adds an input guard that receives both validated input and context.
   * Runs after input validation, before the resolver.
   * Use for resource ownership checks and other input-dependent access control.
   */
  inputGuard(g: InputGuard<TInput, TContext>): Capability<TInput, TOutput, TContext>;

  enhance(e: Enhancer): Capability<TInput, TOutput, TContext>;

  output<O>(schema: ZodType<O>): Capability<TInput, O, TContext>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCapability = Capability<any, any, any>;

// ---------------------------------------------------------------------------
// Internal builder
// ---------------------------------------------------------------------------

type CapabilityBase = {
  _capix: true;
  [CAPABILITY_BRAND]: true;
  name: string;
  _input: unknown;
  _output: unknown;
  _context: unknown;
  inputSchema: ZodType | null;
  outputSchema: ZodType | null;
  guards: ReadonlyArray<AnyGuard>;
  inputGuards: ReadonlyArray<AnyInputGuard>;
  intent: Intent;
  _intentExplicit: boolean;
  _skipValidation: boolean;
  // Raw resolver — enumerable so it copies through spread in chaining methods.
  // Named _fn to avoid name collision with the non-enumerable .resolve() method
  // added by makeCapability via Object.defineProperties.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _fn: (...args: any[]) => any;
};

function makeCapability<TInput, TOutput, TContext extends BaseContext>(
  base: CapabilityBase,
): Capability<TInput, TOutput, TContext> {
  const cap = base as unknown as Capability<TInput, TOutput, TContext>;
  const rawFn = base._fn;

  // Attach methods as non-enumerable properties so spread in chaining doesn't copy them,
  // and so enhancers returning { ...cap, resolve: wrappedFn } can set a plain enumerable
  // resolve that enhance() picks up as the new _fn.
  Object.defineProperties(base, {
    // _resolverOnly: raw resolver, no guards. Used by the execution engine (guards already ran).
    // Also called by enhancers to wrap the resolver without re-running guards.
    _resolverOnly: {
      value: rawFn,
      writable: false,
      enumerable: false,
      configurable: false,
    },
    // resolve: runs all guards, then calls the raw resolver.
    // Accepts BaseContext — safe for composition from any calling context.
    // Non-async fast path when no guards: avoids extra microtask tick so fake-timer
    // tests and hot-path callers see no overhead vs the old direct-fn assignment.
    resolve: {
      value: (input: TInput, ctx: BaseContext): Promise<TOutput> => {
        if (base.guards.length === 0 && base.inputGuards.length === 0) {
          const r = rawFn(input, ctx as TContext);
          return (r instanceof Promise ? r : Promise.resolve(r)) as Promise<TOutput>;
        }
        const run = async (): Promise<TOutput> => {
          for (const guard of base.guards) {
            const gr = guard(ctx);
            if (gr !== undefined && gr !== null && typeof (gr as { then?: unknown }).then === 'function') {
              await (gr as Promise<void>);
            }
          }
          if (base.inputGuards.length > 0) {
            await runInputGuards(base.inputGuards, input, ctx as TContext);
          }
          return rawFn(input, ctx as TContext) as Promise<TOutput>;
        };
        return run();
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    guard: {
      value<G extends (ctx: TContext) => any>(g: G): Capability<TInput, TOutput, NarrowContext<TContext, G>> {
        return makeCapability<TInput, TOutput, NarrowContext<TContext, G>>({
          ...base,
          guards: [...base.guards, g as AnyGuard],
        });
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    inputGuard: {
      value(g: InputGuard<TInput, TContext>): Capability<TInput, TOutput, TContext> {
        return makeCapability<TInput, TOutput, TContext>({
          ...base,
          inputGuards: [...base.inputGuards, g as AnyInputGuard],
        });
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    enhance: {
      value(e: Enhancer): Capability<TInput, TOutput, TContext> {
        const enhanced = e(cap);
        // enhanced.resolve is the plain enumerable property set by the enhancer:
        //   (cap) => ({ ...cap, resolve: wrappedFn })
        // This wrappedFn calls cap._resolverOnly internally, so guards don't double-run.
        // We use it as the new raw resolver for the returned capability.
        return makeCapability<TInput, TOutput, TContext>({
          ...base,
          _fn: enhanced.resolve as (...args: unknown[]) => unknown,
        });
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    output: {
      value<O>(schema: ZodType<O>): Capability<TInput, O, TContext> {
        return makeCapability<TInput, O, TContext>({
          ...base,
          outputSchema: schema,
        });
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
  });

  return cap;
}

// ---------------------------------------------------------------------------
// capability() overloads
// ---------------------------------------------------------------------------

/**
 * Shared arg-parsing for both capability(...) and a GuardBuilder's terminal
 * call (capability.guard(...)(...)) — the only difference between the two
 * call sites is which guards (if any) are already known when the base is
 * constructed.
 */
function buildCapability(args: unknown[], guards: ReadonlyArray<AnyGuard>): AnyCapability {
  const [first, second, thirdArg] = args as [
    ZodType | ((...a: unknown[]) => unknown),
    ((...a: unknown[]) => unknown) | Intent | undefined,
    Intent | undefined,
  ];

  const isZodSchema =
    first !== null &&
    typeof first === 'object' &&
    ('_zod' in (first as object) || '_def' in (first as object));

  if (!isZodSchema) {
    // No-schema overloads: capability(resolver) | capability(resolver, intent)
    const explicitIntent = typeof second === 'string' ? (second as Intent) : undefined;
    return makeCapability<undefined, unknown, BaseContext>({
      _capix: true,
      [CAPABILITY_BRAND]: true,
      name: '(unnamed)',
      _input: undefined,
      _output: undefined,
      _context: undefined,
      inputSchema: null,
      outputSchema: null,
      guards,
      inputGuards: [],
      _intentExplicit: explicitIntent !== undefined,
      intent: explicitIntent ?? 'mutation',
      _skipValidation: false,
      _fn: first as (...a: unknown[]) => unknown,
    });
  }

  // Schema overloads: capability(schema, resolver) | capability(schema, resolver, intent)
  const thirdIntent = typeof thirdArg === 'string' ? (thirdArg as Intent) : undefined;

  return makeCapability<unknown, unknown, BaseContext>({
    _capix: true,
    [CAPABILITY_BRAND]: true,
    name: '(unnamed)',
    _input: undefined,
    _output: undefined,
    _context: undefined,
    inputSchema: first as ZodType,
    outputSchema: null,
    guards,
    inputGuards: [],
    _intentExplicit: thirdIntent !== undefined,
    intent: thirdIntent ?? 'mutation',
    _skipValidation: false,
    _fn: second as (...a: unknown[]) => unknown,
  });
}

/**
 * Defines a capability — the unit of server-side logic in Capix.
 *
 * Wraps a resolver function with optional input validation (Zod schema), guards,
 * and enhancers. Capabilities are the building blocks registered in createServer().
 *
 * @example No-input capability
 * const ping = capability(() => ({ pong: true }));
 *
 * @example With Zod input schema
 * const getUser = capability(
 *   z.object({ id: z.string() }),
 *   async (input, ctx) => db.users.find(input.id),
 * );
 *
 * @example With explicit intent (overrides key-based inference in inferRoutes)
 * const deletePost = capability(
 *   z.object({ id: z.string() }),
 *   async (input, ctx) => db.posts.delete(input.id),
 *   'delete',
 * );
 *
 * @example Adding guards and enhancers
 * const createPost = capability(schema, resolver)
 *   .guard(mustBeAuthenticated)
 *   .enhance(withTimeout(5000));
 *
 * Use {@link capability.withContext} to pre-bind the context type when all
 * capabilities in a module share the same application context.
 */
/** No-input capability. */
export function capability<TOutput, TContext extends BaseContext = BaseContext>(
  resolver: (input: undefined, ctx: TContext) => TOutput | Promise<TOutput>,
): Capability<undefined, TOutput, TContext>;

/** No-input capability with explicit intent. */
export function capability<TOutput, TContext extends BaseContext = BaseContext>(
  resolver: (input: undefined, ctx: TContext) => TOutput | Promise<TOutput>,
  intent: Intent,
): Capability<undefined, TOutput, TContext>;

/** With typed input schema. */
export function capability<
  TSchema extends ZodType,
  TOutput,
  TContext extends BaseContext = BaseContext,
>(
  schema: TSchema,
  resolver: Resolver<ZodOutput<TSchema>, TOutput, TContext>,
): Capability<ZodOutput<TSchema>, TOutput, TContext>;

/** With typed input schema and explicit intent. */
export function capability<
  TSchema extends ZodType,
  TOutput,
  TContext extends BaseContext = BaseContext,
>(
  schema: TSchema,
  resolver: Resolver<ZodOutput<TSchema>, TOutput, TContext>,
  intent: Intent,
): Capability<ZodOutput<TSchema>, TOutput, TContext>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capability(...args: any[]): AnyCapability {
  return buildCapability(args, []);
}

// ---------------------------------------------------------------------------
// Utility inference types
// ---------------------------------------------------------------------------

/** Extract the validated input type from a Capability. */
export type InferInput<TCap extends AnyCapability> = TCap['_input'];

/** Extract the resolved output type from a Capability. */
export type InferOutput<TCap extends AnyCapability> = TCap['_output'];

/** Extract the required context type from a Capability (reflects guard narrowing). */
export type InferContext<TCap extends AnyCapability> = TCap['_context'];

// ---------------------------------------------------------------------------
// isCapability
// ---------------------------------------------------------------------------

/** Returns true for values created by capability(). Plain objects with _capix: true return false. */
export function isCapability(value: unknown): value is AnyCapability {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[CAPABILITY_BRAND] === true
  );
}

// ---------------------------------------------------------------------------
// CapabilityRegistry and compileRegistry
// ---------------------------------------------------------------------------

export type CapabilityRegistry = ReadonlyMap<string, AnyCapability>;

/** Interface to allow recursive references (type aliases can't be circular). */
export interface GroupTree {
  [key: string]: AnyCapability | GroupTree;
}

/**
 * Flattens a nested capability tree into a registry Map keyed by dot-path names.
 *
 * `createServer` calls this automatically — use it directly only when building
 * custom transports or tooling that needs the registry before the server starts.
 *
 * Each capability is named from its path in the tree (`users.getUser`, `posts.create`).
 * Capabilities with an empty `z.object({})` input schema have `_skipValidation` set so
 * the execution engine bypasses Zod entirely for those routes.
 *
 * @throws {Error} If any key is not a camelCase identifier (letters and digits only,
 *   must start with a letter). Dashes, underscores, and leading digits are rejected.
 */
const VALID_KEY = /^[a-zA-Z][a-zA-Z0-9]*$/;

export function compileRegistry(tree: GroupTree, prefix = ''): CapabilityRegistry {
  const map = new Map<string, AnyCapability>();

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (!VALID_KEY.test(key)) {
      throw new Error(
        `[capix] Invalid capability key: "${key}" at path "${path}". ` +
        `Keys must be camelCase identifiers (letters and numbers only, ` +
        `starting with a letter). Examples: getUser, listOrders, createPost.`,
      );
    }

    if (isCapability(value)) {
      // True when inputSchema is z.object({}) — execution engine skips safeParse entirely.
      const skipVal =
        value.inputSchema !== null &&
        'shape' in value.inputSchema &&
        typeof (value.inputSchema as Record<string, unknown>).shape === 'object' &&
        (value.inputSchema as Record<string, unknown>).shape !== null &&
        Object.keys((value.inputSchema as { shape: object }).shape).length === 0;

      // Create a named copy by building a fresh capability base with the correct name.
      // _resolverOnly is the raw resolver (= base._fn on the original capability).
      const base: CapabilityBase = {
        _capix: true,
        [CAPABILITY_BRAND]: true,
        name: path,
        _input: undefined,
        _output: undefined,
        _context: undefined,
        inputSchema: value.inputSchema,
        outputSchema: value.outputSchema,
        guards: value.guards,
        inputGuards: value.inputGuards,
        intent: value.intent,
        _intentExplicit: value._intentExplicit,
        _skipValidation: skipVal,
        // _resolverOnly === base._fn on the original capability (direct reference, no wrapping).
        _fn: (value as unknown as { _resolverOnly: (...args: unknown[]) => unknown })._resolverOnly,
      };
      map.set(path, makeCapability(base));
    } else {
      const nested = compileRegistry(value as GroupTree, path);
      for (const [nestedPath, cap] of nested) {
        map.set(nestedPath, cap);
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// capability.withContext — scoped factory with TContext pre-bound
// ---------------------------------------------------------------------------

/**
 * The type returned by `capability.withContext<TContext>()`.
 * Identical to the `capability()` overloads but with TContext fixed.
 */
export type ScopedCapabilityFactory<TContext extends BaseContext> = {
  <TOutput>(
    resolver: (input: undefined, ctx: TContext) => TOutput | Promise<TOutput>,
  ): Capability<undefined, TOutput, TContext>;
  <TOutput>(
    resolver: (input: undefined, ctx: TContext) => TOutput | Promise<TOutput>,
    intent: Intent,
  ): Capability<undefined, TOutput, TContext>;
  <TSchema extends ZodType, TOutput>(
    schema: TSchema,
    resolver: Resolver<ZodOutput<TSchema>, TOutput, TContext>,
  ): Capability<ZodOutput<TSchema>, TOutput, TContext>;
  <TSchema extends ZodType, TOutput>(
    schema: TSchema,
    resolver: Resolver<ZodOutput<TSchema>, TOutput, TContext>,
    intent: Intent,
  ): Capability<ZodOutput<TSchema>, TOutput, TContext>;
};

// ---------------------------------------------------------------------------
// capability.guard — guard-first builder, resolver typed against the
// already-narrowed context with zero annotation and no factory pre-binding.
// ---------------------------------------------------------------------------

/**
 * The type returned by `capability.guard(...)` and `GuardBuilder.guard(...)`.
 * Callable with the same overloads as `capability()` (via ScopedCapabilityFactory,
 * TContext fixed to the narrowed type accumulated so far), plus `.guard()` to
 * keep narrowing before the resolver is written.
 */
export type GuardBuilder<TContext extends BaseContext> = ScopedCapabilityFactory<TContext> & {
  /**
   * Adds another guard, narrowing TContext further before the resolver is written.
   *
   * Bound to `(ctx: TContext) => any` — not `any` — so a guard incompatible with
   * the context already established by prior guards in this chain is still a
   * type error. Only the entry point (`capability.guard`) relaxes the bound,
   * because only there is TContext guaranteed wider than any real guard's
   * declared parameter (see NarrowContext's doc comment for why `any` is
   * needed at all, and Test 12+ in type-tests.ts for what stays rejected).
   */
  guard<G extends (ctx: TContext) => any>(g: G): GuardBuilder<NarrowContext<TContext, G>>;
};

function makeGuardBuilder<TContext extends BaseContext>(
  guards: ReadonlyArray<AnyGuard>,
): GuardBuilder<TContext> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callable = ((...args: any[]) => buildCapability(args, guards)) as GuardBuilder<TContext>;
  Object.defineProperty(callable, 'guard', {
    value: <G extends (ctx: TContext) => any>(g: G): GuardBuilder<NarrowContext<TContext, G>> =>
      makeGuardBuilder<NarrowContext<TContext, G>>([...guards, g as AnyGuard]),
    writable: false,
    enumerable: false,
    configurable: false,
  });
  return callable;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace capability {
  /**
   * Returns a `capability()` factory with TContext pre-bound.
   * The resolver's `ctx` parameter is inferred as TContext without annotation,
   * and guards typed for TContext are accepted without the `any` escape hatch.
   *
   * @example
   * const appCap = capability.withContext<AppContext>();
   * const getUser = appCap(
   *   z.object({ id: z.string() }),
   *   async (input, ctx) => {  // ctx: AppContext — no annotation needed
   *     if (!ctx.user) throw Errors.Unauthorized();
   *     return db.users.find(input.id);
   *   },
   * ).guard(mustBeAuthenticated);
   */
  export function withContext<TContext extends BaseContext>(): ScopedCapabilityFactory<TContext> {
    return capability as unknown as ScopedCapabilityFactory<TContext>;
  }

  /**
   * Starts a guard-first builder: declare guards before the resolver, so the
   * resolver's `ctx` parameter is inferred as the fully-narrowed type with no
   * annotation and no `capability.withContext<T>()` factory needed.
   *
   * Solves the ordering limitation documented in docs/ts-workarounds.md —
   * `capability(resolver).guard(g)` type-checks the resolver *before* `.guard()`
   * is seen, so TypeScript can't retroactively narrow it. Declaring guards
   * first via this builder means TContext is already narrowed by the time the
   * resolver function literal is contextually typed.
   *
   * The bound is `(ctx: any) => any`, not `(ctx: BaseContext) => any` — the
   * capability starts with TContext = BaseContext, and any real guard (e.g.
   * one requiring AppContext) declares a *more specific* parameter type than
   * BaseContext. Function-parameter contravariance means that guard's type
   * would never be assignable to a BaseContext-bound parameter, which is
   * exactly the limitation this entry point exists to route around. Every
   * `.guard()` call after this first one uses the real accumulated TContext
   * (not `any`), so a guard genuinely incompatible with what prior guards
   * established is still rejected — see type-tests.ts.
   *
   * @example
   * const getProfile = capability
   *   .guard(mustBeUser)
   *   .guard(mustBeAdmin)(
   *     z.object({}),
   *     (_, ctx) => ctx.user.id, // ctx: AppContext & { user: User & { role: 'admin' } } — no annotation
   *     'query',
   *   );
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function guard<G extends (ctx: any) => any>(g: G): GuardBuilder<NarrowContext<BaseContext, G>> {
    return makeGuardBuilder<NarrowContext<BaseContext, G>>([g as AnyGuard]);
  }
}
