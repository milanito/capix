# Benchmarks

HTTP throughput of Capix's REST transport against Express, Fastify, and Hono across three scenarios of increasing complexity.

## How to run

```bash
cd benchmarks
bash run.sh
```

Or:

```bash
pnpm --filter capix-benchmarks bench
```

## Methodology

- **Tool**: [autocannon](https://github.com/mcollina/autocannon) — 100 concurrent connections, 10-second window
- **Environment**: Linux 6.19 · Node.js v25.2.1 · Fedora 43
- All four servers run in the same Node.js process group; results reflect relative overhead, not absolute capacity
- Scenarios run sequentially; servers stay up for the full suite
- Capix runs via `tsx` (TypeScript source); the others run pre-compiled JS

## Scenarios

| # | Route | What it tests |
|---|---|---|
| 1 | `GET /hello` | Pure framework overhead — JSON response, no logic |
| 2 | `GET /users/:id` | Zod input validation + path-param extraction |
| 3 | `GET /profile` + `Authorization: Bearer …` | Auth header read + sync guard |

## Results (v5 — 0.1.0-beta.1)

All figures are **req/s (average)** over the 10-second window. Re-measured on `0.1.0-beta.1` after the beta-hardening work (Zod 4 migration, graceful shutdown, pluggable enhancer stores, lifecycle hooks).

### Scenario 1 — Hello World

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 27,659 | 3ms | 6ms |
| **Capix** | **26,240** | **3ms** | **7ms** |
| Hono      | 22,910 | 4ms | 7ms |
| Express   | 16,176 | 5ms | 11ms |

### Scenario 2 — Zod Validation

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 25,526 | 3ms | 7ms |
| **Capix** | **24,316** | **3ms** | **7ms** |
| Hono      | 21,876 | 4ms | 7ms |
| Express   | 15,259 | 6ms | 10ms |

### Scenario 3 — Auth + Guard

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 25,813 | 3ms | 7ms |
| **Capix** | **24,194** | **3ms** | **7ms** |
| Hono      | 20,332 | 4ms | 8ms |
| Express   | 15,366 | 5ms | 10ms |

## Analysis

Capix trails Fastify by **5–6%** across the three scenarios — the sync-guard and sync-buildContext fast-paths keep the auth scenario from widening the gap.

Capix **beats Hono** in all three scenarios (+15% hello world, +11% Zod, +19% auth) and **beats Express by ~60%** everywhere.

The remaining Fastify gap is deliberate:
- Zod `safeParse` costs ~270ns/request. Fastify uses Ajv + JSON Schema, which V8 can specialize better. Capix chose Zod for TypeScript-native authoring.
- Fastify's handler model is thinner — no context builder, no capability registry lookup. The gap in Scenario 1 is the irreducible cost of Capix's dispatch pipeline.

## Honest caveats

- **tsx overhead**: Capix runs TypeScript source via tsx's JIT transform. Pre-built JS would narrow the Fastify gap by ~2–3%.
- **Shared machine**: all processes compete for the same CPU. Treat results as order-of-magnitude, not precise ratios.
- **`timeout: false`**: the benchmark server disables per-request `AbortSignal` creation. Production code (default `timeout: 30_000`) is ~6% slower. This is a fair comparison for throughput benchmarks; real apps need timeouts.
- **This is not a real app**: a single-route microbenchmark is the best case for every framework. Real workloads with DB I/O will dominate any framework-level difference.

## uWebSockets.js (planned)

A `uWS`-based transport is planned. uWS is a C++ HTTP/WebSocket server bound to Node.js; it is typically 2–3× faster than Node.js's native `http` module. When the `uWS` transport ships, Scenario 1 throughput should exceed Fastify.

The current benchmarks use Node.js native `http`. The gap between Capix and Fastify in Scenario 1 (~5%) is primarily explained by Capix's capability dispatch overhead, not the HTTP layer — so a `uWS` transport could push Capix ahead of Fastify even on Scenario 1.

## Optimization history

See [`benchmarks/README.md`](https://github.com/milanito/capix/blob/master/benchmarks/README.md) for the detailed optimization log (v1 → v4), including every micro-optimization applied and its measured impact.
