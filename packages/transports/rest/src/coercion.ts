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

/** Zod 4 internal def — schema._zod.def (see zod's library-authors guide). */
type ZodDefLike = {
  type?: string;
  innerType?: unknown;
  in?: unknown;
  options?: unknown[];
  shape?: Record<string, unknown>;
};

function defOf(schema: unknown): ZodDefLike | null {
  if (typeof schema !== 'object' || schema === null) return null;
  const def = (schema as { _zod?: { def?: ZodDefLike } })._zod?.def;
  return typeof def === 'object' && def !== null ? def : null;
}

/** Wrapper types whose inner schema determines the coercion target. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'catch',
  'readonly',
  'nonoptional',
  'pipe', // .transform() — the input side is what the client sends
]);

/** Unwraps optional/nullable/default/pipe layers to the underlying def. */
function unwrap(schema: unknown): ZodDefLike | null {
  let def = defOf(schema);
  let depth = 0;
  while (def !== null && def.type !== undefined && WRAPPERS.has(def.type) && depth < 16) {
    def = defOf(def.innerType ?? def.in);
    depth++;
  }
  return def;
}

function kindOf(fieldSchema: unknown): CoercionKind | null {
  const def = unwrap(fieldSchema);
  if (def === null) return null;
  switch (def.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'union': {
      // Coerce only when every meaningful branch agrees on one primitive kind
      // (e.g. z.union([z.number(), z.null()])). A string branch means the raw
      // string is already acceptable — leave it alone.
      const kinds = new Set<CoercionKind | null>();
      for (const option of def.options ?? []) {
        const inner = unwrap(option);
        if (inner?.type === 'null' || inner?.type === 'undefined') continue;
        kinds.add(inner?.type === 'number' ? 'number' : inner?.type === 'boolean' ? 'boolean' : null);
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
    if (def?.type !== 'object') continue;

    const shape = def.shape ?? {};
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
