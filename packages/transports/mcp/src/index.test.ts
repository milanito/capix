import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import {
  capability,
  compileRegistry,
  createExecutionEngine,
  defineContext,
  defineError,
  defineGuard,
} from '@capixjs/core';
import type { InvokeFn } from '@capixjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildMcpServer, buildTools, toToolName, mcpTransport } from './index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const Forbidden = defineError(403, 'Forbidden');

const mustBeAdmin = defineGuard((ctx) => {
  if ((ctx as { role?: string }).role !== 'admin') throw Forbidden();
});

const getUser = capability(
  z.object({ id: z.string() }),
  ({ id }) => ({ id, name: 'Alice' }),
).output(z.object({ id: z.string(), name: z.string() }));

const listUsers = capability(
  z.object({ page: z.number().optional() }),
  () => [{ id: '1' }],
);

const createUser = capability(
  z.object({ name: z.string(), email: z.string() }),
  (i) => ({ id: 'new', ...i }),
);

const deleteUser = capability(z.object({ id: z.string() }), () => ({ deleted: true }));

const ping = capability(() => 'pong', 'query');

const adminOnly = capability(z.object({}), () => ({ secret: 42 })).guard(mustBeAdmin);

const tree = {
  users: { getUser, listUsers, createUser, deleteUser },
  system: { ping },
  admin: { getSecrets: adminOnly },
};

function makeInvoke(): InvokeFn {
  return createExecutionEngine({
    registry: compileRegistry(tree),
    buildContext: defineContext(async (req) => ({
      requestId: 'test',
      role: req.headers['x-role'] ?? 'user',
    })),
    isDevelopment: true,
  });
}

async function connectedClient(): Promise<Client> {
  const registry = compileRegistry(tree);
  const server = buildMcpServer(registry, makeInvoke(), { name: 'test-api', version: '1.2.3' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport as unknown as Parameters<typeof server.connect>[0]);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(clientTransport as unknown as Parameters<Client['connect']>[0]);
  return client;
}

// ---------------------------------------------------------------------------
// Tool listing
// ---------------------------------------------------------------------------

describe('buildTools', () => {
  it('converts dot-paths to underscore tool names', () => {
    expect(toToolName('users.getUser')).toBe('users_getUser');
    const { tools, byName } = buildTools(compileRegistry(tree));
    expect(tools.map((t) => t.name)).toContain('users_getUser');
    expect(byName.get('users_getUser')).toBe('users.getUser');
  });

  it('derives inputSchema from the Zod input schema', () => {
    const { tools } = buildTools(compileRegistry(tree));
    const create = tools.find((t) => t.name === 'users_createUser')!;
    expect(create.inputSchema['type']).toBe('object');
    expect(Object.keys(create.inputSchema['properties'] as object).sort()).toEqual(['email', 'name']);
    expect(create.inputSchema['required']).toEqual(['name', 'email']);
  });

  it('gives schemaless capabilities an empty object inputSchema', () => {
    const { tools } = buildTools(compileRegistry(tree));
    const pingTool = tools.find((t) => t.name === 'system_ping')!;
    expect(pingTool.inputSchema).toEqual({ type: 'object', properties: {} });
  });

  it('declares outputSchema only for object-typed output schemas', () => {
    const { tools } = buildTools(compileRegistry(tree));
    const get = tools.find((t) => t.name === 'users_getUser')!;
    expect(get.outputSchema).toBeDefined();
    expect((get.outputSchema as Record<string, unknown>)['type']).toBe('object');
    const list = tools.find((t) => t.name === 'users_listUsers')!;
    expect(list.outputSchema).toBeUndefined();
  });

  it('maps intent to tool annotations', () => {
    const { tools } = buildTools(compileRegistry(tree));
    const get = tools.find((t) => t.name === 'users_getUser')!;
    expect(get.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const del = tools.find((t) => t.name === 'users_deleteUser')!;
    expect(del.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const create = tools.find((t) => t.name === 'users_createUser')!;
    expect(create.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });
});

// ---------------------------------------------------------------------------
// End-to-end over InMemoryTransport
// ---------------------------------------------------------------------------

describe('MCP server — tools/list and tools/call', () => {
  it('lists every capability as a tool', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'admin_getSecrets',
      'system_ping',
      'users_createUser',
      'users_deleteUser',
      'users_getUser',
      'users_listUsers',
    ]);
    await client.close();
  });

  it('calls a tool and returns JSON text plus structuredContent', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'users_getUser', arguments: { id: '7' } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual({ id: '7', name: 'Alice' });
    expect(result.structuredContent).toEqual({ id: '7', name: 'Alice' });
    await client.close();
  });

  it('returns scalar results as text without structuredContent', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'system_ping', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toBe('"pong"');
    expect(result.structuredContent).toBeUndefined();
    await client.close();
  });

  it('surfaces validation failures as tool errors with issues', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'users_createUser', arguments: { name: 42 } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('BadRequest');
    expect(text).toContain('name');
    expect(text).toContain('email');
    await client.close();
  });

  it('surfaces guard rejections as typed tool errors', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'admin_getSecrets', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('Forbidden');
    await client.close();
  });

  it('rejects unknown tool names', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'nope_nothing', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toContain('NotFound');
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// Streamable HTTP mode
// ---------------------------------------------------------------------------

describe('mcpTransport — Streamable HTTP', () => {
  const PORT = 39517;
  let transport: ReturnType<typeof mcpTransport> | null = null;

  afterEach(async () => {
    await transport?.unmount();
    transport = null;
  });

  it('serves tools over HTTP and forwards request headers to context', async () => {
    const registry = compileRegistry(tree);
    transport = mcpTransport({ port: PORT, name: 'http-api' });
    await transport.mount(makeInvoke(), { registry, invoke: makeInvoke() });

    const clientTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${PORT}/mcp`),
      { requestInit: { headers: { 'x-role': 'admin' } } },
    );
    const client = new Client({ name: 'http-client', version: '0.0.1' });
    await client.connect(clientTransport as unknown as Parameters<Client['connect']>[0]);

    const { tools } = await client.listTools();
    expect(tools.length).toBe(6);

    // x-role: admin header reaches the context builder → guard passes
    const result = await client.callTool({ name: 'admin_getSecrets', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ secret: 42 });

    await client.close();
  });

  it('404s outside the MCP path', async () => {
    const registry = compileRegistry(tree);
    transport = mcpTransport({ port: PORT });
    await transport.mount(makeInvoke(), { registry, invoke: makeInvoke() });

    const res = await fetch(`http://127.0.0.1:${PORT}/other`);
    expect(res.status).toBe(404);
  });
});
