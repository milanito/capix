import { describe, it, expect } from 'vitest';
import { jwtContextBuilder, createJWTHelpers, authPlugin } from './index.js';
import type { AuthContext } from './index.js';
import { isFrameworkError } from '@capixjs/core';
import type { RawRequest, BaseContext } from '@capixjs/core';

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

describe('authPlugin', () => {
  const secret = 'test-secret-key';
  const base: BaseContext = { requestId: 'req-1' };

  it('plugin.name identifies the plugin', () => {
    const { plugin } = authPlugin<{ id: string }>({ secret, userFromToken: (p) => ({ id: p['sub'] as string }) });
    expect(plugin.name).toBe('capix-plugin-auth');
  });

  it('plugin.context sets user to null when no Authorization header, preserving base fields', async () => {
    const { plugin } = authPlugin<{ id: string }>({ secret, userFromToken: (p) => ({ id: p['sub'] as string }) });
    const ctx = await plugin.context(base, mockRequest());
    expect(ctx.user).toBeNull();
    expect(ctx.requestId).toBe('req-1');
  });

  it('plugin.context sets user to null for an invalid token', async () => {
    const { plugin } = authPlugin<{ id: string }>({ secret, userFromToken: (p) => ({ id: p['sub'] as string }) });
    const ctx = await plugin.context(base, mockRequest({ authorization: 'Bearer not.a.jwt' }));
    expect(ctx.user).toBeNull();
  });

  it('plugin.context sets user to the verified user for a valid token', async () => {
    const { plugin, helpers } = authPlugin<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const token = helpers.sign({ sub: 'user-123' });
    const ctx = await plugin.context(base, mockRequest({ authorization: `Bearer ${token}` }));
    expect(ctx.user).toEqual({ id: 'user-123' });
  });

  // Cast away the `asserts` signature to a plain function type: TS2775
  // forbids directly calling an assertion function whose own binding isn't
  // explicitly typed as such, but these tests only care about the runtime
  // throw/no-throw behavior, not the compile-time narrowing.
  function asPlainGuard(
    guard: (ctx: AuthContext<{ id: string }>) => asserts ctx is AuthContext<{ id: string }> & { user: { id: string } },
  ): (ctx: AuthContext<{ id: string }>) => void {
    return guard;
  }

  it('mustBeAuthenticated does not throw when ctx.user is set', () => {
    const { mustBeAuthenticated } = authPlugin<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const ctx: AuthContext<{ id: string }> = { ...base, user: { id: 'user-123' } };
    expect(() => asPlainGuard(mustBeAuthenticated)(ctx)).not.toThrow();
  });

  it('mustBeAuthenticated throws a 401 Unauthorized framework error when ctx.user is null', () => {
    const { mustBeAuthenticated } = authPlugin<{ id: string }>({
      secret,
      userFromToken: (p) => ({ id: p['sub'] as string }),
    });
    const ctx: AuthContext<{ id: string }> = { ...base, user: null };
    try {
      asPlainGuard(mustBeAuthenticated)(ctx);
      expect.fail('mustBeAuthenticated should have thrown for a null user');
    } catch (err) {
      expect(isFrameworkError(err)).toBe(true);
      expect((err as { status: number }).status).toBe(401);
    }
  });
});
