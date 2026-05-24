import { spawn } from 'node:child_process';
import { Command } from 'commander';
import * as print from '../utils/print.js';
import { fileExists } from '../utils/fs.js';
import * as path from 'node:path';

export function registerDev(program: Command): void {
  program
    .command('dev [entry]')
    .description('start development server with file watching (uses tsx)')
    .option('--port <port>', 'override port (sets PORT env var)')
    .action((entry: string | undefined, opts: { port?: string }) => {
      const entryFile = entry ?? 'src/server.ts';
      const abs = path.resolve(process.cwd(), entryFile);

      if (!fileExists(abs)) {
        print.fatal(`Entry file not found: ${entryFile}`);
      }

      const env = { ...process.env };
      if (opts.port) env['PORT'] = opts.port;

      print.info(`Starting dev server: ${entryFile}`);
      print.dim('  tsx watch ' + entryFile);
      print.blank();

      const child = spawn('npx', ['tsx', 'watch', entryFile], {
        stdio: 'inherit',
        env,
        shell: false,
      });

      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          print.fatal('tsx not found. Install it: npm install -D tsx');
        }
        print.fatal(`Failed to start: ${err.message}`);
      });

      process.on('SIGINT', () => {
        child.kill('SIGINT');
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        child.kill('SIGTERM');
        process.exit(0);
      });
    });
}
