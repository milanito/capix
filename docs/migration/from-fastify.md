# Migrating from Fastify

Fastify and Capix start from a similar place: schema-first request handling instead of pulling fields out of `req` by hand. The difference isn't "unstructured vs. structured" the way it is coming from Express — it's that Fastify's schema validates one HTTP request, while a Capix capability's Zod schema validates one call, and that same call is reachable from REST, WebSocket, GraphQL, a queue, or MCP without rewriting it per transport. This guide focuses on that shift, plus Fastify-specific concepts (plugins/encapsulation, the hook lifecycle, decorators) that don't have a 1:1 Capix equivalent.

## Route handler with schema validation

```ts
// Fastify
fastify.get('/users/:id', {
  schema: {
    params: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
}, async (request, reply) => {
  const user = await db.users.find(request.params.id);
  if (!user) return reply.code(404).send({ error: 'Not found' });
  return user;
});

// Capix
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
);
// Route inferred: GET /users/:id
```

The schema isn't bolted onto the route here — it *is* the input type. `id` is `string` inside the resolver with no cast, the same way Fastify's JSON Schema narrows `request.params` when paired with a type provider (`@fastify/type-provider-typebox`, `fastify-type-provider-zod`). The difference is scope: Fastify's schema validates one HTTP route. A capability's schema validates the call itself — the same `getUser` capability, unchanged, is what `wsTransport`, `graphqlTransport`, and `mcpTransport` all invoke. There's no route to define on those transports; `capability()` is the whole definition.

## Plugins and encapsulation

Fastify's plugin system does two jobs: code splitting (`fastify.register(routes, { prefix: '/users' })`) and *encapsulation* — a plugin's decorators and hooks are scoped to it and its children by default, invisible to siblings unless explicitly shared with `fastify-plugin`.

```ts
// Fastify — plugin registration with a prefix
async function userRoutes(fastify, opts) {
  fastify.get('/', listUsers);
  fastify.get('/:id', getUser);
  fastify.post('/', createUser);
}
fastify.register(userRoutes, { prefix: '/users' });

// Capix — a group is the whole unit
const capabilities = {
  users: { listUsers, getUser, createUser },
};
// Routes inferred from names + group key: GET /users, GET /users/:id, POST /users
```

Capix has no equivalent of encapsulation. Every capability lives in one flat registry (nested groups become dot-paths — `users.getUser`), and guards, enhancers, and context are visible everywhere they're attached; nothing is scoped to "this plugin and its children" the way Fastify decorators are. If your Fastify app leans on encapsulation to isolate per-plugin state (a database connection only some routes should see, for instance), model that as an explicit field on context instead — set once in `buildContext`, or added by a `definePlugin()` context extension (see [Plugins](../guide/plugins.md)), and let the guard chain — not encapsulation — decide who gets to use it.

## Hooks

Fastify's hook lifecycle is fine-grained: `onRequest`, `preParsing`, `preValidation`, `preHandler`, `preSerialization`, `onSend`, `onResponse`, `onError`, and more, each running at a specific point for every route (or scoped to a plugin). Capix condenses this to three mechanisms, and doesn't have a hook for every one of Fastify's stages:

```ts
// Fastify — preHandler as an auth check
fastify.addHook('preHandler', async (request, reply) => {
  const token = request.headers.authorization?.replace('Bearer ', '');
  if (!token) return reply.code(401).send({ error: 'Unauthorized' });
  request.user = await verifyToken(token);
});

// Capix — a guard, attached to just the capabilities that need it
const mustBeUser = defineGuard((ctx: AppContext): asserts ctx is AppContext & { user: User } => {
  if (!ctx.user) throw errors.Unauthorized();
});

const getProfile = capability.guard(mustBeUser)(
  z.object({}),
  async (_, ctx) => ctx.user, // ctx.user: User, not User | null — narrowed by the guard
  'query',
);
```

| Fastify hook | Nearest Capix equivalent |
|---|---|
| `onRequest` | REST transport's single `hooks.onRequest` (headers/response only — runs before routing, has no access to the parsed input or context) |
| `preValidation`, `preHandler` | `.guard(...)` — runs after input validation, before the resolver, with the typed context |
| (input-dependent access checks, e.g. "does this user own this resource") | `.inputGuard(...)` — receives both validated input and context |
| — (no equivalent) | `.enhance(...)` — wraps the resolver itself: caching, retries, timeouts, rate limiting, circuit breaking all ship as enhancers in `@capixjs/core` |
| `preSerialization`, `onSend` | not directly exposed — shape the response by returning the right value, or validate it with `.output(schema)` |
| `onError` | not a hook — thrown errors are caught by the execution engine automatically on every transport; see [Errors](#error-handling) below |

The one hook Capix does expose at the HTTP layer, `restTransport({ hooks: { onRequest } })`, only sees the raw request/response — it runs before routing and before your context is built, so it's for response headers (CORS, security headers), not business logic. Guards are where Fastify users end up putting most `preHandler` logic today.

## Decorators

Fastify's `fastify.decorate()` / `request.decorate()` attach values to the app or request for handlers to read later — a database client, a request-scoped logger, a computed value from a hook.

```ts
// Fastify
fastify.decorate('db', createDbClient());
fastify.decorateRequest('requestId', null);
fastify.addHook('onRequest', async (request) => {
  request.requestId = crypto.randomUUID();
});

fastify.get('/users/:id', async (request, reply) => {
  return request.server.db.users.find(request.params.id); // via fastify.db
});

// Capix — everything a resolver needs is on ctx, built once per request
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  db: dbClient, // same client instance across requests — build it outside buildContext
}));

const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => ctx.db.users.find(id),
  'query',
);
```

App-level decorators (shared across every request, like a DB client) are just values captured in a closure around `buildContext` — construct them once, outside the function, and reference them inside it. Request-level decorators (computed per request, like `requestId`) are fields `buildContext` sets directly. There's no separate decorator registration step; `ctx`'s shape *is* the set of decorators, and it's fully typed rather than requiring a `FastifyRequest` module augmentation to get type safety.

## Error handling

```ts
// Fastify — a global error handler, or per-route try/catch
fastify.setErrorHandler((error, request, reply) => {
  if (error.statusCode) return reply.code(error.statusCode).send({ error: error.message });
  reply.code(500).send({ error: 'Internal error' });
});

// Capix — typed errors, caught automatically, identical shape on every transport
const errors = {
  NotFound: defineError(404, 'Not found'),
  Forbidden: defineError(403, 'Forbidden'),
};

const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw errors.NotFound(); // → { error: 'NotFound', message: 'Not found' }, status 404
    return user;
  },
  'query',
);
// An unexpected throw (not defineError) → 500, detail suppressed outside development
```

There's no `setErrorHandler` to register — every transport's execution engine catches thrown errors the same way, so the REST 404, the WebSocket `ok: false` frame, the GraphQL `errors[]` entry, and the MCP `isError` result all carry the same `{ error, message, meta? }` shape from the same thrown `errors.NotFound()`. Fastify's `error.statusCode` convention (attach a status to any `Error`) has no equivalent — use `defineError` to declare the error up front instead of attaching a status to a generic `Error` at throw time.

## CORS, security headers, and logging

Fastify wires cross-cutting HTTP concerns as plugins registered on the app:

```ts
// Fastify
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';

await fastify.register(cors, { origin: 'https://app.example.com' });
await fastify.register(helmet);
```

Capix's equivalents aren't capability-registry plugins (`definePlugin`) — CORS and security headers are REST-transport concerns, so they're options merged into `restTransport()` directly:

```ts
// Capix
import { cors } from '@capixjs/plugin-cors';
import { helmet, mergeHooks } from '@capixjs/plugin-helmet';

restTransport({
  port: 3000,
  ...mergeHooks(
    cors({ origin: 'https://app.example.com' }),
    helmet(),
  ),
});
```

`cors()` and `helmet()` each return a partial `RestTransportOptions` (`{ cors, hooks }` / `{ hooks }`); `mergeHooks` combines two or more of them into one options object — every `hooks.onRequest` runs (so neither overwrites the other's headers), and the `cors` field carries through. Logging isn't a registered plugin either — `@capixjs/plugin-logging`'s `loggingEnhancer()` attaches to individual capabilities via `.enhance(loggingEnhancer())`, since Capix has no single "every request passes through here" HTTP-level hook beyond `onRequest` (see [Hooks](#hooks) above).

## Multipart file uploads

```ts
// Fastify + @fastify/multipart
await fastify.register(multipart);

fastify.post('/upload', async (request, reply) => {
  const file = await request.file();
  const buffer = await file.toBuffer();
  await storage.save(file.filename, buffer);
  return { ok: true };
});

// Capix
import { uploadedFile } from '@capixjs/transport-rest';

const uploadFile = capability(
  z.object({
    file: uploadedFile({ maxSize: 2 * 1024 * 1024, accept: ['image/jpeg', 'image/png'] }),
    title: z.string(),
  }),
  async ({ file, title }) => {
    await storage.save(file.filename, file.buffer);
    return { ok: true, title };
  },
);
```

`uploadedFile()` is a Zod schema factory — size and MIME-type limits are declared once, in the schema, alongside the capability's other fields, and validated the same way a `z.string().email()` would be. There's no separate `request.file()` step or manual buffering.

## OpenAPI

```ts
// Fastify + @fastify/swagger
await fastify.register(swagger, { openapi: { info: { title: 'My API', version: '1.0.0' } } });
```

```bash
# Capix
capix openapi --title "My API" --api-version 1.0.0 --output openapi.json
```

`capix openapi` generates a full OpenAPI 3.1 document from the capability registry — same source of truth as the routes themselves, no separate schema annotations to keep in sync.

## Reference table

| Fastify | Capix |
|---|---|
| `fastify.get('/users/:id', { schema }, handler)` | `capability(schema, resolver, 'query')` |
| `fastify.register(plugin, { prefix })` | group object `{ users: { list, get, create } }` |
| `fastify.addHook('preHandler', fn)` | `.guard(fn)` |
| `fastify.addHook('onRequest', fn)` | `restTransport({ hooks: { onRequest: fn } })` (headers only, no context) |
| `fastify.decorate('db', client)` | value captured in a closure around `buildContext` |
| `request.user`, custom decorators | `ctx.user`, any field returned by `buildContext` |
| `reply.code(status).send(body)` | `return body` (status inferred from the thrown/returned typed error) |
| `fastify.setErrorHandler(fn)` | not needed — every transport catches thrown errors automatically |
| `error.statusCode = 404; throw error` | `throw defineError(404, 'Not found')()` |
| type provider (`TypeBox`, `zod-type-provider`) | Zod is the type provider — no separate package |
| `@fastify/cors` | `cors()` from `@capixjs/plugin-cors`, spread into `restTransport()` |
| `@fastify/helmet` | `helmet()` from `@capixjs/plugin-helmet`, spread into `restTransport()` |
| `@fastify/multipart` | `uploadedFile()` from `@capixjs/transport-rest`, used inside a Zod schema |
| `@fastify/swagger` | `capix openapi` CLI command |
| `fastify.listen({ port: 3000 })` | `createServer({ transports: [restTransport({ port: 3000 })] }).start()` |

## What Capix cannot replace

- **Fine-grained hook stages**: `preParsing`, `preSerialization`, `onSend`, and `onResponse` have no Capix equivalent — the REST transport exposes one `onRequest` hook and nothing after the resolver runs. Response shaping happens by returning the right value (and optionally validating it with `.output(schema)`), not by intercepting the response on its way out.
- **Plugin encapsulation**: Fastify scopes decorators and hooks to a plugin and its children. Every Capix capability shares one flat registry and one context shape — there's no per-subtree isolation.
- **Streaming responses**: neither Fastify's `reply.send(stream)` nor Server-Sent Events map onto a capability, which returns one value. Use the WebSocket transport's event bus for incremental push, or a queue capability plus a status-polling capability for long-running work — see the "Non-goals for 1.0" section of [API stability](../api/stability.md) and the [real-time pattern](../patterns/real-time.md).
- **HTTP/2 / HTTP/3**: the REST transport uses `node:http` (HTTP/1.1). Put Nginx or a CDN in front if you need HTTP/2 termination.
