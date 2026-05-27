import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodSchemaToString } from './zod-to-string.js';

describe('zodSchemaToString — primitives', () => {
  it('z.string()  → "string"',  () => expect(zodSchemaToString(z.string())).toBe('string'));
  it('z.number()  → "number"',  () => expect(zodSchemaToString(z.number())).toBe('number'));
  it('z.boolean() → "boolean"', () => expect(zodSchemaToString(z.boolean())).toBe('boolean'));
  it('z.null()    → "null"',    () => expect(zodSchemaToString(z.null())).toBe('null'));
  it('z.undefined() → "undefined"', () => expect(zodSchemaToString(z.undefined())).toBe('undefined'));
  it('z.bigint()  → "bigint"',  () => expect(zodSchemaToString(z.bigint())).toBe('bigint'));
  it('z.date()    → "Date"',    () => expect(zodSchemaToString(z.date())).toBe('Date'));
  it('z.any()     → "any"',     () => expect(zodSchemaToString(z.any())).toBe('any'));
  it('z.unknown() → "unknown"', () => expect(zodSchemaToString(z.unknown())).toBe('unknown'));
  it('z.never()   → "never"',   () => expect(zodSchemaToString(z.never())).toBe('never'));
  it('z.void()    → "void"',    () => expect(zodSchemaToString(z.void())).toBe('void'));
});

describe('zodSchemaToString — literals and enums', () => {
  it('z.literal("active")     → \'"active"\'',  () => expect(zodSchemaToString(z.literal('active'))).toBe('"active"'));
  it('z.literal(42)           → "42"',           () => expect(zodSchemaToString(z.literal(42))).toBe('42'));
  it('z.literal(true)         → "true"',          () => expect(zodSchemaToString(z.literal(true))).toBe('true'));
  it('z.enum(["a","b","c"])   → "a" | "b" | "c"', () =>
    expect(zodSchemaToString(z.enum(['a', 'b', 'c']))).toBe('"a" | "b" | "c"'));
});

describe('zodSchemaToString — wrappers', () => {
  it('z.optional(z.string()) → "string | undefined"', () =>
    expect(zodSchemaToString(z.optional(z.string()))).toBe('string | undefined'));

  it('z.nullable(z.string()) → "string | null"', () =>
    expect(zodSchemaToString(z.nullable(z.string()))).toBe('string | null'));

  it('z.default(z.number(), 1) → inner type without default value shown', () =>
    expect(zodSchemaToString(z.number().default(1))).toBe('number'));

  it('z.coerce.number() → "number"', () =>
    expect(zodSchemaToString(z.coerce.number())).toBe('number'));

  it('z.coerce.string() → "string"', () =>
    expect(zodSchemaToString(z.coerce.string())).toBe('string'));
});

describe('zodSchemaToString — collections', () => {
  it('z.array(z.string()) → "string[]"', () =>
    expect(zodSchemaToString(z.array(z.string()))).toBe('string[]'));

  it('z.array(z.union([z.string(), z.number()])) → wraps in parens', () =>
    expect(zodSchemaToString(z.array(z.union([z.string(), z.number()])))).toBe('(string | number)[]'));

  it('z.object({ id: z.string() }) → "{ id: string }"', () =>
    expect(zodSchemaToString(z.object({ id: z.string() }))).toBe('{ id: string }'));

  it('z.object({}) → "{}"', () =>
    expect(zodSchemaToString(z.object({}))).toBe('{}'));

  it('z.record(z.string()) → "Record<string, string>"', () =>
    expect(zodSchemaToString(z.record(z.string()))).toBe('Record<string, string>'));

  it('z.tuple([z.string(), z.number()]) → "[string, number]"', () =>
    expect(zodSchemaToString(z.tuple([z.string(), z.number()]))).toBe('[string, number]'));
});

describe('zodSchemaToString — union and intersection', () => {
  it('z.union([z.string(), z.number()]) → "string | number"', () =>
    expect(zodSchemaToString(z.union([z.string(), z.number()]))).toBe('string | number'));

  it('z.intersection — combines with &', () => {
    const schema = z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }));
    expect(zodSchemaToString(schema)).toBe('{ a: string } & { b: number }');
  });

  it('z.discriminatedUnion → renders each variant', () => {
    const schema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), x: z.string() }),
      z.object({ type: z.literal('b'), y: z.number() }),
    ]);
    const result = zodSchemaToString(schema);
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
    expect(result).toContain('|');
  });
});

describe('zodSchemaToString — transforms and effects', () => {
  it('z.string().transform(fn) → shows inner type "string"', () =>
    expect(zodSchemaToString(z.string().transform(Number))).toBe('string'));

  it('z.string().refine(fn) → shows inner type "string"', () =>
    expect(zodSchemaToString(z.string().refine((v) => v.length > 0))).toBe('string'));
});

describe('zodSchemaToString — depth truncation', () => {
  it('deeply nested object truncates to "{ ... }" beyond depth 2', () => {
    const nested = z.object({
      a: z.object({
        b: z.object({
          c: z.object({ d: z.string() }),
        }),
      }),
    });
    const result = zodSchemaToString(nested);
    expect(result).toContain('{ ... }');
  });

  it('z.lazy() returns "..."', () => {
    type Tree = { value: string; children: Tree[] };
    const TreeSchema: z.ZodType<Tree> = z.lazy(() =>
      z.object({ value: z.string(), children: z.array(TreeSchema) }),
    );
    const result = zodSchemaToString(TreeSchema);
    expect(result).toBe('...');
  });
});

describe('zodSchemaToString — no Zod internals in output', () => {
  it('no "Zod" prefix appears in any output', () => {
    const schemas = [
      z.string(),
      z.object({ id: z.string(), count: z.coerce.number() }),
      z.enum(['a', 'b']),
      z.optional(z.string()),
      z.array(z.union([z.string(), z.number()])),
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('x') }),
        z.object({ type: z.literal('y') }),
      ]),
    ];
    for (const s of schemas) {
      const result = zodSchemaToString(s);
      expect(result).not.toMatch(/Zod[A-Z]/);
    }
  });
});
