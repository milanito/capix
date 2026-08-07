import { createServer, defineContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import jwt from 'jsonwebtoken';
import { capabilities } from './capabilities.js';
import type { Context, JwtPayload } from './capabilities.js';

const JWT_SECRET = process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production';
const PORT = Number(process.env['PORT'] ?? 3000);

function parseBearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

const buildContext = defineContext(async (req): Promise<Context> => {
  const authHeader = Array.isArray(req.headers['authorization'])
    ? req.headers['authorization'][0]
    : req.headers['authorization'];
  const token = parseBearer(authHeader);
  let user: JwtPayload | null = null;

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
      user = payload;
    } catch {
      // Invalid/expired token — treat as anonymous
    }
  }

  return { requestId: crypto.randomUUID(), user };
});

const server = createServer({
  context: buildContext,
  capabilities,
  transports: [
    restTransport({
      port: PORT,
      cors: { origin: '*' },
    }),
  ],
});

server.start().then(() => {
  console.log(`JWT auth example listening on http://localhost:${PORT}`);
  console.log();
  console.log('Generate a dev token:');
  // Reads JWT_SECRET from the environment at run time instead of interpolating
  // it here — this line lands in shell history and CI/terminal logs, and the
  // fallback dev secret is fine to print, but a real JWT_SECRET is not.
  console.log(
    `  node -e "const j=require('jsonwebtoken'); console.log(j.sign({sub:'1',name:'Alice',role:'admin'}, process.env.JWT_SECRET || 'dev-secret-change-in-production'))"`,
  );
  console.log();
  console.log('Try it:');
  console.log(`  curl -X POST http://localhost:${PORT}/auth/listRoles`);
  console.log(`  curl -X POST http://localhost:${PORT}/auth/getProfile -H 'Authorization: Bearer <token>'`);
  console.log(`  curl -X POST http://localhost:${PORT}/auth/getAdminStats -H 'Authorization: Bearer <token>'`);
});
