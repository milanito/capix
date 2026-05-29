import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry } from 'capix';
import { generateClient } from './client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(caps: Record<string, Record<string, ReturnType<typeof capability>>>) {
  return compileRegistry(caps);
}

function clientFor(caps: Record<string, Record<string, ReturnType<typeof capability>>>) {
  return generateClient(makeRegistry(caps), 'http://localhost:3000');
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

describe('client generator — body handling', () => {
  it('PATCH route with path param and body fields includes body arg', () => {
    const out = clientFor({
      projects: {
        updateProject: capability(
          z.object({ id: z.string(), name: z.string().optional(), description: z.string().optional() }),
          async (i) => i, 'update',
        ),
      },
    });
    // Signature should have separate id and body params
    expect(out).toMatch(/updateProject\(id: string, body\?:/);
    // Body should contain only non-path fields
    expect(out).toMatch(/body\?: \{[^}]*name\?:/);
    expect(out).toMatch(/body\?: \{[^}]*description\?:/);
    // id should NOT appear in the body type
    expect(out).not.toMatch(/body\?: \{[^}]*id:/);
    // request call should pass body
    expect(out).toMatch(/request\('PATCH'.*body\)/);
  });

  it('body fields do not include path param names', () => {
    const out = clientFor({
      posts: {
        updatePost: capability(
          z.object({ id: z.string(), title: z.string() }),
          async (i) => i, 'update',
        ),
      },
    });
    // body type must not contain id
    expect(out).not.toMatch(/body: \{[^}]*id:/);
    // body type must contain title
    expect(out).toMatch(/body: \{ title: string \}/);
  });

  it('PATCH route with only path params has no body arg', () => {
    const out = clientFor({
      posts: {
        publishPost: capability(
          z.object({ id: z.string() }),
          async (i) => i, 'update',
        ),
      },
    });
    // No body parameter in the signature
    expect(out).toMatch(/publishPost\(id: string\)/);
    // No third arg to request()
    expect(out).toMatch(/request\('PATCH', `[^`]+`\)/);
  });

  it('POST route with no path params has body arg', () => {
    const out = clientFor({
      projects: {
        createProject: capability(
          z.object({ name: z.string(), description: z.string().optional() }),
          async (i) => i, 'mutation',
        ),
      },
    });
    expect(out).toMatch(/createProject\(body: \{/);
    expect(out).toMatch(/request\('POST'.*body\)/);
  });

  it('PUT route with path param and body fields includes body arg', () => {
    const out = clientFor({
      projects: {
        replaceProject: capability(
          z.object({ id: z.string(), name: z.string() }),
          async (i) => i, 'replace',
        ),
      },
    });
    expect(out).toMatch(/replaceProject\(id: string, body: \{ name: string \}\)/);
    expect(out).toMatch(/request\('PUT'.*body\)/);
  });

  it('GET route with path param only has no query arg', () => {
    const out = clientFor({
      projects: {
        getProject: capability(
          z.object({ id: z.string() }),
          async (i) => i, 'query',
        ),
      },
    });
    expect(out).toMatch(/getProject\(id: string\)/);
    // No third arg
    expect(out).toMatch(/request\('GET', `[^`]+`\)/);
  });

  it('GET route with path param and extra fields passes query arg, not path param', () => {
    const out = clientFor({
      projects: {
        listProjectTasks: capability(
          z.object({ id: z.string(), page: z.number().optional() }),
          async (i) => i, 'query',
        ),
      },
    });
    // id is a separate arg, page goes into query
    expect(out).toMatch(/listProjectTasks\(id: string, query\?:/);
    expect(out).toMatch(/request\('GET'.*query\)/);
    // query type must NOT include id
    expect(out).not.toMatch(/query\?: \{[^}]*id:/);
  });

  it('DELETE route with path param only has no body arg', () => {
    const out = clientFor({
      projects: {
        deleteProject: capability(
          z.object({ id: z.string() }),
          async () => null, 'delete',
        ),
      },
    });
    expect(out).toMatch(/deleteProject\(id: string\)/);
    // No third arg
    expect(out).toMatch(/request\('DELETE', `[^`]+`\)/);
  });

  it('no-input capability has no parameters', () => {
    const out = clientFor({
      system: {
        ping: capability(() => ({ pong: true })),
      },
    });
    expect(out).toMatch(/system_ping\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Type rendering
// ---------------------------------------------------------------------------

describe('client generator — type rendering', () => {
  it('optional fields rendered with ? syntax, not T | undefined', () => {
    const out = clientFor({
      items: {
        createItem: capability(
          z.object({ name: z.string(), note: z.string().optional() }),
          async (i) => i, 'mutation',
        ),
      },
    });
    expect(out).toContain('note?: string');
    expect(out).not.toContain('note: string | undefined');
  });

  it('required fields have no ? suffix', () => {
    const out = clientFor({
      items: {
        createItem: capability(
          z.object({ name: z.string() }),
          async (i) => i, 'mutation',
        ),
      },
    });
    expect(out).toContain('name: string');
    expect(out).not.toContain('name?: string');
  });

  it('all-optional body param is optional with ?', () => {
    const out = clientFor({
      items: {
        updateItem: capability(
          z.object({ id: z.string(), note: z.string().optional(), tag: z.string().optional() }),
          async (i) => i, 'update',
        ),
      },
    });
    expect(out).toMatch(/body\?: \{/);
  });

  it('body with any required field is not optional', () => {
    const out = clientFor({
      items: {
        updateItem: capability(
          z.object({ id: z.string(), name: z.string(), note: z.string().optional() }),
          async (i) => i, 'update',
        ),
      },
    });
    // body is required (not `body?`)
    expect(out).toMatch(/body: \{/);
  });
});

// ---------------------------------------------------------------------------
// Path template
// ---------------------------------------------------------------------------

describe('client generator — path templates', () => {
  it('path params are referenced directly, not via input.param', () => {
    const out = clientFor({
      projects: {
        getProject: capability(
          z.object({ id: z.string() }),
          async (i) => i, 'query',
        ),
      },
    });
    expect(out).toContain('${id}');
    expect(out).not.toContain('${input.');
  });

  it('multiple path params are all referenced directly', () => {
    const out = clientFor({
      orgs: {
        getOrgProject: capability(
          z.object({ orgId: z.string(), projectId: z.string() }),
          async (i) => i,
          'query',
          { http: { method: 'GET', path: '/orgs/:orgId/projects/:projectId' } },
        ),
      },
    });
    expect(out).toContain('${orgId}');
    expect(out).toContain('${projectId}');
    expect(out).not.toContain('${input.');
  });
});
