# @capixjs/plugin-cors

CORS plugin for Capix. Adds Cross-Origin Resource Sharing headers to all responses when using the REST transport.

## Install

```bash
npm install @capixjs/plugin-cors
```

## Usage

```ts
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { corsPlugin } from '@capixjs/plugin-cors';

createServer({
  capabilities: { ... },
  plugins: [
    corsPlugin({
      origin: ['https://app.example.com', 'https://admin.example.com'],
      credentials: true,
    }),
  ],
  transports: [restTransport({ port: 3000 })],
}).start();
```

## Options

```ts
corsPlugin({
  // Allowed origins. String, string[], or function
  origin: '*',
  origin: 'https://example.com',
  origin: ['https://app.example.com', 'https://admin.example.com'],
  origin: (origin) => origin.endsWith('.example.com'),

  // Allowed methods (default: GET, POST, PATCH, PUT, DELETE, OPTIONS)
  methods: ['GET', 'POST'],

  // Allowed request headers (default: Content-Type, Authorization)
  headers: ['Content-Type', 'Authorization', 'X-Custom-Header'],

  // Allow cookies / credentials (default: false)
  credentials: true,

  // Preflight cache duration in seconds (default: 86400)
  maxAge: 3600,
})
```

## License

MIT
