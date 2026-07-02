import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { generateOpenAPI } from '@capixjs/transport-rest';
import type { OpenAPIOptions } from '@capixjs/transport-rest';

type OpenapiCommandOptions = {
  config?: string;
  output?: string;
  title: string;
  apiVersion: string;
  description?: string;
  server?: string;
  urlCase?: string;
};

export function registerOpenapi(program: Command): void {
  program
    .command('openapi')
    .description('generate an OpenAPI 3.1 spec from capabilities')
    .option('--config <path>', 'path to capabilities file')
    .option('--output <file>', 'write the spec to a file instead of stdout')
    .option('--title <title>', 'API title', 'Capix API')
    .option('--api-version <version>', 'API version string', '0.1.0')
    .option('--description <text>', 'API description')
    .option('--server <url>', 'server URL to include in the spec')
    .option('--url-case <case>', 'URL segment case: kebab | camel | snake (must match restTransport)')
    .action(async (opts: OpenapiCommandOptions) => {
      if (opts.urlCase !== undefined && !['kebab', 'camel', 'snake'].includes(opts.urlCase)) {
        print.fatal(`Invalid --url-case '${opts.urlCase}'. Expected kebab, camel, or snake.`);
      }

      const { registry } = await loadRegistry(opts.config);

      const options: OpenAPIOptions = {
        title: opts.title,
        version: opts.apiVersion,
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(opts.server !== undefined ? { servers: [{ url: opts.server }] } : {}),
        ...(opts.urlCase !== undefined
          ? { urlCase: opts.urlCase as 'kebab' | 'camel' | 'snake' }
          : {}),
      };

      const json = JSON.stringify(generateOpenAPI(registry, options), null, 2);

      if (opts.output !== undefined) {
        const { writeFile } = await import('../utils/fs.js');
        writeFile(opts.output, json + '\n');
        print.success(`OpenAPI spec written to ${opts.output}`);
      } else {
        console.log(json);
      }
    });
}
