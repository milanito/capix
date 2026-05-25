# Capix

A capability-based Node.js server framework. Replace routes and middleware with a single primitive: a **capability** — a typed, composable pure function that declares what your server can do.

```ts
import { z } from 'zod';
import { capability, defineGuard, createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';

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
| [`capix`](packages/core) | Core framework — `capability`, `createServer`, guards, enhancers |
| [`capix-transport-rest`](packages/transports/rest) | HTTP/1.1 REST transport with automatic route inference |
| [`capix-transport-ws`](packages/transports/ws) | WebSocket transport for real-time capabilities |
| [`capix-testing`](packages/testing) | Test utilities — `mockContext`, `testServer` |
| [`capix-plugin-cors`](packages/plugins/cors) | CORS plugin |
| [`capix-plugin-helmet`](packages/plugins/helmet) | Security headers plugin |
| [`capix-plugin-logging`](packages/plugins/logging) | Structured request logging via pino |

## Quick start

```bash
npm install capix capix-transport-rest zod
```

```ts
import { z } from 'zod';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from 'capix';
import { restTransport } from 'capix-transport-rest';

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
import { withCache, withRateLimit, withCircuitBreaker, withTimeout, withMetrics } from 'capix';

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

Override with `{ http: { method, path } }` when needed.

### Plugins

Group related capabilities and context extensions into reusable plugins:

```ts
import { definePlugin } from 'capix';

const authPlugin = definePlugin({
  capabilities: { users: { getUser, createUser } },
  context: (base) => ({ ...base, isPlugin: true }),
});

createServer({
  plugins: [authPlugin],
  transports: [restTransport({ port: 3000 })],
}).start();
```

## CLI

```bash
npm install -g capix-cli
```

| Command | Description |
|---|---|
| `capix docs` | Print capability docs as Markdown |
| `capix show <name>` | Show a single capability's schema |
| `capix list` | List all registered capabilities |
| `capix routes` | Show HTTP route table |

## Examples

| Example | Description |
|---|---|
| [`examples/basic-rest`](examples/basic-rest) | CRUD API with REST transport |
| [`examples/with-auth`](examples/with-auth) | JWT auth, role-based guards |

## Testing

`capix-testing` provides helpers to test capabilities without a running server:

```ts
import { mockContext, testServer } from 'capix-testing';

// Unit test: invoke capability directly
const ctx = mockContext({ user: { id: '1', admin: true } });
const result = await getUser.resolve({ id: '1' }, ctx);
expect(result.name).toBe('Alice');

// Integration test: real HTTP server on a random port
const server = await testServer({ capabilities: { users: { getUser } } });
const res = await fetch(`${server.url}/users/1`);
await server.stop();
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
