import { Command } from 'commander';
import * as path from 'node:path';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from 'capix-transport-rest';
import type { RouteDefinition } from 'capix-transport-rest';
import type { CapabilityRegistry } from 'capix';

function schemaToObject(schema: unknown): Record<string, string> | null {
  if (!schema) return null;
  const s = schema as { shape?: Record<string, unknown> };
  if (!s.shape) return null;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.shape)) {
    const typeName = (v as { _def?: { typeName?: string } })._def?.typeName ?? 'unknown';
    result[k] = typeName.replace('Zod', '').toLowerCase();
  }
  return result;
}

function buildAiContext(registry: CapabilityRegistry, projectName: string): string {
  let routes: RouteDefinition[] = [];
  try {
    routes = generateRoutes(registry);
  } catch {
    routes = [];
  }

  const caps: unknown[] = [];
  for (const [name, cap] of registry) {
    const route = routes.find((r) => r.capability === name);
    caps.push({
      name,
      intent: cap.intent,
      guards: cap.guards.length,
      input: schemaToObject(cap.inputSchema),
      http: route ? { method: route.method, path: route.path } : undefined,
    });
  }

  const doc = {
    project: projectName,
    generated: new Date().toISOString(),
    capabilities: caps,
  };

  return JSON.stringify(doc, null, 2);
}

export function registerAiContext(program: Command): void {
  program
    .command('ai-context')
    .description('generate a machine-readable context document for AI assistants')
    .option('--config <path>', 'path to capabilities file', 'src/capabilities.ts')
    .option('--output <file>', 'output file path (default: .capix-context.json)')
    .option('--name <name>', 'project name (default: directory name)')
    .action(async (opts: { config: string; output?: string; name?: string }) => {
      const { registry } = await loadRegistry(opts.config);
      const projectName = opts.name ?? path.basename(process.cwd());
      const outPath = opts.output ?? path.join(process.cwd(), '.capix-context.json');
      const content = buildAiContext(registry, projectName);

      const { writeFile } = await import('../utils/fs.js');
      writeFile(outPath, content);
      print.success(`AI context written to ${outPath} (${registry.size} capabilities)`);
    });

  program
    .command('sync-ai-context')
    .description('refresh .capix-context.json in place (alias for ai-context)')
    .option('--config <path>', 'path to capabilities file', 'src/capabilities.ts')
    .option('--name <name>', 'project name')
    .action(async (opts: { config: string; name?: string }) => {
      const { registry } = await loadRegistry(opts.config);
      const projectName = opts.name ?? path.basename(process.cwd());
      const outPath = path.join(process.cwd(), '.capix-context.json');
      const content = buildAiContext(registry, projectName);

      const { writeFile } = await import('../utils/fs.js');
      writeFile(outPath, content);
      print.success(`AI context synced (${registry.size} capabilities)`);
    });
}
