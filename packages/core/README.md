# capix

Core primitives for the Capix framework. Defines capabilities, context, guards, errors, enhancers, plugins, and the server.

## Install

```bash
npm install capix zod
```

## Quick example

```ts
import { z } from 'zod';
import { capability, defineContext, defineGuard, defineError, createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';

// 1. Define what your server knows about each request
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: req.headers.authorization === 'Bearer admin'
    ? { id: '1', role: 'admin' as const }
    : null,
}));

// 2. Define guards — preconditions that run before a capability
const Errors = { Unauthorized: defineError(401, 'Unauthorized') };
const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw Errors.Unauthorized();
});

// 3. Define capabilities — typed pure functions
const cap     = capability.withContext<Awaited<ReturnType<typeof buildContext>>>();
const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }) => ({ id, name: 'Alice' }),
  'query',
).guard(mustBeUser);

// 4. Create the server
createServer({
  context:      buildContext,
  capabilities: { users: { getUser } },
  transports:   [restTransport({ port: 3000 })],
}).start();
// → GET /users/:id
```

## Capability

A capability wraps a resolver function with optional input/output schemas:

```ts
// No schema — no input validation
const ping = capability(() => 'pong');

// With input schema — validates and infers types
const greet = capability(
  z.object({ name: z.string() }),
  ({ name }) => `Hello, ${name}`,
);

// With output schema — validates resolver return value in development
const getMetrics = capability(
  z.object({ window: z.enum(['1h', '24h']) }),
  fetchMetrics,
).output(MetricsSchema);

// With explicit intent (overrides name-based inference)
const searchUsers = capability(
  z.object({ q: z.string() }),
  ({ q }) => db.users.search(q),
  'query',
);
```

Capabilities are **immutable**. `.guard()`, `.enhance()`, and `.output()` each return a new instance:

```ts
const adminOnly = greet.guard(mustBeAdmin);
const cached    = getMetrics.enhance(withCache(60));
```

### Context-typed factory

Use `capability.withContext<TContext>()` to bind the factory to your application context type. Define it once, import everywhere:

```ts
// src/capabilities.ts
import { capability } from 'capix';
import type { AppContext } from './context.js';

export const cap = capability.withContext<AppContext>();
```

For capabilities that require a logged-in user, define a second factory with a narrowed context:

```ts
type AuthContext = AppContext & { user: NonNullable<AppContext['user']> };

export const cap     = capability.withContext<AppContext>();   // public endpoints
export const authCap = capability.withContext<AuthContext>();  // authenticated endpoints
```

Without `withContext`, `ctx` is typed as `BaseContext` (only `requestId`).

### Internal composition with `.resolve()`

Call one capability from inside another. Guards re-run — this is intentional and safe:

```ts
export const getPost = cap(z.object({ id: z.string() }), async ({ id }) => {
  const post = await db.posts.find(id);
  if (!post) throw Errors.NotFound();
  return post;
}, 'query').guard(mustBeUser);

export const updatePost = cap(z.object({ id: z.string(), title: z.string() }), async ({ id, title }, ctx) => {
  const post = await getPost.resolve({ id }, ctx); // guards re-run
  return db.posts.update(id, { title });
}, 'update').guard(mustBeUser);
```

## Guards

Guards run before the resolver and throw to reject the request:

```ts
import { defineGuard, defineError } from 'capix';

const Errors = { Forbidden: defineError(403, 'Forbidden') };

const mustBeAdmin = defineGuard((ctx) => {
  if (ctx.user?.role !== 'admin') throw Errors.Forbidden();
});

// Multiple guards run in order; first failure stops execution
const adminCap = capability(schema, handler)
  .guard(mustBeLoggedIn)
  .guard(mustBeAdmin);
```

**Input guards** run after input validation and receive both `(input, ctx)`:

```ts
import { defineInputGuard } from 'capix';

const mustOwnResource = defineInputGuard((input: { id: string }, ctx) => {
  if (input.id !== ctx.user?.id) throw Errors.Forbidden();
});
```

## Errors

```ts
import { defineError, defaultErrors } from 'capix';

// Define application-specific errors
const Errors = {
  NotFound:     defineError(404, 'Not found'),
  OutOfStock:   defineError(409, 'Out of stock'),
  // Explicit code — predictable, easy to test:
  NotPurchased: defineError(403, 'You can only review products you have purchased', 'NotPurchased'),
};

// Use built-in errors
throw defaultErrors.Unauthorized();
throw defaultErrors.NotFound({ detail: 'User not found' });

// Use custom errors
throw Errors.OutOfStock({ productId: '123' });
```

The error code in responses is derived from the message (`'Not found'` → `'NotFound'`) unless you pass a third argument. Errors are serialized as:

```json
{ "error": "NotFound", "message": "Not found" }
```

with the given HTTP status code.

## Enhancers

Enhancers wrap the resolver for cross-cutting concerns:

```ts
import { withCache, withRateLimit, withCircuitBreaker, withTimeout, withRetry, withMetrics } from 'capix';

const robustCap = capability(schema, handler)
  .enhance(withCache(30))
  .enhance(withRateLimit({ max: 100, windowMs: 60_000 }))
  .enhance(withCircuitBreaker({ failureThreshold: 5, successThreshold: 2, timeoutMs: 30_000 }))
  .enhance(withTimeout(5000))
  .enhance(withRetry(3, 200));
```

| Enhancer | Options | Description |
|---|---|---|
| `withCache(ttlSeconds)` | `number` | In-memory cache keyed by capability name + serialized input |
| `withRateLimit(opts)` | `{ max, windowMs }` | Sliding window rate limiter |
| `withCircuitBreaker(opts)` | `{ failureThreshold, successThreshold, timeoutMs }` | Opens after N failures; resets after timeout |
| `withTimeout(ms)` | `number` | Rejects after N milliseconds with `504 Timeout` |
| `withRetry(n, delayMs?)` | `number, number` | Retries on non-FrameworkError failures with backoff |
| `withRollback` | — | Enables `ctx.onRollback(fn)` for compensating failed multi-step mutations |
| `withMetrics(collector)` | `MetricsCollector` | Emits duration and success/error metrics |
| `withLogging` | — | Logs capability name, duration, and outcome |

## Context

Context is built once per request and passed to every guard and resolver:

```ts
import { defineContext } from 'capix';

const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user:      await verifyToken(req.headers.authorization),
  db,
}));
```

The `req` argument is `{ headers: Record<string, string | string[] | undefined> }`. Use `getHeader(req, 'authorization')` for safe string access.

## Plugins

Plugins encapsulate capabilities and context extensions:

```ts
import { definePlugin } from 'capix';

const tenantPlugin = definePlugin({
  capabilities: { users: { getUser, createUser } },
  context: (base) => ({ ...base, tenantId: 'default' }),
});

createServer({
  plugins:    [tenantPlugin, loggingPlugin],
  transports: [restTransport({ port: 3000 })],
}).start();
```

## Event bus

Typed pub/sub for broadcasting events from REST capabilities to WebSocket clients:

```ts
import { createEventBus } from 'capix';

type AppEvents = {
  'order:paid':   { orderId: string; amount: number };
  'task:updated': { id: string; status: string };
};

export const eventBus = createEventBus<AppEvents>();

// Publish from any capability or anywhere in your app
eventBus.publish('order:paid', { orderId: '123', amount: 99 });

// Subscribe server-side
const unsub = eventBus.subscribe('order:paid', (data) => {
  console.log('Order paid:', data.orderId);
});
unsub(); // unsubscribe
```

Pass `eventBus` to `wsTransport({ eventBus })` to forward published events to subscribed WS clients.

## Exports

### Factories

| Export | Description |
|---|---|
| `capability()` | Create a capability |
| `capability.withContext<T>()` | Create a scoped factory with a pre-bound context type |
| `defineContext(fn)` | Define a context builder |
| `defineGuard(fn)` | Define a guard |
| `defineGuardFor<T>()` | Define a narrowing guard (asserts ctx is T) |
| `defineInputGuard(fn)` | Define an input guard (runs after validation, receives input + ctx) |
| `defineError(status, message, code?)` | Define a typed error factory |
| `defineEnhancer(fn)` | Define a capability enhancer |
| `definePlugin(plugin)` | Define a plugin |
| `defineConfig(config)` | Define server config with type inference |
| `createServer(config)` | Create a server |
| `createEventBus<TEvents>()` | Create a typed event bus |

### Built-in enhancers

| Export | Description |
|---|---|
| `withCache(ttlSeconds)` | In-memory output cache |
| `withRateLimit(options)` | Sliding window rate limiter |
| `withCircuitBreaker(options)` | Circuit breaker (closed / open / half-open) |
| `withTimeout(ms)` | Cancel after N milliseconds |
| `withRetry(maxAttempts, delayMs?)` | Retry on non-framework failures with backoff |
| `withRollback` | Compensation registry for multi-step mutations |
| `withMetrics(collector)` | Record timing and outcome metrics |
| `withLogging` | Log capability name, duration, and outcome |
| `consoleMetricsCollector` | Default `MetricsCollector` that logs to console |

### Utilities

| Export | Description |
|---|---|
| `isCapability(v)` | Type guard for capabilities |
| `isFrameworkError(v)` | Type guard for FrameworkErrors |
| `inferIntent(key)` | Infer capability intent from a key name |
| `compileRegistry(capabilities)` | Compile a group tree into a flat registry |
| `getHeader(req, name)` | Safe header access from `RawRequest` |
| `defaultErrors` | Built-in error factories: `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `TooManyRequests`, `Internal`, `Timeout` |
| `runGuards` / `runInputGuards` | Run guard arrays (used by custom transports) |
| `createExecutionEngine(options)` | Create a capability execution engine |
| `mergePlugins(plugins)` | Merge a plugin array into a single plugin |

### Types

`Capability<TInput, TOutput, TContext>`, `AnyCapability`, `BaseContext`, `ContextBuilder`,
`RawRequest`, `Guard`, `NarrowingGuard`, `InputGuard`, `AnyGuard`, `NarrowContext`,
`Enhancer`, `Resolver`, `Plugin`, `MergedPlugins`, `Intent`, `InferInput<Cap>`,
`InferOutput<Cap>`, `InferContext<Cap>`, `GroupTree`, `CapabilityRegistry`,
`ScopedCapabilityFactory`, `FrameworkError`, `ErrorFactory`, `WithRollback<T>`,
`MetricsCollector`, `CircuitBreakerOptions`, `RateLimitOptions`, `Transport`,
`TransportWithCapabilities`, `MountOptions`, `ServerConfig`, `Server`,
`EventBus<TEvents>`, `EventMap`, `SubscribeOptions`, `InvokeFn`, `CapabilityRequest`,
`CapabilityResponse`

## License

MIT
