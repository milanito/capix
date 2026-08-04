import * as path from 'node:path';
import { Command } from 'commander';
import * as print from '../utils/print.js';
import { writeFile, findProjectRoot } from '../utils/fs.js';
import { renderCapabilityTs, renderGroupTs } from '../templates/generate.js';

export function toKebabCase(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

export type ParsedCapabilityArgs = { capabilityName: string; groupParts: string[] };

/**
 * Parses `generate capability <args...>` positional args into a capability
 * name and its group path. Supports three forms:
 *   generate capability getUser              -> { capabilityName: 'getUser', groupParts: [] }
 *   generate capability users getUser        -> { capabilityName: 'getUser', groupParts: ['users'] }
 *   generate capability users/variants list  -> { capabilityName: 'list', groupParts: ['users', 'variants'] }
 */
export function parseCapabilityArgs(args: string[]): ParsedCapabilityArgs {
  if (args.length === 1) {
    const parts = (args[0] ?? '').split('/').filter(Boolean);
    const capabilityName = parts[parts.length - 1] ?? args[0] ?? '';
    const groupParts = parts.slice(0, -1);
    return { capabilityName, groupParts };
  }
  const capabilityName = args[args.length - 1] ?? '';
  const groupParts = args.slice(0, -1).flatMap((a) => a.split('/').filter(Boolean));
  return { capabilityName, groupParts };
}

export function registerGenerate(program: Command): void {
  const gen = program
    .command('generate')
    .alias('g')
    .description('generate capability or group scaffolding');

  gen
    .command('capability <args...>')
    .alias('cap')
    .description('scaffold a new capability file')
    .option('--input', 'include a Zod input schema')
    .option('--dir <dir>', 'output directory (default: src/capabilities)')
    .action((args: string[], opts: { input?: boolean; dir?: string }) => {
      const root = findProjectRoot() ?? process.cwd();
      const baseDir = opts.dir ?? path.join(root, 'src', 'capabilities');

      // Support: generate capability getUser
      //          generate capability users getUser       (group name)
      //          generate capability users/variants list (slash-separated group)
      const { capabilityName, groupParts } = parseCapabilityArgs(args);

      const outDir = groupParts.length > 0 ? path.join(baseDir, ...groupParts) : baseDir;
      const fileName = toKebabCase(capabilityName);
      const outPath = path.join(outDir, `${fileName}.ts`);

      const content = renderCapabilityTs(capabilityName, opts.input ?? false);
      writeFile(outPath, content);

      print.success(`Generated capability: ${path.relative(process.cwd(), outPath)}`);
    });

  gen
    .command('group <name> [capabilities...]')
    .description('scaffold a capability group that re-exports named capabilities')
    .option('--dir <dir>', 'output directory (default: src/capabilities)')
    .action((name: string, capabilities: string[], opts: { dir?: string }) => {
      const root = findProjectRoot() ?? process.cwd();
      const outDir = opts.dir ?? path.join(root, 'src', 'capabilities');
      const fileName = toKebabCase(name);
      const outPath = path.join(outDir, `${fileName}.group.ts`);

      const content = renderGroupTs(name, capabilities);
      writeFile(outPath, content);

      print.success(`Generated group: ${path.relative(process.cwd(), outPath)}`);
    });
}
