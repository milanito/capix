import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from 'capix-transport-rest';

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('validate server config: duplicate routes, naming, schema issues')
    .option('--config <path>', 'path to capabilities file', 'src/capabilities.ts')
    .action(async (opts: { config: string }) => {
      const { registry } = await loadRegistry(opts.config);

      let errors = 0;
      let warnings = 0;

      print.header('Capix check');
      print.blank();

      // 1. Check for capabilities with no guards and no schema (may be unintentional)
      for (const [name, cap] of registry) {
        if (!cap.inputSchema && cap.intent !== 'query') {
          print.warn(`${name}: mutation capability has no input schema`);
          warnings++;
        }
      }

      // 2. Check for route conflicts via generateRoutes (it throws on duplicates)
      try {
        const routes = generateRoutes(registry);
        print.success(`${routes.length} routes generated, no conflicts`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        print.error(`Route conflict: ${msg}`);
        errors++;
      }

      // 3. Naming conventions
      for (const [name] of registry) {
        const parts = name.split('.');
        for (const part of parts) {
          if (!/^[a-z][a-zA-Z0-9]*$/.test(part)) {
            print.warn(`${name}: segment "${part}" should be camelCase`);
            warnings++;
          }
        }
      }

      print.blank();

      if (errors === 0 && warnings === 0) {
        print.success('All checks passed');
      } else {
        if (errors > 0) print.error(`${errors} error${errors > 1 ? 's' : ''}`);
        if (warnings > 0) print.warn(`${warnings} warning${warnings > 1 ? 's' : ''}`);
        if (errors > 0) process.exit(1);
      }

      print.blank();
    });
}
