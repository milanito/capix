import { Command } from 'commander';
import * as path from 'node:path';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from '@capixjs/transport-rest';
import type { RouteDefinition, HttpOverride } from '@capixjs/transport-rest';
import type { AnyCapability, CapabilityRegistry } from '@capixjs/core';

/** Zod 4 internal def — schema._zod.def. */
type ClientZodDef = {
  type?: string;
  innerType?: unknown;
  element?: unknown;
  shape?: Record<string, unknown>;
  options?: unknown[];
};

function zodDefOf(schema: unknown): ClientZodDef {
  return (schema as { _zod?: { def?: ClientZodDef } })?._zod?.def ?? {};
}

function zodTypeToTs(schema: unknown): string {
  const def = zodDefOf(schema);

  switch (def.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'undefined': return 'undefined';
    case 'any': return 'unknown';
    case 'unknown': return 'unknown';
    case 'optional': {
      const inner = zodTypeToTs(def.innerType);
      return `${inner} | undefined`;
    }
    case 'nullable': {
      const inner = zodTypeToTs(def.innerType);
      return `${inner} | null`;
    }
    case 'array': {
      const inner = zodTypeToTs(def.element);
      return `Array<${inner}>`;
    }
    case 'object': {
      const entries = Object.entries(def.shape ?? {});
      if (entries.length === 0) return 'Record<string, never>';
      return `{ ${renderFields(entries)} }`;
    }
    case 'union': {
      const opts = (def.options ?? []).map(zodTypeToTs);
      return opts.join(' | ');
    }
    default:
      return 'unknown';
  }
}

/**
 * Renders object fields as TypeScript property declarations.
 * Optional fields use the `key?: T` syntax rather than `key: T | undefined`.
 */
function renderFields(entries: Array<[string, unknown]>): string {
  return entries.map(([k, v]) => {
    const def = zodDefOf(v);
    if (def.type === 'optional') {
      return `${k}?: ${zodTypeToTs(def.innerType)}`;
    }
    return `${k}: ${zodTypeToTs(v)}`;
  }).join('; ');
}

/** Extracts `:param` names from a route path like `/projects/:id/tasks/:taskId`. */
function extractPathParams(routePath: string): string[] {
  const params: string[] = [];
  for (const segment of routePath.split('/')) {
    if (segment.startsWith(':')) params.push(segment.slice(1));
  }
  return params;
}

/** Returns the Zod schema's shape, or an empty object if not available. */
function getShape(cap: AnyCapability): Record<string, unknown> {
  return zodDefOf(cap.inputSchema).shape ?? {};
}

function capNameToFn(name: string): string {
  return name.replace(/\./g, '_').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function generateClient(
  registry: CapabilityRegistry,
  baseUrl: string,
  overrides: Record<string, HttpOverride> = {},
): string {
  let routes: RouteDefinition[] = [];
  try {
    routes = generateRoutes(registry, { overrides });
  } catch {
    routes = [];
  }

  const lines: string[] = [
    '// Auto-generated Capix client — do not edit',
    '',
    `const BASE_URL = '${baseUrl}';`,
    '',
    'async function request<T>(method: string, path: string, input?: unknown): Promise<T> {',
    '  const isBody = method !== "GET" && method !== "DELETE" && method !== "HEAD";',
    '  let url = BASE_URL + path;',
    '  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };',
    '  if (isBody && input) {',
    '    init.body = JSON.stringify(input);',
    '  } else if (!isBody && input && typeof input === "object") {',
    '    const params = new URLSearchParams(input as Record<string, string>).toString();',
    '    if (params) url += "?" + params;',
    '  }',
    '  const res = await fetch(url, init);',
    '  const json = await res.json() as { data?: T; error?: string; message?: string };',
    '  if (!res.ok) throw new Error(`${json.error}: ${json.message}`);',
    '  return json.data as T;',
    '}',
    '',
  ];

  for (const [name, cap] of registry) {
    const route = routes.find((r) => r.capability === name);
    if (!route) continue;

    const fnName = capNameToFn(name);
    const isReadOnly = ['GET', 'HEAD', 'DELETE'].includes(route.method);
    const pathParams = extractPathParams(route.path);
    const pathParamSet = new Set(pathParams);
    const shape = cap.inputSchema !== null ? getShape(cap) : {};

    // Non-path fields go into body (writes) or query string (reads)
    const remainingEntries = Object.entries(shape).filter(([k]) => !pathParamSet.has(k));
    const hasRemaining = remainingEntries.length > 0;

    // Build function parameter list
    const fnParams: string[] = [];

    // One typed arg per path param
    for (const p of pathParams) {
      const typeDef = shape[p];
      fnParams.push(`${p}: ${typeDef !== undefined ? zodTypeToTs(typeDef) : 'string'}`);
    }

    // Body or query param for remaining fields
    if (hasRemaining) {
      const allOptional = remainingEntries.every(([, v]) => zodDefOf(v).type === 'optional');
      const fieldsType = `{ ${renderFields(remainingEntries)} }`;
      if (isReadOnly) {
        // Query params are always optional — callers may omit them
        fnParams.push(`query?: ${fieldsType}`);
      } else {
        fnParams.push(allOptional ? `body?: ${fieldsType}` : `body: ${fieldsType}`);
      }
    }

    // Path expression: template literal for routes with params, plain string otherwise
    const pathExpr = pathParams.length > 0
      ? `\`${route.path.replace(/:([a-zA-Z]+)/g, '${$1}')}\``
      : `'${route.path}'`;

    // Third arg to request(): body for write methods, query for read methods
    // Only provided when there are remaining (non-path) fields
    const thirdArg = hasRemaining ? (isReadOnly ? ', query' : ', body') : '';

    lines.push(`export async function ${fnName}(${fnParams.join(', ')}): Promise<unknown> {`);
    lines.push(`  return request('${route.method}', ${pathExpr}${thirdArg});`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function registerClient(program: Command): void {
  program
    .command('client')
    .description('generate a typed fetch client from capabilities')
    .option('--config <path>', 'path to capabilities file')
    .option('--output <file>', 'output file path (default: src/client.ts)')
    .option('--base-url <url>', 'base URL for the client', 'http://localhost:3000')
    .action(async (opts: { config: string; output?: string; baseUrl: string }) => {
      const { registry } = await loadRegistry(opts.config);
      const outPath = opts.output ?? path.join(process.cwd(), 'src', 'client.ts');
      const code = generateClient(registry, opts.baseUrl);

      const { writeFile } = await import('../utils/fs.js');
      writeFile(outPath, code);
      print.success(`Client written to ${outPath}`);
    });
}
