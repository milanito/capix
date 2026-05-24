import * as path from 'node:path';
import { Command } from 'commander';
import * as print from '../utils/print.js';
import { writeFile, findProjectRoot } from '../utils/fs.js';
import { renderCapabilityTs, renderGroupTs } from '../templates/generate.js';

export function registerGenerate(program: Command): void {
  const gen = program
    .command('generate')
    .alias('g')
    .description('generate capability or group scaffolding');

  gen
    .command('capability <name>')
    .alias('cap')
    .description('scaffold a new capability file')
    .option('--input', 'include a Zod input schema')
    .option('--dir <dir>', 'output directory (default: src/capabilities)')
    .action((name: string, opts: { input?: boolean; dir?: string }) => {
      const root = findProjectRoot() ?? process.cwd();
      const outDir = opts.dir ?? path.join(root, 'src', 'capabilities');
      const fileName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const outPath = path.join(outDir, `${fileName}.ts`);

      const content = renderCapabilityTs(name, opts.input ?? false);
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
      const fileName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const outPath = path.join(outDir, `${fileName}.group.ts`);

      const content = renderGroupTs(name, capabilities);
      writeFile(outPath, content);

      print.success(`Generated group: ${path.relative(process.cwd(), outPath)}`);
    });
}
