# Auth patterns

Authentication in Capix is not a middleware — it is a context builder. Your `buildContext` function reads the `Authorization` header, verifies it, and sets `ctx.user`. Guards then check `ctx.user` to enforce access.

## Which pattern to use

| Situation | Use |
|---|---|
| JWT only | `jwtContextBuilder` |
| JWT + custom fields (`db`, `jobs`, etc.) | `jwtContextBuilder` with `extraContext` |
| JWT + API key fallback | `defineContext` + `createJWTHelpers` |
| Sessions, OAuth, or any custom scheme | `defineContext` directly |

---

## Pattern 1: `jwtContextBuilder` (recommended for most apps)

One function that handles JWT verification and your custom context fields:

```ts
// src/context.ts
import { capability } from '@capixjs/core';
import { jwtContextBuilder, createJWTHelpers } from '@capixjs/plugin-auth';
import { db } from './db.js';

export type AppUser = { id: string; email: string; role: 'customer' | 'admin' };

export const jwt = createJWTHelpers<AppUser>({
  secret: process.env.JWT_SECRET!,
  expiresIn: '7d',
  userFromToken: async (payload) => db.users.get(payload['sub'] as string),
});

// buildContext resolves to: { requestId, user: AppUser | null, db }
export const buildContext = jwtContextBuilder<AppUser, { db: typeof db }>({
  jwtHelpers:   jwt,
  extraContext: async () => ({ db }),
});

export type AppContext  = Awaited<ReturnType<typeof buildContext>>;
export type AuthContext = AppContext & { user: AppUser };

export const cap     = capability.withContext<AppContext>();
export const authCap = capability.withContext<AuthContext>();
```

```ts
// src/capabilities/auth/login.ts
import { z } from 'zod';
import { cap, jwt } from '../../context.js';

export const login = cap(
  z.object({ email: z.string().email(), password: z.string() }),
  async ({ email, password }, ctx) => {
    const user = await ctx.db.verifyCredentials(email, password);
    if (!user) throw errors.Unauthorized();
    return { token: jwt.sign({ sub: user.id, email: user.email, role: user.role }) };
  },
);
```

```ts
// src/capabilities/users/profile.ts
import { z } from 'zod';
import { authCap } from '../../context.js';
import { mustBeAuthenticated } from '@capixjs/plugin-auth';

export const getProfile = authCap(
  z.object({}),
  async (_, ctx) => ctx.user, // ctx.user is AppUser (non-null)
  'query',
).guard(mustBeAuthenticated);
```

---

## Pattern 2: JWT + API key (dual auth)

For APIs that accept both user JWTs and machine-to-machine API keys:

```ts
// src/context.ts
import { defineContext, getHeader } from '@capixjs/core';
import { createJWTHelpers } from '@capixjs/plugin-auth';
import { db } from './db.js';

export type AppUser = { id: string; email: string; role: 'customer' | 'admin' };

const jwtHelpers = createJWTHelpers<AppUser>({
  secret: process.env.JWT_SECRET!,
  userFromToken: async (payload) => db.users.get(payload['sub'] as string),
});

export const buildContext = defineContext(async (req) => {
  const requestId  = crypto.randomUUID();
  const apiKey     = getHeader(req, 'x-api-key');
  const authHeader = getHeader(req, 'authorization') ?? '';

  let user: AppUser | null = null;
  if (apiKey) {
    user = await db.apiKeys.findUser(apiKey);
  } else if (authHeader.startsWith('Bearer ')) {
    user = await jwtHelpers.verify(authHeader.slice(7));
  }

  return { requestId, user, db };
});
```

Both auth paths produce the same `user` shape — guards and resolvers are identical regardless of which method was used.

---

## Pattern 3: Role-based guards

```ts
import { defineGuard, defineError } from '@capixjs/core';

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden:    defineError(403, 'Forbidden'),
};

export const mustBeAuthenticated = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});

export const mustBeAdmin = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
  if (ctx.user.role !== 'admin') throw errors.Forbidden();
});

// Compose on a capability
const adminCapability = cap(schema, handler)
  .guard(mustBeAuthenticated)
  .guard(mustBeAdmin);
```

For role requirements known at definition time, a factory is cleaner:

```ts
const mustHaveRole = (role: string) =>
  defineGuard((ctx) => {
    if (!ctx.user) throw errors.Unauthorized();
    if (ctx.user.role !== role) throw errors.Forbidden();
  });

const adminCap = cap(schema, handler).guard(mustHaveRole('admin'));
```

---

## Token signing and verification

`createJWTHelpers` returns `{ sign, verify }`:

```ts
const jwt = createJWTHelpers<AppUser>({
  secret: process.env.JWT_SECRET!,
  expiresIn: '7d',
  userFromToken: async (payload) => db.users.get(payload['sub'] as string),
});

// Sign — returns a JWT string
const token = jwt.sign({ sub: user.id, email: user.email, role: user.role });

// Verify — returns AppUser | null (never throws)
const user = await jwt.verify(token);
```

Tokens are cached after first verification (LRU, 500 entries by default). The cache is cleared when a token expires.

## RS256 and JWKS (Auth0, Clerk, Cognito, Keycloak)

Every auth entry point (`authPlugin`, `jwtContextBuilder`, `createJWTHelpers`) accepts exactly one of three verification modes:

```ts
// 1. Shared secret — HS256 family (sign + verify)
{ secret: process.env.JWT_SECRET! }

// 2. PEM key pair — RS/ES/PS families (verify; sign too if privateKey given)
{ publicKey: PUBLIC_PEM, privateKey: PRIVATE_PEM }

// 3. Issuer JWKS endpoint — verify-only, keys resolved by the token's kid
{ jwks: { url: 'https://your-tenant.auth0.com/.well-known/jwks.json' } }
```

With `jwks`, the key set is fetched once and cached (10 minutes by default); an unknown `kid` triggers a rate-limited refetch, so issuer key rotation works without restarts, and a flood of forged tokens cannot hammer the endpoint. If the endpoint goes down, the previously fetched keys keep serving.

```ts
export const buildContext = jwtContextBuilder<AppUser, { db: DB }>({
  jwks: { url: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json` },
  userFromToken: async (payload) => db.users.bySub(payload['sub'] as string),
  extraContext: async () => ({ db }),
});
```

Verification algorithms are always pinned (HS family for `secret`, RS/ES/PS families for keys and JWKS) — a token whose `alg` header falls outside the configured family is rejected, which blocks algorithm-confusion attacks. Override with `algorithms` if you need to narrow further (e.g. `['RS256']`).
