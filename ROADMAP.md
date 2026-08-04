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

Remaining follow-up: scaffolded projects (`capix new`) still generate
the two-factory pattern by default — update the templates to use
`capability.guard(...)` instead, now that it's the recommended default.

### GraphQL and Queue integration tests — done
`test/integration/graphql.test.ts` drives a live `graphqlTransport`
over real HTTP; `test/integration/queue.test.ts` mounts `queueTransport`
alongside `restTransport` on one server/store and asserts a queued job
produces identical guard/validation/error results as the equivalent
REST call. BullMQ/SQS adapters remain covered by mocked unit tests only
— a live-broker integration test would need a new CI service (Redis/
LocalStack), left as a follow-up.

### CLI test coverage
The CLI commands work and are covered by smoke tests in CI. Unit tests
for `generate`, `show`, `list`, `docs`, `check`, `diff`, `call`, and
`ai-context` are needed before 1.0.

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
