# @capixjs/plugin-cors

CORS plugin for Capix. Adds Cross-Origin Resource Sharing headers to all responses when using the REST transport.

## Install

```bash
npm install @capixjs/plugin-cors
```

## Usage

`cors()` returns REST-transport options (`{ cors, hooks }`) — spread it into `restTransport()`. It is not a `definePlugin()`-style plugin, so it does not go in `createServer({ plugins: [...] })`.

```ts
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { cors } from '@capixjs/plugin-cors';

createServer({
  capabilities: { ... },
  transports: [
    restTransport({
      port: 3000,
      ...cors({ origin: ['https://app.example.com', 'https://admin.example.com'] }),
    }),
  ],
}).start();
```

To combine with `@capixjs/plugin-helmet`, use that package's `mergeHooks()` — it merges both plugins' `onRequest` hooks (so neither overwrites the other's headers) and carries the `cors` field through:

```ts
import { helmet, mergeHooks } from '@capixjs/plugin-helmet';

restTransport({
  port: 3000,
  ...mergeHooks(
    cors({ origin: 'https://app.example.com' }),
    helmet(),
  ),
})
```

## Options

```ts
cors({
  // Allowed origins. String, string[], or function (default: '*')
  origin: '*',
  origin: 'https://example.com',
  origin: ['https://app.example.com', 'https://admin.example.com'],
  origin: (origin) => origin.endsWith('.example.com'),

  // Allowed methods, as the literal Access-Control-Allow-Methods value
  // (default: 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
  methods: 'GET, POST',

  // Allowed request headers, as the literal Access-Control-Allow-Headers value
  // (default: 'Content-Type, Authorization')
  headers: 'Content-Type, Authorization, X-Custom-Header',

  // Reflect a Vary: Origin header when origin is a function (default: true)
  varyOrigin: true,
})
```

There is no `credentials` or `maxAge` option — this plugin doesn't set `Access-Control-Allow-Credentials` or `Access-Control-Max-Age`.

## License

MIT
