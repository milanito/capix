# Capix Roadmap

This document tracks what is planned before 1.0 and what comes after.
Nothing here is a commitment or a timeline.

## Before 1.0

### Guard type ergonomics
The two-factory pattern (`cap` / `authCap`) is the current workaround
for a TypeScript limitation with guard narrowing. The goal is to make
this pattern invisible — scaffolded projects show it by default so
developers never need to discover it through a confusing error.

See `docs/ts-workarounds.md` for the current explanation.

### GraphQL and Queue integration tests
Both transports have unit tests but no end-to-end integration tests.
Automated integration tests are needed before 1.0.

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
