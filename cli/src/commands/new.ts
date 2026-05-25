import * as path from 'node:path';
import * as readline from 'node:readline';
import { Command } from 'commander';
import * as print from '../utils/print.js';
import { writeFile, fileExists } from '../utils/fs.js';
import {
  renderPackageJson,
  renderTsConfig,
  renderCapabilitiesTs,
  renderServerTs,
  renderGitignore,
  renderReadme,
  renderEnvExample,
  renderCursorRules,
} from '../templates/new-project.js';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptSelect(question: string, choices: string[]): Promise<string> {
  const labeled = choices.map((c, i) => `  ${i + 1}. ${c}`).join('\n');
  const raw = await prompt(`${question}\n${labeled}\n> `);
  const idx = parseInt(raw, 10) - 1;
  if (idx >= 0 && idx < choices.length) {
    const choice = choices[idx];
    if (choice !== undefined) return choice;
  }
  const first = choices[0];
  if (first === undefined) return '';
  return first;
}

export function registerNew(program: Command): void {
  program
    .command('new [name]')
    .description('scaffold a new Capix project')
    .option('--rest', 'use REST transport (default)')
    .option('--ws', 'use WebSocket transport')
    .option('--both', 'use both REST and WebSocket transports')
    .option('-y, --yes', 'skip prompts and use defaults')
    .action(async (nameArg: string | undefined, opts: { rest?: boolean; ws?: boolean; both?: boolean; yes?: boolean }) => {
      let name = nameArg;

      if (!name) {
        if (opts.yes) {
          name = 'my-capix-app';
        } else {
          name = await prompt('Project name: ');
          if (!name) name = 'my-capix-app';
        }
      }

      // Sanitize name
      name = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      let transport: 'rest' | 'ws' | 'both';
      if (opts.both) {
        transport = 'both';
      } else if (opts.ws) {
        transport = 'ws';
      } else if (opts.rest) {
        transport = 'rest';
      } else if (opts.yes) {
        transport = 'rest';
      } else {
        const choice = await promptSelect('Transport:', ['rest', 'ws', 'both']);
        transport = (choice as 'rest' | 'ws' | 'both') ?? 'rest';
      }

      const dir = path.resolve(process.cwd(), name);

      if (fileExists(dir)) {
        print.warn(`Directory ${name} already exists. Files may be overwritten.`);
      }

      print.header(`Creating ${name}`);

      const files: Array<[string, string]> = [
        ['package.json', renderPackageJson({ name, transport })],
        ['tsconfig.json', renderTsConfig()],
        ['src/capabilities.ts', renderCapabilitiesTs()],
        ['src/server.ts', renderServerTs({ name, transport })],
        ['.gitignore', renderGitignore()],
        ['.env.example', renderEnvExample()],
        ['README.md', renderReadme({ name, transport })],
        ['.cursor/rules', renderCursorRules()],
      ];

      for (const [rel, content] of files) {
        const abs = path.join(dir, rel);
        writeFile(abs, content);
        print.success(rel);
      }

      print.blank();
      print.info(`Next steps:`);
      print.item(`cd ${name}`);
      print.item('npm install  (or pnpm install)');
      print.item('npm run dev');
      print.blank();
    });
}
