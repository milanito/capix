# Beta Test Findings — Full Developer Experience from npm

**Date:** 2026-06-01  
**Packages tested:** `@capixjs/core@0.1.0-alpha.3`, `@capixjs/transport-rest@0.1.0-alpha.3`, `@capixjs/plugin-auth@0.1.0-alpha.3`, `@capixjs/testing@0.1.0-alpha.3`, `@capixjs/cli@0.1.0-alpha.3`  
**Method:** Fresh npm installs only, no file: links, docs followed exactly

---

## Summary

| Phase | Result |
|-------|--------|
| 1. Scaffold (`capix new`) | ✓ Pass |
| 2. CLI introspection (`list`, `show`, `check`, `docs`) | ✓ Pass (minor issue) |
| 3. Real mini-API with auth (TypeScript) | ✓ Pass |
| 4. E2E verification (all routes + auth flows) | ✓ Pass |
| 5. Testing utilities (`@capixjs/testing` + vitest) | ✓ Pass |
| 6. Error response shapes | ✓ Pass |
| 7. Docs vs reality | ✓ Pass |

---

## Blockers (now fixed — were present in alpha.1/alpha.2)

These were resolved before alpha.3 and are documented for historical context.

### B1 — `capix new` installed with broken workspace:* deps (fixed in alpha.2)
`npm publish` was used in CI; it left `workspace:*` in published packages instead of real version numbers.  
**Fix:** CI now uses `pnpm publish --no-git-checks`, which substitutes workspace protocols.

### B2 — Scaffold deps `^0.1.0` excluded prereleases (fixed in alpha.3)
The scaffold template generated `"@capixjs/core": "^0.1.0"`, which npm/pnpm resolves as "stable `1.x`
or nothing". No stable version exists so install failed.  
**Fix:** Template now generates `"@capixjs/core": "alpha"` (dist-tag), which always resolves to the
latest alpha.

---

## Open Issues

### I1 — `capix show` leaks `ZodString` in schema display (minor, cosmetic)

**Severity:** Low — affects human-readable CLI output only.  
**Steps to reproduce:**
```bash
capix show posts.createPost
# Output:
#   title  ZodString    ← should be "string"
#   body   ZodString
```
**Not affected:** `capix docs`, `capix ai-context`, runtime validation — all show `string` correctly.  
**Root cause:** The `show` command prints `schema._def.typeName` or similar Zod internal instead of
calling the schema prettifier used by `docs` and `ai-context`.  
**Fix location:** `cli/src/commands/show.ts` — use the same schema serializer as `docs`.

### I2 — pnpm 9 `minimumReleaseAge` blocks install within 24h of a new release

**Severity:** Medium — affects users who install the package on release day.  
**Details:** pnpm 9 defaults to refusing packages published within the last 24 hours unless
`minimum-release-age=0` is set in `.npmrc`. Setting this in the project `.npmrc` didn't reliably
disable it in testing.  
**Workaround:** Use `npm install` instead of `pnpm install` for the first install on a freshly
published version.  
**Recommendation:** Document this in the "Getting Started" guide under a "Known Limitations" callout,
or add `minimum-release-age=0` to the scaffolded `.npmrc`.

---

## Verified Working

### Scaffold
- `npx @capixjs/cli@alpha new my-app --rest -y` — creates correct project structure
- `npx tsc --noEmit` — compiles clean out of the box
- `npx tsx src/server.ts` — server starts, `/system/ping` → 200

### Auth plugin (`@capixjs/plugin-auth`)
- `authPlugin<User>({ secret, userFromToken })` — correct TypeScript types throughout
- `jwtPlugin` wired via `plugins: [jwtPlugin]` in `createServer` — works
- `mustBeAuthenticated` guard on `.guard()` — correctly blocks unauthenticated requests with 401
- `jwt.sign({ sub: id })` — issues valid JWTs
- Token verification via `Authorization: Bearer <token>` header — works transparently
- `user` available on `ctx` in protected resolvers — fully typed

### Error responses (all consistent shape)
```json
{ "error": "NotFound",   "message": "Not found" }
{ "error": "Unauthorized", "message": "Unauthorized" }
{ "error": "BadRequest", "message": "Input validation failed", "meta": { "issues": ["email: Invalid email"] } }
{ "error": "MethodNotAllowed", "message": "Method not allowed" }
```

### CLI (`@capixjs/cli`)
- `capix list` — shows all routes with HTTP method, guard count, public/protected status
- `capix check` — passes on valid project, exits non-zero on errors
- `capix docs` — clean markdown output, no Zod internals
- `capix ai-context` — clean JSON with `"string"` types (not `ZodString`)
- `capix generate capability posts createPost` — creates `src/capabilities/posts/create-post.ts`
- `capix call items.getItem '{"id":"1"}'` — executes capability in-process

### Testing utilities (`@capixjs/testing`)
- `testServer({ context, capabilities })` — creates in-process test server without HTTP
- `server.call({ capability, input })` — returns `{ ok, status, data?, error?, message? }`
- Unauthenticated guard test: passing context with `user: null` → 401
- Authenticated guard test: passing context with `user: { id, email }` → 200

### Route inference (REST)
| Capability | Inferred route |
|------------|----------------|
| `system.ping` | GET /system/ping |
| `items.getItem` | GET /items/:id |
| `auth.login` | POST /auth/login |
| `posts.listPosts` | GET /posts |
| `posts.createPost` | POST /posts |

All match expected REST conventions.

---

## Recommended Actions

| Priority | Action |
|----------|--------|
| Low | Fix `capix show` ZodString display (#I1) |
| Medium | Document or fix pnpm minimumReleaseAge issue (#I2) |
| Future | When going stable, update scaffold template from `"alpha"` to `"^1.0.0"` |
