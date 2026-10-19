import type { NodeIR, WorkflowIR } from '../ir';

/**
 * The longest an instance of a workflow can live, from its IR: every delay at its longest, every
 * wait to its timeout, a time window as a full week (the furthest the next allowed slot can be),
 * the longest arm of a branch or cohort — and at least the goal's window, which keeps an instance
 * watching after its last step. Message, action and event steps count as instant. A runtime that
 * caps an instance's lifetime (a Lambda durable execution's `ExecutionTimeout`) checks its
 * workflows against it, rather than finding out when the platform stops one midway.
 */

const WEEK_MS = 7 * 24 * 3_600_000;

function flowMs(nodes: readonly NodeIR[]): number {
  let total = 0;
  for (const node of nodes) total += nodeMs(node);
  return total;
}

function nodeMs(node: NodeIR): number {
  switch (node.type) {
    case 'delay':
      return node.duration.ms;
    case 'random_delay':
      return Math.max(node.min.ms, node.max.ms);
    case 'time_window':
      return WEEK_MS;
    case 'wait_until':
      return node.timeout.ms + (Array.isArray(node.onTimeout) ? flowMs(node.onTimeout) : 0);
    case 'branch':
      return Math.max(
        flowMs(node.otherwise ?? []),
        ...node.cases.map((branch) => flowMs(branch.flow))
      );
    case 'cohort':
      return Math.max(0, ...node.arms.map((arm) => flowMs(arm.flow)));
    default:
      return 0;
  }
}

export function longestJourneyMs(ir: Pick<WorkflowIR, 'flow' | 'goal'>): number {
  return Math.max(flowMs(ir.flow), ir.goal?.within?.ms ?? 0);
}
