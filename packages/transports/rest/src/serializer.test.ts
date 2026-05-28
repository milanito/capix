import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { compileRegistry, capability } from 'capix';
import { buildSerializers, defaultSerializer } from './serializer.js';

describe('defaultSerializer', () => {
  it('wraps data in {"data":...}', () => {
    expect(defaultSerializer({ id: '1', name: 'Alice' })).toBe('{"data":{"id":"1","name":"Alice"}}');
  });

  it('handles null', () => {
    expect(defaultSerializer(null)).toBe('{"data":null}');
  });

  it('handles arrays', () => {
    expect(defaultSerializer([1, 2, 3])).toBe('{"data":[1,2,3]}');
  });
});

describe('buildSerializers', () => {
  it('returns empty map when no capabilities have outputSchema', () => {
    const reg = compileRegistry({
      hello: capability(() => ({ message: 'hello' }), 'query'),
    });
    const map = buildSerializers(reg);
    expect(map.size).toBe(0);
  });

  it('compiles serializer for capability with outputSchema', () => {
    const reg = compileRegistry({
      users: {
        getUser: capability(
          z.object({ id: z.string() }),
          ({ id }) => ({ id, name: 'Alice' }),
          'query',
        ).output(z.object({ id: z.string(), name: z.string() })),
      },
    });
    const map = buildSerializers(reg);
    expect(map.has('users.getUser')).toBe(true);
    const serialize = map.get('users.getUser')!;
    expect(serialize({ id: '1', name: 'Alice' })).toBe('{"data":{"id":"1","name":"Alice"}}');
  });

  it('compiled serializer wraps correctly', () => {
    const reg = compileRegistry({
      hello: capability(() => ({ message: 'hi' }), 'query')
        .output(z.object({ message: z.string() })),
    });
    const map = buildSerializers(reg);
    const serialize = map.get('hello')!;
    const result = serialize({ message: 'hi' });
    expect(result).toBe('{"data":{"message":"hi"}}');
  });

  it('no entry for capability without outputSchema', () => {
    const reg = compileRegistry({
      noop: capability(() => 'ok', 'query'),
    });
    const map = buildSerializers(reg);
    expect(map.has('noop')).toBe(false);
  });
});
