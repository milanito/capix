# Changelog

## 0.1.0-alpha.1 — 2026-05-30

Initial public alpha.

### Core (`capix`)

- `capability()` — typed pure function primitive with input/output schemas
- `capability.withContext<TContext>()` — scoped factory for typed context
- `defineContext(fn)` — request context builder
- `defineGuard(fn)` / `defineGuardFor<T>()` — guards with optional type narrowing
- `defineInputGuard(fn)` — guards that run after input validation
- `defineError(status, message, code?)` — typed error factories
- `defineEnhancer(fn)` — enhancer definition helper
- `definePlugin(plugin)` — plugin bundling
- `createServer(config)` — server factory with per-transport capability registries
- `createEventBus<TEvents>()` — typed pub/sub for server push
- Built-in enhancers: `withCache`, `withRateLimit`, `withCircuitBreaker`, `withTimeout`, `withRetry`, `withRollback`, `withMetrics`, `withLogging`
- `defaultErrors` — pre-built error factories for common HTTP status codes

### Transports

- `capix-transport-rest` — Node.js `http` server with automatic URL inference from capability names, path parameter extraction, query string coercion, multipart/file upload, route overrides
- `capix-transport-ws` — WebSocket server with request/response capability invocation and EventBus-powered server push
- `capix-transport-graphql` — GraphQL schema auto-generated from Zod schemas, GraphiQL playground, `ZodDefault`/`ZodEffects` unwrapping
- `capix-transport-queue` — background job worker via pluggable adapters (`MemoryQueueAdapter` included; BullMQ, SQS, etc. via custom adapters)

### Plugins

- `capix-plugin-auth` — `jwtContextBuilder`, `createJWTHelpers`, `authPlugin`, `mustBeAuthenticated` guard, JWT cache
- `capix-plugin-cors` — CORS headers for REST
- `capix-plugin-helmet` — security headers for REST
- `capix-plugin-logging` — structured request logging via pino

### CLI (`capix-cli`)

12 commands: `new`, `generate capability`, `generate group`, `dev`, `list`, `show`, `call`, `check`, `docs`, `client`, `diff`, `ai-context`

### Testing (`capix-testing`)

`mockContext`, `testServer` — run the full execution engine without an HTTP server

### Performance (v4, Node.js v25, Linux)

| Scenario | req/s |
|---|---|
| Hello World | 28,488 |
| Zod Validation | 26,097 |
| Auth + Guard | 27,102 |

Beats Express by 65–71% and Hono by 19–27%. Within 3% of Fastify.
