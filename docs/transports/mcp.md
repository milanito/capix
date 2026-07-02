# MCP transport

`@capixjs/transport-mcp` exposes every capability as a [Model Context Protocol](https://modelcontextprotocol.io) tool, so AI clients (Claude Code, editors, agents) can call your server directly. Guards, input validation, and typed errors run through the same execution engine as every other transport.

```bash
npm install @capixjs/transport-mcp
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

Intent follows the same rule as REST route inference: an explicit intent wins, otherwise it is inferred from the capability's key name (`getUser` → query, `deleteUser` → delete).

## stdio mode

Omit `port` and the process serves MCP over stdin/stdout — diagnostics go to stderr:

```ts
import { createServer } from '@capixjs/core';
import { mcpTransport } from '@capixjs/transport-mcp';

createServer({
  context: buildContext,
  capabilities: { users: { getUser, createUser } },
  transports: [mcpTransport({ name: 'my-api', version: '1.0.0' })],
}).start();
```

For quick local use there is also [`capix mcp`](../cli.md#capix-mcp), which serves your capabilities file over stdio with a stub context:

```bash
claude mcp add my-api -- npx capix mcp --config src/capabilities.ts
```

## HTTP mode

Pass `port` to serve the MCP Streamable HTTP transport (stateless) — mountable alongside your other transports. Request headers are forwarded to the context builder exactly like on the REST transport, so header-based auth guards keep working:

```ts
createServer({
  context: buildContext,
  capabilities,
  transports: [
    restTransport({ port: 3000 }),
    mcpTransport({ port: 3001, path: '/mcp', name: 'my-api', version: '1.0.0' }),
  ],
}).start();
```

## Options

| Option | Description |
|---|---|
| `port` | Serve Streamable HTTP on this port; omit for stdio |
| `host` | Bind host in HTTP mode (default `0.0.0.0`) |
| `path` | MCP endpoint path in HTTP mode (default `/mcp`) |
| `name`, `version` | Reported during the MCP handshake |
| `timeoutMs` | Per-call timeout (default 30 000) |
| `capabilities` | Per-transport registry, overrides the server-level default |

## Scoping what you expose

Every capability in the registry becomes a callable tool. If some capabilities should not be reachable by AI clients, give the MCP transport its own registry:

```ts
mcpTransport({ port: 3001, capabilities: { search: { findDocs }, users: { getUser } } })
```

Guards still run on every call — but not exposing a capability at all is the stronger default.
