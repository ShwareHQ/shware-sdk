import { relative } from 'node:path';
import {
  type InFlightProblem,
  type JourneyConfig,
  type PinnedWorkflow,
  checkInFlight,
  compileConfig,
  describeInFlight,
  isConfig,
  pinnedWorkflows,
} from '@shware/workflow';
import { postgresJsStore } from '@shware/workflow/postgres-js';
import { runnerImport } from 'vite';
import { findConfig } from './server';

/**
 * `workflow-ui plan` — the deploy-time check, before the deploy: compiles the project and holds
 * the bundle, with the templates this code would serve, against the workflow versions journeys
 * are still running on in the database (`checkInFlight` in `@shware/workflow`). On Cloudflare a
 * new version's code serves the moment it is published, so the host's own refusal comes too late
 * to protect a running journey from a template change; CI runs this ahead of `wrangler deploy`
 * and stops on a non-zero exit.
 */

export interface PlanOptions {
  cwd?: string;
  config?: string;
  /** The engine's database, as `postgres` connects to it. */
  databaseUrl: string;
}

export interface PlanReport {
  /**
   * Every workflow version with running journeys; `carried` when this bundle still contains that
   * exact version (otherwise those journeys finish on theirs, and new ones enter the new version).
   */
  pinned: (PinnedWorkflow & { carried: boolean })[];
  /** What this bundle would take from them; empty when the deploy is safe. */
  problems: InFlightProblem[];
  /** What the database lacks against the SDK's tables: migrations to run before the deploy. */
  schema: string[];
}

export async function planDeploy(options: PlanOptions): Promise<PlanReport> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = findConfig(cwd, options.config);
  const { module } = await runnerImport<{ default?: unknown }>(configPath);
  if (!isConfig(module.default)) {
    throw new Error(
      `workflow-ui: ${relative(cwd, configPath)} must \`export default defineConfig({...})\``
    );
  }
  const config: JourneyConfig = module.default;
  const bundle = compileConfig(config);
  const schemaName = config.database?.schema;
  const { store, close } = postgresJsStore(
    options.databaseUrl,
    schemaName === undefined ? {} : { schema: schemaName }
  );
  try {
    const schema = await store.checkSchema();
    // Without the tables there are no journeys to keep; with columns missing, the pins still read
    const pinned = schema.some((problem) => problem.startsWith('table '))
      ? []
      : await pinnedWorkflows(store);
    const carried = new Set(bundle.workflows.map((w) => w.contentHash));
    return {
      pinned: pinned.map((pin) => ({
        workflow: pin.workflow,
        contentHash: pin.contentHash,
        running: pin.running,
        ir: pin.ir,
        carried: carried.has(pin.contentHash),
      })),
      problems: checkInFlight(pinned, bundle, config),
      schema,
    };
  } finally {
    await close();
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The report as the lines the CLI prints. */
export function formatPlan(report: PlanReport): string[] {
  const lines: string[] = [];
  const journeys = report.pinned.reduce((sum, pin) => sum + pin.running, 0);
  if (report.pinned.length === 0) {
    lines.push('no journey is running: nothing is pinned');
  } else {
    lines.push(
      `${plural(report.pinned.length, 'pinned version')}, ${plural(journeys, 'running journey')}:`
    );
    for (const pin of report.pinned) {
      const note = pin.carried
        ? ''
        : '  (finish on their version; this bundle changes the workflow)';
      lines.push(`  ${pin.workflow}@${pin.contentHash.slice(0, 8)}  ${pin.running} running${note}`);
    }
  }
  if (report.schema.length > 0) {
    lines.push('the database lacks (run the migrations before deploying):');
    for (const problem of report.schema) lines.push(`  ${problem}`);
  }
  if (report.problems.length === 0) {
    lines.push('this bundle keeps every running journey: safe to deploy');
  } else {
    lines.push('this bundle would break running journeys:');
    for (const line of describeInFlight(report.problems)) lines.push(`  ${line}`);
    lines.push(
      'fix the bundle (keep the segment or action, give the template a new id, make the prop optional), or deploy with POST /bundle/deploy?force=1 to fail them'
    );
  }
  return lines;
}
