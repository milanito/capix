# capix-plugin-auth

JWT authentication plugin for [Capix](https://github.com/capix/capix).

Reads the `Authorization: Bearer <token>` header on every request, verifies the JWT, and sets `ctx.user` in the context. Provides a `mustBeAuthenticated` guard for protecting capabilities.

## Install

```bash
npm install capix-plugin-auth jsonwebtoken
```

## Usage

### 1. Create the plugin

```ts
// src/auth.ts
import { authPlugin } from 'capix-plugin-auth';

type AppUser = { id: string; email: string; role: string };

export const {
  plugin: jwtPlugin,
  mustBeAuthenticated,
  helpers: jwt,
} = authPlugin<AppUser>({
  secret: process.env.JWT_SECRET!,
  expiresIn: '7d',           // optional, default '7d'
  userFromToken: (payload) => ({
    id: payload['sub']!,
    email: payload['email'] as string,
    role: payload['role'] as string,
  }),
});
```

### 2. Register the plugin

```ts
// src/server.ts
import { createServer } from 'capix';
import { jwtPlugin } from './auth.js';

const server = createServer({
  context: buildContext,
  capabilities,
  plugins: [jwtPlugin],
  transports: [...],
});
```

### 3. Protect capabilities

Use the two-factory pattern so `ctx.user` is typed correctly in resolvers:

```ts
// src/capabilities.ts
import { capability } from 'capix';
import type { AppUser } from './auth.js';

export type AppContext   = { requestId: string; user: AppUser | null };
export type AuthContext  = AppContext & { user: AppUser };

export const cap     = capability.withContext<AppContext>();
export const authCap = capability.withContext<AuthContext>();
```

```ts
// src/capabilities/profile.ts
import { z } from 'zod';
import { authCap } from '../capabilities.js';
import { mustBeAuthenticated } from '../auth.js';

export const getProfile = authCap(
  z.object({}),
  async (_, ctx) => {
    return { id: ctx.user.id, email: ctx.user.email }; // ctx.user is AppUser
  },
  'query',
).guard(mustBeAuthenticated);
```

### 4. Issue tokens (login endpoint)

```ts
import { jwt } from './auth.js';

export const login = cap(
  z.object({ email: z.string().email(), password: z.string() }),
  async ({ email, password }, ctx) => {
    const user = await ctx.db.verifyPassword(email, password);
    if (!user) throw errors.Unauthorized();
    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return { token };
  },
);
```

## API

### `authPlugin<TUser>(options)`

Creates the plugin, guard, and JWT helpers as a unit.

| Option | Type | Default | Description |
|---|---|---|---|
| `secret` | `string` | required | JWT signing secret |
| `expiresIn` | `string \| number` | `'7d'` | Token lifetime |
| `userFromToken` | `(payload) => TUser \| null` | required | Extract user from verified payload |

Returns `{ plugin, mustBeAuthenticated, helpers }`.

### `createJWTHelpers<TUser>(options)`

Standalone JWT helpers without the Capix plugin machinery. Useful when you need to sign or verify tokens outside of a capability (e.g., in a WebSocket handshake or background job).

```ts
import { createJWTHelpers } from 'capix-plugin-auth';
const jwt = createJWTHelpers({ secret, userFromToken });

const token = jwt.sign({ sub: '123', role: 'admin' });
const user  = await jwt.verify(token); // AppUser | null
```

### `mustBeAuthenticated`

A Capix guard that asserts `ctx.user` is non-null. Throws `401 Unauthorized` if the request has no valid token.

Always pair with `authCap` (the narrowed factory) — see the [two-factory pattern](../../docs/ts-workarounds.md).

## Types

```ts
// Context shape added by the plugin
type AuthContext<TUser>      = BaseContext & { user: TUser | null };
// Context shape after the guard runs
type AuthenticatedContext<TUser> = BaseContext & { user: TUser };
```
