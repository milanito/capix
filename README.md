# Capix

A capability-based Node.js server framework. Replace routes and middleware with a single primitive: a **capability** — a typed, composable pure function that declares what your server can do.

```ts
import { z } from 'zod';
import { capability, defineGuard, createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';

const mustBeAdmin = defineGuard((ctx) => {
  if (!ctx.user?.admin) throw new Error('Forbidden');
});

const createPost = capability(
  z.object({ title: z.string(), body: z.string() }),
  async ({ title, body }, ctx) => db.posts.create({ title, body, authorId: ctx.user.id }),
).guard(mustBeAdmin);

createServer({
  capabilities: { posts: { createPost } },
  transports: [restTransport({ port: 3000 })],
}).start();
// POST /posts  ← inferred from capability name
```

No `req`/`res`. No `next()`. No middleware stack. The HTTP layer is an optional transport.

## Why capabilities?

| Traditional | Capix |
|---|---|
| Routes scatter business logic | Capabilities are pure functions — testable without a server |
| Middleware is implicit and ordered | Guards are explicit, typed, and chainable |
| Cross-cutting concerns require middleware | Enhancers wrap the resolver directly |
| Type safety stops at the controller | Input/output schemas validate at runtime and infer TypeScript types |
| Every route file imports `Request`/`Response` | Zero framework imports in your domain code |

## Packages

| Package | Description |
|---|---|
| [`@capixjs/core`](packages/core) | Core framework — `capability`, `createServer`, guards, enhancers, event bus |
| [`@capixjs/transport-rest`](packages/transports/rest) | HTTP/1.1 REST transport with automatic route inference |
| [`@capixjs/transport-ws`](packages/transports/ws) | WebSocket transport for real-time capabilities and server push |
| [`@capixjs/transport-graphql`](packages/transports/graphql) | GraphQL transport with auto-generated schema and GraphiQL playground |
| [`@capixjs/transport-queue`](packages/transports/queue) | Queue transport for background jobs via BullMQ, SQS, or any adapter |
| [`@capixjs/plugin-auth`](packages/plugins/auth) | JWT authentication — `jwtContextBuilder`, `createJWTHelpers`, `mustBeAuthenticated` |
| [`@capixjs/plugin-cors`](packages/plugins/cors) | CORS plugin |
| [`@capixjs/plugin-helmet`](packages/plugins/helmet) | Security headers plugin |
| [`@capixjs/plugin-logging`](packages/plugins/logging) | Structured request logging via pino |
| [`@capixjs/testing`](packages/testing) | Test utilities — `mockContext`, `testServer` |

## Quick start

```bash
npm install @capixjs/core @capixjs/transport-rest zod@^4
```

```ts
import { z } from 'zod';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';

// --- Errors ---
const Errors = {
  NotFound: defineError(404, 'Not found'),
  Forbidden: defineError(403, 'Forbidden'),
};

// --- Context ---
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: await verifyToken(req.headers.authorization),
}));

// --- Guards ---
const mustBeLoggedIn = defineGuard((ctx) => {
  if (!ctx.user) throw Errors.Forbidden();
});

// --- Capabilities ---
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw Errors.NotFound();
    return user;
  },
).guard(mustBeLoggedIn);

const createUser = capability(
  z.object({ name: z.string(), email: z.string().email() }),
  async (input) => db.users.create(input),
);

// --- Server ---
createServer({
  context: buildContext,
  capabilities: { users: { getUser, createUser } },
  transports: [restTransport({ port: 3000 })],
}).start();
// GET  /users/:id   ← getUser
// POST /users       ← createUser
```

## Typing your context

Every real Capix app has app-specific context (database connection, current user, logger). Use `capability.withContext<YourContext>()` to create a factory pre-typed for your context — define it once, import it everywhere:

```ts
// src/capabilities.ts — define once
import { capability } from '@capixjs/core';
import type { AppContext } from './context.js';

export const cap = capability.withContext<AppContext>();
```

```ts
// src/capabilities/users/get.ts — import and use
import { cap } from '../../capabilities.js';

export const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => {
    // ctx.user, ctx.db — all typed correctly, no annotation needed
    const user = await ctx.db.users.findById(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
).guard(mustBeUser);
```

Without `withContext`, `ctx` is typed as `BaseContext` (only `requestId`).

**Authenticated capabilities** — create a second factory for capabilities that require a logged-in user:

```ts
// After mustBeUser runs, ctx.user is non-null.
// Use authCap to express this in the resolver's type.
type AuthContext = AppContext & { user: NonNullable<AppContext['user']> };

export const cap     = capability.withContext<AppContext>();   // public endpoints
export const authCap = capability.withContext<AuthContext>();  // authenticated endpoints

// ctx.user is User (not User | null) — no null check needed
export const getProfile = authCap(z.object({}), async (_, ctx) => ctx.user, 'query')
  .guard(mustBeUser);
```

> **Note:** TypeScript cannot retroactively narrow the resolver's `ctx` from guards added via `.guard()`. The `authCap` pattern pre-types the resolver instead. See [docs/ts-workarounds.md](./docs/ts-workarounds.md) for details.

## Core concepts

### Capabilities

A capability wraps a resolver function with optional input/output schemas:

```ts
// No schema — accepts any input
const ping = capability(() => 'pong');

// With input schema — validates and infers types automatically
const greet = capability(
  z.object({ name: z.string() }),
  ({ name }) => `Hello, ${name}`,
);

// With output schema — validates resolver return value
const getMetrics = capability(
  z.object({ window: z.enum(['1h', '24h']) }),
  fetchMetrics,
).output(MetricsSchema);
```

Capabilities are **immutable**. `.guard()` and `.enhance()` return new instances:

```ts
const adminOnly = greet.guard(mustBeAdmin);       // new capability
const cached = getMetrics.enhance(withCache(60)); // new capability
```

### Guards

Guards run before the resolver and throw to reject the request:

```ts
const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw Errors.Unauthorized();
  // TypeScript narrows ctx.user as non-null after this point
});

// Multiple guards run in order; first failure stops execution
const cap = capability(schema, handler)
  .guard(mustBeLoggedIn)
  .guard(mustBeAdmin);
```

### Enhancers

Enhancers wrap the resolver for cross-cutting concerns:

```ts
import { withCache, withRateLimit, withCircuitBreaker, withTimeout, withMetrics } from '@capixjs/core';

const robustCap = capability(schema, handler)
  .enhance(withCache(30))              // cache for 30 seconds
  .enhance(withRateLimit({ max: 100, windowMs: 60_000 }))
  .enhance(withCircuitBreaker({ threshold: 5, resetMs: 30_000 }))
  .enhance(withTimeout(5000));
```

### HTTP route inference

The REST transport infers routes from capability names. No annotations required:

| Capability name | Route |
|---|---|
| `getUser` | `GET /users/:id` |
| `listUsers` | `GET /users` |
| `createUser` | `POST /users` |
| `updateUser` | `PATCH /users/:id` |
| `replaceUser` | `PUT /users/:id` |
| `deleteUser` | `DELETE /users/:id` |
| `uploadAvatar` | `POST /users/uploadAvatar` |

To override a route, pass `overrides` to `restTransport` — routing is a transport concern and does not belong in capability definitions:

```ts
restTransport({
  port: 3000,
  overrides: {
    'tasks.listTasks': { method: 'GET', path: '/projects/:projectId/tasks' },
  },
})
```

### Plugins

Group related capabilities and context extensions into reusable plugins:

```ts
import { definePlugin } from '@capixjs/core';

const authPlugin = definePlugin({
  capabilities: { users: { getUser, createUser } },
  context: (base) => ({ ...base, isPlugin: true }),
});

createServer({
  plugins: [authPlugin],
  transports: [restTransport({ port: 3000 })],
}).start();
```

## Nested resource routes

For URLs like `/projects/:projectId/tasks`, pass `overrides` to `restTransport` — the inference engine handles flat groups but not hierarchies:

```ts
// src/capabilities/tasks/list.ts — no routing info here
const listTasks = capability(
  z.object({
    projectId: z.string(),
    page:      z.coerce.number().default(1),
    status:    z.enum(['todo', 'done']).optional(),
  }),
  async ({ projectId, page, status }, ctx) => {
    return ctx.db.tasks.list({ projectId, page, status });
  },
  'query',
).guard(mustBeUser);
```

```ts
// src/server.ts — routing lives here
restTransport({
  port: 3000,
  overrides: {
    'tasks.listTasks': { method: 'GET', path: '/projects/:projectId/tasks' },
  },
})
```

The REST transport merges URL params, query string, and body into a single typed input object. See [`examples/nested-routes`](./examples/nested-routes) for a full working example.

## Transport-specific capabilities

By default, all capabilities are available on all transports. Pass `capabilities` directly to a transport to expose only a subset:

```ts
const publicAPI = { items: { list: listItems, get: getItem } };
const memberAPI = { items: { create: createItem, update: updateItem } };
const jobsOnly  = { jobs:  { processItem, generateReport } };

createServer({
  context: buildContext,
  transports: [
    // REST and GraphQL expose public + member capabilities
    restTransport({ port: 3000, capabilities: { ...publicAPI, ...memberAPI } }),
    graphqlTransport({ port: 4000, capabilities: { ...publicAPI, ...memberAPI } }),

    // Queue only processes background jobs — never gets an HTTP endpoint
    queueTransport({ queues: ['jobs'], adapter, capabilities: jobsOnly }),
  ],
});
```

Capabilities are plain objects — pass the same reference to multiple transports to share them without duplication.

### Top-level default

Providing `capabilities` at the top level sets the default for all transports that don't specify their own:

```ts
createServer({
  context:      buildContext,
  capabilities: publicAPI,              // default for REST + GraphQL
  transports: [
    restTransport({ port: 3000 }),      // uses publicAPI
    graphqlTransport({ port: 4000 }),   // uses publicAPI
    queueTransport({
      queues:       ['jobs'],
      adapter,
      capabilities: jobsOnly,           // overrides publicAPI for queue only
    }),
  ],
});
```

If every transport specifies its own `capabilities`, the top-level field can be omitted entirely. Capix throws at startup if a transport has no capabilities and no server-level default is provided.

## Real-time updates

The WebSocket transport is request/response. For server-push (broadcasting mutations to connected WS clients), use a module-level `EventEmitter`:

```ts
// src/events.ts — shared event bus
import { EventEmitter } from 'node:events';
export const taskEvents = new EventEmitter();

// src/capabilities/tasks/update.ts — emit after mutation
export const updateTask = authCap(Input, async ({ id, ...data }, ctx) => {
  const task = await ctx.db.tasks.update(id, data);
  taskEvents.emit('task.updated', { taskId: id, data: task });
  return task;
}, 'update').guard(mustBeUser);
```

See [`examples/realtime`](./examples/realtime) for the complete broadcast pattern.

## Known TypeScript limitation

Guard type narrowing applies to subsequent guards in the chain, but TypeScript cannot retroactively narrow the resolver's `ctx` parameter based on guards added via `.guard()`. Use `capability.withContext<AuthContext>()` as the workaround.

See [docs/ts-workarounds.md](./docs/ts-workarounds.md) for a full explanation, the two-factory pattern, and what a future fix would look like.

## Performance

Capix's REST transport trails Fastify by ~3% in a hello-world microbenchmark and beats Hono by ~19%. Zod validation and the capability dispatch pipeline add ~270ns/request relative to a bare handler. See [docs/benchmarks.md](docs/benchmarks.md) for the full results and methodology.

| Framework | req/s (hello world) | req/s (auth + guard) |
|---|---|---|
| Fastify | 29,531 | 27,899 |
| **Capix** | **28,488** | **27,102** |
| Hono | 23,970 | 21,365 |
| Express | 16,632 | 16,239 |

## 511 tests passing

```
pnpm -r test  →  511 tests, 0 failures
```

## CLI

```bash
npm install -g @capixjs/cli
```

| Command | Description |
|---|---|
| `capix new <name>` | Scaffold a new project |
| `capix dev` | Start dev server with file watching |
| `capix list` | List all registered capabilities |
| `capix docs` | Print capability docs as Markdown |
| `capix generate capability <group> <name>` | Generate a capability file |
| `capix client` | Generate a typed fetch client |
| `capix openapi` | Generate an OpenAPI 3.1 spec |

See [docs/cli.md](docs/cli.md) for all commands.

## Documentation

- [Quick start](docs/guide/quick-start.md)
- [Capabilities](docs/guide/capabilities.md)
- [Guards](docs/guide/guards.md)
- [Context](docs/guide/context.md)
- [Errors](docs/guide/errors.md)
- [Enhancers](docs/guide/enhancers.md)
- [Plugins](docs/guide/plugins.md)
- [Testing](docs/guide/testing.md)
- [Transports overview](docs/transports/overview.md)
- [REST transport](docs/transports/rest.md)
- [WebSocket transport](docs/transports/websocket.md)
- [GraphQL transport](docs/transports/graphql.md)
- [Queue transport](docs/transports/queue.md)
- [Patterns: auth](docs/patterns/auth.md)
- [Patterns: composition](docs/patterns/composition.md)
- [Patterns: real-time](docs/patterns/real-time.md)
- [Patterns: multi-step mutations](docs/patterns/multi-step.md)
- [Migration from Express](docs/migration/from-express.md)
- [CLI reference](docs/cli.md)
- [API reference](docs/api/index.md)

## Examples

| Example | Description |
|---|---|
| [`examples/basic-rest`](examples/basic-rest) | CRUD API with REST transport |
| [`examples/with-auth`](examples/with-auth) | JWT auth, role-based guards |
| [`examples/nested-routes`](examples/nested-routes) | Nested resource routes with `http` override |
| [`examples/realtime`](examples/realtime) | EventEmitter broadcast pattern for WS push |
| [`examples/file-upload`](examples/file-upload) | Multipart file upload |
| [`examples/pagination`](examples/pagination) | Query string coercion, filters, sorting |
| [`examples/jwt-auth`](examples/jwt-auth) | Full JWT auth flow |

## Testing

`@capixjs/testing` provides helpers to test capabilities without a running server:

```ts
import { mockContext, testServer } from '@capixjs/testing';

// Unit test: invoke capability directly (no server needed)
const ctx = mockContext({ user: { id: '1', admin: true } });
const result = await getUser.resolve({ id: '1' }, ctx);
expect(result.name).toBe('Alice');

// Integration test: real execution engine, no HTTP server
const server = testServer({
  context: buildContext,
  capabilities: { users: { getUser } },
});

const response = await server.call({
  capability: 'users.getUser',
  input: { id: '1' },
  headers: { authorization: 'Bearer test-token' },
});
expect(response.ok).toBe(true);
expect(response.status).toBe(200);
```

## Development

```bash
pnpm install
pnpm -r build          # build all packages
pnpm -r test           # run all tests
pnpm -r typecheck      # typecheck all packages
```

```bash
# Run a specific package
cd packages/core
pnpm test
pnpm typecheck
```

## License

MIT
