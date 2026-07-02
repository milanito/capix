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
  readonly _capix: true;
  readonly [CAPABILITY_BRAND]: true;
  readonly name: string;
  // phantom type fields for inference — never accessed at runtime
  readonly _input: TInput;
  readonly _output: TOutput;
  readonly _context: TContext;
  readonly inputSchema: ZodType | null;
  readonly outputSchema: ZodType | null;
  readonly guards: ReadonlyArray<AnyGuard>;
  readonly inputGuards: ReadonlyArray<AnyInputGuard>;
  readonly intent: Intent;
  /** True when intent was explicitly passed to capability(); false when defaulted. */
  readonly _intentExplicit: boolean;
  /**
   * Set by compileRegistry when inputSchema is a z.object({}) with no keys.
   * The execution engine skips input validation entirely — there is nothing to validate.
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
   * Raw resolver — no guards. Used by the execution engine after it has
   * already run guards. Also used internally by enhancers wrapping the resolver.
   * Do not call this from application code — use resolve() instead.
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
      guards: [],
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
    guards: [],
    inputGuards: [],
    _intentExplicit: thirdIntent !== undefined,
    intent: thirdIntent ?? 'mutation',
    _skipValidation: false,
    _fn: second as (...a: unknown[]) => unknown,
  });
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
}
