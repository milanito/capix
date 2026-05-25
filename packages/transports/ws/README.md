# capix-transport-ws

WebSocket transport for Capix. Exposes your capabilities over a persistent WebSocket connection.

## Install

```bash
npm install capix capix-transport-ws zod
```

## Usage

```ts
import { createServer } from 'capix';
import { wsTransport } from 'capix-transport-ws';

createServer({
  capabilities: {
    chat: { sendMessage, getHistory },
  },
  transports: [wsTransport({ port: 3001 })],
}).start();
```

## Protocol

Clients send JSON frames:

```json
{ "id": "1", "capability": "chat.sendMessage", "input": { "text": "hello" } }
```

The server responds with:

```json
{ "id": "1", "ok": true, "data": { "messageId": "abc" } }
```

On error:

```json
{ "id": "1", "ok": false, "error": { "code": "Forbidden", "message": "Forbidden", "status": 403 } }
```

The `id` field is echoed back so clients can match responses to requests.

## Combining transports

Run REST and WebSocket side-by-side:

```ts
import { restTransport } from 'capix-transport-rest';
import { wsTransport } from 'capix-transport-ws';

createServer({
  capabilities: { ... },
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001 }),
  ],
}).start();
```

## Options

```ts
wsTransport({
  port: 3001,        // required
  host: '0.0.0.0',  // default: '0.0.0.0'
  path: '/ws',       // default: '/'
})
```

## License

MIT
