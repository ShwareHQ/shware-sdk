#!/usr/bin/env node
import { generateSchema } from './generate';
import { startStudio } from './server';

/**
 * `workflow-ui` — start the studio over the project in ./workflow.config.ts.
 *
 *   npx workflow-ui              # reads ./workflow.config.ts (and ./workflow.stats.ts)
 *   npx workflow-ui --port 5000
 *   npx workflow-ui --config apps/marketing/workflow.config.ts
 *   npx workflow-ui generate --out ../../packages/db/src/schema/workflow.ts [--check]
 */

interface Args {
  port?: number;
  config?: string;
  stats?: string;
  out?: string;
  check: boolean;
  open: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { open: false, check: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--open') args.open = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--out' || arg === '-o') args.out = argv[++i];
    else if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]);
    else if (arg === '--config' || arg === '-c') args.config = argv[++i];
    else if (arg === '--stats' || arg === '-s') args.stats = argv[++i];
  }
  return args;
}

const HELP = `
  workflow-ui — review your workflows, templates and reports

  Usage
    $ workflow-ui [dev] [options]
    $ workflow-ui generate --out <file> [--check] [--config <path>]

  Options
    -p, --port <port>    Port to listen on (default 4321)
    -c, --config <path>  Project file (default ./workflow.config.ts)
    -s, --stats <path>   Stats source (default ./workflow.stats.ts, if present)
        --open           Open the browser on start
    -o, --out <file>     generate: where the drizzle schema file goes
        --check          generate: fail when the file is out of date, write nothing
    -h, --help           Show this message
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'generate') {
    const args = parseArgs(rest);
    if (args.help || args.out === undefined) {
      console.log(HELP);
      if (args.out === undefined && !args.help) process.exitCode = 1;
      return;
    }
    try {
      const result = await generateSchema({
        out: args.out,
        check: args.check,
        ...(args.config !== undefined ? { config: args.config } : {}),
      });
      if (result === 'outdated') {
        console.error(
          `\n  ${args.out} is out of date — run workflow-ui generate, then your migration tool\n`
        );
        process.exitCode = 1;
      } else {
        console.log(`\n  ${args.out} ${result === 'written' ? 'written' : 'is up to date'}\n`);
      }
    } catch (error) {
      console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  // `dev` is accepted so the command reads well; the studio is the default mode
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
      ...(args.stats !== undefined ? { stats: args.stats } : {}),
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
