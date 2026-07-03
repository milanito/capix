#!/usr/bin/env node
import { Command } from 'commander';
import { registerNew } from './commands/new.js';
import { registerGenerate } from './commands/generate.js';
import { registerDev } from './commands/dev.js';
import { registerList } from './commands/list.js';
import { registerShow } from './commands/show.js';
import { registerCall } from './commands/call.js';
import { registerCheck } from './commands/check.js';
import { registerDocs } from './commands/docs.js';
import { registerClient } from './commands/client.js';
import { registerOpenapi } from './commands/openapi.js';
import { registerMcp } from './commands/mcp.js';
import { registerDiff } from './commands/diff.js';
import { registerAiContext } from './commands/ai-context.js';
import { cliVersion } from './utils/version.js';

const program = new Command();

program
  .name('capix')
  .description('CLI for the Capix framework')
  .version(cliVersion());

registerNew(program);
registerGenerate(program);
registerDev(program);
registerList(program);
registerShow(program);
registerCall(program);
registerCheck(program);
registerDocs(program);
registerClient(program);
registerOpenapi(program);
registerMcp(program);
registerDiff(program);
registerAiContext(program);

program.parse(process.argv);
