# capix-plugin-auth

JWT authentication plugin for Capix. Reads the `Authorization: Bearer <token>` header, verifies the JWT, and provides typed `ctx.user` access in every capability.

## Install

```bash
npm install capix-plugin-auth jsonwebtoken
```

## Recommended: `jwtContextBuilder`

The simplest approach — one function that handles JWT verification AND your custom context fields with full type safety:

```ts
// src/context.ts
import { defineContext, capability } from 'capix';
import { jwtContextBuilder, createJWTHelpers } from 'capix-plugin-auth';
import { db } from './db.js';
import { jobs } from './jobs.js';

export type AppUser = { id: string; email: string; role: 'customer' | 'admin' };

export const jwtHelpers = createJWTHelpers<AppUser>({
  secret: process.env.JWT_SECRET ?? 'dev-secret',
  expiresIn: '7d',
  userFromToken: async (payload) => db.users.get(payload['sub'] as string),
});

// buildContext resolves to: { requestId, user: AppUser | null, db, jobs }
export const buildContext = jwtContextBuilder<AppUser, { db: typeof db; jobs: typeof jobs }>({
  jwtHelpers,
  extraContext: async (_req) => ({ db, jobs }),
});

// Two scoped factories — one for public capabilities, one for protected ones
export type AppContext  = { requestId: string; user: AppUser | null; db: typeof db; jobs: typeof jobs };
export type AuthContext = AppContext & { user: AppUser };

export const cap     = capability.withContext<AppContext>();
export const authCap = capability.withContext<AuthContext>();
```

```ts
// src/server.ts
import { createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';
import { buildContext } from './context.js';
import { capabilities } from './capabilities/index.js';

createServer({
  context: buildContext,
  capabilities,
  transports: [restTransport({ port: 3000 })],
}).start();
```

```ts
// src/capabilities/profile.ts
import { z } from 'zod';
import { authCap } from '../context.js';
import { mustBeAuthenticated } from 'capix-plugin-auth';

export const getProfile = authCap(
  z.object({}),
  async (_, ctx) => ({ id: ctx.user.id, email: ctx.user.email }), // ctx.user is AppUser
  'query',
).guard(mustBeAuthenticated);
```

```ts
// src/capabilities/auth/login.ts — issue tokens
import { z } from 'zod';
import { cap } from '../context.js';
import { jwtHelpers } from '../context.js';

export const login = cap(
  z.object({ email: z.string().email(), password: z.string() }),
  async ({ email, password }, ctx) => {
    const user = await ctx.db.verifyCredentials(email, password);
    if (!user) throw errors.Unauthorized();
    return { token: jwtHelpers.sign({ sub: user.id, email: user.email, role: user.role }) };
  },
);
```

## Alternative: `authPlugin` (plugin-based)

Use when you want Capix to manage the JWT context extension via the plugin system:

```ts
// src/auth.ts
import { authPlugin } from 'capix-plugin-auth';

type AppUser = { id: string; email: string; role: string };

export const { plugin: jwtPlugin, mustBeAuthenticated, helpers: jwt } = authPlugin<AppUser>({
  secret: process.env.JWT_SECRET!,
  userFromToken: (payload) => ({ id: payload['sub'] as string, email: payload['email'] as string, role: payload['role'] as string }),
});
```

```ts
// src/server.ts
createServer({
  context: buildContext,
  capabilities,
  plugins: [jwtPlugin],
  transports: [restTransport({ port: 3000 })],
}).start();
```

Note: `authPlugin` composes with `buildContext` via the plugin system but loses the ability to add typed custom fields (like `db`, `jobs`) through the plugin — use `jwtContextBuilder` with `extraContext` for that.

## API

### `jwtContextBuilder<TUser, TExtra>(options)`

Builds a complete `ContextBuilder` that handles JWT verification and optional extra context.

| Option | Type | Required | Description |
|---|---|---|---|
| `jwtHelpers` | `JWTHelpers<TUser>` | yes | From `createJWTHelpers` |
| `extraContext` | `(req) => TExtra \| Promise<TExtra>` | no | Adds custom fields (db, jobs, etc.) |

Returns a `ContextBuilder` typed as `{ requestId, user: TUser | null } & TExtra`.

### `createJWTHelpers<TUser>(options)`

Standalone JWT sign/verify utilities.

| Option | Type | Required | Description |
|---|---|---|---|
| `secret` | `string` | yes | JWT signing secret |
| `expiresIn` | `string \| number` | no | Token lifetime (default `'7d'`) |
| `userFromToken` | `(payload) => TUser \| null \| Promise<TUser \| null>` | yes | Extract user from verified payload |

```ts
const jwt = createJWTHelpers<AppUser>({ secret, userFromToken });
const token = jwt.sign({ sub: '123', role: 'admin' });
const user  = await jwt.verify(token); // AppUser | null
```

### `authPlugin<TUser>(options)`

Creates `{ plugin, mustBeAuthenticated, helpers }` as a unit.

### `mustBeAuthenticated`

Guard that asserts `ctx.user` is non-null. Throws `401 Unauthorized` when no valid token is present. Pair with `authCap` (the narrowed factory) so `ctx.user` is typed as non-null in the resolver.

## Dual auth: JWT + API key

For APIs that accept both user sessions (JWT Bearer tokens) and machine-to-machine auth (API keys), write `buildContext` manually using `createJWTHelpers` and inspect the incoming headers yourself:

```ts
// src/context.ts
import { defineContext } from 'capix';
import { createJWTHelpers } from 'capix-plugin-auth';
import { db } from './db.js';

export type AppUser = { id: string; email: string; role: 'customer' | 'admin' };

const jwtHelpers = createJWTHelpers<AppUser>({
  secret: process.env.JWT_SECRET!,
  userFromToken: async (payload) => db.users.get(payload['sub'] as string),
});

export const buildContext = defineContext(async (req) => {
  const requestId = crypto.randomUUID();
  let user: AppUser | null = null;

  const authHeader = req.headers['authorization'] ?? '';
  const apiKeyHeader = req.headers['x-api-key'];

  if (apiKeyHeader) {
    // API key auth — look up the associated service account
    user = await db.apiKeys.findUser(String(apiKeyHeader));
  } else if (authHeader.startsWith('Bearer ')) {
    // JWT auth
    user = await jwtHelpers.verify(authHeader.slice(7));
  }

  return { requestId, user, db };
});
```

Both paths produce the same `user` shape, so the rest of your capabilities — guards, resolvers — work identically regardless of which auth method was used.

**When to use this pattern vs `jwtContextBuilder`:**

- Use `jwtContextBuilder` when all your clients use JWT Bearer tokens (the common case).
- Use manual `defineContext` when you need a second auth path (API keys, session cookies, service-to-service tokens) that `jwtContextBuilder` can't express.

## License

MIT
