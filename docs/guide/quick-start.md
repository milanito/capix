# Quick start

From zero to a running API in 5 minutes.

## Scaffold a project

```bash
npx capix-cli@alpha new my-api
cd my-api
pnpm install
pnpm dev
```

The server starts at `http://localhost:3000`. You should see:

```
[capix] Server started on http://localhost:3000
[capix] Routes:
  GET  /items/:id    items.getItem
  GET  /items        items.listItems
  POST /items        items.createItem
```

## Make a request

```bash
curl http://localhost:3000/items
# → { "data": [] }

curl -X POST http://localhost:3000/items \
  -H 'Content-Type: application/json' \
  -d '{"name": "My first item"}'
# → { "data": { "id": "1", "name": "My first item" } }

curl http://localhost:3000/items/1
# → { "data": { "id": "1", "name": "My first item" } }
```

## What was generated

```
my-api/
├── src/
│   ├── capabilities.ts   # cap and authCap factories
│   ├── context.ts        # buildContext, errors
│   ├── server.ts         # server entry point
│   └── capabilities/
│       └── items/
│           ├── get.ts
│           ├── list.ts
│           └── create.ts
├── tsconfig.json
└── package.json
```

## Add a capability

```bash
# Generate a capability file
npx capix generate capability users getUser

# → src/capabilities/users/get-user.ts
```

The generated file:

```ts
import { z } from 'zod';
import { cap } from '../../capabilities.js';

export const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => {
    return { id }; // implement your resolver here
  },
  'query',
);
```

Register it in your capabilities index:

```ts
// src/capabilities/index.ts
import { getUser } from './users/get-user.js';

export const capabilities = {
  items: { getItem, listItems, createItem },
  users: { getUser },  // ← add this line
};
```

The REST transport infers `GET /users/:id` from the name `getUser` automatically.

## Add a guard

Guards are preconditions — they run before the resolver and throw to reject the request:

```ts
// src/context.ts
import { defineGuard, defineError } from 'capix';

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
};

export const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});
```

Apply it to your capability:

```ts
export const getUser = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => ({ id }),
  'query',
).guard(mustBeUser);
```

Now any request without a valid user gets `401 Unauthorized`.

## Next steps

- [Capabilities](./capabilities.md) — the full capability API
- [Guards](./guards.md) — guards, input guards, and narrowing
- [Context](./context.md) — building request context
- [Errors](./errors.md) — typed error factories
- [Enhancers](./enhancers.md) — caching, rate limiting, circuit breakers
- [Transports](../transports/overview.md) — REST, WebSocket, GraphQL, Queue
