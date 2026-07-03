# Security Policy

## Reporting a vulnerability

Please report security issues privately — do not open a public issue.

- **GitHub**: use [private vulnerability reporting](https://github.com/milanito/capix/security/advisories/new) on this repository.

You should receive an acknowledgement within 72 hours. Please include a minimal reproduction and the affected package(s) and version(s).

## Supported versions

Capix is pre-1.0. Only the **latest published release** receives security fixes — older alphas/betas are not patched retroactively. Once 1.0 ships, the latest minor of each supported major will receive fixes.

## Scope notes

- The REST, WebSocket, GraphQL, and MCP transports are designed to face untrusted input; hardening issues there (parser crashes, resource exhaustion, validation bypasses, prototype pollution) are in scope and prioritized.
- `withRateLimit`'s in-memory default is per-process by design — see the [enhancers guide](docs/guide/enhancers.md) for the distributed store. Reports that in-memory limits don't hold across instances are expected behavior, not vulnerabilities.
- npm packages are published with provenance attestations; verify with `npm audit signatures`.
