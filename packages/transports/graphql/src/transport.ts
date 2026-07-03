/**
 * transport.ts — GraphQL transport using graphql-http (spec-compliant).
 *
 * Serves a GraphQL endpoint and an optional GraphiQL playground.
 * Forwards request headers to capability resolvers via context.
 */

import * as http from 'node:http';
import { createHandler } from 'graphql-http/lib/use/node';
import { buildGraphQLSchema } from './schema-builder.js';
import { closeHttpServerGracefully } from '@capixjs/core';
import type { Transport, MountOptions, InvokeFn, GroupTree, TransportWithCapabilities } from '@capixjs/core';

export type GraphQLTransportOptions = {
  readonly port: number;
  readonly host?: string;
  /** URL path for the GraphQL endpoint. Default: '/graphql' */
  readonly path?: string;
  /**
   * Serve a GraphiQL playground at `{path}/playground`. Default: true.
   * Set to false to disable in production.
   */
  readonly playground?: boolean;
  /** Capability registry for this transport only. Overrides the server-level default. */
  readonly capabilities?: GroupTree;
  /**
   * How long unmount() waits for in-flight requests before force-closing
   * their connections, in milliseconds. Default: 10_000.
   */
  readonly shutdownTimeoutMs?: number;
};

function playgroundHtml(endpoint: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Capix GraphQL Playground</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql/graphiql.min.css" />
  <style>body { margin: 0; } #graphiql { height: 100vh; }</style>
</head>
<body>
  <div id="graphiql"></div>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/graphiql/graphiql.min.js"></script>
  <script>
    const root = ReactDOM.createRoot(document.getElementById('graphiql'));
    root.render(React.createElement(GraphiQL, {
      fetcher: GraphiQL.createFetcher({ url: '${endpoint}' }),
      defaultEditorToolsVisibility: true,
    }));
  </script>
</body>
</html>`;
}

export function graphqlTransport(options: GraphQLTransportOptions): TransportWithCapabilities {
  let server: http.Server | null = null;

  const gqlPath = options.path ?? '/graphql';
  const playPath = `${gqlPath}/playground`;
  const showPlayground = options.playground !== false;

  return {
    ...(options.capabilities !== undefined ? { _capabilities: options.capabilities } : {}),

    async mount(invoke: InvokeFn, mountOptions: MountOptions): Promise<void> {
      const schema = buildGraphQLSchema(mountOptions.registry, invoke);

      const gqlHandler = createHandler({
        schema,
        context: (req) => {
          const rawHeaders = req.raw.headers;
          const headers: Record<string, string> = {};
          for (const [key, val] of Object.entries(rawHeaders)) {
            if (val !== undefined) {
              headers[key] = Array.isArray(val) ? val.join(', ') : val;
            }
          }
          return { headers };
        },
      });

      function httpHandler(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = req.url ?? '/';
        const pathname = url.split('?')[0] ?? '';

        if (showPlayground && pathname === playPath) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(playgroundHtml(gqlPath));
          return;
        }

        if (pathname === gqlPath || pathname === `${gqlPath}/`) {
          gqlHandler(req, res).catch((err: unknown) => {
            console.error('[capix:graphql] Handler error:', err);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end('Internal error');
            }
          });
          return;
        }

        res.writeHead(404);
        res.end();
      }

      console.log('\nCapix GraphQL transport starting...');
      console.log(`  ✓ GraphQL    http://localhost:${options.port}${gqlPath}`);
      if (showPlayground) {
        console.log(`  ✓ Playground http://localhost:${options.port}${playPath}`);
      }

      return new Promise((resolve, reject) => {
        server = http.createServer(httpHandler);
        server.on('error', reject);
        server.listen(options.port, options.host ?? '0.0.0.0', () => resolve());
      });
    },

    async unmount(): Promise<void> {
      if (!server) return;
      const s = server;
      server = null;
      await closeHttpServerGracefully(s, options.shutdownTimeoutMs ?? 10_000);
    },
  };
}
