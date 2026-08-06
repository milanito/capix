/**
 * transport.test.ts — graphqlTransport's own HTTP wiring: mount/unmount,
 * custom endpoint path, trailing slash, and unknown routes.
 *
 * index.test.ts covers schema-building; test/integration/graphql.test.ts
 * covers end-to-end query/mutation/guard/error behavior over the default
 * mount. This file is the remaining gap: transport-level concerns that
 * don't depend on any particular schema shape.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { capability, createServer, defineContext } from '@capixjs/core';
import { graphqlTransport } from './transport.js';
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

/**
 * getFreePort() closes its probe socket before the real server binds to that
 * port number — under CI-level parallelism, another test file's probe can
 * claim the same ephemeral port in that gap, so the real bind then fails
 * with EADDRINUSE. Retries with a fresh port on that specific failure.
 */
async function startOnFreePort<T extends { start: () => Promise<void> }>(
  build: (port: number) => T,
  maxAttempts = 5,
): Promise<{ server: T; port: number }> {
  for (let attempt = 1; ; attempt++) {
    const port = await getFreePort();
    const server = build(port);
    try {
      await server.start();
      return { server, port };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE' || attempt >= maxAttempts) throw err;
    }
  }
}

const buildContext = defineContext(async () => ({ requestId: 'test' }));
const ping = capability(() => ({ pong: true }), 'query');

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers) await s.stop().catch(() => {});
  servers.length = 0;
});

async function query(baseUrl: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ ping { pong } }' }),
  });
  const status = res.status;
  const body = status === 404 ? null : ((await res.json()) as unknown);
  return { status, body };
}

describe('graphqlTransport — endpoint path', () => {
  it('serves the default /graphql endpoint', async () => {
    const { server, port } = await startOnFreePort((p) => createServer({
      context: buildContext,
      capabilities: { ping },
      transports: [graphqlTransport({ port: p })],
    }));
    servers.push(server);
    const { status } = await query(`http://localhost:${port}`, '/graphql');
    expect(status).toBe(200);
  });

  it('serves at a custom path and 404s the default one', async () => {
    const { server, port } = await startOnFreePort((p) => createServer({
      context: buildContext,
      capabilities: { ping },
      transports: [graphqlTransport({ port: p, path: '/api/gql' })],
    }));
    servers.push(server);
    const baseUrl = `http://localhost:${port}`;
    expect((await query(baseUrl, '/api/gql')).status).toBe(200);
    expect((await query(baseUrl, '/graphql')).status).toBe(404);
  });

  it('accepts a trailing slash on the endpoint path', async () => {
    const { server, port } = await startOnFreePort((p) => createServer({
      context: buildContext,
      capabilities: { ping },
      transports: [graphqlTransport({ port: p })],
    }));
    servers.push(server);
    const { status } = await query(`http://localhost:${port}`, '/graphql/');
    expect(status).toBe(200);
  });

  it('returns 404 for an unrelated path', async () => {
    const { server, port } = await startOnFreePort((p) => createServer({
      context: buildContext,
      capabilities: { ping },
      transports: [graphqlTransport({ port: p })],
    }));
    servers.push(server);
    const { status } = await query(`http://localhost:${port}`, '/nope');
    expect(status).toBe(404);
  });
});

describe('graphqlTransport — mount/unmount lifecycle', () => {
  it('unmount() stops the server so further requests fail to connect', async () => {
    const { server, port } = await startOnFreePort((p) => createServer({
      context: buildContext,
      capabilities: { ping },
      transports: [graphqlTransport({ port: p })],
    }));
    const baseUrl = `http://localhost:${port}`;
    expect((await query(baseUrl, '/graphql')).status).toBe(200);

    await server.stop();
    await expect(query(baseUrl, '/graphql')).rejects.toThrow();
  });

  it('a second stop() is a no-op, not a hang or throw', async () => {
    const { server, port } = await startOnFreePort((p) => createServer({
      context: buildContext,
      capabilities: { ping },
      transports: [graphqlTransport({ port: p })],
    }));
    void port;
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });
});
