/**
 * capability.ts — the core capability primitive
 * Depends on: errors.ts, context.ts, guards.ts, zod
 */

import type { ZodSchema, ZodTypeAny } from 'zod';
import type { BaseContext } from './context.js';
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
  readonly inputSchema: ZodTypeAny | null;
  readonly outputSchema: ZodTypeAny | null;
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
  readonly resolve: Resolver<TInput, TOutput, TContext>;

  /**
   * Invoke the capability's resolver directly, bypassing TypeScript context
   * type checking. Use only for server-side capability composition where the
   * calling context is known to satisfy the required guards at runtime.
   *
   * Note: guards do NOT re-run when using resolveUnchecked. You are
   * responsible for ensuring the context satisfies guard preconditions.
   */
  resolveUnchecked(input: TInput, ctx: BaseContext): Promise<TOutput>;

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

  output<O>(schema: ZodSchema<O>): Capability<TInput, O, TContext>;
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
  inputSchema: ZodTypeAny | null;
  outputSchema: ZodTypeAny | null;
  guards: ReadonlyArray<AnyGuard>;
  inputGuards: ReadonlyArray<AnyInputGuard>;
  intent: Intent;
  _intentExplicit: boolean;
  _skipValidation: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (...args: any[]) => any;
};

function makeCapability<TInput, TOutput, TContext extends BaseContext>(
  base: CapabilityBase,
): Capability<TInput, TOutput, TContext> {
  const cap = base as unknown as Capability<TInput, TOutput, TContext>;

  // Attach chaining methods as non-enumerable properties so spread doesn't copy them
  Object.defineProperties(base, {
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
        return makeCapability<TInput, TOutput, TContext>({
          ...base,
          resolve: enhanced.resolve,
        });
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    output: {
      value<O>(schema: ZodSchema<O>): Capability<TInput, O, TContext> {
        return makeCapability<TInput, O, TContext>({
          ...base,
          outputSchema: schema,
        });
      },
      writable: false,
      enumerable: false,
      configurable: false,
    },
    resolveUnchecked: {
      value(input: TInput, ctx: BaseContext): Promise<TOutput> {
        return Promise.resolve(base.resolve(input, ctx as TContext));
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
  TSchema extends ZodTypeAny,
  TOutput,
  TContext extends BaseContext = BaseContext,
>(
  schema: TSchema,
  resolver: Resolver<TSchema['_output'], TOutput, TContext>,
): Capability<TSchema['_output'], TOutput, TContext>;

/** With typed input schema and explicit intent. */
export function capability<
  TSchema extends ZodTypeAny,
  TOutput,
  TContext extends BaseContext = BaseContext,
>(
  schema: TSchema,
  resolver: Resolver<TSchema['_output'], TOutput, TContext>,
  intent: Intent,
): Capability<TSchema['_output'], TOutput, TContext>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capability(...args: any[]): AnyCapability {
  const [first, second, thirdArg] = args as [
    ZodTypeAny | ((...a: unknown[]) => unknown),
    ((...a: unknown[]) => unknown) | Intent | undefined,
    Intent | undefined,
  ];

  const isZodSchema =
    first !== null &&
    typeof first === 'object' &&
    '_def' in (first as object);

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
      resolve: first as (...a: unknown[]) => unknown,
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
    inputSchema: first as ZodTypeAny,
    outputSchema: null,
    guards: [],
    inputGuards: [],
    _intentExplicit: thirdIntent !== undefined,
    intent: thirdIntent ?? 'mutation',
    _skipValidation: false,
    resolve: second as (...a: unknown[]) => unknown,
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

      // Create a named copy by building a fresh capability base with the correct name
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
        resolve: value.resolve,
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
  <TSchema extends ZodTypeAny, TOutput>(
    schema: TSchema,
    resolver: Resolver<TSchema['_output'], TOutput, TContext>,
  ): Capability<TSchema['_output'], TOutput, TContext>;
  <TSchema extends ZodTypeAny, TOutput>(
    schema: TSchema,
    resolver: Resolver<TSchema['_output'], TOutput, TContext>,
    intent: Intent,
  ): Capability<TSchema['_output'], TOutput, TContext>;
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
