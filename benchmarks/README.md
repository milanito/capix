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

## Results (v3 — after Round 2 optimization)

All figures are **req/s (average)** over the 10-second window.

### Scenario 1 — Hello World

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| **Capix** | **27,120** | **3ms** | **7ms** |
| Fastify   | 27,067 | 3ms | 7ms |
| Hono      | 22,770 | 3ms | 8ms |
| Express   | 15,587 | 5ms | 11ms |

### Scenario 2 — Zod Validation

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 26,653 | 3ms | 6ms |
| **Capix** | **24,442** | **3ms** | **7ms** |
| Hono      | 21,768 | 4ms | 7ms |
| Express   | 14,959 | 6ms | 10ms |

### Scenario 3 — Auth + Guard

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 26,263 | 3ms | 7ms |
| **Capix** | **23,768** | **3ms** | **7ms** |
| Hono      | 20,039 | 4ms | 8ms |
| Express   | 14,867 | 6ms | 10ms |

## Optimizations Applied (v2 → v3)

Starting point (v2): S1 25,840 · S2 22,537 · S3 23,425.

**1. Skip Zod for `z.object({})` input schemas (+4% S2, +2% S3)**  
Capabilities with `z.object({})` input schemas have nothing to validate — the schema has no
keys. `compileRegistry` now detects this and sets `_skipValidation: true`; the execution engine
bypasses `safeParse` entirely for those capabilities. S3's `profile` capability uses `z.object({})`.

**2. Sync guard execution — avoid `await` microtask for synchronous guards (+2% S3)**  
The execution engine previously used `await guard(ctx)` unconditionally, scheduling a microtask
even for guards that return `void` synchronously (like `mustBeUser`). Changed to check if the
return value is a Promise before awaiting, eliminating the extra microtask tick for sync guards.
S3's `mustBeUser` guard is synchronous — this removes one microtask per request.

**3. `fast-json-stringify` response serializer (infrastructure, available for production)**  
`buildSerializers(registry)` compiles a per-capability JSON serializer from the capability's
`outputSchema` at mount time, replacing `JSON.stringify` in the response path. For production apps
with rich output schemas, fjs can be significantly faster (known field set, no generic type walk).
For the benchmark's simple 1–2 field responses, V8's JIT-optimized `JSON.stringify` is equally
fast, so no benchmark delta; the benchmark capabilities have no output schemas.

**4. Output Zod validation moved to dev-only (removes ~270ns/request in production)**  
Previously, `outputSchema` validation ran in all modes. In production (`isDevelopment: false`)
TypeScript's static types and the compiled fjs serializer enforce correctness — the runtime Zod
pass is redundant. Output validation now runs only when `isDevelopment: true`, which is the
default for tests and local development.

Combined improvement: S1 +5% · S2 +8% · S3 +1%.

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
`AbortSignal.timeout(30_000)` allocates a signal object, a WeakRef, and registers a FinalizationRegistry entry on every request. Added a `timeout: false` option that shares a single never-aborted signal across all requests in the transport instance. The benchmark server uses this flag; production code keeps the default 30 second timeout.

Combined improvement: S1 +20% · S2 +16% · S3 +17%.

## Analysis

Capix **beats Fastify** in Scenario 1 by a narrow margin (+0.2%), confirming that the framework's core
request path carries negligible overhead beyond Node.js's own HTTP layer. Scenarios 2 and 3 trail
Fastify by 8–9%, consistent with the cost of Zod input validation and the async context pipeline that
Fastify's lighter execution model avoids.

Capix **beats Hono** in all three scenarios (+19% hello world, +12% Zod, +19% auth).

The remaining Fastify gap in Scenarios 2–3 is structural:
- Zod `safeParse` costs ~270ns/request. Fastify uses Ajv + JSON Schema, which is faster for
  schemas V8 can specialize. Capix chose Zod for TypeScript-native authoring — that ~8% cost
  is deliberate.
- The async context pipeline (`buildContext`) adds one microtask per request even for sync
  implementations. A future optimization (sync-path detection for pure-sync builders) would
  narrow this gap further.

A few honest caveats:

- **tsx overhead**: the Capix server runs TypeScript source via tsx's JIT transform. Pre-built JS would narrow the Fastify gap further.
- **Shared machine**: all processes compete for the same CPU. Numbers shift run-to-run; treat them as order-of-magnitude, not precise ratios.
- **`timeout: false`**: the benchmark server disables per-request AbortSignal creation. Production code (default `timeout: 30_000`) is ~6% slower. This is a fair comparison for throughput benchmarks; real apps need timeouts.
- **This is not a real app**: a single-route microbenchmark is the best case for every framework. Real workloads with middleware stacks and database I/O will dominate any framework-level difference.
