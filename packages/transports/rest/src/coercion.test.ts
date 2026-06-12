import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { capability, compileRegistry } from '@capixjs/core';
import { buildCoercionMaps, coerceValue, coerceFields } from './coercion.js';

function mapsFor(schema: ZodTypeAny) {
  const reg = compileRegistry({
    g: { cap: capability(schema, (i) => i) },
  });
  return buildCoercionMaps(reg).get('g.cap');
}

describe('buildCoercionMaps', () => {
  it('maps number and boolean fields, skips strings', () => {
    const m = mapsFor(z.object({ name: z.string(), age: z.number(), active: z.boolean() }));
    expect(m?.get('name')).toBeUndefined();
    expect(m?.get('age')).toBe('number');
    expect(m?.get('active')).toBe('boolean');
  });

  it('unwraps optional, nullable, and default wrappers', () => {
    const m = mapsFor(z.object({
      a: z.number().optional(),
      b: z.boolean().default(false),
      c: z.number().nullable(),
      d: z.number().optional().default(0),
    }));
    expect(m?.get('a')).toBe('number');
    expect(m?.get('b')).toBe('boolean');
    expect(m?.get('c')).toBe('number');
    expect(m?.get('d')).toBe('number');
  });

  it('handles z.coerce and refined fields', () => {
    const m = mapsFor(z.object({
      page: z.coerce.number().min(1),
      strict: z.number().refine((n) => n > 0),
    }));
    expect(m?.get('page')).toBe('number');
    expect(m?.get('strict')).toBe('number');
  });

  it('uniform unions coerce; mixed unions stay raw', () => {
    const m = mapsFor(z.object({
      onlyNum: z.union([z.number(), z.null()]),
      mixed: z.union([z.number(), z.string()]),
    }));
    expect(m?.get('onlyNum')).toBe('number');
    expect(m?.get('mixed')).toBeUndefined();
  });

  it('returns no map for record, no-schema, and string-only capabilities', () => {
    const reg = compileRegistry({
      g: {
        rec: capability(z.record(z.unknown()), (i) => i),
        none: capability(() => 'ok'),
        strs: capability(z.object({ a: z.string() }), (i) => i),
      },
    });
    const maps = buildCoercionMaps(reg);
    expect(maps.get('g.rec')).toBeUndefined();
    expect(maps.get('g.none')).toBeUndefined();
    expect(maps.get('g.strs')).toBeUndefined(); // no coercible fields → no map
  });
});

describe('coerceValue', () => {
  it('coerces clean numbers and leaves garbage raw', () => {
    expect(coerceValue('42', 'number')).toBe(42);
    expect(coerceValue('-1.5', 'number')).toBe(-1.5);
    expect(coerceValue('abc', 'number')).toBe('abc'); // Zod errors on the original
    expect(coerceValue('', 'number')).toBe('');
    expect(coerceValue('  ', 'number')).toBe('  '); // Number('  ') is 0 — must not coerce
  });

  it('coerces only literal true/false for booleans', () => {
    expect(coerceValue('true', 'boolean')).toBe(true);
    expect(coerceValue('false', 'boolean')).toBe(false);
    expect(coerceValue('1', 'boolean')).toBe('1');
    expect(coerceValue('yes', 'boolean')).toBe('yes');
  });
});

describe('coerceFields', () => {
  it('coerces matching string fields in place, skips non-strings', () => {
    const obj: Record<string, unknown> = { age: '30', active: 'true', name: '0123', already: 7 };
    coerceFields(obj, new Map([['age', 'number'], ['active', 'boolean'], ['already', 'number']]));
    expect(obj).toEqual({ age: 30, active: true, name: '0123', already: 7 });
  });
});
