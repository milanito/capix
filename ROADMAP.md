# Capix Roadmap

This document tracks what is planned before 1.0 and what comes after.
Nothing here is a commitment or a timeline.

## Before 1.0

### Guard type ergonomics — fixed
`capability.guard(...)` lets guards be declared before the resolver, so
the resolver's `ctx` is inferred fully narrowed with no annotation, no
factory, and no footgun (forgetting a guard is still a compile error —
unlike the two-factory pattern, where a bare `authCap` silently grants
the narrowed type). Additive: `capability()`, `.guard()` postfix, and
`capability.withContext()` are unchanged. See `docs/ts-workarounds.md`
for the full writeup and `packages/core/src/type-tests.ts` (Tests
12-17) for the compile-time proof.

`capix new` scaffolds (`cli/src/templates/new-project.ts`) and the
generated `.cursor/rules` now demonstrate `capability.guard(...)`
directly, including a guarded `auth.me` example capability — verified
by scaffolding a project against the local build and confirming it
typechecks and the guard actually enforces at runtime (401 when
unauthenticated).

### GraphQL and Queue integration tests — done
`test/integration/graphql.test.ts` drives a live `graphqlTransport`
over real HTTP; `test/integration/queue.test.ts` mounts `queueTransport`
alongside `restTransport` on one server/store and asserts a queued job
produces identical guard/validation/error results as the equivalent
REST call. BullMQ/SQS adapters remain covered by mocked unit tests only
— a live-broker integration test would need a new CI service (Redis/
LocalStack), left as a follow-up.

### CLI test coverage — done
Unit tests added for `generate`, `show`, `list`, `docs`, `check`,
`diff`, `call`, and `ai-context` (60 new tests). `diff`, `ai-context`,
`docs`, and `generate` had their pure logic extracted into exported
functions (`computeDiff`, `buildAiContext`, `capabilityToMarkdown`,
`parseCapabilityArgs`, etc.) and tested directly, matching the pattern
`client.ts`/`generateClient` already used. `list`, `show`, `check`, and
`call` are tested at the command level (mocked `loadRegistry`,
captured console output, mocked `process.exit`).

Writing real tests for `check` surfaced two genuine bugs, now fixed:
route-conflict detection never actually ran (`generateRoutes()` only
infers routes, it doesn't detect duplicates — conflict detection lives
in `compileRouter()`, which `check` never called), and scaffold-
placeholder detection read `cap.resolve.toString()` (the framework's
guard-running wrapper, constant regardless of the user's resolver)
instead of `cap._resolverOnly.toString()` (the actual user code).

### CI dependency vulnerability scanning — done
`audit.yml` now runs `pnpm audit --prod --audit-level high` as a
blocking step (production dependencies only — what actually reaches
consumers of `@capixjs/*` packages) plus a full, informational
`pnpm audit --audit-level moderate` (`continue-on-error: true`) for
visibility into devDependency-only and lower-severity findings without
blocking merges on them.

Getting the blocking gate to a real, honest pass (not a suppressed
one) took two fixes:
- `fast-uri` (pulled in by `@capixjs/transport-rest` via
  `fast-json-stringify` → `ajv`) and `ip-address` (pulled in by
  `@capixjs/transport-mcp` via `@modelcontextprotocol/sdk` →
  `express-rate-limit`) were both vulnerable at their locked versions
  but already patched *within* the semver ranges their dependents
  declare — the lockfile was simply stale. A plain `pnpm install`
  refresh resolved both to patched versions; no override needed.
- `benchmarks`' comparison-framework dependencies (Fastify 4.x,
  Express 4.x, autocannon, an older Hono) accounted for the rest of
  the findings. `benchmarks` is private and never published, so these
  were never real production risk — but `pnpm audit` has no
  workspace-scoping flag, so they showed up regardless. Moved to
  `benchmarks`'s `devDependencies` (which `--prod` correctly excludes)
  since that's what they actually are for an unpublished tool; verified
  the benchmark servers still boot after the move.

One known gap left as follow-up: `@hono/node-server` (pulled in by
`@capixjs/transport-mcp` via `@modelcontextprotocol/sdk`) has a
moderate-severity, Windows-only path-traversal advisory in its
`serve-static` middleware fixed only in its 2.x line; the SDK's own
`package.json` pins `^1.19.9`, so it can't move without an upstream SDK
bump. Below the blocking gate's severity threshold, so it doesn't
block, but isn't fixed either.

Also surfaced (informational only, not fixed): `vitest` has a critical
advisory (arbitrary file read/execute when `vitest --ui` is running)
fixed in 3.2.6+; every package here is on vitest 1.6.x. Fixing it means
a vitest 1.x → 3.x migration across every package in the workspace —
real work, not a version-bump one-liner, and out of scope for this
pass.

### Migration guides — done
"From Express", "From Fastify", and "From tRPC" all exist now. tRPC is
the closest of the three to Capix conceptually — procedures and
capabilities are the same idea (schema-validated input, typed
resolver, no route file) — so that guide leans on the differences that
actually matter: `capability.guard(...)` vs. tRPC's `protectedProcedure
= publicProcedure.use(isAuthed)` (structurally the same problem Capix's
old two-factory pattern solved, but `capability.guard` needs no second
exported builder), and — stated plainly rather than glossed over —
tRPC's live end-to-end type inference (no codegen, just importing the
server's router type) has no Capix equivalent; `capix client` is
codegen, and it currently only types inputs, not outputs
(`Promise<unknown>` — verified by reading `cli/src/commands/client.ts`,
not assumed). Also notes Capix has no request-batching equivalent to
`httpBatchLink`, and that `.output()` is dev-only by default in Capix
(verified against `execution-engine.ts`) where tRPC's runs on every
call.

Writing the Fastify guide surfaced a pre-existing documentation bug in
the same shape across seven files (`docs/guide/plugins.md`,
`docs/migration/from-express.md`, `docs/transports/rest.md`, and the
`packages/core`, `packages/plugins/cors`, `packages/plugins/logging`,
`packages/plugins/helmet` READMEs): examples referencing a
`corsPlugin`/`helmetPlugin`/`loggingPlugin` API that was never actually
shipped (real API: `cors()`/`helmet()` spread into `restTransport()`,
`loggingEnhancer()` via `.enhance()`). All seven fixed. The `logging`
and `helmet` READMEs also documented options/default headers/log
fields that don't match the real implementation (`X-Frame-Options`
default was documented as `DENY`, actually `SAMEORIGIN`; three headers
listed that the plugin never sets; `HSTS` — a header it does set — was
missing from the table entirely; `logging`'s `transport`/`base`
options and its example log line didn't match `LoggingOptions` or the
real log fields at all) — corrected against the source, not just
renamed.

Fixing these surfaced a real bug, not just a doc bug — now fixed:
the "combine cors() + helmet()" pattern shown in every one of those
files (and in `test/integration/plugins.test.ts`) — `restTransport({
...mergeHooks(corsOpts, helmetOpts) })` — silently dropped the CORS
origin restriction. `mergeHooks()` only merged each argument's `hooks`,
never their `cors` field, so the transport fell back to its default
`origin: '*'` while Helmet's headers still applied — confirmed with a
live server before the fix: a disallowed `Origin` header still got
back `Access-Control-Allow-Origin: *`. The integration test didn't
catch it because it exercised `cors({ origin: '*' })`, which happens
to match the fallback default.

`mergeHooks()` (`packages/plugins/helmet/src/index.ts`) now carries
`cors` through — the last argument that defines it wins, matching how
plain object spread would behave. Backwards compatible: the return
type only gained an optional field. 5 new unit tests cover it directly
(carries through regardless of argument order, omitted when nothing
defines it, last-wins when more than one argument does, hooks still
merge correctly alongside it); the integration test now asserts on a
distinguishing origin instead of `'*'` so it can no longer pass by
accident. All doc examples simplified back to the plain
`...mergeHooks(cors(...), helmet())` form now that it's correct by
default. `packages/plugins/helmet/CHANGELOG.md` has an `[Unreleased]`
entry.

## After 1.0

### uWebSockets.js transport
A transport backed by uWS would provide 2–3× higher throughput for
I/O-bound APIs. This is on the long-term roadmap but has no timeline.
The current REST transport on node:http is fast enough for the vast
majority of production APIs.

### Streaming responses
The current REST transport does not support streaming. Planned for a
future minor release.

### Browser client SDK
A typed fetch client that works in the browser without a build step.
The CLI already generates a client — a published package is planned.

## Contributing

If you are interested in working on any of these, open an issue first
to discuss the approach. See [CONTRIBUTING.md](CONTRIBUTING.md).
