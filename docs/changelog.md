# Changelog

## 0.1.0-alpha.19 — 2026-07-03

### Added
- **Every package now has tests.** `plugin-cors`, `plugin-helmet`,
  `plugin-logging`, and `@capixjs/testing` shipped with zero tests (two of
  them hid behind `--passWithNoTests`); they now have 27 tests covering
  origin matching and Vary handling, security header defaults/overrides and
  `mergeHooks`, the logging enhancer's success/error paths and
  input/output redaction defaults, and the full `testServer` surface
- **CI now tests the Node versions we claim.** The audit workflow gained a
  matrix: Node 20 and 24 on Ubuntu (blocking — `engines` promises `>=20`
  but only 22 was ever tested) and Node 22 on Windows (non-blocking until
  it has a track record)

### Fixed
- The pre-publish audit's typecheck, version-consistency, peer-dependency,
  LICENSE/README, and pack-integrity checks never included
  `@capixjs/transport-mcp` — it is now covered by all of them

---

## 0.1.0-alpha.18 — 2026-07-03

### Added
- **WebSocket hardening.** Three new `wsTransport` options:
  - `maxPayloadBytes` (default 1 MiB, was the `ws` library's 100 MiB) —
    oversized frames close the connection with `1009`
  - `heartbeatIntervalMs` (default 30 s) — the server pings each client
    every interval and terminates clients that missed the previous ping,
    so dead connections stop holding subscriptions forever
  - `authorizeSubscribe(event, headers)` — reject event subscriptions with
    a `Forbidden` reply; headers come from the HTTP upgrade request

### Fixed
- **Docs: WebSocket auth section described per-message headers, which the
  transport never supported.** It now documents the actual behavior:
  context is built from the upgrade-request headers on every message

---

## 0.1.0-alpha.17 — 2026-07-03

### Added
- **Graceful shutdown on every transport.** `server.stop()` now drains
  instead of dropping: the HTTP transports (REST, GraphQL, MCP) stop
  accepting connections, drop idle keep-alive sockets immediately, give
  in-flight requests a drain window, then force-close stragglers — before
  this, a single keep-alive connection made `stop()` hang forever. The
  WebSocket transport sends clients a clean `1001` close frame and
  terminates sockets that never finish the handshake. New per-transport
  option: `shutdownTimeoutMs` (default `10_000`)
- **New core export: `closeHttpServerGracefully(server, drainMs)`** —
  the shared drain sequence, for custom HTTP transports

---

## 0.1.0-alpha.16 — 2026-07-03

### Changed
- **API surface audit — first beta-gate release.** New
  [API stability policy](https://github.com/milanito/capix/blob/master/docs/api/stability.md)
  defines three tiers (public, extension-author, internal) and the semver
  commitment per release stage. Internal capability fields (`_capix`,
  phantom type fields, `_intentExplicit`, `_skipValidation`) are now marked
  `@internal` in the type definitions
- **New core export: `resolveIntent(cap, key)`.** The shared effective-intent
  rule (explicit intent wins, otherwise inferred from the key name). REST
  routing, GraphQL placement, MCP annotations, and the CLI all use it now —
  transport authors should too, instead of reading `intent` directly
- **GraphQL: key-name intent inference now applies.** Capabilities without
  an explicit intent whose name infers `query` (`getUser`, `listPosts`)
  are now Query fields instead of Mutation fields, matching how REST routes
  them as GET. Explicit intents behave as before
- **CLI: `check`, `show`, `docs`, `diff`, and `ai-context` report effective
  intent.** `capix check` no longer warns "mutation capability has no input
  schema" for capabilities that route as queries via name inference

---

## 0.1.0-alpha.15 — 2026-07-02

### Added
- **New package: `@capixjs/transport-mcp`.** Exposes every capability as a
  Model Context Protocol tool so AI clients (Claude Code, editors, agents)
  can call your server directly. Dot-path names become tool names
  (`users.getUser` → `users_getUser`), Zod input schemas become tool
  `inputSchema`, object output schemas become `outputSchema` +
  `structuredContent`, and intent maps to tool annotations (`query` →
  `readOnlyHint`, `delete` → `destructiveHint`, matching REST route
  inference). Guards, validation, and typed errors run through the same
  execution engine as every other transport. Two modes: stdio (local MCP
  clients spawn the process) and stateless Streamable HTTP (`port` option,
  request headers reach the context builder for auth guards)
- **New CLI command: `capix mcp`.** Serves your capabilities file as an MCP
  stdio server (`claude mcp add my-api -- npx capix mcp`), or over
  Streamable HTTP with `--port`

---

## 0.1.0-alpha.14 — 2026-07-02

### Breaking
- **Zod 4.** All packages now require `zod@^4` (previously `^3.23`). Your
  capability schemas keep working unchanged — the public Zod API used in
  Capix apps (`z.object`, `z.string`, `.optional()`, `.default()`, guards,
  enhancers) is the same. What changed under the hood:
  - Schema introspection (REST coercion, OpenAPI generation, GraphQL schema
    building, `capix show`/`docs`/`client`) now reads Zod 4's internals
  - `@capixjs/transport-rest` uses Zod 4's native `z.toJSONSchema` for
    response serializers and OpenAPI output — the `zod-to-json-schema`
    dependency is gone
  - If you use `z.record`, Zod 4 requires an explicit key schema:
    `z.record(z.unknown())` → `z.record(z.string(), z.unknown())`
  - Validation error messages follow Zod 4's format (e.g.
    `Invalid input: expected string, received number`)
  - `capix new` scaffolds new projects with `zod@^4`

### Fixed
- **npm `latest` tag now tracks the newest release.** `npm install
  @capixjs/*` previously resolved to `0.1.0-alpha.1` — the first-ever
  publish claimed `latest` and prerelease publishes never moved it. The
  publish workflow now retags `latest` on every release

---

## 0.1.0-alpha.13 — 2026-07-02

### Added
- **OpenAPI 3.1 generation.** New `generateOpenAPI(registry, options)` export in
  `@capixjs/transport-rest` builds an OpenAPI 3.1 document from a compiled
  registry using the same route inference as the running server: path
  parameters from `:id` segments, query parameters for GET/DELETE, JSON
  request bodies for POST/PATCH/PUT (with required lists derived from the Zod
  schema), the `{ data }` response envelope, per-operation `400` responses for
  schema-validated capabilities, and a shared `ErrorResponse` component.
  Supports `title`, `version`, `description`, `servers`, `urlCase`, and route
  `overrides`
- **New CLI command: `capix openapi`.** Generates the spec from your
  capabilities file and prints it to stdout or writes it with `--output`.
  Flags: `--config`, `--title`, `--api-version`, `--description`, `--server`,
  `--url-case`

---

## 0.1.0-alpha.12 — 2026-06-12

### Changed
- **REST transport: query/multipart coercion is now schema-aware.** Previously
  every query-string and multipart value was blindly coerced — `?name=123`
  became the number `123` and failed `z.string()` validation, and
  `?code=01234` was silently corrupted to `1234`. Values are now coerced to
  number/boolean only when the capability's Zod input schema types that field
  as number/boolean (through `optional`/`default`/`nullable`/refinement
  wrappers); everything else stays a raw string. Capabilities without an
  object schema (`z.record`, schemaless) receive raw strings
- **REST transport: path params are now coerced too.** `GET /things/42` with
  `z.object({ id: z.number() })` now validates (path params were never
  coerced before, so numeric ids always failed)
- JSON body values are never coerced — JSON expresses numbers and booleans
  itself, so a string where a number belongs remains a type error

---

## 0.1.0-alpha.11 — 2026-06-12

### Fixed
- **Event bus: a throwing subscriber no longer breaks the publisher.** A sync
  throw in one subscriber (or its filter) used to propagate into the resolver
  that called `publish()` — turning a successful mutation into a 500 after the
  write committed — and skipped delivery to the remaining subscribers.
  Subscriber errors are now caught, logged, and isolated
- **Queue transport: in-memory adapter no longer drops failures silently.**
  Handler throws are now logged by default

### Added
- `MemoryQueueAdapter` now accepts `{ onResult, onError }` hooks. `onResult`
  fires for every processed message — including `ok: false` results
  (validation failures, guard rejections, resolver errors), which were
  previously invisible. `MemoryQueueAdapterOptions` is exported

---

## 0.1.0-alpha.10 — 2026-06-12

### Fixed
- **GraphQL transport: typed errors are no longer flattened into message
  strings.** Capability errors used to surface as `Error('NotFound: Item not
  found')`, losing the status code and meta. Errors are now thrown as
  `GraphQLError` with `extensions: { code, status, meta }` so clients can
  branch on `extensions.code` instead of parsing messages. The error message
  is now the human-readable message alone (no `Code:` prefix)

---

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
