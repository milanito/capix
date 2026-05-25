# capix

The core of the Capix framework. Provides the `capability` primitive, guards, enhancers, server, plugins, and context.

## Install

```bash
npm install capix zod
```

## Capability

```ts
import { z } from 'zod';
import { capability, defineError } from 'capix';

const Errors = { NotFound: defineError(404, 'Not found') };

const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw Errors.NotFound();
    return user;
  },
);
```

The first argument is an optional Zod schema. If provided, input is validated before the resolver runs. TypeScript types are inferred — no separate type annotation needed.

## Guards

Guards run before the resolver. Throw to reject:

```ts
import { defineGuard, defineError } from 'capix';

const Errors = { Forbidden: defineError(403, 'Forbidden') };

const mustBeAdmin = defineGuard((ctx) => {
  if (!ctx.user?.admin) throw Errors.Forbidden();
});

const adminCap = capability(schema, handler).guard(mustBeAdmin);
```

Guards are **additive** — each `.guard()` call appends to the chain. They receive the context after `buildContext` runs.

## Enhancers

Enhancers wrap the resolver:

```ts
import { withCache, withRateLimit, withCircuitBreaker, withTimeout, withMetrics } from 'capix';

const cap = capability(schema, handler)
  .enhance(withCache(30))                              // 30-second cache
  .enhance(withRateLimit({ max: 100, windowMs: 60_000 }))
  .enhance(withCircuitBreaker({ threshold: 5, resetMs: 30_000 }))
  .enhance(withTimeout(5000));
```

Built-in enhancers:

| Enhancer | Description |
|---|---|
| `withCache(ttlSeconds)` | In-memory cache keyed by `name:JSON.stringify(input)` |
| `withRateLimit(opts)` | Sliding window rate limiter |
| `withCircuitBreaker(opts)` | Opens after N failures, resets after `resetMs` |
| `withTimeout(ms)` | Rejects if resolver takes longer than `ms` |
| `withMetrics(collector)` | Calls `collector.record(event)` on each invocation |

## Context

Context is built once per request and passed to guards and resolvers:

```ts
import { defineContext } from 'capix';

const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: await verifyToken(req.headers.authorization),
}));
```

The `req` argument is a minimal `{ headers: Record<string, string | string[]> }`. Your `buildContext` function can call any async operation to produce the context object.

## Errors

```ts
import { defineError } from 'capix';

const NotFound = defineError(404, 'Not found');
const Unauthorized = defineError(401, 'Unauthorized');

// Throw from guards or resolvers:
throw NotFound();
throw NotFound({ detail: 'User not found' });
```

`defineError(status, code)` returns a factory. Thrown errors are caught by the execution engine and serialized as `{ error: { code, message, ...rest } }` with the given HTTP status.

## Server

```ts
import { createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';

const server = createServer({
  context: buildContext,
  capabilities: {
    users: { getUser, createUser, updateUser, deleteUser },
    posts: { listPosts, getPost },
  },
  transports: [restTransport({ port: 3000 })],
});

await server.start();
// ...
await server.stop();
```

## Plugins

```ts
import { definePlugin } from 'capix';

const authPlugin = definePlugin({
  capabilities: { users: { getUser, createUser } },
  context: (base) => ({ ...base, tenantId: 'default' }),
});

createServer({
  plugins: [authPlugin, loggingPlugin],
  transports: [restTransport({ port: 3000 })],
}).start();
```

## License

MIT
