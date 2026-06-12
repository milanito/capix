# Changelog

## 0.1.0-alpha.9 — 2026-06-12

### Fixed
- **Queue transport: BullMQ adapter no longer opens a Redis connection per
  job.** `enqueue` used to create a new `Queue` and close it for every single
  message. Queue instances are now cached per queue name and reused for the
  adapter's lifetime; `stop()` closes them. Concurrent first enqueues share a
  single instance

---

## 0.1.0-alpha.8 — 2026-06-12

### Fixed
- **`withCache` no longer grows without bound.** The cache is now a true LRU
  with a `maxSize` cap (default 1,000 entries); expired entries are removed on
  access instead of occupying capacity forever
- **`withRateLimit` no longer leaks tracked keys.** With a per-user or per-IP
  `keyFn`, every key ever seen stayed in memory permanently. Stale keys are
  now swept and a `maxKeys` hard cap (default 10,000) bounds the store

### Added
- `withCache(ttl, { keyFn })` — derive the cache key from input *and* context.
  The default key ignores context, which serves one user's cached response to
  every other user when the output depends on `ctx`. Use `keyFn` for any
  context-dependent capability
- `withCache(ttl, { maxSize })` and `withRateLimit({ maxKeys })` options
- `CacheOptions` exported from `@capixjs/core`

---

## 0.1.0-alpha.7 — 2026-06-12

### Fixed
- **REST transport: per-request timeout no longer retains memory after the
  response.** Every completed request used to leave its `AbortSignal.timeout`
  timer and an abort-listener closure alive for the full timeout window
  (default 30s) — at high request rates that meant hundreds of thousands of
  dead closures held at steady state. The timer is now cleared the moment the
  invocation settles. Behavior is unchanged: hung capabilities still get a
  `504` and the request signal still aborts at the deadline

---

## 0.1.0-alpha.6 — 2026-06-12

### Fixed
- **REST transport: malformed percent-encoding crashed the process.** A request
  like `GET /users/%zz` threw an uncaught `URIError` from the synchronous
  request path and killed the server. Undecodable path params now return
  `400 Bad Request`; undecodable query-string text falls back to its raw form
  (WHATWG `URLSearchParams` behavior)
- REST transport: synchronous errors in the request handler are now caught and
  answered with `500` instead of escaping as an `uncaughtException`

### Security
- REST transport: `__proto__` keys are stripped from query strings, JSON bodies,
  and multipart fields before merging into capability input
- REST transport: JSON bodies that are not objects (arrays, primitives) are
  rejected with `400` instead of being merged as index-keyed garbage

---

## 0.1.0-alpha.5 — 2026-06-01

### Added
- `ROADMAP.md` — documents pre-1.0 gaps and post-1.0 plans
- `CONTRIBUTING.md` — contributing guidelines for bug reports and local setup
- Scaffold now generates `.cursor/rules` with idiomatic Capix patterns for
  AI-assisted development

### Changed
- Scaffold `capabilities.ts` now defines `AppUser`, `AuthContext`, and
  `authCap` out of the box — the two-factory guard pattern is visible from
  the start instead of requiring discovery through a confusing TypeScript error

### Removed
- README no longer promises a uWebSockets.js transport — moved to `ROADMAP.md`
  under "After 1.0"

---

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
