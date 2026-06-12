import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry } from '@capixjs/core';
import { graphql, GraphQLNonNull, GraphQLString, GraphQLFloat, GraphQLBoolean } from 'graphql';
import { buildGraphQLSchema, JSONScalar } from './schema-builder.js';
import type { CapabilityResponse, InvokeFn } from '@capixjs/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoke(response: CapabilityResponse): InvokeFn {
  const fn = vi.fn().mockResolvedValue(response);
  return fn as unknown as InvokeFn;
}

function makeSchema(
  caps: Record<string, Record<string, ReturnType<typeof capability>>>,
  invoke: InvokeFn,
) {
  const registry = compileRegistry(caps);
  return buildGraphQLSchema(registry, invoke);
}

// ---------------------------------------------------------------------------
// Query vs Mutation routing
// ---------------------------------------------------------------------------

describe('buildGraphQLSchema — Query vs Mutation', () => {
  it('query intent produces a Query field', async () => {
    const invoke = makeInvoke({ ok: true, data: 'pong' });
    const schema = makeSchema({ sys: { ping: capability(() => 'pong', 'query') } }, invoke);

    const result = await graphql({ schema, source: '{ sys_ping }' });

    expect(result.errors).toBeUndefined();
    expect((result.data as Record<string, unknown>)['sys_ping']).toBe('pong');
  });

  it('mutation intent produces a Mutation field', async () => {
    const invoke = makeInvoke({ ok: true, data: { id: '1' } });
    const schema = makeSchema({
      users: {
        createUser: capability(
          z.object({ name: z.string() }),
          async (i) => i,
          'mutation',
        ),
      },
    }, invoke);

    const result = await graphql({
      schema,
      source: 'mutation { users_createUser(name: "Alice") }',
    });

    expect(result.errors).toBeUndefined();
  });

  it('update intent produces a Mutation field', async () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      users: {
        updateUser: capability(
          z.object({ id: z.string() }),
          async (i) => i,
          'update',
        ),
      },
    }, invoke);

    const result = await graphql({
      schema,
      source: 'mutation { users_updateUser(id: "1") }',
    });

    expect(result.errors).toBeUndefined();
  });

  it('delete intent produces a Mutation field', async () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      items: {
        deleteItem: capability(
          z.object({ id: z.string() }),
          async () => null,
          'delete',
        ),
      },
    }, invoke);

    const result = await graphql({
      schema,
      source: 'mutation { items_deleteItem(id: "x") }',
    });

    expect(result.errors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Invoke integration
// ---------------------------------------------------------------------------

describe('buildGraphQLSchema — invoke integration', () => {
  it('passes args to invoke as input', async () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      items: {
        getItem: capability(
          z.object({ id: z.string() }),
          async (i) => i,
          'query',
        ),
      },
    }, invoke);

    await graphql({ schema, source: '{ items_getItem(id: "42") }' });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'items.getItem',
      input: { id: '42' },
    }));
  });

  it('throws GraphQL error when invoke returns ok: false', async () => {
    const invoke = makeInvoke({
      ok: false,
      error: { status: 404, error: 'NotFound', message: 'Item not found' },
    });
    const schema = makeSchema({
      items: {
        getItem: capability(z.object({ id: z.string() }), async (i) => i, 'query'),
      },
    }, invoke);

    const result = await graphql({ schema, source: '{ items_getItem(id: "99") }' });

    expect(result.errors).toBeDefined();
    expect(result.errors![0]!.message).toBe('Item not found');
  });

  it('exposes code, status, and meta in error extensions', async () => {
    const invoke = makeInvoke({
      ok: false,
      error: {
        status: 429,
        error: 'TooManyRequests',
        message: 'Too many requests',
        meta: { retryAfter: 12, limit: 100 },
      },
    });
    const schema = makeSchema({
      items: {
        getItem: capability(z.object({ id: z.string() }), async (i) => i, 'query'),
      },
    }, invoke);

    const result = await graphql({ schema, source: '{ items_getItem(id: "99") }' });

    expect(result.errors).toBeDefined();
    const err = result.errors![0]!;
    expect(err.message).toBe('Too many requests');
    expect(err.extensions).toMatchObject({
      code: 'TooManyRequests',
      status: 429,
      meta: { retryAfter: 12, limit: 100 },
    });
  });

  it('omits meta from extensions when the error has none', async () => {
    const invoke = makeInvoke({
      ok: false,
      error: { status: 403, error: 'Forbidden', message: 'Forbidden' },
    });
    const schema = makeSchema({
      items: {
        getItem: capability(z.object({ id: z.string() }), async (i) => i, 'query'),
      },
    }, invoke);

    const result = await graphql({ schema, source: '{ items_getItem(id: "1") }' });

    const err = result.errors![0]!;
    expect(err.extensions).toMatchObject({ code: 'Forbidden', status: 403 });
    expect(err.extensions).not.toHaveProperty('meta');
  });

  it('dot-path name maps to underscore field name', async () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      users: { getUser: capability(() => null, 'query') },
    }, invoke);

    await graphql({ schema, source: '{ users_getUser }' });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'users.getUser',
    }));
  });

  it('no-input capability resolves with empty input', async () => {
    const invoke = makeInvoke({ ok: true, data: { pong: true } });
    const schema = makeSchema({
      sys: { ping: capability(() => ({ pong: true }), 'query') },
    }, invoke);

    await graphql({ schema, source: '{ sys_ping }' });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'sys.ping',
      input: {},
    }));
  });
});

// ---------------------------------------------------------------------------
// Type conversion
// ---------------------------------------------------------------------------

describe('buildGraphQLSchema — type conversion', () => {
  it('string input arg is GraphQLNonNull(GraphQLString)', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      items: { getItem: capability(z.object({ id: z.string() }), async (i) => i, 'query') },
    }, invoke);

    const field = schema.getQueryType()!.getFields()['items_getItem']!;
    const arg = field.args.find((a) => a.name === 'id')!;
    expect(arg.type).toBeInstanceOf(GraphQLNonNull);
    expect((arg.type as GraphQLNonNull<typeof GraphQLString>).ofType).toBe(GraphQLString);
  });

  it('number input arg is GraphQLNonNull(GraphQLFloat)', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      items: { listItems: capability(z.object({ page: z.number() }), async (i) => i, 'query') },
    }, invoke);

    const field = schema.getQueryType()!.getFields()['items_listItems']!;
    const arg = field.args.find((a) => a.name === 'page')!;
    expect(arg.type).toBeInstanceOf(GraphQLNonNull);
    expect((arg.type as GraphQLNonNull<typeof GraphQLFloat>).ofType).toBe(GraphQLFloat);
  });

  it('boolean input arg is GraphQLNonNull(GraphQLBoolean)', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      items: { listItems: capability(z.object({ active: z.boolean() }), async (i) => i, 'query') },
    }, invoke);

    const field = schema.getQueryType()!.getFields()['items_listItems']!;
    const arg = field.args.find((a) => a.name === 'active')!;
    expect(arg.type).toBeInstanceOf(GraphQLNonNull);
    expect((arg.type as GraphQLNonNull<typeof GraphQLBoolean>).ofType).toBe(GraphQLBoolean);
  });

  it('optional input arg is nullable (no NonNull wrapper)', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      items: {
        listItems: capability(z.object({ page: z.number().optional() }), async (i) => i, 'query'),
      },
    }, invoke);

    const field = schema.getQueryType()!.getFields()['items_listItems']!;
    const arg = field.args.find((a) => a.name === 'page')!;
    expect(arg.type).not.toBeInstanceOf(GraphQLNonNull);
    expect(arg.type).toBe(GraphQLFloat);
  });

  it('no outputSchema → JSONScalar return type', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      sys: { ping: capability(() => null, 'query') },
    }, invoke);

    const field = schema.getQueryType()!.getFields()['sys_ping']!;
    expect(field.type).toBe(JSONScalar);
  });

  it('outputSchema with ZodObject → named GraphQLObjectType with NonNull', () => {
    const invoke = makeInvoke({ ok: true, data: { id: '1', name: 'Alice' } });
    const schema = makeSchema({
      users: {
        getUser: capability(
          z.object({ id: z.string() }),
          async (i) => i,
          'query',
        ).output(z.object({ id: z.string(), name: z.string() })),
      },
    }, invoke);

    const field = schema.getQueryType()!.getFields()['users_getUser']!;
    // Should be NonNull(ObjectType)
    expect(field.type.toString()).toContain('UsersGetUserOutput');
  });
});

// ---------------------------------------------------------------------------
// Schema with only mutations
// ---------------------------------------------------------------------------

describe('buildGraphQLSchema — all-mutation registry', () => {
  it('Query type has _empty placeholder when no query capabilities', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      users: {
        createUser: capability(z.object({ name: z.string() }), async (i) => i, 'mutation'),
      },
    }, invoke);

    const queryType = schema.getQueryType()!;
    expect(queryType.getFields()['_empty']).toBeDefined();

    const mutationType = schema.getMutationType()!;
    expect(mutationType.getFields()['users_createUser']).toBeDefined();
  });

  it('Mutation type is absent when all capabilities are queries', () => {
    const invoke = makeInvoke({ ok: true, data: null });
    const schema = makeSchema({
      sys: { ping: capability(() => null, 'query') },
    }, invoke);

    expect(schema.getMutationType()).toBeUndefined();
  });
});
