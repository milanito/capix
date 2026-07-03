import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { cliVersion } from './version.js';

describe('cliVersion', () => {
  it('matches the package.json version', () => {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version: string };
    expect(cliVersion()).toBe(pkg.version);
  });

  it('is a semver string, not a stale hardcoded value', () => {
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
