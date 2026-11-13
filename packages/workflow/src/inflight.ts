import { ConfigCompileError, type JourneyConfig, checkMessage, registryIndex } from './config';
import { referencedSegments } from './dsl/bundle';
import type { BundleIR, WorkflowIR } from './ir';
import { nodesOf } from './plan';
import type { JourneyStore } from './store/index';

/**
 * In-flight compatibility: what a deploy would take away from the journeys still running.
 *
 * A journey is pinned to the workflow IR it entered on and runs it to completion, but the IR only
 * *names* what it uses — a template by channel and key, a segment or an action by id — and those
 * are resolved at the moment of use against the deployed bundle and the code serving it. That is
 * the design (README "Versioning"): the latest content goes out, a segment is a live audience. It
 * leaves one way to break a running journey — a deploy that removes or reshapes something a
 * pinned IR still names — and these checks find it before the deploy, on the pinned IRs
 * themselves, against the bundle and registry that would serve them. A compatible change (a
 * reworded template, a new optional prop, a segment's condition) passes; an incompatible one (a
 * template gone or moved to another channel, a new required prop, a segment or action removed)
 * is reported with the journeys it would break.
 */

/** One pinned version of a workflow: the IR and how many journeys are running on it. */
export interface PinnedWorkflow {
  workflow: string;
  contentHash: string;
  /** Journeys with a `running` entry on this hash. */
  running: number;
  /** The stored IR; undefined when the store has no body for the hash (those journeys cannot run). */
  ir: WorkflowIR | undefined;
}

export interface InFlightProblem {
  workflow: string;
  contentHash: string;
  running: number;
  /** What the bundle would take away, as a sentence naming the node where there is one. */
  problem: string;
}

/** The pinned versions with running journeys, each with its stored IR. */
export async function pinnedWorkflows(
  store: Pick<JourneyStore, 'runningPins' | 'getWorkflowIR'>
): Promise<PinnedWorkflow[]> {
  const pins = await store.runningPins();
  return Promise.all(
    pins.map(async ({ workflow, contentHash, running }) => ({
      workflow,
      contentHash,
      running,
      ir: await store.getWorkflowIR(contentHash),
    }))
  );
}

/**
 * Every way `bundle` (and `config`'s registry, when given — the templates the code would then
 * serve) fails a pinned IR. Without a config only the bundle is checked: segments, actions, and
 * the template manifest when the bundle carries one. Empty when the deploy is safe.
 */
export function checkInFlight(
  pinned: readonly PinnedWorkflow[],
  bundle: BundleIR,
  config?: JourneyConfig
): InFlightProblem[] {
  const segments = new Set(bundle.segments.map((s) => s.id));
  const actions = new Set(bundle.actions.map((a) => a.name));
  const templates = new Set(bundle.templates.map((t) => `${t.channel}:${t.key}`));
  const index = config === undefined ? undefined : registryIndex(config);
  const problems: InFlightProblem[] = [];
  for (const pin of pinned) {
    const report = (problem: string) => {
      const { workflow, contentHash, running } = pin;
      problems.push({ workflow, contentHash, running, problem });
    };
    if (pin.ir === undefined) {
      report('its workflow body is not in the store');
      continue;
    }
    for (const segment of referencedSegments(pin.ir)) {
      if (!segments.has(segment)) report(`segment '${segment}' is not in the bundle`);
    }
    for (const node of nodesOf(pin.ir.flow)) {
      if (node.type === 'action' && !actions.has(node.action)) {
        report(`node ${node.id}: action '${node.action}' is not in the bundle`);
      }
      if (node.type !== 'message') continue;
      if (index !== undefined && config !== undefined) {
        try {
          checkMessage(pin.ir, node, index, config);
        } catch (error) {
          if (!(error instanceof ConfigCompileError)) throw error;
          report(error.message);
        }
      } else if (bundle.templates.length > 0) {
        const key = `${node.channel}:${node.template}`;
        if (!templates.has(key)) {
          report(
            `node ${node.id}: ${node.channel} template '${node.template}' is not in the bundle`
          );
        }
      }
    }
  }
  return problems;
}

/** The problems as lines, one per pinned version, with the journeys it carries. */
export function describeInFlight(problems: readonly InFlightProblem[]): string[] {
  const byPin = new Map<string, InFlightProblem[]>();
  for (const problem of problems) {
    const key = `${problem.workflow}@${problem.contentHash}`;
    byPin.set(key, [...(byPin.get(key) ?? []), problem]);
  }
  return [...byPin.values()].map((group) => {
    const [{ workflow, contentHash, running }] = group as [InFlightProblem, ...InFlightProblem[]];
    const journeys = `${running} running ${running === 1 ? 'journey' : 'journeys'}`;
    return `${workflow}@${contentHash.slice(0, 8)} (${journeys}): ${group.map((p) => p.problem).join('; ')}`;
  });
}
