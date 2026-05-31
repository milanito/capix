import { describe, it, expect } from 'vitest';
import { jwtContextBuilder, createJWTHelpers } from './index.js';
import type { RawRequest } from '@capixjs/core';

function mockRequest(headers: Record<string, string> = {}): RawRequest {
  return {
    method: 'GET',
    url: '/',
    headers,
    signal: new AbortController().signal,
  };
}

describe('jwtContextBuilder', () => {
  const secret = 'test-secret-key';

  it('returns null user when no Authorization header', async () => {
    const builder = jwtContextBuilder<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const ctx = await builder(mockRequest());
    expect(ctx.user).toBeNull();
    expect(ctx.requestId).toBeDefined();
  });

  it('returns null user for invalid token', async () => {
    const builder = jwtContextBuilder<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const ctx = await builder(mockRequest({ authorization: 'Bearer invalid.token.here' }));
    expect(ctx.user).toBeNull();
  });

  it('returns verified user for valid token', async () => {
    const helpers = createJWTHelpers<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const token = helpers.sign({ sub: 'user-123' });
    const builder = jwtContextBuilder<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const ctx = await builder(mockRequest({ authorization: `Bearer ${token}` }));
    expect(ctx.user).toEqual({ id: 'user-123' });
  });

  it('includes extraContext fields in returned context', async () => {
    const db = { users: new Map<string, string>() };
    const builder = jwtContextBuilder<{ id: string }, { db: typeof db }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
      extraContext: async () => ({ db }),
    });
    const ctx = await builder(mockRequest());
    expect(ctx.db).toBe(db);
    expect(ctx.user).toBeNull();
    expect(ctx.requestId).toBeDefined();
  });

  it('extraContext is called with the raw request', async () => {
    let capturedReq: RawRequest | undefined;
    const builder = jwtContextBuilder<{ id: string }, { captured: boolean }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
      extraContext: async (req) => {
        capturedReq = req;
        return { captured: true };
      },
    });
    const req = mockRequest({ 'x-custom': 'yes' });
    const ctx = await builder(req);
    expect(ctx.captured).toBe(true);
    expect(capturedReq?.headers['x-custom']).toBe('yes');
  });

  it('combines user and extraContext fields with correct types', async () => {
    const builder = jwtContextBuilder<{ id: string; role: string }, { db: { name: string } }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string, role: p['role'] as string }),
      extraContext: async () => ({ db: { name: 'test-db' } }),
    });
    const ctx = await builder(mockRequest());
    // TypeScript: all fields are accessible
    expect(ctx.db.name).toBe('test-db');
    expect(ctx.user).toBeNull();
  });

  it('works without extraContext (returns just requestId and user)', async () => {
    const builder = jwtContextBuilder<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const ctx = await builder(mockRequest());
    expect(Object.keys(ctx)).toContain('requestId');
    expect(Object.keys(ctx)).toContain('user');
  });
});
