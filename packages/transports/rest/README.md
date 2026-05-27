# capix-transport-rest

HTTP/1.1 REST transport for Capix. Mounts your capabilities as REST endpoints with automatic route inference.

## Install

```bash
npm install capix capix-transport-rest zod
```

## Usage

```ts
import { createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';

createServer({
  capabilities: {
    users: { getUser, listUsers, createUser, updateUser, deleteUser },
  },
  transports: [restTransport({ port: 3000 })],
}).start();
```

## Route inference

Routes are inferred from capability names — no decorators or annotations needed:

| Capability name | Method | Path |
|---|---|---|
| `getUser` | GET | `/users/:id` |
| `listUsers` | GET | `/users` |
| `createUser` | POST | `/users` |
| `addUser` | POST | `/users` |
| `updateUser` | PATCH | `/users/:id` |
| `replaceUser` | PUT | `/users/:id` |
| `deleteUser` | DELETE | `/users/:id` |
| `removeUser` | DELETE | `/users/:id` |
| `bulkStatus` | POST | `/users/bulk-status` |
| `register` | POST | `/auth/register` |

Rules:
- The first path segment comes from the capability group key (e.g., `users`)
- `get*` with an `id`-shaped input field → `GET /:group/:id`
- `get*` without `id` / `list*` / `find*` / `search*` → `GET /:group`
- `create*` / `add*` / `new*` → `POST /:group`
- `update*` / `edit*` / `modify*` → `PATCH /:group/:id`
- `replace*` / `set*` → `PUT /:group/:id`
- `delete*` / `remove*` / `destroy*` → `DELETE /:group/:id`
- Everything else → `POST /:group/:key` (key converted to kebab-case)

Capability keys are converted to kebab-case by default: `bulkStatus` → `bulk-status`, `listItems` → `list-items`. Override with `urlCase: 'camel' | 'snake'`.

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
import type { UploadedFile } from 'capix-transport-rest';
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
