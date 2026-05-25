import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as net from 'node:net';
import { capability, createServer, defineContext } from 'capix';
import { z } from 'zod';
import { restTransport } from './index.js';
import type { Server } from 'capix';

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

const buildContext = defineContext(async () => ({ requestId: crypto.randomUUID() }));

// getStatus → query, no id → GET /status
const getStatus = capability(() => ({ pong: true }));

// createRecord → mutation (create*) → POST /records (drops key)
const createRecord = capability(z.object({ name: z.string() }), ({ name }) => ({ name }));

// createNull → mutation (create*) → POST /nulls, returns null → 204
const createNull = capability(() => null);

// getItem → query with id → GET /items/:id
const getItem = capability(z.object({ id: z.string() }), ({ id }) => ({ id }));

// deleteItem → delete → DELETE /items/:id
const deleteItem = capability(z.object({ id: z.string() }), ({ id }) => ({ deleted: id }));

// updateItem → update → PATCH /items/:id
const updateItem = capability(z.object({ id: z.string(), name: z.string() }), (input) => input);

// getMetrics → query, no id → GET /metrics (for coercion test)
const getMetrics = capability(
  z.object({ active: z.boolean(), count: z.number() }),
  (input) => input,
);

let server: Server;
let port: number;

beforeAll(async () => {
  port = await getFreePort();
  server = createServer({
    context: buildContext,
    capabilities: {
      status: { getStatus },
      nulls: { createNull },
      items: { getItem, deleteItem, updateItem },
      records: { createRecord },
      metrics: { getMetrics },
    },
    transports: [
      restTransport({
        port,
        cors: { origin: (origin) => origin.includes('allowed') },
        maxBodySize: 256,
      }),
    ],
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

describe('REST transport', () => {
  it('GET capability returns 200 with data', async () => {
    // getStatus → GET /status
    const res = await fetch(`http://localhost:${port}/status`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { pong: boolean } };
    expect(json.data.pong).toBe(true);
  });

  it('capability returning null → 204 No Content', async () => {
    // createNull → POST /nulls
    const res = await fetch(`http://localhost:${port}/nulls`, { method: 'POST' });
    expect(res.status).toBe(204);
  });

  it('unknown path → 404', async () => {
    const res = await fetch(`http://localhost:${port}/nonexistent`);
    expect(res.status).toBe(404);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('NotFound');
  });

  it('wrong method on known path → 405 with Allow header', async () => {
    // createNull is POST only; try GET
    const res = await fetch(`http://localhost:${port}/nulls`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
  });

  it('OPTIONS preflight → 204', async () => {
    const res = await fetch(`http://localhost:${port}/status`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
  });

  it('CORS function origin — allowed origin gets ACAO header', async () => {
    const res = await fetch(`http://localhost:${port}/status`, {
      headers: { Origin: 'https://allowed.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.example.com');
  });

  it('CORS function origin — denied origin gets no ACAO header', async () => {
    const res = await fetch(`http://localhost:${port}/status`, {
      headers: { Origin: 'https://blocked.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('payload exceeds maxBodySize → 413', async () => {
    // POST /records with body > 256 bytes
    const res = await fetch(`http://localhost:${port}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(300) }),
    });
    expect(res.status).toBe(413);
  });

  it('invalid JSON body → 400 BadRequest', async () => {
    const res = await fetch(`http://localhost:${port}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('BadRequest');
  });

  it('GET with path param — extracted correctly', async () => {
    // getItem → GET /items/:id
    const res = await fetch(`http://localhost:${port}/items/abc`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { id: string } };
    expect(json.data.id).toBe('abc');
  });

  it('DELETE request — no body, uses path param', async () => {
    // deleteItem → DELETE /items/:id
    const res = await fetch(`http://localhost:${port}/items/xyz`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { deleted: string } };
    expect(json.data.deleted).toBe('xyz');
  });

  it('query param coercion — true/false/numbers coerced from string', async () => {
    // getMetrics → GET /metrics?active=true&count=42
    const res = await fetch(`http://localhost:${port}/metrics?active=true&count=42`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { active: boolean; count: number } };
    expect(json.data.active).toBe(true);
    expect(json.data.count).toBe(42);
  });

  it('Zod validation failure → 400 with issues', async () => {
    // createRecord requires { name: string }, send wrong type
    const res = await fetch(`http://localhost:${port}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string; meta: unknown };
    expect(json.error).toBe('BadRequest');
    expect(json.meta).toBeDefined();
  });

  it('onRequest hook is called', async () => {
    const hook = vi.fn();
    const p = await getFreePort();
    const srv = createServer({
      context: buildContext,
      capabilities: { status: { getStatus } },
      transports: [restTransport({ port: p, hooks: { onRequest: hook } })],
    });
    await srv.start();
    await fetch(`http://localhost:${p}/status`);
    expect(hook).toHaveBeenCalledOnce();
    await srv.stop();
  });

  it('PATCH request — path param merged with JSON body', async () => {
    // updateItem → PATCH /items/:id, body { name }
    const res = await fetch(`http://localhost:${port}/items/xyz`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'updated' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { id: string; name: string } };
    expect(json.data.id).toBe('xyz');
    expect(json.data.name).toBe('updated');
  });

  it('static string cors origin uses the string directly', async () => {
    const p = await getFreePort();
    const srv = createServer({
      context: buildContext,
      capabilities: { status: { getStatus } },
      transports: [restTransport({ port: p, cors: { origin: 'https://example.com' } })],
    });
    await srv.start();
    const res = await fetch(`http://localhost:${p}/status`);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    await srv.stop();
  });

  it('empty body on POST is ignored — input becomes empty object', async () => {
    // createNull has no input schema, empty body is fine → 204
    const res = await fetch(`http://localhost:${port}/nulls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(204);
  });
});
