import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateRoutes } from '@capixjs/transport-rest';
import { effectiveIntent } from '../utils/intent.js';

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('validate server config: duplicate routes, naming, schema issues')
    .option('--config <path>', 'path to capabilities file')
    .action(async (opts: { config: string }) => {
      const { registry } = await loadRegistry(opts.config);

      let errors = 0;
      let warnings = 0;

      print.header('Capix check');
      print.blank();

      // 1. Check for capabilities with no guards and no schema (may be unintentional)
      for (const [name, cap] of registry) {
        if (!cap.inputSchema && effectiveIntent(name, cap) !== 'query') {
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

      // 3. Detect scaffold placeholder resolvers
      const PLACEHOLDER_PATTERNS = [/not.?implemented/i, /TODO/i, /throw new Error\(['"]TODO/i];
      for (const [name, cap] of registry) {
        const src = cap.resolve.toString();
        if (PLACEHOLDER_PATTERNS.some((re) => re.test(src))) {
          print.warn(`${name}: resolver looks like a scaffold placeholder (not implemented)`);
          warnings++;
        }
      }

      // 4. Naming conventions
      for (const [name] of registry) {
        const parts = name.split('.');
        for (const part of parts) {
          if (!/^[a-z][a-zA-Z0-9]*$/.test(part)) {
            print.warn(`${name}: segment "${part}" should be camelCase`);
            warnings++;
          }
        }
      }

      // 5. Detect nested-resource patterns that may need a transport-level override
      // Keys like listProjectTasks, getProjectTask suggest /projects/:id/tasks hierarchy
      const NESTED_PATTERN = /^(list|get|create|update|delete|find|add|remove)[A-Z][a-z]+[A-Z]/;
      for (const [name, cap] of registry) {
        const key = name.split('.').pop() ?? name;
        if (NESTED_PATTERN.test(key)) {
          print.warn(
            `${name}: key "${key}" suggests a nested resource route.\n` +
            `  The inferred route may be unexpected. Consider adding an override to restTransport():\n` +
            `  overrides: { '${name}': { method: 'GET', path: '/resources/:resourceId/subresources' } }`,
          );
          warnings++;
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
