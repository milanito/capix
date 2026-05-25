import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as net from 'node:net';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from 'capix';
import { restTransport } from 'capix-transport-rest';
import type { Server } from 'capix';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

type User = { id: string; name: string; email: string; role: 'user' | 'admin' };

const USERS: User[] = [
  { id: '1', name: 'Alice', email: 'alice@test.com', role: 'user' },
  { id: '2', name: 'Bob', email: 'bob@test.com', role: 'admin' },
];

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
  Conflict: defineError(409, 'Conflict'),
};

type Context = { requestId: string; user: User | null };

const buildContext = defineContext(async (req): Promise<Context> => {
  const auth = req.headers['authorization'];
  const token = typeof auth === 'string' ? auth.replace('Bearer ', '') : null;
  const user = token ? (USERS.find((u) => u.id === token) ?? null) : null;
  return { requestId: crypto.randomUUID(), user };
});

const mustBeUser = defineGuard((ctx: Context): asserts ctx is Context & { user: User } => {
  if (!ctx.user) throw errors.Unauthorized();
});

const mustBeAdmin = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: User & { role: 'admin' } } => {
    if (!ctx.user) throw errors.Unauthorized();
    if (ctx.user.role !== 'admin') throw errors.Forbidden();
  },
);

const ping = capability(() => ({ pong: true }));

const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = USERS.find((u) => u.id === id);
    if (!user) throw errors.NotFound({ id });
    return user;
  },
).guard(mustBeUser);

const listUsers = capability(z.object({}), async () => USERS).guard(mustBeUser);

const createUser = capability(
  z.object({ name: z.string().min(1), email: z.string().email() }),
  async ({ name, email }) => {
    if (USERS.some((u) => u.email === email)) throw errors.Conflict({ email });
    const user: User = { id: String(USERS.length + 1), name, email, role: 'user' };
    USERS.push(user);
    return user;
  },
).guard(mustBeAdmin);

const deleteUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const idx = USERS.findIndex((u) => u.id === id);
    if (idx === -1) throw errors.NotFound({ id });
    USERS.splice(idx, 1);
    return { deleted: true };
  },
).guard(mustBeAdmin);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const port = await getFreePort();
  baseUrl = `http://localhost:${port}`;

  server = createServer({
    context: buildContext,
    capabilities: {
      system: { ping },
      users: { get: getUser, list: listUsers, create: createUser, delete: deleteUser },
    },
    transports: [restTransport({ port })],
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('REST API integration', () => {
  it('POST /system/ping — no auth required', async () => {
    // ping is inferred as mutation (no create/get prefix) → POST /system/ping
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown };
    expect(body.data).toEqual({ pong: true });
  });

  it('GET /users — with valid auth returns list', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: 'Bearer 1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: User[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /users — without auth returns 401', async () => {
    const res = await fetch(`${baseUrl}/users`);
    expect(res.status).toBe(401);
  });

  it('GET /users/:id — valid id returns user', async () => {
    const res = await fetch(`${baseUrl}/users/1`, {
      headers: { Authorization: 'Bearer 1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: User };
    expect(body.data.id).toBe('1');
    expect(body.data.name).toBe('Alice');
  });

  it('GET /users/:id — invalid id returns 404', async () => {
    const res = await fetch(`${baseUrl}/users/999`, {
      headers: { Authorization: 'Bearer 1' },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('NotFound');
  });

  it('POST /users — user role returns 403', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer 1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie', email: 'charlie@test.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /users — admin creates user', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer 2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie', email: 'charlie@test.com' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: User };
    expect(body.data.name).toBe('Charlie');
  });

  it('POST /users — invalid body returns 400 with issues', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer 2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; meta: { issues: unknown[] } };
    expect(body.error).toBe('BadRequest');
    expect(Array.isArray(body.meta.issues)).toBe(true);
  });

  it('DELETE /users/:id — user role returns 403', async () => {
    const res = await fetch(`${baseUrl}/users/1`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer 1' },
    });
    expect(res.status).toBe(403);
  });

  it('DELETE /users/:id — admin succeeds', async () => {
    // Add a user first so we can delete without affecting other tests
    const created = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer 2', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ToDelete', email: 'todelete@test.com' }),
    });
    const { data } = await created.json() as { data: User };

    const res = await fetch(`${baseUrl}/users/${data.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer 2' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('GET /nonexistent — 404', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('PUT /users — method not allowed returns 405', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer 1' },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBeTruthy();
  });

  it('OPTIONS — CORS preflight returns 204', async () => {
    const res = await fetch(`${baseUrl}/users`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('CORS headers present on all responses', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('malformed JSON body returns 400', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { Authorization: 'Bearer 2', 'Content-Type': 'application/json' },
      body: '{not valid json}',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('BadRequest');
  });

  it('query string coercion — number string becomes number', async () => {
    const res = await fetch(`${baseUrl}/system/ping`, { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
