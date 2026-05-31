/**
 * Loads a Capix capabilities tree from a dedicated export file.
 *
 * The file should export its capabilities as named exports or a default export
 * of a GroupTree. It must NOT call server.start() — keep that in server.ts.
 *
 * Convention (checked in order):
 *   src/capabilities/index.ts  — directory structure (common for larger projects)
 *   src/capabilities.ts        — single file (scaffold default)
 *   capabilities/index.ts      — without src/ prefix
 *   capabilities.ts            — without src/ prefix
 *   src/server.ts              — imports capabilities and starts the server
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { GroupTree } from '@capixjs/core';
import { compileRegistry, isCapability } from '@capixjs/core';
import type { CapabilityRegistry } from '@capixjs/core';
import * as print from './print.js';

// Register tsx so subsequent dynamic imports can resolve TypeScript source files.
// This is a no-op when the file is already compiled JS.
import { register } from 'tsx/esm/api';
register();

export type LoadedRegistry = {
  registry: CapabilityRegistry;
};

const CAPABILITY_CANDIDATES = [
  'src/capabilities/index.ts',
  'src/capabilities.ts',
  'capabilities/index.ts',
  'capabilities.ts',
];

/**
 * Searches common locations for a capabilities file, returning the first found path.
 * Returns null if none is found.
 */
export function findCapabilitiesFile(cwd: string): string | null {
  for (const candidate of CAPABILITY_CANDIDATES) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      return candidate;
    }
  }
  return null;
}

export async function loadRegistry(configPath?: string): Promise<LoadedRegistry> {
  let resolvedConfig = configPath;
  if (!resolvedConfig) {
    const found = findCapabilitiesFile(process.cwd());
    if (!found) {
      print.fatal(
        `[capix] Could not find capabilities file. Checked:\n` +
        CAPABILITY_CANDIDATES.map((c) => `  - ${c}`).join('\n') +
        `\n\nRun this command from your project root, or specify the path:\n` +
        `  capix list --config src/my-capabilities.ts`,
      );
    }
    resolvedConfig = found!;
  }
  const abs = path.resolve(process.cwd(), resolvedConfig);
  let mod: unknown;

  try {
    mod = await import(abs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    print.fatal(`Failed to load ${resolvedConfig}: ${msg}`);
  }

  const m = mod as Record<string, unknown>;

  // 1. Named export `capabilities` (e.g. `export const capabilities = { ... }`)
  if ('capabilities' in m && typeof m['capabilities'] === 'object') {
    const caps = m['capabilities'] as GroupTree;
    if (isGroupTree(caps)) {
      return { registry: compileRegistry(caps) };
    }
  }

  // 2. Default export that is a GroupTree
  if ('default' in m && typeof m['default'] === 'object' && m['default'] !== null) {
    const def = m['default'] as GroupTree;
    if (isGroupTree(def)) {
      return { registry: compileRegistry(def) };
    }
  }

  // 3. Treat entire module namespace as GroupTree (each named export is a group or cap)
  const allExports: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === 'default') continue;
    allExports[k] = v;
  }
  if (Object.keys(allExports).length > 0 && isGroupTree(allExports as GroupTree)) {
    return { registry: compileRegistry(allExports as GroupTree) };
  }

  print.fatal(
    `${resolvedConfig} does not export a Capix GroupTree.\n` +
    `  Expected: export const capabilities = { group: { capability } }\n` +
    `  Or:       export default { group: { capability } }`,
  );
}

function isGroupTree(val: unknown): val is GroupTree {
  if (typeof val !== 'object' || val === null) return false;
  const entries = Object.entries(val as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([, v]) => isCapability(v) || isGroupTree(v));
}
