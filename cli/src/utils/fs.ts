import * as fs from 'node:fs';
import * as path from 'node:path';

export function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function readJsonFile<T>(p: string): T {
  const content = fs.readFileSync(p, 'utf8');
  return JSON.parse(content) as T;
}

export function writeFile(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function findProjectRoot(from: string = process.cwd()): string | null {
  let dir = path.resolve(from);
  while (true) {
    if (fileExists(path.join(dir, 'package.json'))) {
      const pkg = readJsonFile<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(
        path.join(dir, 'package.json'),
      );
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('capix' in deps) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
