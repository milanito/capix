import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';

export function registerList(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('list all registered capabilities')
    .option('--config <path>', 'path to capabilities file', 'src/capabilities.ts')
    .action(async (opts: { config: string }) => {
      const { registry } = await loadRegistry(opts.config);

      if (registry.size === 0) {
        print.warn('No capabilities found.');
        return;
      }

      print.header(`Capabilities (${registry.size})`);
      print.blank();

      const rows: Array<[string, string, string]> = [];
      for (const [name, cap] of registry) {
        const intent = cap.intent.padEnd(8);
        const guards = cap.guards.length > 0 ? `${cap.guards.length} guard${cap.guards.length > 1 ? 's' : ''}` : '';
        rows.push([name, intent, print.dim(guards)]);
      }
      print.table(rows);
      print.blank();
    });
}
