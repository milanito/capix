# Capix Benchmarks

Measures HTTP throughput of Capix's REST transport against Express, Fastify, and Hono across three scenarios of increasing complexity.

## Running

```bash
# From the repo root
pnpm --filter capix-benchmarks install
pnpm --filter capix-benchmarks bench
```

Or directly:

```bash
cd benchmarks
bash run.sh
```

## Methodology

- Tool: [autocannon](https://github.com/mcollina/autocannon) — 100 concurrent connections, 10-second window
- All four servers run in the same Node.js process group on the same machine; results reflect relative overhead, not absolute capacity
- Each scenario runs sequentially; servers stay up for the full suite
- Capix runs via `tsx` (TypeScript source); the others run pre-compiled JS

**Machine:** Linux 6.19 · Node.js v25.2.1 · Fedora 43

## Scenarios

| # | Route | What it tests |
|---|-------|---------------|
| 1 | `GET /hello` | Pure framework overhead — JSON response, no logic |
| 2 | `GET /users/:id` | Zod input validation + path-param extraction |
| 3 | `GET /profile` + `Authorization: Bearer …` | Auth header read + guard function |

For scenarios 2 and 3, each framework implements equivalent logic (no extra middleware or plugins). Capix uses its built-in `capability.withContext()` + `.guard()` pattern; Express/Fastify/Hono use inline handlers. See `servers/` for the full source.

## Results (v2 — after optimization)

All figures are **req/s (average)** over the 10-second window.

### Scenario 1 — Hello World

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 27,282 | 3ms | 7ms |
| **Capix** | **25,840** | **3ms** | **7ms** |
| Hono      | 22,501 | 4ms | 8ms |
| Express   | 15,978 | 5ms | 10ms |

### Scenario 2 — Zod Validation

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 25,383 | 3ms | 7ms |
| **Capix** | **22,537** | **4ms** | **8ms** |
| Hono      | 21,372 | 4ms | 7ms |
| Express   | 14,606 | 6ms | 11ms |

### Scenario 3 — Auth + Guard

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 25,522 | 3ms | 7ms |
| **Capix** | **23,425** | **3ms** | **7ms** |
| Hono      | 19,896 | 4ms | 8ms |
| Express   | 15,212 | 6ms | 10ms |

## Optimizations Applied (v1 → v2)

Starting point (v1): S1 21,575 · S2 19,384 · S3 19,980.

**1. Pre-built response headers (+12% S1)**  
Previously, each request called `setHeader` three times for CORS headers before `writeHead`. Each call validates the header name against a regex. Replaced with headers objects built once at startup and passed directly to `writeHead` — eliminating three regex checks and three `Map.set` calls per request.

**2. String concatenation for the data wrapper (+2% S2)**  
`JSON.stringify({ data: output })` allocates a wrapper object on every response. Replaced with `'{"data":' + JSON.stringify(output) + '}'`.

**3. Sync Zod parsing (+6% S2)**  
`safeParseAsync` builds an internal Promise chain even for synchronous schemas. Replaced with `safeParse` (sync, zero Promise overhead) and a try/catch fallback to `safeParseAsync` only when the schema has async refinements (uncommon).

**4. Router params — lazy allocation (+5% S2)**  
The router previously created `{ ...params, [name]: value }` on every path-parameter match. Changed to mutate the params object in place with save/restore on backtrack. For routes with no path params (the majority), the params allocation is now skipped entirely — the match returns `null`.

**5. AbortSignal elimination for no-timeout case (+6% S1)**  
`AbortSignal.timeout(30_000)` allocates a signal object, a WeakRef, and registers a FinalizationRegistry entry on every request. Added a `requestTimeout: false` option that shares a single never-aborted signal across all requests in the transport instance. The benchmark server uses this flag; production code keeps the default 30 second timeout.

Combined improvement: S1 +20% · S2 +16% · S3 +17%.

## Analysis

Capix **beats Hono** in all three scenarios (+15% hello world, +5% Zod, +18% auth) and runs within 6% of Fastify in hello world.

The remaining Fastify gap (~6–11%) is structural: Fastify's JSON serializer compiles specialized output functions from JSON Schema at startup, bypassing the generic `JSON.stringify` walk entirely. Capix chose Zod over JSON Schema — a deliberate tradeoff that trades ~10% peak throughput for full TypeScript-native schema authoring with runtime inference.

A few honest caveats:

- **tsx overhead**: the Capix server runs TypeScript source via tsx's JIT transform. Pre-built JS would narrow the Fastify gap further.
- **Shared machine**: all processes compete for the same CPU. Numbers shift run-to-run; treat them as order-of-magnitude, not precise ratios.
- **requestTimeout: false**: the benchmark server disables per-request AbortSignal creation. Production code (default `requestTimeout: 30_000`) is ~6% slower. This is a fair comparison for throughput benchmarks; real apps need timeouts.
- **This is not a real app**: a single-route microbenchmark is the best case for every framework. Real workloads with middleware stacks and database I/O will dominate any framework-level difference.
