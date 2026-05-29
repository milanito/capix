import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { capability, isCapability, compileRegistry, inferIntent } from './capability.js';
import { defaultErrors } from './errors.js';

const baseCtx = { requestId: 'test' };

describe('inferIntent', () => {
  it('maps get/find/fetch/read to query', () => {
    expect(inferIntent('get')).toBe('query');
    expect(inferIntent('getUser')).toBe('query');
    expect(inferIntent('findById')).toBe('query');
    expect(inferIntent('fetchAll')).toBe('query');
    expect(inferIntent('readProfile')).toBe('query');
  });

  it('maps list/search/filter to query', () => {
    expect(inferIntent('list')).toBe('query');
    expect(inferIntent('listUsers')).toBe('query');
    expect(inferIntent('searchPosts')).toBe('query');
    expect(inferIntent('filterResults')).toBe('query');
  });

  it('maps me/status/health/count/check to query', () => {
    expect(inferIntent('me')).toBe('query');
    expect(inferIntent('status')).toBe('query');
    expect(inferIntent('health')).toBe('query');
    expect(inferIntent('healthCheck')).toBe('query');
    expect(inferIntent('count')).toBe('query');
    expect(inferIntent('countUsers')).toBe('query');
    expect(inferIntent('check')).toBe('query');
    expect(inferIntent('checkPermission')).toBe('query');
  });

  it('maps create/add/new to mutation', () => {
    expect(inferIntent('create')).toBe('mutation');
    expect(inferIntent('createUser')).toBe('mutation');
    expect(inferIntent('add')).toBe('mutation');
    expect(inferIntent('newItem')).toBe('mutation');
  });

  it('register and login are default mutations (named actions)', () => {
    expect(inferIntent('register')).toBe('mutation');
    expect(inferIntent('login')).toBe('mutation');
  });

  it('maps update/edit/patch/modify to update', () => {
    expect(inferIntent('update')).toBe('update');
    expect(inferIntent('updateUser')).toBe('update');
    expect(inferIntent('editPost')).toBe('update');
    expect(inferIntent('patchProfile')).toBe('update');
    expect(inferIntent('modifyConfig')).toBe('update');
  });

  it('maps replace/set/put to replace', () => {
    expect(inferIntent('replace')).toBe('replace');
    expect(inferIntent('replaceAll')).toBe('replace');
    expect(inferIntent('setConfig')).toBe('replace');
    expect(inferIntent('putItem')).toBe('replace');
  });

  it('maps delete/remove/destroy/cancel to delete', () => {
    expect(inferIntent('delete')).toBe('delete');
    expect(inferIntent('deleteUser')).toBe('delete');
    expect(inferIntent('removeItem')).toBe('delete');
    expect(inferIntent('destroySession')).toBe('delete');
    expect(inferIntent('cancelOrder')).toBe('delete');
  });

  it('defaults to mutation for unrecognized keys', () => {
    expect(inferIntent('publish')).toBe('mutation');
    expect(inferIntent('approve')).toBe('mutation');
    expect(inferIntent('verify')).toBe('mutation');
  });
});

describe('capability (no input)', () => {
  it('resolves correctly with no input', async () => {
    const cap = capability(() => ({ message: 'hello' }));
    const result = await cap.resolve(undefined, baseCtx);
    expect(result).toEqual({ message: 'hello' });
  });

  it('has _capix brand', () => {
    const cap = capability(() => 42);
    expect(cap._capix).toBe(true);
  });
});

describe('capability (with schema)', () => {
  it('resolver receives typed input', async () => {
    const Input = z.object({ id: z.string() });
    const cap = capability(Input, async ({ id }) => ({ found: id }));
    const result = await cap.resolve({ id: '123' }, baseCtx);
    expect(result).toEqual({ found: '123' });
  });

  it('stores the input schema', () => {
    const Input = z.object({ id: z.string() });
    const cap = capability(Input, ({ id }) => id);
    expect(cap.inputSchema).toBe(Input);
  });

  it('async resolver resolves correctly', async () => {
    const cap = capability(z.object({ x: z.number() }), async ({ x }) => x * 2);
    const result = await cap.resolve({ x: 5 }, baseCtx);
    expect(result).toBe(10);
  });

  it('explicit intent is stored', () => {
    const cap = capability(z.object({}), () => null, 'query');
    expect(cap.intent).toBe('query');
  });

  it('resolver receives raw input from cap.resolve (no Zod parsing here)', async () => {
    const Input = z.object({ id: z.string() });
    const cap = capability(Input, ({ id }) => id);
    // cap.resolve bypasses Zod — transforms and defaults are applied by the execution engine
    const result = await cap.resolve({ id: 'raw' }, baseCtx);
    expect(result).toBe('raw');
  });
});

describe('.guard()', () => {
  it('returns a NEW capability (no mutation)', () => {
    const cap = capability(() => 1);
    const guarded = cap.guard(() => { /* pass */ });
    expect(guarded).not.toBe(cap);
  });

  it('accumulates guards in order', () => {
    const g1 = vi.fn();
    const g2 = vi.fn();
    const cap = capability(() => 1).guard(g1).guard(g2);
    expect(cap.guards).toHaveLength(2);
    expect(cap.guards[0]).toBe(g1);
    expect(cap.guards[1]).toBe(g2);
  });

  it('original capability guards are unchanged', () => {
    const g1 = vi.fn();
    const cap = capability(() => 1);
    cap.guard(g1);
    expect(cap.guards).toHaveLength(0);
  });
});

describe('.enhance()', () => {
  it('wraps the resolver', async () => {
    const log: string[] = [];
    const cap = capability(() => 42).enhance((c) => ({
      ...c,
      resolve: async (input, ctx) => {
        log.push('before');
        const result = await c.resolve(input, ctx);
        log.push('after');
        return result;
      },
    }));
    await cap.resolve(undefined, baseCtx);
    expect(log).toEqual(['before', 'after']);
  });

  it('returns a new capability', () => {
    const cap = capability(() => 1);
    const enhanced = cap.enhance((c) => c);
    expect(enhanced).not.toBe(cap);
  });

  it('double enhance — both wrap, outer first', async () => {
    const log: string[] = [];
    const cap = capability(() => 'result')
      .enhance((c) => ({
        ...c,
        resolve: async (i, ctx) => {
          log.push('inner-before');
          const r = await c.resolve(i, ctx);
          log.push('inner-after');
          return r;
        },
      }))
      .enhance((c) => ({
        ...c,
        resolve: async (i, ctx) => {
          log.push('outer-before');
          const r = await c.resolve(i, ctx);
          log.push('outer-after');
          return r;
        },
      }));
    await cap.resolve(undefined, baseCtx);
    expect(log).toEqual(['outer-before', 'inner-before', 'inner-after', 'outer-after']);
  });
});

describe('.output()', () => {
  it('sets outputSchema', () => {
    const schema = z.object({ id: z.string() });
    const cap = capability(() => ({ id: '1' })).output(schema);
    expect(cap.outputSchema).toBe(schema);
  });

  it('returns a new capability', () => {
    const schema = z.object({ id: z.string() });
    const cap = capability(() => ({ id: '1' }));
    const withOutput = cap.output(schema);
    expect(withOutput).not.toBe(cap);
  });
});

describe('isCapability', () => {
  it('returns true for capabilities', () => {
    expect(isCapability(capability(() => 1))).toBe(true);
  });

  it('returns false for plain objects', () => {
    expect(isCapability({ _capix: true })).toBe(false);
    expect(isCapability({})).toBe(false);
    expect(isCapability(null)).toBe(false);
    expect(isCapability('cap')).toBe(false);
  });
});

describe('compileRegistry', () => {
  it('produces correct dot-path keys', () => {
    const tree = {
      users: {
        get: capability(() => 'user'),
        list: capability(() => []),
      },
    };
    const registry = compileRegistry(tree);
    expect(registry.has('users.get')).toBe(true);
    expect(registry.has('users.list')).toBe(true);
  });

  it('names capabilities from their path', () => {
    const tree = {
      users: {
        get: capability(() => 'user'),
      },
    };
    const registry = compileRegistry(tree);
    expect(registry.get('users.get')?.name).toBe('users.get');
  });

  it('handles deeply nested groups', () => {
    const tree = {
      a: {
        b: {
          c: capability(() => 1),
        },
      },
    };
    const registry = compileRegistry(tree);
    expect(registry.has('a.b.c')).toBe(true);
    expect(registry.get('a.b.c')?.name).toBe('a.b.c');
  });

  it('handles top-level capabilities', () => {
    const tree = {
      ping: capability(() => 'pong'),
    };
    const registry = compileRegistry(tree);
    expect(registry.has('ping')).toBe(true);
    expect(registry.get('ping')?.name).toBe('ping');
  });

  it('throws on invalid key (non-camelCase)', () => {
    expect(() =>
      compileRegistry({ 'invalid-key': capability(() => 1) } as Parameters<typeof compileRegistry>[0]),
    ).toThrow(/Invalid capability key/);
  });

  it('guards throw when condition not met', async () => {
    const cap = capability(() => 1).guard((ctx) => {
      if (!('user' in ctx)) throw defaultErrors.Unauthorized();
    });
    await expect(
      (async () => {
        for (const g of cap.guards) await g(baseCtx);
      })(),
    ).rejects.toBeDefined();
  });
});

describe('resolveUnchecked', () => {
  it('invokes resolver with any BaseContext subtype', async () => {
    const cap = capability(
      z.object({ x: z.number() }),
      async ({ x }) => x * 2,
    );
    const result = await cap.resolveUnchecked({ x: 5 }, baseCtx);
    expect(result).toBe(10);
  });

  it('return type matches capability output', async () => {
    const cap = capability(
      z.object({ name: z.string() }),
      async ({ name }) => ({ greeting: `Hello, ${name}!` }),
    );
    const result = await cap.resolveUnchecked({ name: 'Alice' }, baseCtx);
    expect(result).toEqual({ greeting: 'Hello, Alice!' });
  });

  it('guards do not re-run when using resolveUnchecked', async () => {
    const guardSpy = vi.fn();
    const cap = capability(() => 1).guard(() => guardSpy());
    await cap.resolveUnchecked(undefined, baseCtx);
    expect(guardSpy).not.toHaveBeenCalled();
  });

  it('resolver receives the passed context at runtime', async () => {
    const cap = capability(
      z.object({}),
      async (_input, ctx) => (ctx as typeof baseCtx).requestId,
    );
    const result = await cap.resolveUnchecked({}, { requestId: 'my-id' });
    expect(result).toBe('my-id');
  });

  it('no-input capability resolves with undefined input', async () => {
    const cap = capability(() => 42);
    const result = await cap.resolveUnchecked(undefined, baseCtx);
    expect(result).toBe(42);
  });
});

describe('Capability has no http field', () => {
  it('capability object has no http property', () => {
    const cap = capability(() => 1);
    expect('http' in cap).toBe(false);
  });

  it('capability factory accepts no http option (3-arg max)', () => {
    const cap = capability(z.object({ id: z.string() }), async (i) => i, 'query');
    expect(cap.intent).toBe('query');
  });
});
