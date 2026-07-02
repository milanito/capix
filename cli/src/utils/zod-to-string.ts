/**
 * zod-to-string.ts — human-readable Zod schema introspection
 *
 * Reads Zod 4's internal def structure (schema._zod.def) to produce
 * TypeScript-like type strings. Used by `capix docs` and `capix show`
 * to describe capability schemas.
 */

type ZodDef = {
  type: string;
  // object
  shape?: Record<string, ZodLike>;
  // array
  element?: ZodLike;
  // set / record / map value
  valueType?: ZodLike;
  // record / map key
  keyType?: ZodLike;
  // optional / nullable / default / prefault / catch / readonly / nonoptional / promise
  innerType?: ZodLike;
  // pipe (.transform(), z.preprocess())
  in?: ZodLike;
  // union / discriminated union
  options?: ZodLike[];
  // intersection
  left?: ZodLike;
  right?: ZodLike;
  // tuple
  items?: ZodLike[];
  rest?: ZodLike;
  // literal — v4 literals hold one or more values
  values?: unknown[];
  // enum
  entries?: Record<string, unknown>;
};

type ZodLike = { _zod: { def: ZodDef } };

const MAX_DEPTH = 6;

function defOf(schema: unknown): ZodDef | null {
  if (!schema || typeof schema !== 'object') return null;
  const def = (schema as { _zod?: { def?: ZodDef } })._zod?.def;
  return def && typeof def === 'object' ? def : null;
}

export function zodSchemaToString(schema: unknown, depth = 0): string {
  const def = defOf(schema);
  if (def === null) return 'unknown';
  if (depth > MAX_DEPTH) return '...';

  const d = depth + 1;

  switch (def.type) {
    case 'string':    return 'string';
    case 'number':
    case 'int':       return 'number';
    case 'bigint':    return 'bigint';
    case 'boolean':   return 'boolean';
    case 'date':      return 'Date';
    case 'null':      return 'null';
    case 'undefined': return 'undefined';
    case 'void':      return 'void';
    case 'any':       return 'any';
    case 'unknown':   return 'unknown';
    case 'never':     return 'never';
    case 'symbol':    return 'symbol';
    case 'nan':       return 'NaN';

    case 'literal': {
      const vals = (def.values ?? []).map((v) => {
        if (typeof v === 'string') return `"${v}"`;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return 'literal';
      });
      return vals.length > 0 ? vals.join(' | ') : 'literal';
    }

    case 'enum': {
      const vals = Object.values(def.entries ?? {});
      if (vals.length === 0) return 'enum';
      return vals
        .map((v) => (typeof v === 'string' ? `"${v}"` : String(v)))
        .join(' | ');
    }

    case 'object': {
      if (depth > 2) return '{ ... }';
      const shape = def.shape ?? {};
      const fields = Object.entries(shape)
        .map(([k, v]) => `${k}: ${zodSchemaToString(v, d)}`)
        .join(', ');
      return fields ? `{ ${fields} }` : '{}';
    }

    case 'array': {
      const inner = def.element ? zodSchemaToString(def.element, d) : 'unknown';
      const needsParens = inner.includes(' ') && !inner.startsWith('{') && !inner.startsWith('[');
      return needsParens ? `(${inner})[]` : `${inner}[]`;
    }

    case 'tuple': {
      const items = (def.items ?? []).map((item) => zodSchemaToString(item, d));
      const rest = def.rest ? `, ...${zodSchemaToString(def.rest, d)}[]` : '';
      return `[${items.join(', ')}${rest}]`;
    }

    case 'record': {
      const k = def.keyType ? zodSchemaToString(def.keyType, d) : 'string';
      const v = def.valueType ? zodSchemaToString(def.valueType, d) : 'unknown';
      return `Record<${k}, ${v}>`;
    }

    case 'map': {
      const k = def.keyType ? zodSchemaToString(def.keyType, d) : 'unknown';
      const v = def.valueType ? zodSchemaToString(def.valueType, d) : 'unknown';
      return `Map<${k}, ${v}>`;
    }

    case 'set': {
      const inner = def.valueType ? zodSchemaToString(def.valueType, d) : 'unknown';
      return `Set<${inner}>`;
    }

    case 'optional': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `${inner} | undefined`;
    }

    case 'nullable': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `${inner} | null`;
    }

    case 'default':
    case 'prefault':
    case 'catch':
    case 'nonoptional':
      return def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';

    case 'pipe':
      // .transform() / z.preprocess() — describe the input side
      return def.in ? zodSchemaToString(def.in, d) : 'unknown';

    case 'union': {
      const opts = def.options ?? [];
      return opts.map((o) => zodSchemaToString(o, d)).join(' | ');
    }

    case 'intersection': {
      const left = def.left ? zodSchemaToString(def.left, d) : 'unknown';
      const right = def.right ? zodSchemaToString(def.right, d) : 'unknown';
      return `${left} & ${right}`;
    }

    case 'promise': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `Promise<${inner}>`;
    }

    case 'lazy':
      return '...';

    case 'readonly': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `Readonly<${inner}>`;
    }

    default:
      return def.type ?? 'unknown';
  }
}
