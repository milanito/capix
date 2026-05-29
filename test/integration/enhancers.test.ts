import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import {
  capability,
  createServer,
  defineContext,
  withCache,
  withRateLimit,
  withCircuitBreaker,
  withTimeout,
  withMetrics,
} from 'capix';
import { z } from 'zod';
import { restTransport } from 'capix-transport-rest';
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

async function post(url: string, body: Record<string, unknown> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// withCache
// ---------------------------------------------------------------------------

async function makeCacheServer() {
  let callCount = 0;
  // getItem → query with id → GET /data/:id
  const getItem = capability(
    z.object({ id: z.string() }),
    ({ id }) => { callCount++; return { id, seq: callCount }; },
  ).enhance(withCache(10));

  const port = await getFreePort();
  const srv = createServer({
    context: buildContext,
    capabilities: { data: { getItem } },
    transports: [restTransport({ port })],
  });
  await srv.start();

  return {
    baseUrl: `http://localhost:${port}`,
    getCallCount: () => callCount,
    stop: () => srv.stop(),
  };
}

describe('withCache — HTTP integration', () => {
  it('first call hits the resolver', async () => {
    const { baseUrl, getCallCount, stop } = await makeCacheServer();
    try {
      const res = await fetch(`${baseUrl}/data/one`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { seq: number } };
      expect(body.data.seq).toBe(1);
      expect(getCallCount()).toBe(1);
    } finally {
      await stop();
    }
  });

  it('second call with same id returns cached result — resolver not called again', async () => {
    const { baseUrl, getCallCount, stop } = await makeCacheServer();
    try {
      await fetch(`${baseUrl}/data/one`);
      const res = await fetch(`${baseUrl}/data/one`);
      const body = await res.json() as { data: { seq: number } };
      expect(body.data.seq).toBe(1); // cached seq from first call
      expect(getCallCount()).toBe(1); // resolver ran only once
    } finally {
      await stop();
    }
  });

  it('different ids hit the resolver separately', async () => {
    const { baseUrl, getCallCount, stop } = await makeCacheServer();
    try {
      await fetch(`${baseUrl}/data/a`);
      await fetch(`${baseUrl}/data/b`);
      expect(getCallCount()).toBe(2);
    } finally {
      await stop();
    }
  });
});

// ---------------------------------------------------------------------------
// withRateLimit
// ---------------------------------------------------------------------------

async function makeRateLimitServer(limit: number, windowMs: number) {
  // Named mutation → POST /api/ping
  const ping = capability(() => ({ pong: true }))
    .enhance(withRateLimit({ limit, windowMs }));

  const port = await getFreePort();
  const srv = createServer({
    context: buildContext,
    capabilities: { api: { ping } },
    transports: [restTransport({ port })],
  });
  await srv.start();

  return {
    url: `http://localhost:${port}/api/ping`,
    stop: () => srv.stop(),
  };
}

describe('withRateLimit — HTTP integration', () => {
  it('requests within limit succeed', async () => {
    const { url, stop } = await makeRateLimitServer(2, 60_000);
    try {
      const r1 = await post(url);
      const r2 = await post(url);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    } finally {
      await stop();
    }
  });

  it('request exceeding limit returns 429', async () => {
    const { url, stop } = await makeRateLimitServer(2, 60_000);
    try {
      await post(url);
      await post(url);
      const r3 = await post(url);
      expect(r3.status).toBe(429);
      const body = await r3.json() as { error: string };
      expect(body.error).toBe('TooManyRequests');
    } finally {
      await stop();
    }
  });
});

// ---------------------------------------------------------------------------
// withCircuitBreaker
// ---------------------------------------------------------------------------
// Each test gets its own server + capability instance so circuit state is isolated.

async function makeCircuitServer(options: { failureThreshold: number; successThreshold: number; timeoutMs: number }) {
  let shouldFail = true;

  // Plain Error (not FrameworkError) counts toward failure threshold
  const call = capability(() => {
    if (shouldFail) throw new Error('simulated failure');
    return { ok: true };
  }).enhance(withCircuitBreaker(options));

  const port = await getFreePort();
  const srv = createServer({
    context: buildContext,
    capabilities: { svc: { call } },
    transports: [restTransport({ port })],
  });
  await srv.start();

  return {
    url: `http://localhost:${port}/svc/call`,
    setFail: (v: boolean) => { shouldFail = v; },
    stop: () => srv.stop(),
  };
}

describe('withCircuitBreaker — HTTP integration', () => {
  it('circuit opens after threshold failures → 503', async () => {
    const { url, stop } = await makeCircuitServer({ failureThreshold: 2, successThreshold: 1, timeoutMs: 50 });
    await post(url); // failure 1
    await post(url); // failure 2 — circuit opens
    const r3 = await post(url); // circuit open → 503
    expect(r3.status).toBe(503);
    const body = await r3.json() as { error: string };
    expect(body.error).toBe('ServiceUnavailable');
    await stop();
  });

  it('circuit recovers after timeout + success', async () => {
    const { url, setFail, stop } = await makeCircuitServer({ failureThreshold: 2, successThreshold: 1, timeoutMs: 50 });
    await post(url); // failure 1
    await post(url); // failure 2 → circuit opens
    await new Promise((r) => setTimeout(r, 60)); // wait past timeout
    setFail(false);
    const res = await post(url); // half-open → success → closed
    expect(res.status).toBe(200);
    await stop();
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe('withTimeout — HTTP integration', () => {
  let server: Server;
  let baseUrl: string;

  // Named mutation → POST /ops/run
  const run = capability(
    z.object({ delay: z.number() }),
    async ({ delay }) => {
      await new Promise((r) => setTimeout(r, delay));
      return { done: true };
    },
  ).enhance(withTimeout(50));

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://localhost:${port}`;
    server = createServer({
      context: buildContext,
      capabilities: { ops: { run } },
      transports: [restTransport({ port })],
    });
    await server.start();
  });

  afterAll(async () => { await server.stop(); });

  it('fast operation completes successfully', async () => {
    const res = await post(`${baseUrl}/ops/run`, { delay: 0 });
    expect(res.status).toBe(200);
  });

  it('operation exceeding timeout returns 504', async () => {
    const res = await post(`${baseUrl}/ops/run`, { delay: 200 });
    expect(res.status).toBe(504);
  });
});

// ---------------------------------------------------------------------------
// withMetrics
// ---------------------------------------------------------------------------

describe('withMetrics — HTTP integration', () => {
  let server: Server;
  let baseUrl: string;
  let successCount = 0;
  let errorCount = 0;

  // Named mutation → POST /ops/track
  const track = capability(
    z.object({ fail: z.boolean() }),
    ({ fail }) => {
      if (fail) throw new Error('deliberate failure');
      return { ok: true };
    },
  ).enhance(withMetrics({
    increment(metric) {
      if (metric === 'capability.success') successCount++;
      if (metric === 'capability.error') errorCount++;
    },
    histogram() { /* no-op */ },
  }));

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://localhost:${port}`;
    server = createServer({
      context: buildContext,
      capabilities: { ops: { track } },
      transports: [restTransport({ port })],
    });
    await server.start();
    successCount = 0;
    errorCount = 0;
  });

  afterAll(async () => { await server.stop(); });

  it('successful invocation increments success metric', async () => {
    await post(`${baseUrl}/ops/track`, { fail: false });
    expect(successCount).toBe(1);
  });

  it('failing invocation increments error metric', async () => {
    await post(`${baseUrl}/ops/track`, { fail: true });
    expect(errorCount).toBe(1);
  });
});
