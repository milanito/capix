/**
 * Capix benchmark server
 *
 * Three scenarios:
 *   GET /hello       → { message: 'hello world' }   (pure overhead)
 *   GET /users/:id   → { id, name }                  (Zod validation)
 *   GET /profile     → { id }                        (auth + guard)
 */

import { z } from 'zod';
import { capability, defineContext, defineError, createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';

const SECRET = 'benchmark-secret';
const Errors = { Unauthorized: defineError(401, 'Unauthorized') };

const buildContext = defineContext(async (req) => ({
  requestId: 'bench',
  user: req.headers['authorization']?.startsWith('Bearer ')
    ? { id: '1' }
    : null,
}));

type Ctx = { requestId: string; user: { id: string } | null };

const cap = capability.withContext<Ctx>();

const mustBeUser = (ctx: Ctx) => {
  if (!ctx.user) throw Errors.Unauthorized();
};

const hello   = cap(() => ({ message: 'hello world' }), 'query');
const getUser = cap(z.object({ id: z.string() }), ({ id }) => ({ id, name: 'Alice' }), 'query');
const profile = cap(z.object({}), (_, ctx) => ({ id: ctx.user!.id }), 'query')
  .guard(mustBeUser as never);

createServer({
  context: buildContext,
  capabilities: {
    hello:   { get: hello },
    users:   { get: getUser },
    profile: { get: profile },
  },
  transports: [restTransport({ port: 3000, timeout: false })], // benchmark only — never use false in production
  isDevelopment: false,
}).start();
