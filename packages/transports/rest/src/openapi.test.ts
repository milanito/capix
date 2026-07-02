import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry } from '@capixjs/core';
import { generateOpenAPI } from './openapi.js';

type Spec = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, {
    operationId: string;
    summary: string;
    tags?: string[];
    parameters?: Array<{ name: string; in: string; required: boolean; schema: Record<string, unknown> }>;
    requestBody?: { required: boolean; content: Record<string, { schema: Record<string, unknown> }> };
    responses: Record<string, { description: string; content?: Record<string, { schema: Record<string, unknown> }> }>;
  }>>;
  components: { schemas: Record<string, unknown> };
  tags?: Array<{ name: string }>;
};

function spec(tree: Parameters<typeof compileRegistry>[0], options = {}): Spec {
  return generateOpenAPI(compileRegistry(tree), options) as unknown as Spec;
}

const getUser = capability(z.object({ id: z.string() }), ({ id }) => ({ id }));
const listUsers = capability(
  z.object({ page: z.number().optional(), active: z.boolean().default(true) }),
  (i) => i,
);
const createUser = capability(
  z.object({ name: z.string(), email: z.string().email(), age: z.number().optional() }),
  (i) => i,
);
const updateUser = capability(z.object({ id: z.string(), name: z.string() }), (i) => i);

describe('generateOpenAPI — document shape', () => {
  it('emits a valid 3.1 skeleton with info defaults', () => {
    const doc = spec({ users: { getUser } });
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toEqual({ title: 'Capix API', version: '0.0.0' });
    expect(doc.components.schemas['ErrorResponse']).toBeDefined();
  });

  it('honors title, version, description, and servers', () => {
    const doc = spec({ users: { getUser } }, {
      title: 'My API',
      version: '2.0.0',
      description: 'desc',
      servers: [{ url: 'https://api.example.com' }],
    });
    expect(doc.info).toEqual({ title: 'My API', version: '2.0.0', description: 'desc' });
    expect(doc.servers).toEqual([{ url: 'https://api.example.com' }]);
  });

  it('collects group tags', () => {
    const doc = spec({ users: { getUser }, posts: { listPosts: listUsers } });
    expect(doc.tags).toEqual([{ name: 'posts' }, { name: 'users' }]);
  });

  it('produces an empty paths object for an empty registry', () => {
    const doc = spec({});
    expect(doc.paths).toEqual({});
  });
});

describe('generateOpenAPI — routes and parameters', () => {
  it('converts :id to {id} and emits a required path parameter', () => {
    const doc = spec({ users: { getUser } });
    const op = doc.paths['/users/{id}']!['get']!;
    expect(op.operationId).toBe('users_getUser');
    expect(op.tags).toEqual(['users']);
    expect(op.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('maps non-path GET fields to query parameters with correct required flags', () => {
    const doc = spec({ users: { listUsers } });
    const op = doc.paths['/users']!['get']!;
    const byName = Object.fromEntries((op.parameters ?? []).map((p) => [p.name, p]));
    expect(byName['page']).toMatchObject({ in: 'query', required: false, schema: { type: 'number' } });
    // .default() fields are not required — the server fills them in
    expect(byName['active']).toMatchObject({ in: 'query', required: false });
  });

  it('maps POST fields to a JSON request body with required list', () => {
    const doc = spec({ users: { createUser } });
    const op = doc.paths['/users']!['post']!;
    expect(op.parameters).toBeUndefined();
    const body = op.requestBody!;
    expect(body.required).toBe(true);
    const schema = body.content['application/json']!.schema;
    expect(schema['type']).toBe('object');
    expect(Object.keys(schema['properties'] as object).sort()).toEqual(['age', 'email', 'name']);
    expect(schema['required']).toEqual(['name', 'email']);
  });

  it('splits PATCH input between path parameter and body', () => {
    const doc = spec({ users: { updateUser } });
    const op = doc.paths['/users/{id}']!['patch']!;
    expect(op.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    const schema = op.requestBody!.content['application/json']!.schema;
    expect(Object.keys(schema['properties'] as object)).toEqual(['name']);
  });

  it('uses a non-object input schema as the whole request body', () => {
    const createBlob = capability(z.record(z.unknown()), (i) => i);
    const doc = spec({ blobs: { createBlob } });
    const schema = doc.paths['/blobs']!['post']!.requestBody!.content['application/json']!.schema;
    expect(schema['type']).toBe('object');
    expect(schema['additionalProperties']).toBeDefined();
  });

  it('applies route overrides', () => {
    const listTasks = capability(z.object({ projectId: z.string() }), (i) => i, 'query');
    const doc = spec(
      { tasks: { listTasks } },
      { overrides: { 'tasks.listTasks': { method: 'GET', path: '/projects/:projectId/tasks' } } },
    );
    const op = doc.paths['/projects/{projectId}/tasks']!['get']!;
    expect(op.parameters).toEqual([
      { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  it('respects urlCase', () => {
    const findBulkStatus = capability(z.object({}), () => null);
    const doc = spec({ bulkOps: { findBulkStatus } }, { urlCase: 'snake' });
    expect(Object.keys(doc.paths)).toEqual(['/bulk_ops']);
  });
});

describe('generateOpenAPI — responses', () => {
  it('wraps the output schema in the { data } envelope', () => {
    const getStats = capability(z.object({}), () => ({ count: 1 }))
      .output(z.object({ count: z.number() }));
    const doc = spec({ stats: { getStats } });
    const ok = doc.paths['/stats']!['get']!.responses['200']!;
    const schema = ok.content!['application/json']!.schema;
    expect(schema).toMatchObject({
      type: 'object',
      required: ['data'],
      properties: { data: { type: 'object', properties: { count: { type: 'number' } } } },
    });
  });

  it('adds 400 only for capabilities with an input schema', () => {
    const ping = capability(() => 'pong');
    const doc = spec({ system: { ping }, users: { getUser } });
    expect(doc.paths['/system/ping']!['post']!.responses['400']).toBeUndefined();
    expect(doc.paths['/users/{id}']!['get']!.responses['400']).toBeDefined();
  });

  it('every operation has a default error response referencing ErrorResponse', () => {
    const doc = spec({ users: { getUser, createUser } });
    for (const methods of Object.values(doc.paths)) {
      for (const op of Object.values(methods)) {
        const def = op.responses['default']!;
        expect(def.content!['application/json']!.schema).toEqual({
          $ref: '#/components/schemas/ErrorResponse',
        });
      }
    }
  });
});
