import { createServer, defineContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { capabilities } from './capabilities.js';
import type { Context } from './capabilities.js';

const PORT = Number(process.env['PORT'] ?? 3000);

// Simulated auth tokens
const TOKENS = new Map([
  ['user-token', { id: 'u1', name: 'Alice' }],
  ['admin-token', { id: 'u2', name: 'Bob' }],
]);

function firstHeader(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const buildContext = defineContext(async (req): Promise<Context> => {
  const auth = firstHeader(req.headers['authorization']);
  const token = auth?.replace('Bearer ', '') ?? null;
  const user = token ? (TOKENS.get(token) ?? null) : null;
  return { requestId: crypto.randomUUID(), user };
});

const server = createServer({
  context: buildContext,
  capabilities,
  transports: [
    restTransport({
      port: PORT,
      cors: { origin: '*' },
      multipart: { maxFileSize: 10 * 1024 * 1024, maxFiles: 1 },
    }),
  ],
});

server.start().then(() => {
  console.log('File upload example ready.');
  console.log();
  console.log('Upload a file (requires auth):');
  console.log(`  curl -X POST http://localhost:${PORT}/uploads \\`);
  console.log(`    -H 'Authorization: Bearer user-token' \\`);
  console.log(`    -F 'file=@./path/to/image.jpg' \\`);
  console.log(`    -F 'description=My photo'`);
  console.log();
  console.log('List uploads:');
  console.log(`  curl http://localhost:${PORT}/uploads -H 'Authorization: Bearer user-token'`);
  console.log();
  console.log('Without auth (→ 401):');
  console.log(`  curl -X POST http://localhost:${PORT}/uploads -F 'file=@./path/to/image.jpg'`);
  console.log();
  console.log('Wrong file type (→ 400):');
  console.log(`  curl -X POST http://localhost:${PORT}/uploads \\`);
  console.log(`    -H 'Authorization: Bearer user-token' \\`);
  console.log(`    -F 'file=@./server.ts'`);
});
