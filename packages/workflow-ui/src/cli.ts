#!/usr/bin/env node
import { startStudio } from './server';

/**
 * `workflow-ui` — start the studio over the workflows defined in this project.
 *
 *   npx workflow-ui              # reads ./workflow.config.ts
 *   npx workflow-ui --port 5000
 *   npx workflow-ui --config apps/marketing/workflow.config.ts
 */

interface Args {
  port?: number;
  config?: string;
  open: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--open') args.open = true;
    else if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]);
    else if (arg === '--config' || arg === '-c') args.config = argv[++i];
  }
  return args;
}

const HELP = `
  workflow-ui — review your workflows, templates and reports

  Usage
    $ workflow-ui [dev] [options]

  Options
    -p, --port <port>    Port to listen on (default 4321)
    -c, --config <path>  Config file (default ./workflow.config.ts)
        --open           Open the browser on start
    -h, --help           Show this message
`;

async function main(): Promise<void> {
  // `dev` is accepted so the command reads well, but it is the only mode today
  const argv = process.argv.slice(2).filter((arg) => arg !== 'dev');
  const args = parseArgs(argv);

  if (args.help) {
    console.log(HELP);
    return;
  }

  try {
    const server = await startStudio({
      ...(args.port !== undefined ? { port: args.port } : {}),
      ...(args.config !== undefined ? { config: args.config } : {}),
      open: args.open,
    });
    const address = server.resolvedUrls?.local[0] ?? `http://localhost:${args.port ?? 4321}`;
    console.log(`\n  workflow-ui ready at ${address}\n`);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
