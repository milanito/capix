import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { createExecutionEngine } from 'capix';
import { defineContext } from 'capix';

export function registerCall(program: Command): void {
  program
    .command('call <capability> [input]')
    .description('invoke a capability directly (bypasses transport, uses minimal context)')
    .option('--config <path>', 'path to capabilities file')
    .option('--json', 'output raw JSON (no formatting)')
    .action(async (capName: string, inputArg: string | undefined, opts: { config: string; json?: boolean }) => {
      const { registry } = await loadRegistry(opts.config);

      const cap = registry.get(capName);
      if (!cap) {
        print.error(`Capability "${capName}" not found. Use "capix list" to see available capabilities.`);
        process.exit(1);
      }

      let input: unknown = {};
      if (inputArg) {
        try {
          input = JSON.parse(inputArg);
        } catch {
          print.fatal(`Invalid JSON input: ${inputArg}`);
        }
      }

      // Minimal stub context — enough for capabilities that only need requestId
      const buildContext = defineContext(async (_req) => ({ requestId: 'cli-call' }));

      const invoke = createExecutionEngine({
        registry,
        buildContext,
        isDevelopment: true,
      });

      const response = await invoke({
        capability: cap.name,
        input: input as Record<string, unknown>,
        headers: {},
        signal: AbortSignal.timeout(30_000),
      });

      if (opts.json) {
        if (response.ok) {
          try {
            console.log(JSON.stringify(response.data, null, 2));
          } catch {
            print.fatal(`Response data is not JSON-serializable`);
          }
        } else {
          console.error(JSON.stringify(response.error, null, 2));
          process.exit(1);
        }
        return;
      }

      if (response.ok) {
        print.success(`${capName}`);
        print.blank();
        try {
          console.log(JSON.stringify(response.data, null, 2));
        } catch {
          print.error(`Response data is not JSON-serializable`);
          print.item(String(response.data));
          print.blank();
          process.exit(1);
        }
      } else {
        const { status, error, message, meta } = response.error;
        print.error(`${status} ${error}: ${message}`);
        if (meta !== undefined) {
          print.blank();
          console.log(JSON.stringify(meta, null, 2));
        }
        process.exit(1);
      }
      print.blank();
    });
}
