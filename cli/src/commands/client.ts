import { Command } from 'commander';
import * as path from 'node:path';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from 'capix-transport-rest';
import type { RouteDefinition } from 'capix-transport-rest';
import type { AnyCapability, CapabilityRegistry } from 'capix';

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
      const fields = Object.entries(shape).map(([k, v]) => `${k}: ${zodTypeToTs(v)}`).join('; ');
      return `{ ${fields} }`;
    }
    case 'ZodUnion': {
      const opts = ((d._def as { options?: unknown[] })?.options ?? []).map(zodTypeToTs);
      return opts.join(' | ');
    }
    default:
      return 'unknown';
  }
}

function renderInputType(cap: AnyCapability): string {
  if (!cap.inputSchema) return 'Record<string, never>';
  const schema = cap.inputSchema as { shape?: Record<string, unknown> };
  const shape = schema.shape;
  if (!shape) return 'unknown';
  const fields = Object.entries(shape).map(([k, v]) => `${k}: ${zodTypeToTs(v)}`);
  return `{ ${fields.join('; ')} }`;
}

function capNameToFn(name: string): string {
  return name.replace(/\./g, '_').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function generateClient(registry: CapabilityRegistry, baseUrl: string): string {
  let routes: RouteDefinition[] = [];
  try {
    routes = generateRoutes(registry);
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
    const inputType = renderInputType(cap);
    const hasInput = cap.inputSchema !== null;
    const isBodyMethod = !['GET', 'DELETE', 'HEAD'].includes(route.method);

    // Extract path param names from route pattern (e.g. /projects/:id → ['id'])
    const pathParams = [...route.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1] ?? '');
    const pathWithTypes = route.path.replace(/:([a-zA-Z]+)/g, '${input.$1}');
    const useTemplatePath = pathWithTypes !== route.path;

    const inputParam = hasInput ? `input: ${inputType}` : '';
    const pathExpr = useTemplatePath ? `\`${pathWithTypes}\`` : `'${route.path}'`;

    // Build the body argument:
    // - GET/DELETE: no body, pass input as query params via request()
    // - body method, no path params: pass full input as body
    // - body method, with path params: extract non-path fields and pass as body
    let bodyArg = '';
    if (hasInput) {
      if (!isBodyMethod) {
        bodyArg = ', input'; // query params
      } else if (!useTemplatePath) {
        bodyArg = ', input'; // full input as body
      } else {
        // body method with path params: pass only non-path fields
        const schema = cap.inputSchema as { _def?: { shape?: () => Record<string, unknown> } };
        const shapeFn = schema._def?.shape;
        const shape = typeof shapeFn === 'function' ? shapeFn() : null;
        const bodyFields = shape
          ? Object.keys(shape).filter((k) => !pathParams.includes(k))
          : [];
        if (bodyFields.length > 0) {
          bodyArg = `, { ${bodyFields.map((f) => `${f}: input.${f}`).join(', ')} }`;
        }
      }
    }

    lines.push(`export async function ${fnName}(${inputParam}): Promise<unknown> {`);
    lines.push(`  return request('${route.method}', ${pathExpr}${bodyArg});`);
    lines.push(`}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function registerClient(program: Command): void {
  program
    .command('client')
    .description('generate a typed fetch client from capabilities')
    .option('--config <path>', 'path to capabilities file', 'src/capabilities.ts')
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
