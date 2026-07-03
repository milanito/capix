import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, defineContext, defineGuard, defineError } from '@capixjs/core';
import { mockContext, mockRequest, mockCapability, testServer } from './index.js';

describe('mockContext', () => {
  it('provides a requestId by default and merges overrides', () => {
    expect(mockContext().requestId).toBe('test-request-id');
    const ctx = mockContext<{ requestId: string; user: { id: string } }>({ user: { id: 'u1' } });
    expect(ctx.user).toEqual({ id: 'u1' });
    expect(ctx.requestId).toBe('test-request-id');
  });
});

describe('mockRequest', () => {
  it('provides sensible defaults and merges overrides', () => {
    const req = mockRequest();
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/test');
    expect(req.headers).toEqual({});
    expect(req.signal).toBeInstanceOf(AbortSignal);

    const custom = mockRequest({ method: 'GET', headers: { authorization: 'Bearer x' } });
    expect(custom.method).toBe('GET');
    expect(custom.headers['authorization']).toBe('Bearer x');
  });
});

describe('mockCapability', () => {
  it('wraps a resolver into a callable capability', async () => {
    const cap = mockCapability((input) => ({ echoed: input }));
    await expect(cap.resolve({ a: 1 }, mockContext())).resolves.toEqual({ echoed: { a: 1 } });
  });
});

describe('testServer', () => {
  const Forbidden = defineError(403, 'Forbidden');
  const mustBeAdmin = defineGuard((ctx) => {
    if (!(ctx as { isAdmin?: boolean }).isAdmin) throw Forbidden();
  });

  const server = testServer({
    context: defineContext(async (req) => ({
      requestId: 'test',
      isAdmin: req.headers['x-role'] === 'admin',
    })),
    capabilities: {
      users: {
        getUser: capability(z.object({ id: z.string() }), ({ id }) => ({ id, name: 'Ada' })),
        getSecrets: capability(z.object({}), () => ({ ok: true })).guard(mustBeAdmin),
      },
    },
  });

  it('calls capabilities and unwraps successful responses', async () => {
    const res = await server.call({ capability: 'users.getUser', input: { id: '7' } });
    expect(res).toEqual({ ok: true, status: 200, data: { id: '7', name: 'Ada' } });
  });

  it('surfaces validation failures with status 400 and issues', async () => {
    const res = await server.call({ capability: 'users.getUser', input: { id: 42 } });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.error).toBe('BadRequest');
    expect(Array.isArray(res.meta?.['issues'])).toBe(true);
  });

  it('runs guards with the context built from request headers', async () => {
    const denied = await server.call({ capability: 'users.getSecrets' });
    expect(denied.status).toBe(403);

    const allowed = await server.call({ capability: 'users.getSecrets', headers: { 'x-role': 'admin' } });
    expect(allowed).toEqual({ ok: true, status: 200, data: { ok: true } });
  });

  it('returns 404 for unknown capabilities', async () => {
    const res = await server.call({ capability: 'nope.missing' });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('exposes the raw invoke function', async () => {
    const response = await server.invoke({
      capability: 'users.getUser',
      input: { id: '1' },
      headers: {},
      signal: AbortSignal.timeout(1000),
    });
    expect(response.ok).toBe(true);
  });
});
