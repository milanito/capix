# Capix Roadmap

This document tracks what is planned before 1.0 and what comes after.
Nothing here is a commitment or a timeline.

## Before 1.0

### CI port-collision flakiness — fixed
The pre-publish workflow failed with `EADDRINUSE` on
`packages/transports/rest/src/transport.test.ts`. Root cause: every
integration/unit test file that boots a real server picks a port via a
copy-pasted `getFreePort()` helper that probes port 0, reads the
assigned number, and closes the probe *before* the real server binds
to it — under CI-level parallelism (many test files as concurrent
worker processes), another file's probe can claim that exact same
ephemeral port in the gap, so the real bind then loses the race.

The same helper — and the same exposure — existed in 11 files, 26
real call sites total. Fixed everywhere, not just the one that failed:
added a `startOnFreePort` (single-port) / `startOnFreePorts`
(fixed-tuple, for servers mounting multiple transports — e.g. the
cross-transport test's one server on four ports — that bind together
via one `.start()` call, so a collision on any one of them needs all
of them retried as a unit) helper next to each file's existing
`getFreePort()`, retrying with fresh port(s) specifically on
`EADDRINUSE`. Proved the retry actually recovers — not just that
existing tests still pass — with a standalone script that force-
occupies the first port handed out and confirms a second attempt with
a fresh port succeeds.

Full monorepo build + test (670 tests) passed after every file was
converted. `test/integration` isn't part of CI's `tsc` sweep — a
pre-existing gap unrelated to this fix (the guard-type-narrowing
limitation `docs/ts-workarounds.md` documents shows up as unrelated
pre-existing typecheck errors in these same files) — but the
multi-port tuple variants were still typed precisely (no
`number | undefined` from destructuring plain arrays) rather than
leaning on that gap.

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

One gap was left as a follow-up at the time: `@hono/node-server`
(pulled in by `@capixjs/transport-mcp` via
`@modelcontextprotocol/sdk`) had a moderate-severity, Windows-only
path-traversal advisory in its `serve-static` middleware, fixed only
in its 2.x line — the SDK's `package.json` pinned `^1.19.9`. Now
fixed: the SDK has since widened its own declared range to
`^1.19.9 || ^2.0.5` (checked by fetching the current SDK's published
`package.json` from the registry, not assumed). The lockfile doesn't
jump majors on its own just because a range widens, so `pnpm update
@hono/node-server --recursive --latest` was needed to actually move
it — `transport-mcp` now resolves `@hono/node-server@2.1.0`, and
`pnpm audit --prod` reports zero vulnerabilities (previously one
moderate). The only package.json affected was `benchmarks`' own
devDependency on the same package (bumped `^1.0.0` → `^2.1.0` by the
same command); verified functionally, not just "it resolved" — booted
`benchmarks/servers/hono.js` for real and hit both routes. Full
monorepo build + test (670 tests, including the MCP transport's own
suite and the cross-transport suite's real MCP-client-over-
Streamable-HTTP test) passed unmodified.

Also surfaced (informational only, at the time): `vitest` had a
critical advisory (arbitrary file read/execute when `vitest --ui` is
running) fixed in 3.2.6+; every package was on vitest 1.6.x. See
"Vitest 1.x → 3.x migration" below — now fixed.

### Vitest 1.x → 3.x migration — done
Bumped `vitest` and `@vitest/coverage-v8` to `^3.2.7` (latest 3.x —
past the critical UI-server RCE's 3.2.6 patch threshold, without
jumping into v4's separate breaking changes, which wasn't what was
scoped) across all 15 `package.json` files that reference either.

Checked exposure to every breaking change in both the 1→2 and 2→3
migration guides before touching anything, not just the ones that
seemed obviously relevant: 2-arg `vi.fn<T1,T2>`/`Mock<T1,T2>` generics,
`.mock.results`, `SpyInstance`, snapshot testing, third-arg test
options, `.mockReset()`, `toThrowError`/`toEqual(new ...)` strictness —
none are used anywhere in the repo. `vi.useFakeTimers()` is used in 4
files, but v3's change (fake timers now also mock `performance.now()`
by default) doesn't apply — nothing in the source ever calls
`performance.now()`. The one real risk — Vite 6's stricter `module`
condition resolution interacting with the documented CJS/ESM
graphql-http workaround in `packages/transports/graphql` and
`test/integration/vitest.config.ts` — turned out fine; both test
suites passed unmodified.

Full monorepo build + test suite passed on the first attempt, no code
changes needed anywhere outside `package.json` files. Specifically
re-verified the `packages/core` coverage gate (v3's V8 coverage
provider changed how it counts empty lines by default) — thresholds
still comfortably cleared (91%/92%/98%/91% vs. the 85/80/90/85 gates).
`.github/workflows/audit.yml`'s comment about this being deferred work
is updated to reflect it's done.

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
