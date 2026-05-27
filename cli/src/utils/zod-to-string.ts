/**
 * zod-to-string.ts — human-readable Zod schema introspection
 *
 * Reads Zod's internal _def structure to produce TypeScript-like type strings.
 * Used by `capix docs` and `capix show` to describe capability schemas.
 */

type ZodDef = {
  typeName: string;
  // ZodObject
  shape?: () => Record<string, ZodLike>;
  // ZodArray / ZodSet / ZodPromise
  type?: ZodLike;
  // ZodOptional / ZodNullable / ZodDefault / ZodCatch / ZodBranded / ZodEffects
  innerType?: ZodLike;
  schema?: ZodLike;
  // ZodUnion / ZodDiscriminatedUnion
  options?: ZodLike[];
  // ZodIntersection
  left?: ZodLike;
  right?: ZodLike;
  // ZodTuple
  items?: ZodLike[];
  rest?: ZodLike;
  // ZodRecord / ZodMap
  keyType?: ZodLike;
  valueType?: ZodLike;
  // ZodLiteral
  value?: unknown;
  // ZodEnum / ZodNativeEnum
  values?: unknown[] | Record<string, unknown>;
  // ZodFunction
  args?: ZodLike;
  returns?: ZodLike;
  // ZodCoerce (same as primitive but under coerce namespace)
  // ZodEffects
  effect?: unknown;
};

type ZodLike = { _def: ZodDef };

const MAX_DEPTH = 6;

export function zodSchemaToString(schema: unknown, depth = 0): string {
  if (!schema || typeof schema !== 'object' || !('_def' in (schema as object))) {
    return 'unknown';
  }
  if (depth > MAX_DEPTH) return '...';

  const def = (schema as ZodLike)._def;
  const d = depth + 1;

  switch (def.typeName) {
    case 'ZodString':     return 'string';
    case 'ZodNumber':     return 'number';
    case 'ZodBigInt':     return 'bigint';
    case 'ZodBoolean':    return 'boolean';
    case 'ZodDate':       return 'Date';
    case 'ZodNull':       return 'null';
    case 'ZodUndefined':  return 'undefined';
    case 'ZodVoid':       return 'void';
    case 'ZodAny':        return 'any';
    case 'ZodUnknown':    return 'unknown';
    case 'ZodNever':      return 'never';
    case 'ZodSymbol':     return 'symbol';
    case 'ZodNaN':        return 'NaN';

    case 'ZodLiteral': {
      const v = def.value;
      if (typeof v === 'string') return `"${v}"`;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return 'literal';
    }

    case 'ZodEnum': {
      const vals = def.values;
      if (Array.isArray(vals)) return vals.map((v) => `"${v}"`).join(' | ');
      return 'enum';
    }

    case 'ZodNativeEnum':
      return 'enum';

    case 'ZodObject': {
      if (depth > 2) return '{ ... }';
      if (!def.shape) return 'object';
      const shape = def.shape();
      const fields = Object.entries(shape)
        .map(([k, v]) => `${k}: ${zodSchemaToString(v, d)}`)
        .join(', ');
      return fields ? `{ ${fields} }` : '{}';
    }

    case 'ZodArray': {
      const inner = def.type ? zodSchemaToString(def.type, d) : 'unknown';
      const needsParens = inner.includes(' ') && !inner.startsWith('{') && !inner.startsWith('[');
      return needsParens ? `(${inner})[]` : `${inner}[]`;
    }

    case 'ZodTuple': {
      const items = (def.items ?? []).map((item) => zodSchemaToString(item, d));
      const rest = def.rest ? `, ...${zodSchemaToString(def.rest, d)}[]` : '';
      return `[${items.join(', ')}${rest}]`;
    }

    case 'ZodRecord': {
      const k = def.keyType ? zodSchemaToString(def.keyType, d) : 'string';
      const v = def.valueType ? zodSchemaToString(def.valueType, d) : 'unknown';
      return `Record<${k}, ${v}>`;
    }

    case 'ZodMap': {
      const k = def.keyType ? zodSchemaToString(def.keyType, d) : 'unknown';
      const v = def.valueType ? zodSchemaToString(def.valueType, d) : 'unknown';
      return `Map<${k}, ${v}>`;
    }

    case 'ZodSet': {
      const inner = def.type ? zodSchemaToString(def.type, d) : 'unknown';
      return `Set<${inner}>`;
    }

    case 'ZodOptional': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `${inner} | undefined`;
    }

    case 'ZodNullable': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `${inner} | null`;
    }

    case 'ZodDefault': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return inner;
    }

    case 'ZodCatch':
    case 'ZodBranded':
      return def.type ? zodSchemaToString(def.type, d) : 'unknown';

    case 'ZodEffects':
      return def.schema ? zodSchemaToString(def.schema, d) : 'unknown';

    case 'ZodUnion': {
      const opts = def.options ?? [];
      return opts.map((o) => zodSchemaToString(o, d)).join(' | ');
    }

    case 'ZodDiscriminatedUnion': {
      const opts = def.options ?? [];
      return opts.map((o) => zodSchemaToString(o, d)).join(' | ');
    }

    case 'ZodIntersection': {
      const left = def.left ? zodSchemaToString(def.left, d) : 'unknown';
      const right = def.right ? zodSchemaToString(def.right, d) : 'unknown';
      return `${left} & ${right}`;
    }

    case 'ZodPromise': {
      const inner = def.type ? zodSchemaToString(def.type, d) : 'unknown';
      return `Promise<${inner}>`;
    }

    case 'ZodFunction': {
      const args = def.args ? zodSchemaToString(def.args, d) : '()';
      const returns = def.returns ? zodSchemaToString(def.returns, d) : 'unknown';
      return `${args} => ${returns}`;
    }

    case 'ZodLazy':
      return '...';

    case 'ZodReadonly': {
      const inner = def.innerType ? zodSchemaToString(def.innerType, d) : 'unknown';
      return `Readonly<${inner}>`;
    }

    case 'ZodPipeline':
      return 'unknown';

    default:
      return def.typeName?.replace('Zod', '').toLowerCase() ?? 'unknown';
  }
}
