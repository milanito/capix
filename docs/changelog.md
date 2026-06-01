# Changelog

## 0.1.0-alpha.4 — 2026-06-01

### Fixed
- `capix show` was displaying `ZodString` instead of `string` for field
  types — now uses the same schema prettifier as `capix docs`
- Scaffold template now includes `pnpm.onlyBuiltDependencies` to prevent
  esbuild postinstall errors under pnpm 9
- Scaffold template now generates `.npmrc` with `minimum-release-age=0`
  to prevent pnpm 9 blocking installs within 24 hours of a new release
- Scaffold template now shows the `authCap` two-factory pattern so
  developers see the correct guard narrowing approach from the start

---

## 0.1.0-alpha.3 — 2026-06-01

### Fixed
- Scaffold template generated `"@capixjs/core": "^0.1.0"` which excluded
  prerelease versions — changed to `"@capixjs/core": "alpha"` (dist-tag)
  so installs always resolve correctly during the alpha period

---

## 0.1.0-alpha.2 — 2026-06-01

### Fixed
- Publishing CI was leaving `workspace:*` protocol in published packages
  instead of substituting real version numbers — fixed by switching from
  `npm publish` to `pnpm publish --no-git-checks`

---

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

- `@capixjs/transport-rest` — Node.js `http` server with automatic URL inference from capability names, path parameter extraction, query string coercion, multipart/file upload, route overrides
- `@capixjs/transport-ws` — WebSocket server with request/response capability invocation and EventBus-powered server push
- `@capixjs/transport-graphql` — GraphQL schema auto-generated from Zod schemas, GraphiQL playground, `ZodDefault`/`ZodEffects` unwrapping
- `@capixjs/transport-queue` — background job worker via pluggable adapters (`MemoryQueueAdapter` included; BullMQ, SQS, etc. via custom adapters)

### Plugins

- `@capixjs/plugin-auth` — `jwtContextBuilder`, `createJWTHelpers`, `authPlugin`, `mustBeAuthenticated` guard, JWT cache
- `@capixjs/plugin-cors` — CORS headers for REST
- `@capixjs/plugin-helmet` — security headers for REST
- `@capixjs/plugin-logging` — structured request logging via pino

### CLI (`@capixjs/cli`)

12 commands: `new`, `generate capability`, `generate group`, `dev`, `list`, `show`, `call`, `check`, `docs`, `client`, `diff`, `ai-context`

### Testing (`@capixjs/testing`)

`mockContext`, `testServer` — run the full execution engine without an HTTP server

### Performance (v4, Node.js v25, Linux)

| Scenario | req/s |
|---|---|
| Hello World | 28,488 |
| Zod Validation | 26,097 |
| Auth + Guard | 27,102 |

Beats Express by 65–71% and Hono by 19–27%. Within 3% of Fastify.
