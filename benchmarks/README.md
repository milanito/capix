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

## Results

All figures are **req/s (average)** over the 10-second window.

### Scenario 1 — Hello World

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 23,915 | 3ms | 8ms |
| Hono      | 23,333 | 3ms | 7ms |
| **Capix** | **21,575** | **4ms** | **9ms** |
| Express   | 16,272 | 5ms | 10ms |

### Scenario 2 — Zod Validation

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 26,584 | 3ms | 6ms |
| Hono      | 22,434 | 4ms | 7ms |
| **Capix** | **19,384** | **4ms** | **9ms** |
| Express   | 15,507 | 6ms | 10ms |

### Scenario 3 — Auth + Guard

| Framework | req/s | p50 | p99 |
|-----------|------:|-----|-----|
| Fastify   | 26,424 | 3ms | 7ms |
| **Capix** | **19,980** | **4ms** | **9ms** |
| Hono      | 20,113 | 4ms | 8ms |
| Express   | 15,639 | 5ms | 9ms |

## Analysis

Capix is **~25–33% faster than Express** and **within 15% of Hono** in every scenario. The Fastify gap (~25–35%) reflects Fastify's JSON serialization optimization (it pre-compiles serializers from schemas); Capix does not yet do this.

A few honest caveats:

- **tsx overhead**: the Capix server runs TypeScript source via tsx's JIT transform. Pre-built JS would close some of the Fastify gap.
- **Shared machine**: all processes compete for the same CPU. Numbers shift run-to-run; treat them as order-of-magnitude, not precise ratios.
- **Zod cost is small**: Capix's validation overhead (scenario 1 → 2) is ~10%. Adding a guard (scenario 3) adds negligible cost on top.
- **This is not a real app**: a single-route microbenchmark is the best case for every framework. Real workloads with middleware stacks and database I/O will dominate any framework-level difference.
