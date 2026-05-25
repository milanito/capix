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
        stdio: ['inherit', 'pipe', 'pipe'],
        env,
        shell: false,
      });

      let serverUrlPrinted = false;

      function forwardOutput(data: Buffer): void {
        process.stdout.write(data);
        if (!serverUrlPrinted) {
          const text = data.toString();
          const portMatch = text.match(/(?:Listening|listening|port|PORT)[^\d]*(\d{3,5})/i);
          if (portMatch?.[1]) {
            const port = portMatch[1];
            serverUrlPrinted = true;
            print.blank();
            print.success(`Server running at http://localhost:${port}`);
            print.item('Press Ctrl+C to stop');
            print.blank();
          }
        }
      }

      child.stdout?.on('data', forwardOutput);
      child.stderr?.on('data', (data: Buffer) => process.stderr.write(data));

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
