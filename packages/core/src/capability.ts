/**
 * capability.ts — the core capability primitive
 * Depends on: errors.ts, context.ts, guards.ts, zod
 */

import type { ZodSchema, ZodTypeAny } from 'zod';
import type { BaseContext } from './context.js';
import type { AnyGuard, Guard, NarrowContext } from './guards.js';

const CAPABILITY_BRAND = Symbol('capix.Capability');

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export type Intent = 'query' | 'mutation' | 'update' | 'replace' | 'delete';

const QUERY_PREFIXES = ['get', 'find', 'fetch', 'read', 'list', 'search', 'filter'] as const;
const MUTATION_PREFIXES = ['create', 'add', 'register', 'new'] as const;
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
// HTTP override
// ---------------------------------------------------------------------------

export type HttpOverride = {
  readonly method: string;
  readonly path: string;
};

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
  readonly intent: Intent;
  readonly http?: HttpOverride;
  readonly resolve: Resolver<TInput, TOutput, TContext>;

  /**
   * Adds a guard to this capability.
   *
   * KNOWN LIMITATION: `.guard()` accepts `(ctx: any) => any` due to TypeScript's
   * function-parameter contravariance. A guard typed for `AppContext` cannot be
   * directly assigned to `Guard<BaseContext>` — `AppContext` is more specific and
   * TypeScript correctly rejects the narrower-to-broader assignment in strict mode.
   * `any` bypasses this so guards can be chained across context types.
   * Attempted fix: `guard<TGuard extends (ctx: NoInfer<TContext>) => any>` — breaks
   * any guard typed more specifically than the current TContext. Track: GitHub issue #2
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  guard<G extends (ctx: any) => any>(
    g: G,
  ): Capability<TInput, TOutput, NarrowContext<TContext, G>>;

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
  intent: Intent;
  http?: HttpOverride;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      value<G extends (ctx: any) => any>(g: G): Capability<TInput, TOutput, NarrowContext<TContext, G>> {
        return makeCapability<TInput, TOutput, NarrowContext<TContext, G>>({
          ...base,
          guards: [...base.guards, g as AnyGuard],
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
  });

  return cap;
}

// ---------------------------------------------------------------------------
// capability() overloads
// ---------------------------------------------------------------------------

/** No-input capability. */
export function capability<TOutput, TContext extends BaseContext = BaseContext>(
  resolver: (input: undefined, ctx: TContext) => TOutput | Promise<TOutput>,
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

/** With typed input schema, explicit intent, and HTTP override. */
export function capability<
  TSchema extends ZodTypeAny,
  TOutput,
  TContext extends BaseContext = BaseContext,
>(
  schema: TSchema,
  resolver: Resolver<TSchema['_output'], TOutput, TContext>,
  intent: Intent,
  opts: { http: HttpOverride },
): Capability<TSchema['_output'], TOutput, TContext>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function capability(...args: any[]): AnyCapability {
  const [first, second, thirdIntent, fourthOpts] = args as [
    ZodTypeAny | ((...a: unknown[]) => unknown),
    ((...a: unknown[]) => unknown) | undefined,
    Intent | undefined,
    { http: HttpOverride } | undefined,
  ];

  const isZodSchema =
    first !== null &&
    typeof first === 'object' &&
    '_def' in (first as object);

  if (!isZodSchema) {
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
      intent: thirdIntent ?? 'mutation',
      resolve: first as (...a: unknown[]) => unknown,
    });
  }

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
    intent: thirdIntent ?? 'mutation',
    ...(fourthOpts?.http ? { http: fourthOpts.http } : {}),
    resolve: second as (...a: unknown[]) => unknown,
  });
}

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
 * Walks a group tree recursively, builds a flat Map with dot-path keys,
 * and names each capability from its path.
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
        intent: value.intent,
        ...(value.http ? { http: value.http } : {}),
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
