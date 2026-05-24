# Capix

A capability-based Node.js server framework. Replaces the route/middleware paradigm with a single primitive: a **capability** — a typed pure function that declares what your server can do.

```ts
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => db.users.find(id),
).guard(mustBeUser);
```

There are no routes. No middleware. No `req`/`res`. No `next()`. The HTTP layer is a transport — one of several possible transports, all optional.

## Monorepo Structure

```
packages/
  core/               → capix (the only primitive: capability)
  testing/            → capix-testing (mockContext, testServer)
  transports/
    rest/             → capix-transport-rest (HTTP/1.1 REST)
    ws/               → capix-transport-ws (WebSocket)
examples/
  basic-rest/         → Full REST CRUD example
  with-auth/          → JWT-style auth, multi-role guards
```

## Quick Start

```ts
import { z } from 'zod';
import { capability, defineContext, defineGuard, defineError, createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';

const errors = { NotFound: defineError(404, 'Not found') };

const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: await verifyAuth(req.headers.authorization),
}));

const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw errors.NotFound();
});

const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => db.users.find(id),
).guard(mustBeUser);

createServer({
  context: buildContext,
  capabilities: { users: { get: getUser, list: listUsers } },
  transports: [restTransport({ port: 3000 })],
}).start();
// ✓ GET /users/:id
// ✓ GET /users
```

## Development

```bash
pnpm install
cd packages/core && pnpm exec vitest run    # core tests
cd examples/basic-rest && npx tsx src/server.ts  # start example
```

## Key Concepts

- **Capability**: the only primitive. Immutable, chainable (`.guard()`, `.enhance()`, `.output()`).
- **Context**: built once per request by `buildContext`. Replaces DI.
- **Guards**: throw `FrameworkError` or pass silently. TypeScript narrows `ctx` after `.guard()`.
- **Enhancers**: wrap resolvers for cross-cutting concerns (logging, caching, rate limiting).
- **Transport**: adapts a protocol to `invoke()`. Ships with HTTP/REST and WebSocket.
