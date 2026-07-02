# REST transport

The REST transport maps capabilities to HTTP/1.1 routes. Routes are inferred from capability names automatically — no decorators or annotations.

See the [package README](../../packages/transports/rest/README.md) for the full API.

## Route inference

| Capability | Group | Method | Path |
|---|---|---|---|
| `getUser` (with `id` field) | `users` | GET | `/users/:id` |
| `listUsers` | `users` | GET | `/users` |
| `getUsers` | `users` | GET | `/users` |
| `getMe` | `users` | GET | `/users/me` |
| `getStats` | `users` | GET | `/users/stats` |
| `findByEmail` | `users` | GET | `/users` |
| `createUser` | `users` | POST | `/users` |
| `updateUser` | `users` | PATCH | `/users/:id` |
| `replaceUser` | `users` | PUT | `/users/:id` |
| `deleteUser` | `users` | DELETE | `/users/:id` |
| `unfollow` | `users` | DELETE | `/users/:id/follow` |
| `bulkStatus` | `users` | POST | `/users/bulk-status` |
| `register` | `auth` | POST | `/auth/register` |

Rules:

- `get*` with an `id` field in the input schema → `GET /group/:id`
- `list*`, `find*`, `fetch*`, `read*`, `search*`, `filter*`, `all*` → always `GET /group`
- `get*` without `id` field → `GET /group` only when the remainder matches the group name; otherwise `GET /group/remainder`
- `create*`, `add*`, `new*` → `POST /group`
- `un*` → `DELETE /group/:id/verb`
- `update*`, `edit*`, `patch*`, `modify*` → `PATCH /group/:id`
- `replace*`, `set*`, `put*` → `PUT /group/:id`
- `delete*`, `remove*`, `destroy*`, `cancel*` → `DELETE /group/:id`
- Anything else with `query` intent → `GET /group/key`
- Anything else with `mutation` intent → `POST /group/key`

## Route overrides

Override any inferred route with an explicit path and method:

```ts
restTransport({
  port: 3000,
  overrides: {
    'tasks.listTasks':   { method: 'GET',  path: '/projects/:projectId/tasks' },
    'tasks.createTask':  { method: 'POST', path: '/projects/:projectId/tasks' },
    'admin.exportUsers': { method: 'GET',  path: '/admin/export/users' },
  },
})
```

URL params from the path (`:projectId`) are merged into the capability's input alongside query string parameters and the request body.

## Input merging

The REST transport merges path params, query string, and body into a single validated input object:

```
GET /projects/p-1/tasks?status=todo&page=2
```

```ts
const listTasks = cap(
  z.object({
    projectId: z.string(),
    status:    z.enum(['todo', 'done']).optional(),
    page:      z.coerce.number().default(1),
  }),
  async ({ projectId, status, page }) => { ... },
  'query',
);
```

All three sources (`projectId` from path, `status` and `page` from query string) are merged before validation.

For `GET` requests, input comes from query string + path params. For `POST`/`PATCH`/`PUT`, input comes from body + path params. Body must be `application/json` or `multipart/form-data`.

## Type coercion

Query strings, path params, and multipart text fields always arrive as strings. The transport coerces them based on the capability's input schema, derived once at startup:

- A field typed `z.number()` receives `42` for `?count=42` (also through `.optional()`, `.default()`, `.nullable()`, and refinements)
- A field typed `z.boolean()` receives `true`/`false` for the literal strings `true`/`false`
- Everything else stays a raw string — `?name=123` arrives as the **string** `"123"` for a `z.string()` field, and `?code=01234` keeps its leading zero
- Values that don't parse cleanly (e.g. `?count=abc`) are left as-is so the validation error reports the original input

JSON bodies are never coerced: JSON expresses numbers and booleans itself, so a string where a number belongs is a genuine type error.

Capabilities without an object schema (`z.record`, no schema) receive raw strings. `z.coerce.*` in your schema continues to work and is the right tool for anything beyond plain numbers and booleans.

## File uploads

```ts
import type { UploadedFile } from '@capixjs/transport-rest';
import { z } from 'zod';

const uploadAvatar = cap(
  z.object({
    file:   z.custom<UploadedFile>(),
    userId: z.string(),
  }),
  async ({ file, userId }) => {
    await storage.save(`avatars/${userId}`, file.buffer);
    return { url: `/avatars/${userId}`, mimeType: file.mimeType };
  },
);
```

Send as `multipart/form-data`. Non-file fields are included alongside file fields.

Multipart options:

```ts
restTransport({
  port: 3000,
  multipart: {
    maxFileSize:       5 * 1024 * 1024,              // 5 MiB per file
    maxFiles:          5,
    allowedMimeTypes:  ['image/jpeg', 'image/png'],
  },
})
```

## URL case

Capability keys are converted to kebab-case by default. Override with `urlCase`:

```ts
restTransport({ port: 3000, urlCase: 'snake' }) // bulkStatus → bulk_status
restTransport({ port: 3000, urlCase: 'camel' }) // bulkStatus → bulkStatus
```

## OpenAPI generation

Generate an OpenAPI 3.1 spec from a compiled registry with `generateOpenAPI`. It reuses the transport's route inference, so paths, methods, parameters, and bodies match the running server exactly:

```ts
import { compileRegistry } from '@capixjs/core';
import { generateOpenAPI } from '@capixjs/transport-rest';

const registry = compileRegistry({ users: { getUser, createUser } });
const spec = generateOpenAPI(registry, {
  title: 'My API',
  version: '1.2.0',
  servers: [{ url: 'https://api.example.com' }],
});
```

Pass the same `urlCase` and `overrides` you give `restTransport` so the generated paths line up. Path parameters, query parameters (for GET/DELETE), JSON request bodies (for POST/PATCH/PUT), the `{ data }` response envelope, and the error response shape are all derived from your Zod schemas.

The CLI wraps this as [`capix openapi`](../cli.md#capix-openapi).

## CORS

```ts
restTransport({
  port: 3000,
  cors: {
    origin:      (origin) => origin.endsWith('.example.com'),
    methods:     ['GET', 'POST', 'PATCH', 'DELETE'],
    headers:     ['Content-Type', 'Authorization'],
    credentials: true,
  },
})
```

Or use the `corsPlugin` for a plugin-based approach.

## Timeouts

All requests have a 30-second default timeout. Capabilities that exceed it receive a `504 Timeout` response. Override per-capability with `withTimeout`:

```ts
const getReport = cap(schema, handler, 'query')
  .enhance(withTimeout(120_000)); // 2-minute report generation
```

## Response format

All responses are wrapped in a `{ data: ... }` envelope:

```json
{ "data": { "id": "1", "name": "Alice" } }
```

Errors:

```json
{ "error": "NotFound", "message": "Not found" }
```

HTTP status code is set from the error factory's first argument.
