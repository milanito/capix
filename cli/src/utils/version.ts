import { createRequire } from 'node:module';

/**
 * The CLI's own package version, read from package.json at runtime so
 * `capix --version` always matches the published package.
 */
export function cliVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../../package.json') as { version: string };
  return pkg.version;
}
