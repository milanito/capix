/**
 * transport.ts — MCP transport for Capix.
 *
 * Two modes:
 *   - stdio: the process becomes an MCP server over stdin/stdout. For local
 *     use with MCP clients (Claude Code, editors). Diagnostics go to stderr —
 *     stdout belongs to the protocol.
 *   - http: serves the MCP Streamable HTTP transport (stateless) on a port,
 *     mountable alongside the other Capix transports. Request headers are
 *     forwarded to the context builder like on the REST transport.
 *
 * Mode is inferred: pass `port` for http, omit it for stdio.
 */

import * as http from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { closeHttpServerGracefully } from '@capixjs/core';
import type { Transport, MountOptions, InvokeFn, GroupTree, TransportWithCapabilities } from '@capixjs/core';
import { buildMcpServer } from './server-builder.js';
import type { McpServerOptions } from './server-builder.js';

/**
 * The SDK's transport classes declare `onclose: (() => void) | undefined`
 * while its Transport interface declares `onclose?: () => void` — not
 * assignable under exactOptionalPropertyTypes. Runtime shape is identical.
 */
type SdkTransport = Parameters<Server['connect']>[0];

export type McpTransportOptions = McpServerOptions & {
  /** Listen port. When set, serves Streamable HTTP; when omitted, serves stdio. */
  readonly port?: number;
  readonly host?: string;
  /** URL path for the MCP endpoint in http mode. Default: '/mcp'. */
  readonly path?: string;
  /** Capability registry for this transport only. Overrides the server-level default. */
  readonly capabilities?: GroupTree;
  /**
   * How long unmount() waits for in-flight requests before force-closing
   * their connections in http mode, in milliseconds. Default: 10_000.
   */
  readonly shutdownTimeoutMs?: number;
};

export function mcpTransport(options: McpTransportOptions = {}): TransportWithCapabilities {
  const isHttp = options.port !== undefined;
  const mcpPath = options.path ?? '/mcp';

  let httpServer: http.Server | null = null;
  let stdioServer: Server | null = null;

  const serverOptions: McpServerOptions = {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  };

  return {
    ...(options.capabilities !== undefined ? { _capabilities: options.capabilities } : {}),

    async mount(invoke: InvokeFn, mountOptions: MountOptions): Promise<void> {
      if (!isHttp) {
        // stdio — single long-lived server bound to this process's stdin/stdout
        stdioServer = buildMcpServer(mountOptions.registry, invoke, serverOptions);
        const transport = new StdioServerTransport();
        await stdioServer.connect(transport as unknown as SdkTransport);
        console.error('[capix:mcp] serving MCP over stdio');
        return;
      }

      // http — stateless Streamable HTTP: a fresh Server + transport pair per
      // request, so concurrent clients never share JSON-RPC id space.
      const handler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
        const pathname = (req.url ?? '/').split('?')[0] ?? '';
        if (pathname !== mcpPath && pathname !== `${mcpPath}/`) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end('{"error":"NotFound","message":"MCP endpoint is ' + mcpPath + '"}');
          return;
        }

        const server = buildMcpServer(mountOptions.registry, invoke, serverOptions);
        // No sessionIdGenerator — stateless mode, one transport per request.
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });

        server
          .connect(transport as unknown as SdkTransport)
          .then(() => transport.handleRequest(req, res))
          .catch((err: unknown) => {
            console.error('[capix:mcp] Handler error:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end('{"error":"Internal","message":"Internal server error"}');
            }
          });
      };

      console.log('\nCapix MCP transport starting...');
      console.log(`  ✓ MCP (Streamable HTTP)  http://localhost:${options.port}${mcpPath}`);

      return new Promise((resolve, reject) => {
        httpServer = http.createServer(handler);
        httpServer.on('error', reject);
        httpServer.listen(options.port, options.host ?? '0.0.0.0', () => resolve());
      });
    },

    async unmount(): Promise<void> {
      if (stdioServer !== null) {
        await stdioServer.close();
        stdioServer = null;
      }
      if (!httpServer) return;
      const s = httpServer;
      httpServer = null;
      await closeHttpServerGracefully(s, options.shutdownTimeoutMs ?? 10_000);
    },
  };
}
