/**
 * cross-transport.test.ts — the flagship guarantee, tested end to end.
 *
 * ONE server, ONE registry, FOUR live transports (REST, WebSocket, GraphQL,
 * MCP). Every assertion here is about consistency: the same capability must
 * return the same data, reject with the same typed error, share the same
 * enhancer state, and honor the same guards no matter which protocol the
 * request arrived on.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as net from 'node:net';
import WebSocket from 'ws';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
  createEventBus,
  withRateLimit,
} from '@capixjs/core';
import type { Server, BaseContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { wsTransport } from '@capixjs/transport-ws';
import { graphqlTransport } from '@capixjs/transport-graphql';
import { mcpTransport } from '@capixjs/transport-mcp';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
// One registry
// ---------------------------------------------------------------------------

type Item = { id: string; name: string };
const ITEMS = new Map<string, Item>([['1', { id: '1', name: 'widget' }]]);

const errors = { NotFound: defineError(404, 'Not found') };

type Ctx = BaseContext & { isAdmin: boolean };

const mustBeAdmin = defineGuard((ctx: Ctx) => {
  if (!ctx.isAdmin) throw defineError(403, 'Forbidden')();
});

const cap = capability.withContext<Ctx>();
const events = createEventBus<{ 'item:created': Item }>();

const getItem = cap(
  z.object({ id: z.string() }),
  ({ id }) => {
    const item = ITEMS.get(id);
    if (!item) throw errors.NotFound();
    return item;
  },
  'query',
);

const createItem = cap(
  z.object({ name: z.string().min(1) }),
  ({ name }) => {
    const item: Item = { id: String(ITEMS.size + 1), name };
    ITEMS.set(item.id, item);
    events.publish('item:created', item);
    return item;
  },
  'mutation',
);

// Guarded, non-destructive: consistency of the guard is what's under test.
// deleteItem infers DELETE /items/:id, so all transports can reach it.
const deleteItem = cap(z.object({ id: z.string() }), ({ id }) => ({ deleted: id }), 'delete')
  .guard(mustBeAdmin);

// One shared rate-limited capability: the limiter state lives on the
// capability, so hits must count across transports.
const getScarce = cap(z.object({}), () => ({ ok: true }), 'query').enhance(
  withRateLimit({ limit: 2, windowMs: 60_000, keyFn: () => 'global' }),
);

const tree = {
  items: { getItem, createItem, deleteItem },
  scarce: { getScarce },
};

// ---------------------------------------------------------------------------
// One server, four transports
// ---------------------------------------------------------------------------

let server: Server;
let restPort: number, wsPort: number, gqlPort: number, mcpPort: number;

beforeAll(async () => {
  [restPort, wsPort, gqlPort, mcpPort] = await Promise.all([
    getFreePort(), getFreePort(), getFreePort(), getFreePort(),
  ]);

  server = createServer({
    context: defineContext(async (req): Promise<Ctx> => ({
      requestId: crypto.randomUUID(),
      isAdmin: req.headers['x-role'] === 'admin',
    })),
    capabilities: tree,
    transports: [
      restTransport({ port: restPort }),
      wsTransport({ port: wsPort, eventBus: events }),
      graphqlTransport({ port: gqlPort, playground: false }),
      mcpTransport({ port: mcpPort }),
    ],
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

// Per-protocol callers, all hitting items.getItem / errors the same way
async function viaRest(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${restPort}/items/${id}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function viaWs(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const reply = new Promise<Record<string, unknown>>((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString()) as Record<string, unknown>));
  });
  ws.send(JSON.stringify(payload));
  const out = await reply;
  ws.close();
  return out;
}

async function viaGraphql(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${gqlPort}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function viaMcp<T>(fn: (client: McpClient) => Promise<T>, headers: Record<string, string> = {}): Promise<T> {
  const client = new McpClient({ name: 'xt', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${mcpPort}/mcp`),
    { requestInit: { headers } },
  ) as unknown as Parameters<McpClient['connect']>[0]);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Consistency assertions
// ---------------------------------------------------------------------------

describe('one registry, four transports', () => {
  it('returns the same data on REST, WS, GraphQL, and MCP', async () => {
    const item = { id: '1', name: 'widget' };

    const rest = await viaRest('1');
    expect(rest.body['data']).toEqual(item);

    const ws = await viaWs({ id: 'q1', capability: 'items.getItem', input: { id: '1' } });
    expect(ws['data']).toEqual(item);

    const gql = await viaGraphql('{ items_getItem(id: "1") }');
    expect((gql['data'] as Record<string, unknown>)['items_getItem']).toEqual(item);

    const mcp = await viaMcp((c) => c.callTool({ name: 'items_getItem', arguments: { id: '1' } }));
    expect(mcp.structuredContent).toEqual(item);
  });

  it('rejects with the same typed NotFound error everywhere', async () => {
    const rest = await viaRest('ghost');
    expect(rest.status).toBe(404);
    expect(rest.body['error']).toBe('NotFound');

    const ws = await viaWs({ id: 'q2', capability: 'items.getItem', input: { id: 'ghost' } });
    expect(ws['ok']).toBe(false);
    expect(ws['error']).toBe('NotFound');
    expect(ws['status']).toBe(404);

    const gql = await viaGraphql('{ items_getItem(id: "ghost") }');
    const gqlErr = (gql['errors'] as Array<Record<string, unknown>>)[0]!;
    expect((gqlErr['extensions'] as Record<string, unknown>)['code']).toBe('NotFound');
    expect((gqlErr['extensions'] as Record<string, unknown>)['status']).toBe(404);

    const mcp = await viaMcp((c) => c.callTool({ name: 'items_getItem', arguments: { id: 'ghost' } }));
    expect(mcp.isError).toBe(true);
    expect((mcp.content as Array<{ text: string }>)[0]!.text).toContain('NotFound');
  });

  it('validates input identically everywhere (empty name rejected)', async () => {
    const rest = await fetch(`http://127.0.0.1:${restPort}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(rest.status).toBe(400);

    const ws = await viaWs({ id: 'q3', capability: 'items.createItem', input: { name: '' } });
    expect(ws['status']).toBe(400);
    expect(ws['error']).toBe('BadRequest');

    const mcp = await viaMcp((c) => c.callTool({ name: 'items_createItem', arguments: { name: '' } }));
    expect(mcp.isError).toBe(true);
    expect((mcp.content as Array<{ text: string }>)[0]!.text).toContain('BadRequest');
  });

  it('enforces the admin guard from headers on REST and MCP alike', async () => {
    const denied = await fetch(`http://127.0.0.1:${restPort}/items/1`, { method: 'DELETE' });
    expect(denied.status).toBe(403);

    const allowed = await fetch(`http://127.0.0.1:${restPort}/items/1`, {
      method: 'DELETE',
      headers: { 'x-role': 'admin' },
    });
    expect(allowed.status).toBe(200);

    const mcpDenied = await viaMcp((c) => c.callTool({ name: 'items_deleteItem', arguments: { id: '1' } }));
    expect(mcpDenied.isError).toBe(true);
    expect((mcpDenied.content as Array<{ text: string }>)[0]!.text).toContain('Forbidden');

    const mcpAllowed = await viaMcp(
      (c) => c.callTool({ name: 'items_deleteItem', arguments: { id: '1' } }),
      { 'x-role': 'admin' },
    );
    expect(mcpAllowed.isError).toBeFalsy();
  });

  it('shares enhancer state across transports — one rate limit, not one per protocol', async () => {
    // Two allowed hits: one REST, one GraphQL
    const first = await fetch(`http://127.0.0.1:${restPort}/scarce`);
    expect(first.status).toBe(200);
    const second = await viaGraphql('{ scarce_getScarce }');
    expect(second['errors']).toBeUndefined();

    // Third hit via a THIRD transport must be rejected — the window is shared
    const third = await viaWs({ id: 'q4', capability: 'scarce.getScarce', input: {} });
    expect(third['status']).toBe(429);
    expect(third['error']).toBe('TooManyRequests');
  });

  it('delivers event-bus events published by a REST mutation to WS subscribers', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString()) as Record<string, unknown>));
    ws.send(JSON.stringify({ id: 's1', action: 'subscribe', event: 'item:created' }));
    await new Promise((r) => setTimeout(r, 150));

    const res = await fetch(`http://127.0.0.1:${restPort}/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'from-rest' }),
    });
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 300));
    // The subscribe ack also carries an `event` field — match delivery frames only
    const event = messages.find((m) => m['event'] === 'item:created' && m['data'] !== undefined);
    expect(event).toBeDefined();
    expect((event!['data'] as Item).name).toBe('from-rest');
    ws.close();
  });
});
