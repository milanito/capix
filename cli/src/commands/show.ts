import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';

export function registerShow(program: Command): void {
  program
    .command('show <capability>')
    .description('show details for a single capability')
    .option('--config <path>', 'path to capabilities file')
    .action(async (capName: string, opts: { config: string }) => {
      const { registry } = await loadRegistry(opts.config);

      const cap = registry.get(capName);
      if (!cap) {
        // Fuzzy match
        const close = [...registry.keys()].filter((k) => k.includes(capName));
        if (close.length > 0) {
          print.error(`Capability "${capName}" not found. Did you mean:`);
          for (const k of close) print.item(`  ${k}`);
        } else {
          print.error(`Capability "${capName}" not found.`);
        }
        process.exit(1);
      }

      print.header(cap.name);
      print.blank();
      print.item('intent', cap.intent);
      print.item('guards', String(cap.guards.length));

      if (cap.inputSchema) {
        print.blank();
        print.bold('Input schema:');
        const shape = (cap.inputSchema as { shape?: Record<string, unknown> }).shape;
        if (shape) {
          for (const [field, def] of Object.entries(shape)) {
            const zodType = (def as { _def?: { typeName?: string } })._def?.typeName ?? 'unknown';
            print.item(`  ${field}`, zodType);
          }
        } else {
          print.item('  (schema present but shape not inspectable)');
        }
      } else {
        print.item('input', 'none');
      }

      if (cap.outputSchema) {
        print.blank();
        print.item('output schema', 'defined');
      }

      print.blank();
    });
}
