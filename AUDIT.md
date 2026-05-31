# Capix — Phase 16a Audit Report

Audit performed 2026-05-30 covering test-suite health, TypeScript strictness, scaffold end-to-end, DX error messages, per-transport smoke tests, version consistency, package contents, route inference, and README quality.

---

## Blockers (found and fixed in this audit)

### 1. `capix generate capability` emits invalid identifier for paths with separators

**File:** `cli/src/templates/generate.ts`
**Symptom:** `capix generate capability products/list` emitted `export const products/list = ...` — a syntax error.
**Fix:** Added `toCamelIdentifier()` that splits on `/._-` and joins as camelCase. `products/list` → `productsList`.

### 2. peerDependency ranges exclude prerelease versions

**Files:** All 8 package.json files in transports and plugins.
**Symptom:** `>=0.1.0` does not match `0.1.0-alpha.1` per npm semver. A scaffolded project would fail to install with "capix@undefined".
**Fix:** Changed all peerDependency ranges from `>=0.1.0` to `>=0.1.0-0` (the `-0` prerelease tag is semver's convention for "include all prereleases at this version and above").

### 3. Route inference: `get*` without id field always routed to collection

**File:** `packages/transports/rest/src/router.ts`
**Symptom:** `users.getMe`, `users.getStats` → `GET /users` (collection) instead of `GET /users/me`, `GET /users/stats`.
**Fix:** Replaced the over-broad `/^(list|get|...)/` pattern with a two-stage check:
- `list*`, `find*`, `fetch*`, `read*`, `search*`, `filter*`, `all*` → always collection (`GET /group`)
- `get*` → collection only when the remainder (e.g. `Me`, `Stats`) matches the parent group name (singular/plural), otherwise named endpoint (`GET /group/remainder`)

### 4. Missing LICENSE files

**Files:** `cli/LICENSE`, `packages/transports/graphql/LICENSE`, `packages/transports/queue/LICENSE`
**Symptom:** npm would publish packages without a license file, potentially causing legal issues.
**Fix:** Added MIT LICENSE to each.

### 5. `cli/package.json` missing `files` field

**File:** `cli/package.json`
**Symptom:** Without `files`, npm publishes everything — including `src/`, `tsconfig.json`, test fixtures. Bloats install size and leaks source.
**Fix:** Added `"files": ["dist", "README.md", "LICENSE"]`.

### 6. `@capixjs/plugin-logging` missing `test` script

**File:** `packages/plugins/logging/package.json`
**Symptom:** `pnpm test --filter @capixjs/plugin-logging` exits with "Missing script: test". Would fail CI.
**Fix:** Added `"test": "vitest run --passWithNoTests"`.

---

## Documentation Gaps (Phase 16b)

- `packages/transports/ws/README.md` — does not yet document per-transport `capabilities` option (added in Phase 15).
- `packages/transports/rest/README.md` — same gap.
- `packages/core/README.md` — `TransportWithCapabilities` type and per-transport capability model not documented.
- No `docs/` site yet — each package README exists but there is no unified reference.

---

## Polish (fix when touching relevant files)

- `cli/README.md` — `capix generate capability` example uses `my/capability` but does not mention that slash separators are normalised to camelCase identifiers.
- `packages/transports/graphql/README.md` — JSON scalar semantics (no subfield selection) worth a callout.
- Route inference table in `packages/transports/rest/README.md` does not include the `get*`-without-id named-endpoint rule.

---

## Confirmed Working

| Area | Result |
|------|--------|
| Test suite | 454 tests, 0 failures, 0 skipped |
| TypeScript (`tsc --noEmit`) | Clean across all packages |
| `capix generate app myapp` scaffold | Compiles and `server.start()` runs |
| `capix generate capability users/getUser` | Valid TS, correct `getUser` identifier |
| `capix generate group orders` | Valid TS, correct `orders` identifier |
| REST transport | Correct routes for all intent variants |
| REST transport — `GET /users/me` | `getMe` → named endpoint, not collection |
| REST transport — `GET /users` | `getUsers`, `listUsers` → collection |
| WebSocket transport | Guards, subscriptions, context work |
| GraphQL transport | Schema generation, `parseLiteral`, `ZodDefault`/`ZodEffects` unwrap |
| Queue transport | `MemoryQueueAdapter` enqueue/dispatch round-trip |
| Per-transport capability registries (Phase 15) | Override, fallback, isolation, error-when-none all pass |
| `server.invoke()` | Works for server-level capabilities |
| Plugin system | Auth, CORS, helmet, logging compose correctly |
| peerDependency ranges | All packages: `>=0.1.0-0` (includes prereleases) |
| Package contents | All published packages include LICENSE and README |
| Version consistency | All packages at `0.1.0-alpha.1`; monorepo root at `0.0.1` (intentional) |
