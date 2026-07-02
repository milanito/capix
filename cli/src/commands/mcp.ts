import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import { createExecutionEngine, defineContext } from '@capixjs/core';
import { mcpTransport } from '@capixjs/transport-mcp';

type McpCommandOptions = {
  config?: string;
  port?: string;
  name: string;
  apiVersion: string;
};

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('serve capabilities as MCP tools (stdio by default, HTTP with --port)')
    .option('--config <path>', 'path to capabilities file')
    .option('--port <port>', 'serve MCP over Streamable HTTP on this port instead of stdio')
    .option('--name <name>', 'MCP server name', 'capix')
    .option('--api-version <version>', 'MCP server version string', '0.1.0')
    .action(async (opts: McpCommandOptions) => {
      const port = opts.port !== undefined ? Number(opts.port) : undefined;
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        print.fatal(`Invalid --port '${opts.port}'. Expected an integer between 0 and 65535.`);
      }

      const { registry } = await loadRegistry(opts.config);

      // Minimal stub context — same as `capix call`. Apps that need real
      // context (auth, db) should mount mcpTransport in their own server.
      const buildContext = defineContext(async (_req) => ({ requestId: 'cli-mcp' }));
      const invoke = createExecutionEngine({ registry, buildContext, isDevelopment: true });

      const transport = mcpTransport({
        name: opts.name,
        version: opts.apiVersion,
        ...(port !== undefined ? { port } : {}),
      });

      await transport.mount(invoke, { registry, invoke });

      // stdio: stdout belongs to the protocol; the transport logs to stderr.
      // Keep the process alive until the client disconnects or SIGINT.
      const shutdown = async (): Promise<void> => {
        await transport.unmount();
        process.exit(0);
      };
      process.on('SIGINT', () => void shutdown());
      process.on('SIGTERM', () => void shutdown());
    });
}
