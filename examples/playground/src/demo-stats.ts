import type { WorkflowBuilder } from '@shware/workflow';
import type { MetricPoint, StatsSource, WorkflowReport } from '@shware/workflow-ui/config';
import { activationNudge, checkoutRecovery, christmasPromo, onboarding } from './workflows/index';
import { onboardingEdu } from './workflows/onboarding';
import { reengagement } from './workflows/reengagement';
import { winback } from './workflows/winback';

/**
 * Stand-in for a real engine: deterministic numbers derived from the workflow
 * name, so the reports and badges have something to render. A real project
 * points the config's `stats` at its stats API (Analytics Engine, D1, …) —
 * and needs none of this file.
 */

const WORKFLOWS: WorkflowBuilder[] = [
  checkoutRecovery,
  onboardingEdu,
  winback,
  reengagement,
  onboarding,
  christmasPromo,
  activationNudge,
];

const pseudoRandom = (seed: string, max: number) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % max;
};

/** 30 days ending today, so the x axis reads like a real report. */
const DAYS = 30;
const dates = Array.from({ length: DAYS }, (_, index) => {
  const date = new Date();
  date.setDate(date.getDate() - (DAYS - 1 - index));
  return date.toISOString().slice(0, 10);
});

/** A gently wobbling series, funnel-shaped: delivered > opened > clicked > converted. */
const seriesFor = (seed: string, base: number) =>
  dates.map((date, index) => {
    const wobble = 0.75 + pseudoRandom(`${seed}:${date}`, 50) / 100;
    const trend = 1 + Math.sin((index / DAYS) * Math.PI * 2) * 0.15;
    return Math.round(base * wobble * trend);
  });

const metricsFor = (name: string): MetricPoint[] => {
  const delivered = seriesFor(`${name}:delivered`, 900);
  return dates.map((date, index) => {
    const sent = delivered[index] ?? 0;
    const opened = Math.round(sent * (0.32 + pseudoRandom(`${name}:o:${date}`, 18) / 100));
    const clicked = Math.round(opened * (0.18 + pseudoRandom(`${name}:c:${date}`, 14) / 100));
    const converted = Math.round(clicked * (0.12 + pseudoRandom(`${name}:v:${date}`, 16) / 100));
    return { date, delivered: sent, opened, clicked, converted };
  });
};

const reportFor = (name: string): WorkflowReport => {
  const points = metricsFor(name);
  const sum = (key: keyof Omit<MetricPoint, 'date'>) =>
    points.reduce((total, point) => total + point[key], 0);

  const entered = 2_000 + pseudoRandom(name, 8_000);
  const active = pseudoRandom(`${name}:active`, Math.floor(entered / 4));

  return {
    name,
    entered,
    active,
    completed: entered - active,
    delivered: sum('delivered'),
    opened: sum('opened'),
    clicked: sum('clicked'),
    converted: sum('converted'),
    /* The list draws sparklines from these; one point per day is plenty. */
    series: {
      delivered: points.map((point) => point.delivered),
      opened: points.map((point) => point.opened),
      clicked: points.map((point) => point.clicked),
      converted: points.map((point) => point.converted),
    },
  };
};

export const demoStats: StatsSource = {
  reports: (): WorkflowReport[] => WORKFLOWS.map((builder) => reportFor(builder.toIR().name)),
  metrics: (workflowName) => metricsFor(workflowName),
  nodeStats: (workflowName) => {
    const builder = WORKFLOWS.find((w) => w.toIR().name === workflowName);
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
};
