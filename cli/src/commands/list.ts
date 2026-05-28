import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from 'capix-transport-rest';

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

      const routes = generateRoutes(registry);
      const routeMap = new Map(routes.map((r) => [r.capability, r]));

      print.header(`Capabilities (${registry.size})`);
      print.blank();

      // Calculate column widths
      const rows = [...registry].map(([name, cap]) => {
        const route = routeMap.get(name);
        const guardCount = cap.guards.length;
        const inputGuardCount = cap.inputGuards.length;
        let guardsLabel: string;
        if (guardCount === 0 && inputGuardCount === 0) {
          guardsLabel = 'public';
        } else {
          const parts: string[] = [];
          if (guardCount > 0) parts.push(`${guardCount} guard${guardCount > 1 ? 's' : ''}`);
          if (inputGuardCount > 0) parts.push(`${inputGuardCount} inputGuard${inputGuardCount > 1 ? 's' : ''}`);
          guardsLabel = parts.join(', ');
        }
        return {
          name,
          method: route?.method ?? '?',
          path:   route?.path   ?? '(no route)',
          guards: guardsLabel,
        };
      });

      const nameW   = Math.max(...rows.map((r) => r.name.length));
      const methodW = Math.max(...rows.map((r) => r.method.length));
      const pathW   = Math.max(...rows.map((r) => r.path.length));

      for (const row of rows) {
        const line =
          '  ' +
          row.name.padEnd(nameW + 2) +
          print.dim(row.method.padEnd(methodW + 2)) +
          row.path.padEnd(pathW + 2) +
          print.dim(row.guards);
        console.log(line);
      }
      print.blank();
    });
}
