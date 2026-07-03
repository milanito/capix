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

## Results (v4 — after Phase 11 optimization)

All figures are **req/s (average)** over the 10-second window.

### Scenario 1 — Hello World

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 29,531 | 3ms | 6ms |
| **Capix** | **28,488** | **3ms** | **6ms** |
| Hono      | 23,970 | 3ms | 7ms |
| Express   | 16,632 | 5ms | 10ms |

### Scenario 2 — Zod Validation

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 28,353 | 3ms | 6ms |
| **Capix** | **26,097** | **3ms** | **6ms** |
| Hono      | 23,482 | 3ms | 7ms |
| Express   | 16,733 | 5ms | 9ms |

### Scenario 3 — Auth + Guard

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 27,899 | 3ms | 6ms |
| **Capix** | **27,102** | **3ms** | **6ms** |
| Hono      | 21,365 | 4ms | 8ms |
| Express   | 16,239 | 5ms | 9ms |

## Optimizations Applied (v3 → v4)

Starting point (v3): S1 27,120 · S2 24,442 · S3 23,768.

**1. Sync `buildContext` fast-path — skip microtask for sync context builders (+3% all scenarios)**  
The execution engine previously `await`ed `buildContext(rawReq)` unconditionally, scheduling
a microtask even when the context builder is synchronous (the common case for stateless servers).
Changed to check `typeof ctxResult.then === 'function'` before awaiting — the `await` is skipped
entirely for sync builders, removing one microtask tick per request.

**2. Plugin context extension fast-path (+2% all scenarios when no plugins active)**  
`wrapContext` in `mergePlugins` previously iterated the plugin list even when no plugins provided
`contextExtension`. Added an early return when `contextExtensions.length === 0` — for the common
no-plugin path, `buildContext` is returned unchanged with zero overhead.

**3. Sync input guard fast-path — remove `await` microtask for sync guards (+10% S3)**  
`runInputGuards` previously called `await guard(input, ctx)` unconditionally. Sync guards (like
the benchmark's `mustBeUser`) return `void`, not a Promise — the `await` forced an unnecessary
microtask every request. Changed to thenable check before awaiting, matching the pattern
already used for regular guards in the execution engine since v3.

**4. Router `splitPath`, lazy `decodeURIComponent`, guaranteed-uppercase method (+2% S1)**  
Three hot-path micro-optimizations in the REST router: (a) `splitPath` replaces
`str.split('/').filter(Boolean)` with a single-pass loop that allocates no intermediate array
and skips empty segments inline; (b) `decodeURIComponent` is now guarded by a `includes('%')`
check — most path segments are plain ASCII and pay zero decode cost; (c) the transport
normalizes `req.method` to uppercase once at entry so the router no longer calls
`.toUpperCase()` on every match.

Combined improvement: S1 +5% · S2 +7% · S3 +14%.  
The S3 improvement is larger because it stacks sync buildContext (#1), plugin fast-path (#2),
and sync guard (#3) — all three apply to every request on that route.

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

Capix trails Fastify by 3–4% in Scenarios 1–2, confirming that the framework's core request path
carries near-zero overhead beyond Node.js's own HTTP layer. In Scenario 3 (auth + sync guard)
the gap narrows to **3%**, after Phase 11's sync guard and sync buildContext fast-paths eliminate
two microtask ticks that previously applied to every request on that route.

Capix **beats Hono** in all three scenarios (+19% hello world, +11% Zod, +27% auth).

The remaining Fastify gap is structural and deliberate:
- Zod `safeParse` costs ~270ns/request. Fastify uses Ajv + JSON Schema, which is faster for
  schemas V8 can specialize. Capix chose Zod for TypeScript-native authoring — that ~8% cost
  is intentional.
- Fastify's handler model is thinner: no context builder, no capability registry lookup, no
  output schema path. The ~3% gap in Scenario 1 represents the irreducible cost of Capix's
  capability dispatch pipeline relative to Fastify's bare router.

A few honest caveats:

- **tsx overhead**: the Capix server runs TypeScript source via tsx's JIT transform. Pre-built JS would narrow the Fastify gap by ~2–3%.
- **Shared machine**: all processes compete for the same CPU. Numbers shift run-to-run; treat them as order-of-magnitude, not precise ratios.
- **`timeout: false`**: the benchmark server disables per-request AbortSignal creation. Production code (default `timeout: 30_000`) is ~6% slower. This is a fair comparison for throughput benchmarks; real apps need timeouts.
- **This is not a real app**: a single-route microbenchmark is the best case for every framework. Real workloads with middleware stacks and database I/O will dominate any framework-level difference.

---

## v5 — re-measured on 0.1.0-beta.1

Re-run after the beta-hardening work (Zod 4 migration, graceful shutdown with
connection tracking, pluggable enhancer stores, optional lifecycle hooks —
hooks unconfigured here, so the engine runs unwrapped).

| Scenario | Fastify | **Capix** | Hono | Express |
|---|------:|------:|------:|------:|
| Hello world | 27,659 | **26,240** | 22,910 | 16,176 |
| Zod validation | 25,526 | **24,316** | 21,876 | 15,259 |
| Auth + guard | 25,813 | **24,194** | 20,332 | 15,366 |

Relative standing after all the hardening: within 5–6% of Fastify, +11–19%
over Hono, ~+60% over Express. The absolute numbers moved with the
environment (different load, Zod 4); the ranking did not.
