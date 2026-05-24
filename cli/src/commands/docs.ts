import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from 'capix-transport-rest';
import type { RouteDefinition } from 'capix-transport-rest';
import type { AnyCapability } from 'capix';

function describeSchema(schema: { shape?: Record<string, unknown> } | null): string {
  if (!schema) return 'none';
  const shape = schema.shape;
  if (!shape) return 'opaque schema';
  const fields = Object.entries(shape).map(([k, def]) => {
    const typeName = (def as { _def?: { typeName?: string } })._def?.typeName ?? 'unknown';
    return `${k}: ${typeName}`;
  });
  return `{ ${fields.join(', ')} }`;
}

function capabilityToMarkdown(name: string, cap: AnyCapability, routes: RouteDefinition[]): string {
  const route = routes.find((r) => r.capability === name);
  const lines: string[] = [];

  lines.push(`### \`${name}\``);
  lines.push('');
  lines.push(`**Intent:** ${cap.intent}`);
  if (route) {
    lines.push(`**HTTP:** \`${route.method} ${route.path}\``);
  }
  if (cap.guards.length > 0) {
    lines.push(`**Guards:** ${cap.guards.length}`);
  }

  const inputDesc = describeSchema(cap.inputSchema as { shape?: Record<string, unknown> } | null);
  lines.push(`**Input:** \`${inputDesc}\``);

  if (cap.outputSchema) {
    const outputDesc = describeSchema(cap.outputSchema as { shape?: Record<string, unknown> } | null);
    lines.push(`**Output:** \`${outputDesc}\``);
  }

  lines.push('');
  return lines.join('\n');
}

export function registerDocs(program: Command): void {
  program
    .command('docs')
    .description('print capability documentation as Markdown')
    .option('--config <path>', 'path to capabilities file', 'src/capabilities.ts')
    .option('--output <file>', 'write to file instead of stdout')
    .action(async (opts: { config: string; output?: string }) => {
      const { registry } = await loadRegistry(opts.config);

      let routes: RouteDefinition[] = [];
      try {
        routes = generateRoutes(registry);
      } catch {
        // ignore route errors in docs mode
      }

      const lines: string[] = ['# Capix API Documentation', ''];

      // Group by first path segment
      const groups = new Map<string, string[]>();
      for (const [name, cap] of registry) {
        const group = name.split('.')[0] ?? name;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(name);
        void cap; // referenced below
      }

      for (const [group, names] of groups) {
        lines.push(`## ${group}`);
        lines.push('');
        for (const name of names) {
          const cap = registry.get(name)!;
          lines.push(capabilityToMarkdown(name, cap, routes));
        }
      }

      const output = lines.join('\n');

      if (opts.output) {
        const { writeFile } = await import('../utils/fs.js');
        writeFile(opts.output, output);
        print.success(`Documentation written to ${opts.output}`);
      } else {
        console.log(output);
      }
    });
}
