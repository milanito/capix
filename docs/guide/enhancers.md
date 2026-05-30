# Enhancers

Enhancers wrap the resolver to add cross-cutting behavior — caching, rate limiting, retries, circuit breaking, and observability. Apply them with `.enhance()`.

```ts
import { withCache, withRateLimit, withTimeout } from 'capix';

const getUser = cap(schema, handler, 'query')
  .enhance(withCache(30))
  .enhance(withRateLimit({ max: 100, windowMs: 60_000 }))
  .enhance(withTimeout(5000));
```

Each `.enhance()` call returns a new capability. Enhancers compose outward: the outermost enhancer runs first.

---

## `withCache(ttlSeconds)`

In-memory output cache. The cache key is `capabilityName:JSON.stringify(input)`.

```ts
const getProduct = cap(z.object({ id: z.string() }), fetchProduct, 'query')
  .enhance(withCache(60)); // cache for 60 seconds
```

**Note:** The cache is local to the process and is not shared across instances. For distributed caching, write a custom enhancer that reads from Redis.

**Note:** The cache does not respect context. Two users calling `getUser({ id: '1' })` will get the same cached result. If the output is user-specific, do not use `withCache` — or include a user identifier in the input.

---

## `withRateLimit({ max, windowMs })`

Sliding window rate limiter. State is per-capability, local to the process.

```ts
const sendEmail = cap(schema, handler)
  .enhance(withRateLimit({ max: 10, windowMs: 60_000 })); // 10 calls per minute
```

When the limit is exceeded, throws `429 TooManyRequests`.

**Note:** Like `withCache`, the limiter state is in-memory and per-process. Use a shared store for distributed rate limiting.

---

## `withCircuitBreaker({ failureThreshold, successThreshold, timeoutMs })`

Opens after `failureThreshold` non-framework errors, blocking all calls. After `timeoutMs` milliseconds, transitions to half-open and allows one probe. If it succeeds `successThreshold` times in a row, the breaker closes.

```ts
const callPaymentAPI = cap(schema, handler)
  .enhance(withCircuitBreaker({
    failureThreshold: 5,   // open after 5 failures
    successThreshold: 2,   // close after 2 successes in half-open
    timeoutMs: 30_000,     // try again after 30s
  }));
```

When the circuit is open, throws `503 Service Unavailable`.

**Note:** `FrameworkError` instances (from `defineError`) do not count toward the failure threshold — only unexpected errors do.

---

## `withTimeout(ms)`

Rejects if the resolver does not complete within `ms` milliseconds. Throws `504 Timeout`.

```ts
const getExternalData = cap(schema, handler)
  .enhance(withTimeout(5000)); // 5 second limit
```

---

## `withRetry(maxAttempts, delayMs?)`

Retries the resolver on failure, with exponential backoff. Does not retry `FrameworkError` instances — only unexpected errors.

```ts
const syncCatalog = cap(schema, handler)
  .enhance(withRetry(3, 100)); // 3 attempts, 100ms initial delay (doubles each retry)
```

---

## `withRollback`

Enables `ctx.onRollback(fn)` inside the resolver. If the resolver throws, all registered rollback functions are called in reverse order.

```ts
import { withRollback } from 'capix';

const checkout = authCap(z.object({}), async (_, ctx) => {
  const order = await ctx.db.orders.create({ userId: ctx.user.id });
  ctx.onRollback(() => ctx.db.orders.delete(order.id));

  await ctx.db.inventory.reserve(order.items);
  ctx.onRollback(() => ctx.db.inventory.release(order.items));

  return order;
}, 'mutation').guard(mustBeUser).enhance(withRollback);
```

`withRollback` is not a database transaction. It does not provide atomicity, isolation, or durability. It is suitable for in-memory stores or operations where each step can be independently reversed. For real databases, use a transaction.

See [patterns/multi-step.md](../patterns/multi-step.md) for the full pattern.

---

## `withMetrics(collector)`

Emits a histogram measurement and a success/error increment after each call.

```ts
import { withMetrics, consoleMetricsCollector } from 'capix';

const getUser = cap(schema, handler)
  .enhance(withMetrics(consoleMetricsCollector));
```

Implement `MetricsCollector` to send metrics to DataDog, StatsD, Prometheus, or any backend:

```ts
import type { MetricsCollector } from 'capix';

const statsdCollector: MetricsCollector = {
  increment(name, tags) { statsd.increment(name, tags); },
  histogram(name, value, tags) { statsd.histogram(name, value, tags); },
};
```

---

## `withLogging`

Logs the capability name, duration, and outcome. Uses `ctx.logger` if present, otherwise falls back to `console.info` / `console.error`.

```ts
const getUser = cap(schema, handler).enhance(withLogging);
```

For structured logging, provide a `logger` in your context:

```ts
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: await verifyToken(req.headers.authorization),
  logger: pino({ level: 'info' }),
}));
```

---

## Writing custom enhancers

```ts
import { defineEnhancer } from 'capix';

const withRequestId = defineEnhancer((cap) => ({
  ...cap,
  resolve: async (input: unknown, ctx: Record<string, unknown>) => {
    const result = await (cap as AnyCapability)._resolverOnly(input, ctx);
    return { ...result, requestId: ctx['requestId'] };
  },
}));
```

`defineEnhancer` is a pass-through for type inference — it constrains the function signature so TypeScript accepts the result as `Enhancer`.
