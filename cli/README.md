# @capixjs/cli

CLI tools for the Capix framework. Scaffold projects, inspect capabilities, generate docs, and call capabilities directly from the terminal.

## Install

```bash
npm install -g @capixjs/cli
# or use without installing:
npx capix <command>
```

## Commands

### `capix new [name]`

Scaffold a new Capix project with TypeScript, a context builder, and example capabilities.

```bash
capix new my-api
cd my-api
pnpm install && pnpm dev
```

Generated structure:
```
my-api/
├── src/
│   ├── capabilities.ts   # capability definitions
│   ├── context.ts        # buildContext, error definitions
│   └── server.ts         # server entry point
├── tsconfig.json
├── package.json
└── .cursor/rules         # Capix rules for AI editors
```

---

### `capix list` (alias: `ls`)

List all registered capabilities with their HTTP routes and guard count.

```bash
capix list
capix list --config src/capabilities/index.ts
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

---

### `capix show <capability>`

Show full details for a single capability: input schema, output schema, intent, route, and guards.

```bash
capix show users.getUser
```

---

### `capix call <capability> [input]`

Invoke a capability directly without a running server. Uses a minimal context (no auth, no database).

```bash
capix call users.listUsers
capix call users.getUser '{"id":"1"}'
```

---

### `capix dev [entry]`

Start a development server with file watching. Restarts automatically on changes.

```bash
capix dev
capix dev src/server.ts
```

---

### `capix check`

Validate the server configuration: duplicate routes, naming conflicts, missing schemas.

```bash
capix check
capix check --config src/capabilities/index.ts
```

---

### `capix docs`

Generate Markdown API documentation for all capabilities.

```bash
capix docs                           # print to stdout
capix docs --output docs/api.md      # write to file
capix docs --config src/caps/index.ts --output api.md
```

---

### `capix generate` (alias: `g`)

Generate scaffolding for new capabilities or groups.

```bash
capix generate capability users getUser
capix generate group payments
```

---

### `capix client`

Generate a typed fetch client from your capabilities.

```bash
capix client --output src/client.ts
```

---

### `capix diff <config-a> <config-b>`

Compare capabilities between two config files. Useful for reviewing API changes between branches.

```bash
capix diff src/capabilities.ts src/capabilities.v2.ts
```

---

### `capix ai-context`

Generate a machine-readable context document for AI assistants.

```bash
capix ai-context --output .capix-context.json
```

### `capix sync-ai-context`

Refresh `.capix-context.json` in place (alias for `ai-context`).

---

## Common options

All commands accept:
- `--config <path>` — path to capabilities file (default: `src/capabilities.ts`)
- `--help` — show help for that command

## `.cursor/rules`

New projects get a `.cursor/rules` file automatically. This configures Cursor and other AI editors with Capix framework rules — pattern enforcement, naming conventions, guard usage, and error definitions. Edit it to match your project conventions.

## License

MIT
