# capix-plugin-helmet

Security headers plugin for Capix. Sets Content-Security-Policy, X-Frame-Options, and other protective headers on all responses.

## Install

```bash
npm install capix-plugin-helmet
```

## Usage

```ts
import { createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';
import { helmetPlugin } from 'capix-plugin-helmet';

createServer({
  capabilities: { ... },
  plugins: [helmetPlugin()],
  transports: [restTransport({ port: 3000 })],
}).start();
```

## Default headers

| Header | Default value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Download-Options` | `noopen` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Permitted-Cross-Domain-Policies` | `none` |

## Options

```ts
helmetPlugin({
  // Override or disable individual headers
  contentSecurityPolicy: "default-src 'self'; img-src *",
  contentSecurityPolicy: false,  // disable this header
  frameOptions: 'SAMEORIGIN',
  frameOptions: false,           // disable X-Frame-Options
})
```

Passing `false` for any option omits that header entirely.

## License

MIT
