/**
 * http-shutdown.ts — graceful HTTP server close shared by the HTTP transports.
 *
 * `server.close()` alone is not a shutdown: it stops accepting connections but
 * waits forever for keep-alive sockets, and gives in-flight requests unlimited
 * time. This helper implements the standard drain sequence.
 */

import type * as http from 'node:http';

/**
 * Gracefully closes an HTTP server:
 *
 * 1. stop accepting new connections
 * 2. drop idle keep-alive sockets immediately (they hold nothing in flight)
 * 3. give in-flight requests `drainMs` to finish
 * 4. force-close whatever is still open
 *
 * Resolves when the server has fully closed. Extension-author API — custom
 * HTTP transports should use this in `unmount()`.
 */
export function closeHttpServerGracefully(server: http.Server, drainMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // unref: an armed drain timer must not keep the process alive on its own
    const timer = setTimeout(() => server.closeAllConnections(), drainMs);
    timer.unref();

    server.close((err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    });

    // Idle keep-alive connections would otherwise block close() indefinitely
    server.closeIdleConnections();
  });
}
