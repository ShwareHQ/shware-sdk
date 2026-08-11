import { type WorkflowReport, defineConfig } from '@shware/workflow-ui/config';
import * as examples from '@shware/workflow/examples';
import { emails } from './src/emails';

/**
 * What `pnpm dev` (i.e. `workflow-ui`) reads.
 *
 * Everything the studio shows is listed here explicitly — no directory
 * scanning, no naming conventions.
 */

const workflows = {
  checkoutRecovery: examples.checkoutRecovery,
  onboardingEdu: examples.onboardingEdu,
  winback: examples.winback,
  reengagement: examples.reengagement,
  onboarding: examples.onboarding,
  christmasPromo: examples.christmasPromo,
  activationNudge: examples.activationNudge,
};

/**
 * Stand-in for a real engine: deterministic numbers derived from the workflow
 * name, so the reports and badges have something to render. A real project
 * points these at its stats API (Analytics Engine, D1, …).
 */
const pseudoRandom = (seed: string, max: number) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % max;
};

export default defineConfig({
  title: 'Workflow Studio · demo',
  workflows,
  emails,
  stats: {
    reports: (): WorkflowReport[] =>
      Object.values(workflows).map((builder) => {
        const { name } = builder.toIR();
        const entered = 2_000 + pseudoRandom(name, 8_000);
        const active = pseudoRandom(`${name}:active`, Math.floor(entered / 4));
        const completed = entered - active;
        return {
          name,
          entered,
          active,
          completed,
          converted: Math.floor(completed * (0.08 + pseudoRandom(`${name}:cvr`, 20) / 100)),
        };
      }),
    nodeStats: (workflowName) => {
      const builder = Object.values(workflows).find((w) => w.toIR().name === workflowName);
      if (!builder) return {};
      const stats: Record<string, number> = {};
      const walk = (nodes: ReturnType<typeof builder.toIR>['flow']) => {
        for (const node of nodes) {
          if (node.type === 'delay' || node.type === 'random_delay' || node.type === 'wait_until') {
            stats[node.id] = pseudoRandom(`${workflowName}:${node.id}`, 500);
          }
          if (node.type === 'branch') {
            for (const branchCase of node.cases) walk(branchCase.flow);
            if (node.otherwise) walk(node.otherwise);
          }
          if (node.type === 'cohort') for (const arm of node.arms) walk(arm.flow);
        }
      };
      walk(builder.toIR().flow);
      return stats;
    },
  },
});
