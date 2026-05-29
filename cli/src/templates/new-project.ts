export type NewProjectOptions = {
  name: string;
  transport: 'rest' | 'ws' | 'both';
};

export function renderPackageJson(opts: NewProjectOptions): string {
  const deps: Record<string, string> = {
    capix: '^0.1.0',
    zod: '^3.23.0',
  };

  if (opts.transport === 'rest' || opts.transport === 'both') {
    deps['capix-transport-rest'] = '^0.1.0';
  }
  if (opts.transport === 'ws' || opts.transport === 'both') {
    deps['capix-transport-ws'] = '^0.1.0';
  }

  return JSON.stringify(
    {
      name: opts.name,
      version: '0.1.0',
      type: 'module',
      scripts: {
        dev: 'tsx watch src/server.ts',
        build: 'tsc',
        start: 'node dist/server.js',
      },
      dependencies: deps,
      devDependencies: {
        '@types/node': '^20.0.0',
        tsx: '^4.0.0',
        typescript: '^5.5.0',
      },
    },
    null,
    2,
  );
}

export function renderTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022'],
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noImplicitReturns: true,
        outDir: './dist',
        rootDir: './src',
        declaration: true,
        skipLibCheck: true,
        esModuleInterop: true,
        types: ['node'],
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  );
}

export function renderCapabilitiesTs(): string {
  return `import { z } from 'zod';
import { capability, defineContext, defineError } from 'capix';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type AppContext = {
  readonly requestId: string;
  // Add your app-specific fields here:
  // user: AppUser | null;
  // db: Database;
};

export const buildContext = defineContext(async (_req): Promise<AppContext> => ({
  requestId: crypto.randomUUID(),
}));

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const errors = {
  NotFound: defineError(404, 'Not found'),
};

// ---------------------------------------------------------------------------
// Scoped capability factory
//
// Import \`cap\` in every capability file instead of using \`capability\` directly.
// This pre-binds AppContext so \`ctx\` is correctly typed in every resolver.
//
// For capabilities that require authentication, create a second factory:
//   type AuthContext = AppContext & { user: NonNullable<AppContext['user']> };
//   export const authCap = capability.withContext<AuthContext>();
// ---------------------------------------------------------------------------

export const cap = capability.withContext<AppContext>();

// ---------------------------------------------------------------------------
// Example capabilities — replace with your own
// ---------------------------------------------------------------------------

const ping = cap(
  async (_input, _ctx) => ({ message: 'pong', timestamp: Date.now() }),
  'query',
);

const getItem = cap(
  z.object({ id: z.string() }),
  async ({ id }, _ctx) => {
    if (id !== '1') throw errors.NotFound();
    return { id, name: 'Example item' };
  },
  'query',
);

export const capabilities = {
  system: { ping },
  items: { getItem },
};
`;
}

export function renderServerTs(opts: NewProjectOptions): string {
  const imports: string[] = [
    `import { createServer } from 'capix';`,
    `import { buildContext, capabilities } from './capabilities.js';`,
  ];
  const transports: string[] = [];

  if (opts.transport === 'rest' || opts.transport === 'both') {
    imports.push(`import { restTransport } from 'capix-transport-rest';`);
    transports.push(`restTransport({ port: 3000 })`);
  }
  if (opts.transport === 'ws' || opts.transport === 'both') {
    imports.push(`import { wsTransport } from 'capix-transport-ws';`);
    transports.push(`wsTransport({ port: 3001 })`);
  }

  return `${imports.join('\n')}

const server = createServer({
  context: buildContext,
  capabilities,
  transports: [${transports.join(', ')}],
});

server.start().catch(console.error);
`;
}

export function renderGitignore(): string {
  return `node_modules/
dist/
*.tsbuildinfo
.DS_Store
.env
`;
}

export function renderEnvExample(): string {
  return `# Example environment variables
# Copy to .env and fill in values
NODE_ENV=development
PORT=3000
`;
}

export function renderCursorRules(): string {
  return `# Capix project rules

## Framework overview

This project uses **Capix** — a TypeScript capability-based RPC framework.
The single primitive is \`capability()\`: a typed pure function with input/output schemas,
guards, and enhancers. Transports (REST, WebSocket) are wired at startup and are
separate from capability definitions.

## File layout

- \`src/capabilities.ts\` — context type, scoped factories (\`cap\`, \`authCap\`), shared errors, all capabilities
- \`src/server.ts\` — creates and starts the server with transports
- \`src/guards.ts\` — guard definitions (if you split them out)

For larger projects, split capabilities into \`src/capabilities/<group>.ts\` and barrel-export from \`src/capabilities/index.ts\`.

## Defining capabilities

Always use the scoped factory (\`cap\` or \`authCap\`) instead of bare \`capability()\`:

\`\`\`ts
// query (read)
export const getItem = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => { ... },
  'query',
);

// mutation (write) — no explicit intent needed for standard CRUD names
export const createItem = cap(z.object({ name: z.string() }), async ({ name }) => { ... });

// no-schema query
export const ping = cap(async (_input, _ctx) => ({ ok: true }), 'query');
\`\`\`

## Guards

Guards narrow the context type and run before the resolver:

\`\`\`ts
import { defineGuard, defaultErrors } from 'capix';

export const mustBeAuthenticated = defineGuard(
  (ctx: AppContext): asserts ctx is AuthContext => {
    if (!ctx.user) throw defaultErrors.Unauthorized();
  },
);

// Apply to a capability:
export const getProfile = authCap(schema, resolver).guard(mustBeAuthenticated);
\`\`\`

Always pair \`authCap\` with \`.guard(mustBeAuthenticated)\`. Using \`authCap\` without
the guard is a footgun — TypeScript won't catch it but unauthenticated requests
will throw at runtime.

## Context pattern

\`\`\`ts
export type AppContext  = { requestId: string; user: AppUser | null; db: Database };
export type AuthContext = AppContext & { user: AppUser }; // narrowed

export const cap     = capability.withContext<AppContext>();  // public endpoints
export const authCap = capability.withContext<AuthContext>(); // authenticated endpoints
\`\`\`

## Transport boundary

Capabilities have no knowledge of how they are exposed. Transport concerns live in the
transport packages — NOT in capability definitions:

| Import from | What |
|---|---|
| \`capix\` | \`capability\`, \`defineGuard\`, \`defineContext\`, \`defineError\`, \`defineEnhancer\`, \`withRollback\` |
| \`capix-transport-rest\` | \`restTransport\`, \`HttpOverride\` |
| \`capix-transport-ws\` | \`wsTransport\` |
| \`capix-transport-graphql\` | \`graphqlTransport\` |

Never import transport packages inside capability files.

## REST route inference

| Key pattern | Intent | HTTP route |
|---|---|---|
| \`getItem\`, \`listItems\` | query | GET /items/:id or GET /items |
| \`createItem\` | mutation | POST /items |
| \`updateItem\` | mutation | PATCH /items/:id |
| \`deleteItem\` | mutation | DELETE /items/:id |

To override a route, pass \`overrides\` to \`restTransport\` — do NOT put routing info
inside capability definitions:

\`\`\`ts
// src/server.ts
restTransport({
  port: 3000,
  overrides: {
    'tasks.listTasks':  { method: 'GET',  path: '/projects/:projectId/tasks' },
    'tasks.createTask': { method: 'POST', path: '/projects/:projectId/tasks' },
  },
})
\`\`\`

HTTP overrides only apply to \`restTransport\`. GraphQL and WebSocket transports
derive their own schema or message routing from the capability registry and do not
use \`overrides\`.

## Errors

\`\`\`ts
const errors = {
  NotFound: defineError(404, 'Not found'),
  Forbidden: defineError(403, 'Forbidden'),
};
// In resolver:
throw errors.NotFound();
\`\`\`

Framework errors: \`defaultErrors.Unauthorized()\`, \`defaultErrors.Forbidden()\`, \`defaultErrors.TooManyRequests()\`

## Enhancers

\`\`\`ts
import { withRateLimit, withCache } from 'capix';

export const getItem = cap(schema, resolver).enhance(withRateLimit({ limit: 100, windowMs: 60_000 }));
\`\`\`

## AI context

Run \`capix ai-context\` to regenerate \`.capix-context.json\` after adding or changing capabilities.
This file gives AI assistants a machine-readable map of your API surface.
`;
}

export function renderReadme(opts: NewProjectOptions): string {
  return `# ${opts.name}

A Capix server application.

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## Production

\`\`\`bash
npm run build
npm start
\`\`\`

## Capabilities

- \`system.ping\` — health check${opts.transport === 'rest' || opts.transport === 'both' ? '\n  - GET /system/ping' : ''}
- \`items.get\` — get an item by id${opts.transport === 'rest' || opts.transport === 'both' ? '\n  - GET /items/:id' : ''}
`;
}
