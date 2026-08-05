# @capixjs/plugin-helmet

Security headers plugin for Capix. Sets Content-Security-Policy, X-Frame-Options, and other protective headers on all responses.

## Install

```bash
npm install @capixjs/plugin-helmet
```

## Usage

`helmet()` returns REST-transport options (`{ hooks }`) — spread it into `restTransport()`. It is not a `definePlugin()`-style plugin, so it does not go in `createServer({ plugins: [...] })`.

```ts
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { helmet } from '@capixjs/plugin-helmet';

createServer({
  capabilities: { ... },
  transports: [restTransport({ port: 3000, ...helmet() })],
}).start();
```

To combine with `@capixjs/plugin-cors`, use `mergeHooks()` (also exported from this package) — it merges both plugins' `onRequest` hooks (so neither overwrites the other's headers) and carries the `cors` field through:

```ts
import { cors } from '@capixjs/plugin-cors';
import { mergeHooks } from '@capixjs/plugin-helmet';

restTransport({
  port: 3000,
  ...mergeHooks(
    cors({ origin: 'https://app.example.com' }),
    helmet(),
  ),
})
```

## Default headers

| Header | Default value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | not set (disabled by default) |

## Options

```ts
helmet({
  // Override or disable individual headers — `false` omits the header entirely
  contentSecurityPolicy: "default-src 'self'; img-src *",
  contentSecurityPolicy: false,

  frameOptions: 'DENY' | 'SAMEORIGIN',
  frameOptions: false,

  hsts: 'max-age=63072000; includeSubDomains; preload',
  hsts: false,

  noSniff: false,          // omit X-Content-Type-Options (default: true)

  referrerPolicy: 'same-origin',
  referrerPolicy: false,

  permissionsPolicy: 'geolocation=(), camera=()',  // off (false) by default
})
```

## License

MIT
