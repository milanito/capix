import { resolveIntent } from '@capixjs/core';
import type { AnyCapability, Intent } from '@capixjs/core';

/** Effective intent for a registry entry: explicit wins, else inferred from the key name. */
export function effectiveIntent(dotPath: string, cap: AnyCapability): Intent {
  return resolveIntent(cap, dotPath.split('.').pop() ?? dotPath);
}
