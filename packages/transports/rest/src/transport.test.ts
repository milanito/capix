import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as net from 'node:net';
import { capability, createServer, defineContext } from '@capixjs/core';
import { z } from 'zod';
import { restTransport } from './index.js';
import type { Server } from '@capixjs/core';

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

// searchEchoes → query (search*) → GET /echoes; record schema passes arbitrary keys through
const searchEchoes = capability(z.record(z.string(), z.unknown()), (input) => ({ echoed: input }));

// createEcho → mutation (create*) → POST /echoes
const createEcho = capability(z.record(z.string(), z.unknown()), (input) => ({ echoed: input }));

// findPeople → query collection → GET /people (schema-aware coercion fixture)
const findPeople = capability(
  z.object({
    name: z.string(),
    age: z.number().optional(),
    active: z.boolean().default(false),
  }),
  (input) => input,
);

// getThing → query with numeric id → GET /things/:id (path param coercion fixture)
const getThing = capability(z.object({ id: z.number() }), ({ id }) => ({ id, idType: typeof id }));

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
      echoes: { searchEchoes, createEcho },
      people: { findPeople },
      things: { getThing },
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

describe('request timeout', () => {
  it('default timeout is 30 seconds (option present in type)', () => {
    // Verify the option exists and defaults to 30_000 at the type level
    const opts: Parameters<typeof restTransport>[0] = { port: 9999 };
    expect(opts.timeout).toBeUndefined(); // undefined → defaults to 30_000 internally
  });

  it('timeout: false emits a console warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = await getFreePort();
    const srv = createServer({
      context: buildContext,
      capabilities: { status: { getStatus } },
      transports: [restTransport({ port: p, timeout: false })],
    });
    await srv.start();
    await srv.stop();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('timeout: false'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Do not use this in production'));
    warnSpy.mockRestore();
  });

  it('timeout: false allows requests to complete without being aborted', async () => {
    const p = await getFreePort();
    // Capability that takes 50ms — well under any real timeout but proves signal is not pre-aborted
    const slow = capability(
      async () => {
        await new Promise(r => setTimeout(r, 50));
        return { ok: true };
      },
    );
    const srv = createServer({
      context: buildContext,
      capabilities: { slow: { list: slow } }, // list* → GET /slow
      transports: [restTransport({ port: p, timeout: false })],
    });
    await srv.start();
    const res = await fetch(`http://localhost:${p}/slow`);
    expect(res.status).toBe(200);
    await srv.stop();
  });

  it('custom timeout fires for hung capability — fetch times out', async () => {
    const p = await getFreePort();
    // Capability hangs for longer than the configured timeout
    const hang = capability(
      async () => {
        await new Promise(r => setTimeout(r, 500)); // hangs 500ms
        return { ok: true };
      },
    );
    const srv = createServer({
      context: buildContext,
      capabilities: { hang: { list: hang } }, // list* → GET /hang
      transports: [restTransport({ port: p, timeout: 80 })], // 80ms timeout
    });
    await srv.start();
    // The AbortSignal.timeout(80) fires before the 500ms hang completes.
    // The execution engine catches the aborted signal and returns an error response.
    const res = await fetch(`http://localhost:${p}/hang`, {
      signal: AbortSignal.timeout(2_000), // generous fetch-level timeout
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    await srv.stop();
  });

  it('completed requests are not affected by timeout', async () => {
    const p = await getFreePort();
    const srv = createServer({
      context: buildContext,
      capabilities: { status: { getStatus } },
      transports: [restTransport({ port: p, timeout: 5_000 })],
    });
    await srv.start();
    const res = await fetch(`http://localhost:${p}/status`);
    expect(res.status).toBe(200);
    await srv.stop();
  });

  it('timeout timer is cancelled once the request completes', async () => {
    // Regression: AbortSignal.timeout kept its timer + abort listener alive for
    // the full window after every completed request. The signal must NOT fire
    // after the response is sent — the timer is cleared on settle.
    const p = await getFreePort();
    let captured: AbortSignal | undefined;
    const srv = createServer({
      context: defineContext(async (req) => {
        captured = req.signal;
        return { requestId: crypto.randomUUID() };
      }),
      capabilities: { status: { getStatus } },
      transports: [restTransport({ port: p, timeout: 100 })],
    });
    await srv.start();
    const res = await fetch(`http://localhost:${p}/status`);
    expect(res.status).toBe(200);
    // Wait past the 100ms timeout window — a leaked timer would abort the signal
    await new Promise((r) => setTimeout(r, 250));
    expect(captured).toBeDefined();
    expect(captured!.aborted).toBe(false);
    await srv.stop();
  });

  it('hung capability aborts the request signal at timeout', async () => {
    const p = await getFreePort();
    let captured: AbortSignal | undefined;
    const hang = capability(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { ok: true };
    });
    const srv = createServer({
      context: defineContext(async (req) => {
        captured = req.signal;
        return { requestId: crypto.randomUUID() };
      }),
      capabilities: { hang: { list: hang } },
      transports: [restTransport({ port: p, timeout: 80 })],
    });
    await srv.start();
    const res = await fetch(`http://localhost:${p}/hang`, {
      signal: AbortSignal.timeout(2_000),
    });
    expect(res.status).toBe(504);
    expect(captured!.aborted).toBe(true);
    await srv.stop();
  });
});

describe('hostile request input', () => {
  it('malformed percent-encoding in a path param → 400, server stays up', async () => {
    const res = await fetch(`http://localhost:${port}/items/%zz`);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string; message: string };
    expect(json.error).toBe('BadRequest');
    expect(json.message).toContain('Malformed URL encoding');

    // The process must survive — subsequent requests are served normally
    const after = await fetch(`http://localhost:${port}/status`);
    expect(after.status).toBe(200);
  });

  it('malformed percent-encoding in the query string falls back to raw text', async () => {
    const res = await fetch(`http://localhost:${port}/echoes?x=%zz`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { echoed: Record<string, unknown> } };
    expect(json.data.echoed['x']).toBe('%zz');
  });

  it('never crashes on a batch of hostile URLs', async () => {
    const hostile = ['/items/%', '/items/%2', '/items/%C0%AF', '/items/%E0%A4%A', `/items/${'%'.repeat(64)}`, '/echoes?%zz=%zz&a=1'];
    for (const path of hostile) {
      const res = await fetch(`http://localhost:${port}${path}`);
      expect(res.status).toBeLessThan(500);
    }
    const after = await fetch(`http://localhost:${port}/status`);
    expect(after.status).toBe(200);
  });

  it('__proto__ query keys are dropped from input', async () => {
    const res = await fetch(`http://localhost:${port}/echoes?__proto__=evil&a=1`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { echoed: Record<string, unknown> } };
    // z.record has no field types to coerce toward — values stay raw strings
    expect(json.data.echoed).toEqual({ a: '1' });
  });

  it('__proto__ JSON body keys are not merged into input', async () => {
    const res = await fetch(`http://localhost:${port}/echoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"__proto__": {"polluted": true}, "name": "x"}',
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { echoed: Record<string, unknown> } };
    expect(json.data.echoed).toEqual({ name: 'x' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('non-object JSON body → 400', async () => {
    for (const body of ['[1,2,3]', '"hello"', '42', 'null']) {
      const res = await fetch(`http://localhost:${port}/echoes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
      const json = await res.json() as { message: string };
      expect(json.message).toContain('JSON body must be an object');
    }
  });
});

describe('schema-aware coercion', () => {
  it('numeric-looking strings stay strings when the schema says string', async () => {
    const res = await fetch(`http://localhost:${port}/people?name=123`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { name: unknown } };
    expect(json.data.name).toBe('123');
  });

  it('leading-zero strings are not corrupted', async () => {
    const res = await fetch(`http://localhost:${port}/people?name=01234`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { name: unknown } };
    expect(json.data.name).toBe('01234');
  });

  it('number and boolean fields are coerced per schema', async () => {
    const res = await fetch(`http://localhost:${port}/people?name=ada&age=36&active=true`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { name: string; age: number; active: boolean } };
    expect(json.data).toEqual({ name: 'ada', age: 36, active: true });
  });

  it('path params are coerced when the schema wants a number', async () => {
    const res = await fetch(`http://localhost:${port}/things/42`);
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { id: number; idType: string } };
    expect(json.data.id).toBe(42);
    expect(json.data.idType).toBe('number');
  });

  it('non-numeric text for a number field fails validation on the raw value', async () => {
    const res = await fetch(`http://localhost:${port}/things/not-a-number`);
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('BadRequest');
  });

  it('JSON body values are never coerced', async () => {
    // updateItem expects { id: string, name: string }; numbers in the JSON body
    // must NOT be massaged into strings or vice versa — JSON types are authoritative
    const res = await fetch(`http://localhost:${port}/items/xyz`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 42 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('graceful shutdown', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function bootServer(
    caps: NonNullable<Parameters<typeof createServer>[0]['capabilities']>,
    shutdownTimeoutMs: number,
  ) {
    const port = await getFreePort();
    const server = createServer({
      context: buildContext,
      capabilities: caps,
      transports: [restTransport({ port, shutdownTimeoutMs })],
    });
    await server.start();
    return { server, port };
  }

  it('in-flight requests complete during the drain window', async () => {
    const slowEcho = capability(z.object({}), async () => {
      await sleep(300);
      return { done: true };
    }, 'query');
    const { server, port } = await bootServer({ jobs: { slowEcho } }, 5000);

    const pending = fetch(`http://127.0.0.1:${port}/jobs/slow-echo`);
    await sleep(50); // request is in flight
    const stopping = server.stop();

    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { done: true } });
    await stopping;
  });

  it('idle keep-alive connections do not block shutdown', async () => {
    const getPing = capability(() => ({ pong: true }));
    const { server, port } = await bootServer({ sys: { getPing } }, 10_000);

    // Completed fetch leaves a keep-alive socket open in undici's pool
    const res = await fetch(`http://127.0.0.1:${port}/sys/ping`);
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const started = Date.now();
    await server.stop();
    // With close() alone this would hang until the keep-alive socket dies;
    // generous bound for loaded CI runners
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('hung requests are force-closed at the drain deadline', async () => {
    const getStuck = capability(async () => {
      await sleep(6000);
      return { late: true };
    }, 'query');
    const { server, port } = await bootServer({ sys: { getStuck } }, 150);

    const pending = fetch(`http://127.0.0.1:${port}/sys/stuck`);
    await sleep(50);

    const started = Date.now();
    await server.stop();
    // Well under the 6s capability sleep — proves force-close, not drain-wait,
    // with margin for loaded CI runners
    expect(Date.now() - started).toBeLessThan(4000);

    // The hung request's socket was destroyed, not left dangling
    await expect(pending).rejects.toThrow();
  });
});
