# API Reference

Complete reference for all exports in the `capix` package.

For transport-specific APIs, see:
- [capix-transport-rest](../../packages/transports/rest/README.md)
- [capix-transport-ws](../../packages/transports/ws/README.md)
- [capix-transport-graphql](../../packages/transports/graphql/README.md)
- [capix-transport-queue](../../packages/transports/queue/README.md)
- [capix-plugin-auth](../../packages/plugins/auth/README.md)

---

## `capability(resolver)`
## `capability(inputSchema, resolver)`
## `capability(inputSchema, resolver, intent)`

Creates a capability.

| Parameter | Type | Description |
|---|---|---|
| `inputSchema` | `ZodSchema \| null` | Optional Zod schema for input validation |
| `resolver` | `(input, ctx) => output \| Promise<output>` | The resolver function |
| `intent` | `Intent` | Explicit intent: `'query' \| 'mutation' \| 'update' \| 'replace' \| 'delete'` |

Returns `Capability<TInput, TOutput, BaseContext>`.

---

## `capability.withContext<TContext>()`

Returns a factory function identical to `capability()` but with `TContext` pre-bound as the context type.

```ts
const cap = capability.withContext<AppContext>();
const getUser = cap(schema, async (input, ctx) => {
  // ctx is AppContext
});
```

---

## `defineContext(fn)`

Defines a context builder. `fn` receives a `RawRequest` and returns the context object.

The returned function is a `ContextBuilder` — pass it to `createServer({ context: buildContext })`.

---

## `defineGuard(fn)`

Defines a guard. `fn` receives the context and should throw a `FrameworkError` to reject.

```ts
const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});
```

---

## `defineGuardFor<T>()`

Returns a guard factory for a narrowing guard — one that asserts the context is subtype `T`.

```ts
type AuthCtx = AppContext & { user: User };

const mustBeUser = defineGuardFor<AuthCtx>()((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});
```

---

## `defineInputGuard(fn)`

Defines an input guard — a guard that runs after input validation and receives `(input, ctx)`.

---

## `defineError(status, message, code?)`

Creates a typed error factory.

| Parameter | Type | Description |
|---|---|---|
| `status` | `number` | HTTP status code |
| `message` | `string` | Human-readable message; also used to derive `code` |
| `code` | `string \| undefined` | Machine-readable error code (optional; derived from `message` if omitted) |

Returns `ErrorFactory`: a callable `(meta?) => FrameworkError`.

---

## `defineEnhancer(fn)`

Type-safe pass-through for enhancer functions. Ensures the function matches the `Enhancer` signature.

---

## `definePlugin(plugin)`

Creates a plugin from a plain object with optional `capabilities` and `context` fields.

---

## `defineConfig(config)`

Pass-through for type inference on server config objects. Use to get TypeScript autocomplete on config literals.

---

## `createServer(config)`

Creates a server. Does not start transports.

| Config field | Type | Description |
|---|---|---|
| `context` | `ContextBuilder` | Required if any capability uses context |
| `capabilities` | `GroupTree` | Default capabilities for all transports |
| `plugins` | `Plugin[]` | Plugin array |
| `transports` | `Transport[]` | Transport array |
| `isDevelopment` | `boolean` | Enable output validation; defaults to `NODE_ENV !== 'production'` |

Returns `{ start(), stop(), invoke() }`.

---

## `createEventBus<TEvents>()`

Creates a typed event bus. `TEvents` maps event names to their payload types.

Returns `{ publish(event, data), subscribe(event, handler, options?) }`.

---

## `isCapability(v)`

Type guard: returns `true` if `v` is a Capix capability.

---

## `isFrameworkError(v)`

Type guard: returns `true` if `v` is a `FrameworkError` created by `defineError`.

---

## `inferIntent(key)`

Infers capability intent from a key name using the prefix tables. Returns `Intent`.

---

## `compileRegistry(groupTree)`

Compiles a capability group tree into a flat `CapabilityRegistry` (a `Map<string, AnyCapability>`).

---

## `getHeader(req, name)`

Safe header access from `RawRequest`. Returns `string | undefined`.

---

## `defaultErrors`

Pre-defined error factories:

| Name | Status |
|---|---|
| `BadRequest` | 400 |
| `Unauthorized` | 401 |
| `Forbidden` | 403 |
| `NotFound` | 404 |
| `Conflict` | 409 |
| `TooManyRequests` | 429 |
| `Internal` | 500 |
| `Timeout` | 504 |

---

## Enhancers

See [guide/enhancers.md](../guide/enhancers.md) for usage.

| Export | Signature |
|---|---|
| `withCache` | `(ttlSeconds: number) => Enhancer` |
| `withRateLimit` | `(opts: RateLimitOptions) => Enhancer` |
| `withCircuitBreaker` | `(opts: CircuitBreakerOptions) => Enhancer` |
| `withTimeout` | `(ms: number) => Enhancer` |
| `withRetry` | `(maxAttempts: number, delayMs?: number) => Enhancer` |
| `withRollback` | `Enhancer` |
| `withMetrics` | `(collector: MetricsCollector) => Enhancer` |
| `withLogging` | `Enhancer` |
| `consoleMetricsCollector` | `MetricsCollector` |

---

## Types

| Type | Description |
|---|---|
| `Capability<I, O, C>` | A capability with typed input, output, and context |
| `AnyCapability` | `Capability<unknown, unknown, BaseContext>` |
| `BaseContext` | `{ requestId: string }` |
| `ContextBuilder` | `(req: RawRequest) => Context \| Promise<Context>` |
| `RawRequest` | `{ headers: Record<string, string \| string[] \| undefined> }` |
| `Guard` | `(ctx: C) => void \| Promise<void>` |
| `NarrowingGuard<C, N extends C>` | Guard that asserts ctx is N |
| `InputGuard` | `(input: I, ctx: C) => void \| Promise<void>` |
| `Enhancer` | `(cap: Capability) => Capability` |
| `Resolver<I, O, C>` | `(input: I, ctx: C) => O \| Promise<O>` |
| `Plugin` | `{ capabilities?: GroupTree; context?: (base: C) => C }` |
| `Intent` | `'query' \| 'mutation' \| 'update' \| 'replace' \| 'delete'` |
| `GroupTree` | Recursive object of capabilities |
| `CapabilityRegistry` | `Map<string, AnyCapability>` |
| `InferInput<Cap>` | Extract input type from a capability |
| `InferOutput<Cap>` | Extract output type from a capability |
| `InferContext<Cap>` | Extract context type from a capability |
| `FrameworkError` | Typed error from `defineError` |
| `ErrorFactory` | `(meta?: Record<string, unknown>) => FrameworkError` |
| `WithRollback<T>` | Context extended with `onRollback(fn)` |
| `MetricsCollector` | `{ increment(name, tags?), histogram(name, value, tags?) }` |
| `CircuitBreakerOptions` | `{ failureThreshold, successThreshold, timeoutMs }` |
| `RateLimitOptions` | `{ max, windowMs }` |
| `Transport` | `{ mount(invoke, options): Promise<() => Promise<void>> }` |
| `TransportWithCapabilities` | `Transport & { _capabilities?: GroupTree }` |
| `MountOptions` | `{ registry: CapabilityRegistry; invoke: InvokeFn }` |
| `ServerConfig` | Full config type for `createServer` |
| `Server` | `{ start(), stop(), invoke() }` |
| `EventBus<TEvents>` | Typed event bus |
| `EventMap` | Base type for event maps |
| `InvokeFn` | `(req: CapabilityRequest) => Promise<CapabilityResponse>` |
| `CapabilityRequest` | `{ capability, input, headers? }` |
| `CapabilityResponse` | `{ ok, status, data? } \| { ok: false, status, error, message }` |
