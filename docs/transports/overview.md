# Transports

A transport connects an incoming communication channel to the Capix execution engine. The same capability registry can be served over multiple transports simultaneously.

## Available transports

| Transport | Package | Protocol |
|---|---|---|
| REST | `@capixjs/transport-rest` | HTTP/1.1 |
| WebSocket | `@capixjs/transport-ws` | WebSocket |
| GraphQL | `@capixjs/transport-graphql` | HTTP/1.1 (GraphQL over HTTP) |
| Queue | `@capixjs/transport-queue` | Custom (adapter-based) |
| MCP | `@capixjs/transport-mcp` | Model Context Protocol (stdio / Streamable HTTP) |

## Multiple transports

```ts
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { wsTransport } from '@capixjs/transport-ws';
import { graphqlTransport } from '@capixjs/transport-graphql';

createServer({
  context:      buildContext,
  capabilities: { users, posts },
  transports: [
    restTransport({ port: 3000 }),
    wsTransport({ port: 3001 }),
    graphqlTransport({ port: 4000 }),
  ],
}).start();
```

All three transports serve the same capabilities. The execution engine is shared.

## Per-transport capabilities

Pass `capabilities` directly to a transport to override which capabilities it exposes:

```ts
const publicAPI = { items: { list: listItems, get: getItem } };
const memberAPI = { items: { create: createItem, update: updateItem } };
const jobsOnly  = { jobs: { processItem, generateReport } };

createServer({
  context:      buildContext,
  capabilities: { ...publicAPI, ...memberAPI }, // default for REST + GraphQL
  transports: [
    restTransport({ port: 3000 }), // uses server-level capabilities
    graphqlTransport({ port: 4000, capabilities: publicAPI }), // GraphQL only exposes public API
    queueTransport({ queues: ['jobs'], adapter, capabilities: jobsOnly }), // queue only
  ],
});
```

If every transport specifies its own `capabilities`, the top-level field can be omitted. Capix throws at startup if a transport has no capabilities and no server-level default is provided.

## What transports can and cannot do

Transports can:
- Parse incoming requests and extract the capability name, input, and headers
- Pass headers to `buildContext` via the `RawRequest`
- Forward the structured response to the caller
- Apply transport-specific features (file upload, subscriptions, batching)

Transports cannot:
- Skip guards
- Access the resolver directly
- Bypass input validation

Every transport goes through the same execution engine. Guards always run. Input is always validated. This means adding a transport never creates a security hole.

## Custom transports

A transport is an object with a `mount(invoke, options)` method:

```ts
import type { Transport, InvokeFn, MountOptions } from '@capixjs/core';

const myTransport: Transport = {
  async mount(invoke: InvokeFn, options: MountOptions) {
    // Set up your server/listener here
    // Call invoke() for each incoming request

    const response = await invoke({
      capability: 'users.getUser',
      input: { id: '1' },
      headers: { authorization: 'Bearer token' },
    });

    // response.ok, response.status, response.data or response.error
    return async () => {
      // Teardown — called by server.stop()
    };
  },
};
```

For per-transport capabilities, implement `TransportWithCapabilities`:

```ts
import type { TransportWithCapabilities, GroupTree } from '@capixjs/core';

function myTransport(options: { capabilities?: GroupTree }): TransportWithCapabilities {
  return {
    _capabilities: options.capabilities,
    async mount(invoke, { registry }) {
      // ...
    },
  };
}
```

## Lifecycle

`createServer(config)` builds the server but does not start any transports. Call `.start()` to mount all transports. Call `.stop()` to unmount them in the reverse order they were started.

```ts
const server = createServer({ ... });
await server.start();

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
```
