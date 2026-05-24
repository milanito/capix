import { describe, it, expect } from 'vitest';
import { compileRouter } from './router.js';
import type { RouteDefinition } from './router.js';

function routes(...defs: RouteDefinition[]) {
  return compileRouter(defs);
}

describe('compileRouter', () => {
  it('matches a static route', () => {
    const router = routes({ method: 'GET', path: '/users', capability: 'users.list' });
    const m = router.match('GET', '/users');
    expect(m).toEqual({ found: true, capability: 'users.list', params: {} });
  });

  it('extracts path params', () => {
    const router = routes({ method: 'GET', path: '/users/:id', capability: 'users.get' });
    const m = router.match('GET', '/users/abc123');
    expect(m).toEqual({ found: true, capability: 'users.get', params: { id: 'abc123' } });
  });

  it('URL-decodes param values', () => {
    const router = routes({ method: 'GET', path: '/users/:id', capability: 'users.get' });
    const m = router.match('GET', '/users/hello%20world');
    expect(m).toMatchObject({ found: true, params: { id: 'hello world' } });
  });

  it('prefers static over param at the same level', () => {
    const router = routes(
      { method: 'GET', path: '/users/me', capability: 'users.me' },
      { method: 'GET', path: '/users/:id', capability: 'users.get' },
    );
    expect(router.match('GET', '/users/me')).toMatchObject({ found: true, capability: 'users.me' });
    expect(router.match('GET', '/users/123')).toMatchObject({ found: true, capability: 'users.get' });
  });

  it('returns found: false for unknown path', () => {
    const router = routes({ method: 'GET', path: '/users', capability: 'users.list' });
    const m = router.match('GET', '/orders');
    expect(m).toEqual({ found: false });
  });

  it('returns allowedMethods when path found but method not allowed', () => {
    const router = routes({ method: 'GET', path: '/users', capability: 'users.list' });
    const m = router.match('POST', '/users');
    expect(m).toMatchObject({ found: false, allowedMethods: ['GET'] });
  });

  it('handles nested params', () => {
    const router = routes({ method: 'GET', path: '/orgs/:orgId/users/:userId', capability: 'orgs.users.get' });
    const m = router.match('GET', '/orgs/o1/users/u2');
    expect(m).toMatchObject({ found: true, params: { orgId: 'o1', userId: 'u2' } });
  });

  it('throws on duplicate routes at compile time', () => {
    expect(() =>
      routes(
        { method: 'GET', path: '/users', capability: 'a' },
        { method: 'GET', path: '/users', capability: 'b' },
      ),
    ).toThrow();
  });

  it('strips query string before matching', () => {
    const router = routes({ method: 'GET', path: '/users', capability: 'users.list' });
    const m = router.match('GET', '/users?page=2&limit=10');
    expect(m).toMatchObject({ found: true, capability: 'users.list' });
  });
});
