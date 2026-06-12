/**
 * coercion.ts — schema-aware coercion of string request values.
 *
 * Query strings, path params, and multipart text fields arrive as strings.
 * Instead of blindly coercing anything numeric-looking (which corrupted
 * string fields: ?name=123 became the number 123 and failed z.string(),
 * ?code=0123 silently became 123), coercion targets are derived from each
 * capability's Zod input schema at mount time. A value is coerced to
 * number/boolean only when the schema types that field as number/boolean;
 * everything else stays a raw string.
 *
 * JSON bodies are never coerced — JSON already expresses numbers and
 * booleans, so a string where a number belongs is a genuine type error.
 */

import type { CapabilityRegistry } from '@capixjs/core';

export type CoercionKind = 'number' | 'boolean';

/** field name → coercion target, per capability dot-path. */
export type CoercionMaps = Map<string, Map<string, CoercionKind>>;

type ZodDefLike = {
  typeName?: string;
  innerType?: unknown;
  schema?: unknown;
  type?: unknown;
  options?: unknown[];
  shape?: (() => Record<string, unknown>) | Record<string, unknown>;
};

function defOf(schema: unknown): ZodDefLike | null {
  if (typeof schema !== 'object' || schema === null) return null;
  const def = (schema as { _def?: ZodDefLike })._def;
  return typeof def === 'object' && def !== null ? def : null;
}

/** Wrapper types whose inner schema determines the coercion target. */
const WRAPPERS = new Set([
  'ZodOptional',
  'ZodNullable',
  'ZodDefault',
  'ZodCatch',
  'ZodBranded',
  'ZodReadonly',
  'ZodEffects', // z.coerce.* in some Zod versions, .transform(), .refine()
]);

/** Unwraps optional/nullable/default/effects layers to the underlying def. */
function unwrap(schema: unknown): ZodDefLike | null {
  let def = defOf(schema);
  let depth = 0;
  while (def !== null && def.typeName !== undefined && WRAPPERS.has(def.typeName) && depth < 16) {
    def = defOf(def.innerType ?? def.schema ?? def.type);
    depth++;
  }
  return def;
}

function kindOf(fieldSchema: unknown): CoercionKind | null {
  const def = unwrap(fieldSchema);
  if (def === null) return null;
  switch (def.typeName) {
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodUnion': {
      // Coerce only when every meaningful branch agrees on one primitive kind
      // (e.g. z.union([z.number(), z.null()])). A string branch means the raw
      // string is already acceptable — leave it alone.
      const kinds = new Set<CoercionKind | null>();
      for (const option of def.options ?? []) {
        const inner = unwrap(option);
        if (inner?.typeName === 'ZodNull' || inner?.typeName === 'ZodUndefined') continue;
        kinds.add(inner?.typeName === 'ZodNumber' ? 'number' : inner?.typeName === 'ZodBoolean' ? 'boolean' : null);
      }
      if (kinds.size === 1) {
        const only = kinds.values().next().value;
        return only ?? null;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Builds per-capability coercion maps from compiled input schemas.
 * Capabilities without a ZodObject input schema (no schema, z.record, z.any)
 * get no map — their string values pass through untouched.
 */
export function buildCoercionMaps(registry: CapabilityRegistry): CoercionMaps {
  const maps: CoercionMaps = new Map();

  for (const [dotPath, cap] of registry) {
    if (cap.inputSchema === null) continue;
    const def = unwrap(cap.inputSchema);
    if (def?.typeName !== 'ZodObject') continue;

    const shape = typeof def.shape === 'function' ? def.shape() : (def.shape ?? {});
    const fields = new Map<string, CoercionKind>();
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const kind = kindOf(fieldSchema);
      if (kind !== null) fields.set(key, kind);
    }
    if (fields.size > 0) maps.set(dotPath, fields);
  }

  return maps;
}

/**
 * Coerces a raw string toward the schema's target type. Values that don't
 * parse cleanly are returned as-is so Zod reports the error on the original
 * input instead of a mangled one.
 */
export function coerceValue(raw: string, kind: CoercionKind): unknown {
  if (kind === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }
  // number — require non-blank text; Number('') and Number('  ') are 0
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/** Coerces matching string fields of obj in place. */
export function coerceFields(
  obj: Record<string, unknown>,
  fields: ReadonlyMap<string, CoercionKind>,
): void {
  for (const [key, kind] of fields) {
    const val = obj[key];
    if (typeof val === 'string') obj[key] = coerceValue(val, kind);
  }
}
