import pc from 'picocolors';

export function info(msg: string): void {
  console.log(pc.cyan('ℹ') + '  ' + msg);
}

export function success(msg: string): void {
  console.log(pc.green('✓') + '  ' + msg);
}

export function warn(msg: string): void {
  console.log(pc.yellow('⚠') + '  ' + msg);
}

export function error(msg: string): void {
  console.error(pc.red('✗') + '  ' + msg);
}

export function dim(msg: string): string {
  return pc.dim(msg);
}

export function bold(msg: string): string {
  return pc.bold(msg);
}

export function header(msg: string): void {
  console.log('\n' + pc.bold(pc.cyan(msg)));
}

export function blank(): void {
  console.log('');
}

export function item(label: string, value?: string): void {
  if (value !== undefined) {
    console.log('  ' + pc.bold(label.padEnd(16)) + pc.dim(value));
  } else {
    console.log('  ' + label);
  }
}

export function table(rows: Array<[string, string, string?]>): void {
  const col0 = Math.max(...rows.map(([a]) => a.length));
  const col1 = Math.max(...rows.map(([, b]) => b.length));
  for (const [a, b, c] of rows) {
    const line = '  ' + a.padEnd(col0 + 2) + b.padEnd(col1 + 2) + (c ?? '');
    console.log(line);
  }
}

export function fatal(msg: string): never {
  error(msg);
  process.exit(1);
}
