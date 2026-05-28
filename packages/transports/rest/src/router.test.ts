import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { capability, compileRegistry } from 'capix';
import { compileRouter, generateRoutes } from './router.js';
import type { RouteDefinition } from './router.js';

function routes(...defs: RouteDefinition[]) {
  return compileRouter(defs);
}

describe('compileRouter', () => {
  it('matches a static route', () => {
    const router = routes({ method: 'GET', path: '/users', capability: 'users.list' });
    const m = router.match('GET', '/users');
    expect(m).toEqual({ found: true, capability: 'users.list', params: null });
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

  it('allowedMethods includes all methods for that path', () => {
    const router = routes(
      { method: 'GET', path: '/users', capability: 'users.list' },
      { method: 'POST', path: '/users', capability: 'users.create' },
    );
    const m = router.match('DELETE', '/users');
    expect(m.found).toBe(false);
    if (!m.found) {
      expect(m.allowedMethods).toBeDefined();
      expect(m.allowedMethods).toContain('GET');
      expect(m.allowedMethods).toContain('POST');
    }
  });

  it('two params in a deep path — both extracted', () => {
    const router = routes({ method: 'GET', path: '/users/:userId/orders/:orderId', capability: 'orders.get' });
    const m = router.match('GET', '/users/u1/orders/o2');
    expect(m).toMatchObject({ found: true, params: { userId: 'u1', orderId: 'o2' } });
  });

  it('empty routes array — no match', () => {
    const router = compileRouter([]);
    const m = router.match('GET', '/anything');
    expect(m.found).toBe(false);
    if (!m.found) expect(m.allowedMethods).toBeUndefined();
  });

  it('root param /:id matches anything', () => {
    const router = routes({ method: 'GET', path: '/:id', capability: 'root.get' });
    const m = router.match('GET', '/anything');
    expect(m).toMatchObject({ found: true, capability: 'root.get', params: { id: 'anything' } });
  });

  it('very deep path works correctly', () => {
    const router = routes({ method: 'GET', path: '/a/b/c/d/e/:f', capability: 'deep' });
    const m = router.match('GET', '/a/b/c/d/e/val');
    expect(m).toMatchObject({ found: true, params: { f: 'val' } });
  });

  it('different methods at same level can use different param names', () => {
    // GET /users/:id and POST /users/:userId are allowed — different methods
    const router = routes(
      { method: 'GET',  path: '/users/:id',     capability: 'a' },
      { method: 'POST', path: '/users/:userId',  capability: 'b' },
    );
    const getMatch = router.match('GET', '/users/42');
    expect(getMatch).toMatchObject({ found: true, capability: 'a', params: { id: '42' } });
    const postMatch = router.match('POST', '/users/42');
    expect(postMatch).toMatchObject({ found: true, capability: 'b', params: { userId: '42' } });
  });

  it('same method + conflicting param names at same level throws', () => {
    expect(() =>
      routes(
        { method: 'GET', path: '/users/:id',     capability: 'a' },
        { method: 'GET', path: '/users/:userId',  capability: 'b' },
      ),
    ).toThrow('[capix] Router conflict: param name mismatch for GET');
  });

  it('different methods on same path — each matches correctly', () => {
    const router = routes(
      { method: 'GET', path: '/users', capability: 'users.list' },
      { method: 'POST', path: '/users', capability: 'users.create' },
    );
    expect(router.match('GET', '/users')).toMatchObject({ found: true, capability: 'users.list' });
    expect(router.match('POST', '/users')).toMatchObject({ found: true, capability: 'users.create' });
  });

  it('static path 405 bubbles up when param child also exists', () => {
    // /users/me → GET only. /users/:id → POST only.
    // Matching GET /users/other should fall through to param (no 405 from static).
    // Matching POST /users/me should give 405 from the static branch.
    const router = routes(
      { method: 'GET', path: '/users/me', capability: 'users.me' },
      { method: 'POST', path: '/users/:id', capability: 'users.create' },
    );
    const m = router.match('POST', '/users/me');
    // 'me' matches static child (GET only), returns allowedMethods ['GET']
    expect(m.found).toBe(false);
    if (!m.found) expect(m.allowedMethods).toContain('GET');
  });
});

describe('generateRoutes — kebab-case conversion', () => {
  it('camelCase key → kebab-case URL segment', () => {
    const reg = compileRegistry({
      products: { bulkStatus: capability(z.object({}), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'POST', path: '/products/bulk-status', capability: 'products.bulkStatus' });
  });

  it('camelCase group name → kebab-case URL group', () => {
    const reg = compileRegistry({
      myGroup: { listItems: capability(z.object({}), () => []) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'GET', path: '/my-group', capability: 'myGroup.listItems' });
  });

  it('urlCase: camel preserves camelCase', () => {
    const reg = compileRegistry({
      products: { bulkStatus: capability(z.object({}), () => null) },
    });
    const r = generateRoutes(reg, { urlCase: 'camel' });
    expect(r).toContainEqual({ method: 'POST', path: '/products/bulkStatus', capability: 'products.bulkStatus' });
  });

  it('urlCase: snake converts to snake_case', () => {
    const reg = compileRegistry({
      products: { bulkStatus: capability(z.object({}), () => null) },
    });
    const r = generateRoutes(reg, { urlCase: 'snake' });
    expect(r).toContainEqual({ method: 'POST', path: '/products/bulk_status', capability: 'products.bulkStatus' });
  });

  it('v1 group prefix is not altered by kebab conversion', () => {
    const reg = compileRegistry({
      v1: { products: { listProducts: capability(z.object({}), () => []) } },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'GET', path: '/v1/products', capability: 'v1.products.listProducts' });
  });

  it('create-prefix key still drops from URL even with kebab conversion', () => {
    const reg = compileRegistry({
      products: { createProduct: capability(z.object({ name: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'POST', path: '/products', capability: 'products.createProduct' });
  });

  it('register is no longer a create prefix → POST /auth/register', () => {
    const reg = compileRegistry({
      auth: { register: capability(z.object({ email: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'POST', path: '/auth/register', capability: 'auth.register' });
  });
});

describe('generateRoutes', () => {
  it('update* → PATCH /group/:id', () => {
    const reg = compileRegistry({
      users: { updateUser: capability(z.object({ id: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'PATCH', path: '/users/:id', capability: 'users.updateUser' });
  });

  it('replace* → PUT /group/:id', () => {
    const reg = compileRegistry({
      users: { replaceUser: capability(z.object({ id: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'PUT', path: '/users/:id', capability: 'users.replaceUser' });
  });

  it('delete* → DELETE /group/:id', () => {
    const reg = compileRegistry({
      users: { deleteUser: capability(z.object({ id: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'DELETE', path: '/users/:id', capability: 'users.deleteUser' });
  });

  it('http override takes precedence over inference', () => {
    const cap = capability(z.object({}), () => null);
    (cap as unknown as Record<string, unknown>)['http'] = { method: 'GET', path: '/custom' };
    const reg = compileRegistry({ createFoo: cap });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'GET', path: '/custom', capability: 'createFoo' });
  });

  it('get* without id → GET /group', () => {
    const reg = compileRegistry({
      users: { listUsers: capability(() => []) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'GET', path: '/users', capability: 'users.listUsers' });
  });

  it('named action (non-create) → POST /group/key', () => {
    const reg = compileRegistry({
      auth: { login: capability(z.object({ email: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'POST', path: '/auth/login', capability: 'auth.login' });
  });

  it('me → GET /auth/me', () => {
    const reg = compileRegistry({
      auth: { me: capability(() => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'GET', path: '/auth/me', capability: 'auth.me' });
  });

  it('status/health/count/check → GET /group/key', () => {
    const reg = compileRegistry({
      system: {
        status:  capability(() => null),
        health:  capability(() => null),
        count:   capability(() => null),
        check:   capability(() => null),
      },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'GET', path: '/system/status',  capability: 'system.status' });
    expect(r).toContainEqual({ method: 'GET', path: '/system/health',  capability: 'system.health' });
    expect(r).toContainEqual({ method: 'GET', path: '/system/count',   capability: 'system.count' });
    expect(r).toContainEqual({ method: 'GET', path: '/system/check',   capability: 'system.check' });
  });

  it('un* prefix → DELETE /group/:id/verb', () => {
    const reg = compileRegistry({
      users: { unfollow: capability(z.object({ id: z.string() }), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'DELETE', path: '/users/:id/follow', capability: 'users.unfollow' });
  });

  it('un* camelCase verb → kebab sub-resource path', () => {
    const reg = compileRegistry({
      users: { unblockUser: capability(z.object({}), () => null) },
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'DELETE', path: '/users/:id/block-user', capability: 'users.unblockUser' });
  });

  it('un* at root level → DELETE /:id/verb', () => {
    const reg = compileRegistry({
      unlikePost: capability(z.object({ id: z.string() }), () => null),
    });
    const r = generateRoutes(reg);
    expect(r).toContainEqual({ method: 'DELETE', path: '/:id/like-post', capability: 'unlikePost' });
  });
});
