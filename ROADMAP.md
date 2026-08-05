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

### Migration guides
A "From Express" guide exists. "From Fastify" and "From tRPC" are
planned — tRPC in particular because the capability model looks similar
from the outside and the differences are worth explaining clearly.

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
