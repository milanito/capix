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
