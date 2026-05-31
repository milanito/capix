import { Command } from 'commander';
import * as path from 'node:path';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from '@capixjs/transport-rest';
import type { RouteDefinition, HttpOverride } from '@capixjs/transport-rest';
import type { AnyCapability, CapabilityRegistry } from '@capixjs/core';

function zodTypeToTs(def: unknown): string {
  const d = def as { _def?: { typeName?: string; innerType?: unknown; shape?: Record<string, unknown>; type?: unknown; options?: unknown[] } };
  const typeName = d._def?.typeName ?? '';

  switch (typeName) {
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodNull': return 'null';
    case 'ZodUndefined': return 'undefined';
    case 'ZodAny': return 'unknown';
    case 'ZodUnknown': return 'unknown';
    case 'ZodOptional': {
      const inner = zodTypeToTs(d._def?.innerType);
      return `${inner} | undefined`;
    }
    case 'ZodNullable': {
      const inner = zodTypeToTs(d._def?.innerType);
      return `${inner} | null`;
    }
    case 'ZodArray': {
      const inner = zodTypeToTs(d._def?.type);
      return `Array<${inner}>`;
    }
    case 'ZodObject': {
      const shapeFn = (d._def as unknown as { shape?: () => Record<string, unknown> })?.shape;
      const shape: Record<string, unknown> = typeof shapeFn === 'function' ? shapeFn() : {};
      const entries = Object.entries(shape);
      if (entries.length === 0) return 'Record<string, never>';
      return `{ ${renderFields(entries)} }`;
    }
    case 'ZodUnion': {
      const opts = ((d._def as { options?: unknown[] })?.options ?? []).map(zodTypeToTs);
      return opts.join(' | ');
    }
    default:
      return 'unknown';
  }
}

/**
 * Renders object fields as TypeScript property declarations.
 * ZodOptional fields use the `key?: T` syntax rather than `key: T | undefined`.
 */
function renderFields(entries: Array<[string, unknown]>): string {
  return entries.map(([k, v]) => {
    const d = v as { _def?: { typeName?: string; innerType?: unknown } };
    if (d._def?.typeName === 'ZodOptional') {
      return `${k}?: ${zodTypeToTs(d._def?.innerType)}`;
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
  const schema = cap.inputSchema as { _def?: { shape?: () => Record<string, unknown> } } | null;
  const shapeFn = schema?._def?.shape;
  return typeof shapeFn === 'function' ? shapeFn() : {};
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
      const allOptional = remainingEntries.every(([, v]) => {
        const d = v as { _def?: { typeName?: string } };
        return d._def?.typeName === 'ZodOptional';
      });
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
