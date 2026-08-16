import type { SegmentRef, WorkflowBuilder } from '@shware/workflow';
import type {
  MetricPoint,
  Profile,
  ProfilePage,
  SegmentReport,
  StatsSource,
  WorkflowReport,
} from '@shware/workflow-ui/config';
import { activationNudge, checkoutRecovery, christmasPromo, onboarding } from './workflows/index';
import { onboardingEdu } from './workflows/onboarding';
import * as reengagementModule from './workflows/reengagement';
import { reengagement } from './workflows/reengagement';
import * as segmentModule from './workflows/segments';
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

/**
 * Segment sizes drift rather than wobble: membership is a population, so it
 * trends instead of jumping day to day the way a send count does.
 */
const segmentReportFor = (name: string): SegmentReport => {
  const base = 400 + pseudoRandom(name, 12_000);
  const drift = (pseudoRandom(`${name}:drift`, 60) - 25) / 100;
  const series = dates.map((date, index) => {
    const progress = index / (DAYS - 1);
    const noise = 0.98 + pseudoRandom(`${name}:${date}`, 5) / 100;
    return Math.round(base * (1 + drift * progress) * noise);
  });
  return { name, size: series.at(-1) ?? base, series };
};

/** A segment is named but has no builder's toIR. */
const isSegment = (value: unknown): value is SegmentRef =>
  typeof value === 'object' && value !== null && 'name' in value && !('toIR' in value);

/*
 * Every segment the studio discovers, from the modules that declare them. The
 * studio itself scans the whole workflows directory; a real stats API would
 * return whatever it tracks and the UI would match by name, so this list only
 * has to cover the demo. flatMap, not filter+map: the guard narrows inline,
 * where filter's overload cannot against this union.
 */
const SEGMENT_NAMES = [segmentModule, reengagementModule].flatMap((module) =>
  Object.values(module).flatMap((value) => (isSegment(value) ? [value.name] : []))
);

/* A stable cast of fake people, so paging through them is not a slideshow. */
const FIRST = ['ava', 'noah', 'mia', 'liam', 'zoe', 'kai', 'iris', 'omar', 'lena', 'raj'];
const LAST = ['chen', 'silva', 'novak', 'okafor', 'muller', 'tanaka', 'diaz', 'ahmed'];
const PLANS = ['free', 'pro', 'business'];

const profileFor = (segmentName: string, index: number): Profile => {
  const seed = `${segmentName}:${index}`;
  const first = FIRST[pseudoRandom(`${seed}:f`, FIRST.length)] ?? 'ava';
  const last = LAST[pseudoRandom(`${seed}:l`, LAST.length)] ?? 'chen';
  const created = new Date();
  created.setDate(created.getDate() - pseudoRandom(`${seed}:age`, 720));

  return {
    id: `usr_${pseudoRandom(seed, 0xffffff).toString(16).padStart(6, '0')}`,
    email: `${first}.${last}${index}@example.com`,
    createdAt: created.toISOString(),
    properties: {
      first_name: first,
      last_name: last,
      subscription_plan: PLANS[pseudoRandom(`${seed}:plan`, PLANS.length)] ?? 'free',
      subscription_status: pseudoRandom(`${seed}:status`, 10) > 2 ? 'active' : 'cancelled',
      auto_renew_enabled: pseudoRandom(`${seed}:renew`, 10) > 3,
      docs_created: pseudoRandom(`${seed}:docs`, 240),
      last_seen_at: new Date(Date.now() - pseudoRandom(`${seed}:seen`, 30) * 86_400_000)
        .toISOString()
        .slice(0, 10),
      country: ['US', 'DE', 'JP', 'BR', 'NG'][pseudoRandom(`${seed}:cc`, 5)] ?? 'US',
      marketing_opt_in: pseudoRandom(`${seed}:opt`, 10) > 4,
    },
  };
};

export const demoStats: StatsSource = {
  segments: (): SegmentReport[] => SEGMENT_NAMES.map(segmentReportFor),
  profiles: (segmentName, { limit, offset }): ProfilePage => {
    const total = segmentReportFor(segmentName).size;
    const count = Math.max(0, Math.min(limit, total - offset));
    return {
      total,
      profiles: Array.from({ length: count }, (_, i) => profileFor(segmentName, offset + i)),
    };
  },
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
