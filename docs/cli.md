# CLI

`@capixjs/cli` provides scaffolding, code generation, introspection, and development tools.

## Install

```bash
npm install -g @capixjs/cli
# or use without installing:
npx @capixjs/cli <command>
```

## Scaffolding

### `capix new [name]`

Create a new Capix project.

```bash
capix new my-api
cd my-api && pnpm install && pnpm dev
```

Generated structure:

```
my-api/
├── src/
│   ├── capabilities.ts    # cap and authCap factories
│   ├── context.ts         # buildContext, errors
│   ├── server.ts          # entry point
│   └── capabilities/
│       └── items/
│           ├── get.ts
│           ├── list.ts
│           └── create.ts
├── tsconfig.json
├── package.json
└── .cursor/rules
```

---

## Code generation

### `capix generate capability [group] <name>` (alias: `g capability`)

Generate a capability file.

```bash
capix generate capability users getUser
# → src/capabilities/users/get-user.ts

capix g capability orders createOrder
# → src/capabilities/orders/create-order.ts
```

Names with path separators are normalised to camelCase identifiers:

```bash
capix g capability products/variants list
# → src/capabilities/products/variants/list.ts
# → export const list = cap(...)
```

### `capix generate group <name>` (alias: `g group`)

Generate a capability group index file.

```bash
capix generate group payments
# → src/capabilities/payments/index.ts
```

---

## Development

### `capix dev [entry]`

Start the dev server with file watching. Restarts automatically on changes.

```bash
capix dev
capix dev src/server.ts
```

### `capix check`

Validate the server configuration — duplicate routes, naming conflicts, missing schemas.

```bash
capix check
capix check --config src/capabilities/index.ts
```

---

## Introspection

### `capix list` (alias: `ls`)

List all capabilities with their HTTP routes and guard count.

```bash
capix list
```

Example output:

```
Capabilities (6)

  users.getUser     GET     /users/:id       1 guard
  users.listUsers   GET     /users           public
  users.createUser  POST    /users           2 guards
  auth.login        POST    /auth/login      public
  auth.register     POST    /auth/register   public
  auth.me           GET     /auth/me         1 guard
```

### `capix show <capability>`

Show full details for a single capability: input schema, output schema, intent, inferred route, and guards.

```bash
capix show users.getUser
```

### `capix call <capability> [input]`

Invoke a capability directly without a running server. Uses a minimal context (no auth, no database).

```bash
capix call items.listItems
capix call items.getItem '{"id":"1"}'
```

---

## Documentation generation

### `capix docs`

Generate Markdown API documentation for all capabilities.

```bash
capix docs                            # print to stdout
capix docs --output docs/api.md       # write to file
```

### `capix client`

Generate a typed TypeScript fetch client from your capability registry.

```bash
capix client --output src/client.ts
```

### `capix openapi`

Generate an OpenAPI 3.1 specification from your capability registry. Routes, parameters, request bodies, and response schemas are derived from the same route inference the REST transport uses, so the spec matches the running server.

```bash
capix openapi                                  # print to stdout
capix openapi --output openapi.json            # write to file
capix openapi --title "My API" --api-version 1.2.0 --server https://api.example.com
```

Options:

| Flag | Description |
|---|---|
| `--config <path>` | Path to capabilities file |
| `--output <file>` | Write the spec to a file instead of stdout |
| `--title <title>` | API title (default `Capix API`) |
| `--api-version <version>` | API version string (default `0.1.0`) |
| `--description <text>` | API description |
| `--server <url>` | Server URL to include in the spec |
| `--url-case <case>` | URL segment case: `kebab` \| `camel` \| `snake` — must match your `restTransport` config |

The spec is also available programmatically via `generateOpenAPI(registry, options)` from `@capixjs/transport-rest` — useful for serving it from an endpoint or feeding Swagger UI.

### `capix mcp`

Serve your capabilities as MCP (Model Context Protocol) tools. Defaults to stdio — the mode MCP clients like Claude Code spawn directly:

```bash
capix mcp                              # stdio server
capix mcp --port 4000                  # Streamable HTTP on :4000/mcp
claude mcp add my-api -- npx capix mcp --config src/capabilities.ts
```

Options:

| Flag | Description |
|---|---|
| `--config <path>` | Path to capabilities file |
| `--port <port>` | Serve Streamable HTTP instead of stdio |
| `--name <name>` | MCP server name (default `capix`) |
| `--api-version <version>` | MCP server version string (default `0.1.0`) |

The command runs with a stub context (like `capix call`), so capabilities behind auth guards will reject. Apps that need real context should mount `mcpTransport` from [`@capixjs/transport-mcp`](transports/mcp.md) in their own server.

---

## Comparison

### `capix diff <config-a> <config-b>`

Compare capabilities between two config files. Useful for reviewing API changes between branches.

```bash
capix diff src/capabilities.ts src/capabilities.v2.ts
```

---

## AI context

### `capix ai-context`

Generate a machine-readable context document for AI assistants.

```bash
capix ai-context --output .capix-context.json
```

### `capix sync-ai-context`

Refresh `.capix-context.json` in place.

---

## Common options

All commands accept:

| Option | Description |
|---|---|
| `--config <path>` | Path to capabilities file (default: `src/capabilities.ts`) |
| `--help` | Show help for the command |

## `.cursor/rules`

Scaffolded projects include a `.cursor/rules` file that configures Cursor, GitHub Copilot, and other AI editors with Capix conventions:
- Capability naming patterns
- Guard usage requirements
- Error definition style
- The two-factory pattern for auth
