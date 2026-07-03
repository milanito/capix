import { Command } from 'commander';
import * as print from '../utils/print.js';
import { loadRegistry } from '../utils/loader.js';
import type { CapabilityRegistry } from '@capixjs/core';
import { effectiveIntent } from '../utils/intent.js';

type CapSnap = { intent: string; guards: number; hasInput: boolean; hasOutput: boolean };

function registrySnapshot(registry: CapabilityRegistry): Map<string, CapSnap> {
  const snap = new Map<string, CapSnap>();
  for (const [name, cap] of registry) {
    snap.set(name, {
      intent: effectiveIntent(name, cap),
      guards: cap.guards.length,
      hasInput: cap.inputSchema !== null,
      hasOutput: cap.outputSchema !== null,
    });
  }
  return snap;
}

export function registerDiff(program: Command): void {
  program
    .command('diff <config-a> <config-b>')
    .description('compare capabilities between two config files')
    .action(async (configA: string, configB: string) => {
      const [{ registry: regA }, { registry: regB }] = await Promise.all([
        loadRegistry(configA),
        loadRegistry(configB),
      ]);

      const snapA = registrySnapshot(regA);
      const snapB = registrySnapshot(regB);

      const added: string[] = [];
      const removed: string[] = [];
      const changed: Array<[string, string]> = [];

      for (const [name] of snapB) {
        if (!snapA.has(name)) added.push(name);
      }
      for (const [name] of snapA) {
        if (!snapB.has(name)) removed.push(name);
      }
      for (const [name, a] of snapA) {
        const b = snapB.get(name);
        if (!b) continue;
        const diffs: string[] = [];
        if (a.intent !== b.intent) diffs.push(`intent: ${a.intent} → ${b.intent}`);
        if (a.guards !== b.guards) diffs.push(`guards: ${a.guards} → ${b.guards}`);
        if (a.hasInput !== b.hasInput) diffs.push(`input: ${a.hasInput} → ${b.hasInput}`);
        if (a.hasOutput !== b.hasOutput) diffs.push(`output: ${a.hasOutput} → ${b.hasOutput}`);
        if (diffs.length > 0) changed.push([name, diffs.join(', ')]);
      }

      if (added.length === 0 && removed.length === 0 && changed.length === 0) {
        print.success('No differences found');
        return;
      }

      if (added.length > 0) {
        print.header('Added');
        for (const name of added) print.item(`+ ${name}`);
      }
      if (removed.length > 0) {
        print.header('Removed');
        for (const name of removed) print.item(`- ${name}`);
      }
      if (changed.length > 0) {
        print.header('Changed');
        for (const [name, desc] of changed) print.item(name, desc);
      }
      print.blank();
    });
}
