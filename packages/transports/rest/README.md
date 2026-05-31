# @capixjs/transport-rest

HTTP/1.1 REST transport for Capix. Mounts your capabilities as REST endpoints with automatic route inference.

## Install

```bash
npm install @capixjs/core @capixjs/transport-rest zod
```

## Usage

```ts
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';

createServer({
  capabilities: {
    users: { getUser, listUsers, createUser, updateUser, deleteUser },
  },
  transports: [restTransport({ port: 3000 })],
}).start();
```

## Route inference

Routes are inferred from capability names — no decorators or annotations needed:

| Capability | Group | Method | Path |
|---|---|---|---|
| `getUser` (with `id` field) | `users` | GET | `/users/:id` |
| `listUsers` | `users` | GET | `/users` |
| `getUsers` | `users` | GET | `/users` |
| `getMe` | `users` | GET | `/users/me` |
| `getStats` | `users` | GET | `/users/stats` |
| `findByEmail` | `users` | GET | `/users` |
| `searchUsers` | `users` | GET | `/users` |
| `createUser` | `users` | POST | `/users` |
| `addUser` | `users` | POST | `/users` |
| `updateUser` | `users` | PATCH | `/users/:id` |
| `replaceUser` | `users` | PUT | `/users/:id` |
| `deleteUser` | `users` | DELETE | `/users/:id` |
| `removeUser` | `users` | DELETE | `/users/:id` |
| `unfollow` | `users` | DELETE | `/users/:id/follow` |
| `bulkStatus` | `users` | POST | `/users/bulk-status` |
| `register` | `auth` | POST | `/auth/register` |

Rules:
- The path prefix comes from the capability's group key (`users`, `auth`, etc.)
- `get*` with an `id` field in the input schema → `GET /group/:id`
- `list*`, `find*`, `fetch*`, `read*`, `search*`, `filter*`, `all*` → `GET /group`
- `get*` without `id` field → collection (`GET /group`) only when the remainder matches the group name (e.g. `getUsers` in `users`); otherwise named endpoint (`GET /group/remainder`)
- `create*`, `add*`, `new*` → `POST /group`
- `un*` → `DELETE /group/:id/verb` (inverse sub-resource)
- `update*`, `edit*`, `patch*`, `modify*` → `PATCH /group/:id`
- `replace*`, `set*`, `put*` → `PUT /group/:id`
- `delete*`, `remove*`, `destroy*`, `cancel*` → `DELETE /group/:id`
- Anything else with `query` intent → `GET /group/key`
- Anything else with `mutation` intent → `POST /group/key`

Capability keys are converted to kebab-case by default: `bulkStatus` → `bulk-status`. Override with `urlCase: 'camel' | 'snake'`.

For nested resource routes (`/projects/:projectId/tasks`), use `overrides`:

```ts
restTransport({
  port: 3000,
  overrides: {
    'tasks.listTasks':  { method: 'GET',  path: '/projects/:projectId/tasks' },
    'tasks.createTask': { method: 'POST', path: '/projects/:projectId/tasks' },
  },
})
```

## HTTP override

Override the inferred route when needed:

```ts
const importUsers = capability(
  z.object({ file: z.string() }),
  handler,
  { http: { method: 'POST', path: '/admin/import' } },
);
```

## CORS

```ts
restTransport({
  port: 3000,
  cors: {
    origin: (origin) => origin.endsWith('.example.com'),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    headers: ['Content-Type', 'Authorization'],
    credentials: true,
  },
})
```

`origin` can be a string, string array, or `(origin: string) => boolean` function.

## Request hooks

```ts
restTransport({
  port: 3000,
  onRequest: (req, res) => {
    res.setHeader('X-Request-Id', crypto.randomUUID());
  },
})
```

## File uploads

Use `UploadedFile` from the transport for typed file handling:

```ts
import type { UploadedFile } from '@capixjs/transport-rest';
import { z } from 'zod';

const uploadAvatar = capability(
  z.object({
    file: z.custom<UploadedFile>(),
    userId: z.string(),
  }),
  async ({ file, userId }) => {
    await storage.save(`avatars/${userId}`, file.buffer);
    return { url: `/avatars/${userId}` };
  },
);
```

Send multipart/form-data. Non-file fields are merged alongside file fields in the parsed input.

## Options

```ts
restTransport({
  port: 3000,                  // required
  host: '0.0.0.0',             // default: '0.0.0.0'
  maxBodySize: 1_048_576,      // bytes, default: 1 MiB
  urlCase: 'kebab',            // 'kebab' (default) | 'camel' | 'snake'
  cors: { ... },
  onRequest: (req, res) => void,
  multipart: { maxFileSize, maxFiles, allowedMimeTypes },
})
```

## Per-transport capabilities

Pass `capabilities` directly to the transport to expose only a subset on REST, independent of other transports:

```ts
const publicAPI = { items: { list: listItems, get: getItem } };
const memberAPI = { items: { create: createItem, update: updateItem } };

createServer({
  context: buildContext,
  transports: [
    restTransport({ port: 3000, capabilities: { ...publicAPI, ...memberAPI } }),
  ],
});
```

## Exports

| Export | Description |
|---|---|
| `restTransport(opts)` | Creates an HTTP/REST transport |
| `generateRoutes(registry, opts?)` | Returns route definitions for a registry |
| `compileRouter(routes)` | Compiles routes into a radix-tree router |
| `uploadedFile()` | Zod schema for file upload fields |
| `UploadedFile` | Type for uploaded file objects |
| `RestTransportOptions` | Options type for `restTransport` |
| `GenerateRoutesOptions` | Options type for `generateRoutes` |

## License

MIT
