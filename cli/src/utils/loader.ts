/**
 * Loads a Capix capabilities tree from a dedicated export file.
 *
 * The file should export its capabilities as named exports or a default export
 * of a GroupTree. It must NOT call server.start() — keep that in server.ts.
 *
 * Convention:
 *   src/capabilities.ts  — named exports or default GroupTree (default for CLI)
 *   src/server.ts        — imports capabilities and starts the server
 */
import * as path from 'node:path';
import type { GroupTree } from 'capix';
import { compileRegistry, isCapability } from 'capix';
import type { CapabilityRegistry } from 'capix';
import * as print from './print.js';

export type LoadedRegistry = {
  registry: CapabilityRegistry;
};

export async function loadRegistry(configPath: string): Promise<LoadedRegistry> {
  const abs = path.resolve(process.cwd(), configPath);
  let mod: unknown;

  try {
    mod = await import(abs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    print.fatal(`Failed to load ${configPath}: ${msg}`);
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
    `${configPath} does not export a Capix GroupTree.\n` +
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
