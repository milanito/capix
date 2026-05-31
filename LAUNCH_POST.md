# Capix — Introducing a capability-based Node.js framework

Capix is a TypeScript-first server framework built around a single primitive: the **capability**.

Every handler is a typed unit with an input schema, output schema, guards, and enhancers — defined once, accessible everywhere.

```ts
import { capability, createServer, defineContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { z } from 'zod';

const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  token: req.headers['authorization']?.replace('Bearer ', ''),
}));

const getUser = capability(
  z.object({ id: z.string() }),
  async (input, ctx) => db.users.find(input.id),
);

const server = createServer({
  context: buildContext,
  capabilities: { users: { getUser } },
  transports: [restTransport({ port: 3000 })],
});

await server.start();
// → GET /users/:id is live
```

## What makes it different

**Type-safe end to end.** Input schemas are Zod — the resolver's `input` parameter is automatically inferred. Guards narrow the context type. The CLI generates a typed fetch client from your live capabilities.

**Capability-first.** A `capability` is an object you pass around, test directly, and compose with enhancers — not a route string, not a controller method. Testing is just calling `.resolve()`.

```ts
// No HTTP server needed
const result = await getUser.resolve({ id: '1' }, mockContext);
expect(result.name).toBe('Alice');
```

**Progressive.** Start with a plain resolver. Add input validation, guards, caching, and rate limiting as enhancers — each one wraps the previous, none require framework changes.

**CLI included.** `capix new my-app` scaffolds a project. `capix client` generates a typed fetch client. `capix list` shows every registered capability with its inferred HTTP route.

---

## Performance

Benchmarked with autocannon, 100 connections, 10-second window on Linux/Node.js 25.

| | Capix | Express | Hono | Fastify |
|---|---|---|---|---|
| Hello world | 28,488 | 16,632 | 23,970 | 29,531 |
| Zod validation | 26,097 | 16,733 | 23,482 | 28,353 |
| Auth + JWT guard | 27,102 | 16,239 | 21,365 | 27,899 |

Faster than Express by ~67% across all scenarios.
Faster than Hono by 19–27% across all scenarios.
Within 3–8% of Fastify — and within 3% on auth+guard, the scenario
that represents real production APIs.

The Zod vs Ajv gap: Capix uses Zod for end-to-end TypeScript type inference.
Fastify uses Ajv with JSON Schema — faster for validation, but requires
separate type declarations. The ~3–8% gap is the measurable cost of not
having to write types twice.

**Caveats:** benchmark servers use `timeout: false` (production adds ~6%).
Capix runs TypeScript source via tsx — compiled JS would close the Fastify
gap by another 2–3%. See [benchmarks/README.md](benchmarks/README.md) for
full methodology.

---

## Core concepts

### Capabilities

```ts
// No input
const ping = capability(() => ({ pong: true }));

// Zod input schema — resolver input is typed automatically
const createPost = capability(
  z.object({ title: z.string(), body: z.string() }),
  async (input, ctx) => db.posts.create(input),
);
```

### Guards

Guards run before the resolver. Narrowing guards update the context type so the resolver knows the user is authenticated.

```ts
const mustBeUser = defineGuard((ctx: AppContext): asserts ctx is AppContext & { user: User } => {
  if (!ctx.user) throw defaultErrors.Unauthorized();
});

const getProfile = capability(async (_, ctx) => ctx.user.profile)
  .guard(mustBeUser);
// ctx.user is now typed and safe inside the resolver
```

### Enhancers

Enhancers wrap a capability's resolver without changing its type. Chain them freely.

```ts
const getExpensiveData = capability(schema, resolver)
  .enhance(withCache(60))       // cache 60s
  .enhance(withTimeout(5000))   // 5s timeout → 504
  .enhance(withRateLimit({ limit: 100, windowMs: 60_000 }));
```

### Plugins

Plugins extend the context and contribute capabilities — useful for auth, logging, tracing.

```ts
const authPlugin = definePlugin({
  name: 'auth',
  context: async (base, req) => ({
    ...base,
    user: await verifyToken(req.headers['authorization']),
  }),
});

createServer({ ..., plugins: [authPlugin] });
// ctx.user is available in every resolver
```

---

## Install

```bash
npm install @capixjs/core @capixjs/transport-rest

# or scaffold a new project:
npx @capixjs/cli new my-app
```

**Alpha status:** API is stable enough to build on; some edges are still rough.
Breaking changes will be noted in CHANGELOG.md. Not recommended for production yet.

---

## Links

- [GitHub](https://github.com/your-org/capix)
- [Benchmarks](benchmarks/README.md)
- [Examples](examples/)
- [Changelog](packages/core/CHANGELOG.md)
