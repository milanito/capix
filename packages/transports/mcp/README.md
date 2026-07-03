# @capixjs/transport-mcp

MCP transport for [Capix](https://github.com/milanito/capix). Exposes every capability as a [Model Context Protocol](https://modelcontextprotocol.io) tool, so AI clients — Claude Code, editors, agents — can call your server directly. Guards, input validation, and typed errors run through the same execution engine as every other transport.

## Install

```bash
npm install @capixjs/core @capixjs/transport-mcp zod
```

## Usage

```ts
import { createServer } from '@capixjs/core';
import { mcpTransport } from '@capixjs/transport-mcp';
import { buildContext, capabilities } from './capabilities.js';

createServer({
  context: buildContext,
  capabilities,
  transports: [
    // stdio — for MCP clients that spawn the server process
    mcpTransport({ name: 'my-api', version: '1.0.0' }),

    // or Streamable HTTP — mountable alongside your other transports
    // mcpTransport({ port: 3001, path: '/mcp', name: 'my-api', version: '1.0.0' }),
  ],
}).start();
```

Or serve a capabilities file straight from the CLI:

```bash
claude mcp add my-api -- npx capix mcp --config src/capabilities.ts
```

## Tool mapping

| Capability | MCP tool |
|---|---|
| `users.getUser` | tool `users_getUser` |
| Zod input schema | `inputSchema` (JSON Schema) |
| Zod object output schema | `outputSchema` + `structuredContent` |
| intent `query` | `readOnlyHint: true` |
| intent `delete` | `destructiveHint: true` |
| Guard rejection / validation failure | tool error (`isError: true`) with the typed code and issues |

Intent follows the same rule as REST route inference: explicit intent wins, otherwise it is inferred from the capability's key name (`getUser` → query, `deleteUser` → delete).

In HTTP mode, request headers are forwarded to the context builder — header-based auth guards behave identically to the REST transport. In stdio mode there are no headers; capabilities behind auth guards will reject unless your context builder allows headerless requests.

## Options

| Option | Description |
|---|---|
| `port` | Serve Streamable HTTP on this port; omit for stdio |
| `host` | Bind host in HTTP mode (default `0.0.0.0`) |
| `path` | MCP endpoint path in HTTP mode (default `/mcp`) |
| `name`, `version` | Reported during the MCP handshake |
| `timeoutMs` | Per-call timeout (default 30 000) |
| `capabilities` | Per-transport registry — expose only a subset of capabilities to AI clients |

## Docs

- [MCP transport guide](https://github.com/milanito/capix/blob/master/docs/transports/mcp.md)
- [Working example](https://github.com/milanito/capix/tree/master/examples/with-mcp) — one registry served over REST and MCP at once
