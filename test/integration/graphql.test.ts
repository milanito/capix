/**
 * graphql.test.ts — GraphQL transport end to end over real HTTP.
 *
 * packages/transports/graphql/src/index.test.ts already covers schema-building
 * logic against an in-memory `graphql()` call. This file is the missing piece:
 * a live graphqlTransport mounted on createServer, driven with real `fetch()`
 * POSTs — HTTP wiring, header-based auth through a full guard chain, playground
 * routing, and GraphQL-specific output shapes (nested objects, lists, enums,
 * variables) that only show up once a real schema is queried end to end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import * as net from 'node:net';
import {
  capability,
  defineContext,
  defineGuard,
  defineError,
  createServer,
} from '@capixjs/core';
import { graphqlTransport } from '@capixjs/transport-graphql';
import type { Server } from '@capixjs/core';

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

async function gql(
  baseUrl: string,
  query: string,
  variables?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query, ...(variables !== undefined ? { variables } : {}) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

type Role = 'user' | 'admin';
type Book = { id: string; title: string; tags: string[]; status: 'draft' | 'published' };

const BOOKS: Book[] = [
  { id: '1', title: 'Clean Code', tags: ['craft', 'classic'], status: 'published' },
  { id: '2', title: 'WIP Notes', tags: [], status: 'draft' },
];

const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  Forbidden: defineError(403, 'Forbidden'),
  NotFound: defineError(404, 'Not found'),
};

type Ctx = { requestId: string; role: Role | null };

const buildContext = defineContext(async (req): Promise<Ctx> => {
  const role = req.headers['x-role'];
  return { requestId: crypto.randomUUID(), role: role === 'admin' || role === 'user' ? role : null };
});

const mustBeAdmin = defineGuard((ctx: Ctx): asserts ctx is Ctx & { role: 'admin' } => {
  if (ctx.role !== 'admin') throw errors.Forbidden();
});

const mustBeAuthed = defineGuard((ctx: Ctx): asserts ctx is Ctx & { role: Role } => {
  if (!ctx.role) throw errors.Unauthorized();
});

const BookOutput = z.object({
  id: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  status: z.enum(['draft', 'published']),
});

const getBook = capability(
  z.object({ id: z.string() }),
  ({ id }) => {
    const book = BOOKS.find((b) => b.id === id);
    if (!book) throw errors.NotFound({ id });
    return book;
  },
  'query',
).output(BookOutput);

const listBooks = capability(z.object({}), () => BOOKS, 'query').output(z.array(BookOutput));

const createBook = capability(
  z.object({ title: z.string().min(1), tags: z.array(z.string()).default([]) }),
  ({ title, tags }) => {
    const book: Book = { id: String(BOOKS.length + 1), title, tags, status: 'draft' };
    BOOKS.push(book);
    return book;
  },
  'mutation',
).guard(mustBeAdmin).output(BookOutput);

const whoAmI = capability(z.object({}), (_i, ctx) => ({ role: ctx.role }), 'query')
  .guard(mustBeAuthed)
  .output(z.object({ role: z.string() }));

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const port = await getFreePort();
  baseUrl = `http://localhost:${port}`;

  server = createServer({
    context: buildContext,
    capabilities: { books: { getBook, listBooks, createBook }, me: { whoAmI } },
    transports: [graphqlTransport({ port })],
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphQL transport integration', () => {
  it('resolves a query with nested object field selection', async () => {
    const { status, body } = await gql(baseUrl, '{ books_getBook(id: "1") { id title status } }');
    expect(status).toBe(200);
    expect(body['data']).toEqual({ books_getBook: { id: '1', title: 'Clean Code', status: 'published' } });
  });

  it('resolves a list output type', async () => {
    const { body } = await gql(baseUrl, '{ books_listBooks { id title } }');
    const data = (body['data'] as Record<string, unknown>)['books_listBooks'] as Array<Record<string, unknown>>;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ id: '1', title: 'Clean Code' });
  });

  it('resolves array-of-string fields (tags)', async () => {
    const { body } = await gql(baseUrl, '{ books_getBook(id: "1") { tags } }');
    expect((body['data'] as Record<string, unknown>)['books_getBook']).toEqual({ tags: ['craft', 'classic'] });
  });

  it('resolves enum output values', async () => {
    const { body } = await gql(baseUrl, '{ books_getBook(id: "2") { status } }');
    expect((body['data'] as Record<string, unknown>)['books_getBook']).toEqual({ status: 'draft' });
  });

  it('accepts query variables, not just inline literals', async () => {
    const { body } = await gql(
      baseUrl,
      'query GetBook($id: String!) { books_getBook(id: $id) { title } }',
      { id: '2' },
    );
    expect((body['data'] as Record<string, unknown>)['books_getBook']).toEqual({ title: 'WIP Notes' });
  });

  it('NotFound capability error surfaces with code/status extensions', async () => {
    const { body } = await gql(baseUrl, '{ books_getBook(id: "ghost") { id } }');
    const err = (body['errors'] as Array<Record<string, unknown>>)[0]!;
    expect(err['message']).toBe('Not found');
    expect(err['extensions']).toMatchObject({ code: 'NotFound', status: 404 });
  });

  it('guard rejects an unauthenticated mutation with Forbidden', async () => {
    const { body } = await gql(baseUrl, 'mutation { books_createBook(title: "New") { id } }');
    const err = (body['errors'] as Array<Record<string, unknown>>)[0]!;
    expect(err['extensions']).toMatchObject({ code: 'Forbidden', status: 403 });
  });

  it('guard allows an admin-header mutation and default() applies (empty tags)', async () => {
    const { body } = await gql(
      baseUrl,
      'mutation { books_createBook(title: "New") { title tags } }',
      undefined,
      { 'x-role': 'admin' },
    );
    expect(body['errors']).toBeUndefined();
    expect((body['data'] as Record<string, unknown>)['books_createBook']).toEqual({ title: 'New', tags: [] });
  });

  it('input validation failure (empty title) returns BadRequest extensions', async () => {
    const { body } = await gql(
      baseUrl,
      'mutation { books_createBook(title: "") { id } }',
      undefined,
      { 'x-role': 'admin' },
    );
    const err = (body['errors'] as Array<Record<string, unknown>>)[0]!;
    expect(err['extensions']).toMatchObject({ code: 'BadRequest', status: 400 });
  });

  it('context built from headers threads role through a guard into the resolver', async () => {
    const { body } = await gql(baseUrl, '{ me_whoAmI { role } }', undefined, { 'x-role': 'user' });
    expect((body['data'] as Record<string, unknown>)['me_whoAmI']).toEqual({ role: 'user' });
  });

  it('unknown field is a schema validation error, not a 500', async () => {
    // graphql-http answers 200 with an `errors` array here — it only emits a
    // non-200 request-error status when the client negotiates
    // Accept: application/graphql-response+json. Plain application/json (what
    // every other client in this suite sends) gets the legacy 200 shape.
    const { status, body } = await gql(baseUrl, '{ books_doesNotExist { id } }');
    expect(status).toBe(200);
    expect(body['data']).toBeUndefined();
    expect(body['errors']).toBeDefined();
  });

  it('serves the GraphiQL playground at /graphql/playground', async () => {
    const res = await fetch(`${baseUrl}/graphql/playground`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('GraphiQL');
  });

  it('unknown path returns 404', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`);
    expect(res.status).toBe(404);
  });
});

describe('GraphQL transport — playground disabled', () => {
  let disabledServer: Server;
  let disabledBaseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    disabledBaseUrl = `http://localhost:${port}`;
    disabledServer = createServer({
      context: buildContext,
      capabilities: { books: { listBooks } },
      transports: [graphqlTransport({ port, playground: false })],
    });
    await disabledServer.start();
  });

  afterAll(async () => {
    await disabledServer.stop();
  });

  it('returns 404 for the playground path when disabled', async () => {
    const res = await fetch(`${disabledBaseUrl}/graphql/playground`);
    expect(res.status).toBe(404);
  });

  it('the GraphQL endpoint itself still works', async () => {
    const { status } = await gql(disabledBaseUrl, '{ books_listBooks { id } }');
    expect(status).toBe(200);
  });
});
