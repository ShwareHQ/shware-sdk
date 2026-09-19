import type { NodeIR, SegmentRef, WorkflowBuilder, WorkflowIR } from '@shware/workflow';
import type {
  Granularity,
  LinkStat,
  MessageStat,
  MetricChannel,
  MetricPoint,
  MetricsQuery,
  Profile,
  ProfilePage,
  SegmentReport,
  StatsRange,
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

/* ---------------------------------- Dates ---------------------------------- */

const DAY_MS = 86_400_000;

/** Local calendar day, not a UTC instant — see the note on the studio's isoDay. */
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;

const parseDay = (iso: string) => {
  const [year = 1970, month = 1, day = 1] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/** Every day in an inclusive range, oldest first. Capped: a decade of buckets helps nobody. */
const daysIn = ({ from, to }: StatsRange): string[] => {
  const start = parseDay(from);
  const end = parseDay(to);
  const count = Math.min(
    732,
    Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1)
  );
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return isoDay(date);
  });
};

/** Days since the epoch — a stable phase for the seasonal wobble, independent of the range. */
const dayIndex = (iso: string) => Math.round(parseDay(iso).getTime() / DAY_MS);

/** The bucket an ISO day falls into: itself, its Monday, or the first of its month. */
const bucketOf = (iso: string, granularity: Granularity): string => {
  if (granularity === 'day') return iso;
  const date = parseDay(iso);
  if (granularity === 'month') return `${iso.slice(0, 7)}-01`;
  /* getDay() is Sunday-first; shift so a week starts on Monday. */
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoDay(date);
};

/* --------------------------------- Channels -------------------------------- */

/**
 * Every channel carries traffic in the demo, weighted so email dominates the
 * way it does in a real project. A live stats API would only report channels
 * the workflow actually sends on; here an empty chart on every dropdown entry
 * but one would just look broken.
 */
const CHANNEL_WEIGHT: Record<MetricChannel, number> = {
  email: 1,
  push_ios: 0.42,
  push_android: 0.36,
  slack: 0.11,
  discord: 0.07,
  sms: 0.18,
  webhook: 0.05,
};

const CHANNELS = Object.keys(CHANNEL_WEIGHT) as MetricChannel[];

/**
 * Which analytics channel a message node reports under.
 *
 * The DSL's `push` is one node reaching two app stores; the demo pins each node
 * to one platform so a row has a stable channel. `in_app` and `survey` return
 * nothing on purpose: an in-product surface has no transport receipt, no open
 * pixel and no unsubscribe, so it has no row in a delivery funnel.
 */
function analyticsChannel(node: Extract<NodeIR, { type: 'message' }>): MetricChannel | undefined {
  switch (node.channel) {
    case 'email':
      return 'email';
    case 'sms':
      return 'sms';
    case 'slack':
      return 'slack';
    case 'push':
      return pseudoRandom(`${node.id}:platform`, 2) === 0 ? 'push_ios' : 'push_android';
    default:
      return undefined;
  }
}

/* -------------------------------- Time series ------------------------------- */

const EMPTY_POINT = (date: string): MetricPoint => ({
  date,
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  converted: 0,
});

/** One channel's funnel for one day: a wobble on a slow seasonal trend. */
function dailyPoint(name: string, channel: MetricChannel, date: string): MetricPoint {
  const seed = `${name}:${channel}:${date}`;
  const wobble = 0.75 + pseudoRandom(`${seed}:w`, 50) / 100;
  const trend = 1 + Math.sin((dayIndex(date) / 30) * Math.PI * 2) * 0.15;
  const sent = Math.round(900 * CHANNEL_WEIGHT[channel] * wobble * trend);
  const delivered = Math.round(sent * (0.94 + pseudoRandom(`${seed}:d`, 6) / 100));
  const opened = Math.round(delivered * (0.22 + pseudoRandom(`${seed}:o`, 18) / 100));
  const clicked = Math.round(opened * (0.18 + pseudoRandom(`${seed}:c`, 14) / 100));
  const converted = Math.round(clicked * (0.12 + pseudoRandom(`${seed}:v`, 16) / 100));
  return { date, sent, delivered, opened, clicked, converted };
}

const addPoint = (total: MetricPoint, point: MetricPoint): MetricPoint => ({
  date: total.date,
  sent: total.sent + point.sent,
  delivered: total.delivered + point.delivered,
  opened: total.opened + point.opened,
  clicked: total.clicked + point.clicked,
  converted: total.converted + point.converted,
});

/** A day across the selected channels — one of them, or all of them summed. */
const dayTotal = (name: string, date: string, channel: MetricChannel | undefined): MetricPoint =>
  (channel === undefined ? CHANNELS : [channel]).reduce(
    (total, one) => addPoint(total, dailyPoint(name, one, date)),
    EMPTY_POINT(date)
  );

function metricsFor(name: string, query: MetricsQuery): MetricPoint[] {
  const buckets = new Map<string, MetricPoint>();
  for (const date of daysIn(query)) {
    const key = bucketOf(date, query.granularity);
    const running = buckets.get(key) ?? EMPTY_POINT(key);
    buckets.set(key, addPoint(running, dayTotal(name, date, query.channel)));
  }
  return Array.from(buckets.values());
}

/* ----------------------------------- Links ---------------------------------- */

/* Destinations a marketing flow would actually link to, so the table reads real. */
const LINK_POOL = [
  'https://edensign.io/',
  'https://edensign.io/dashboard',
  'https://edensign.io/studio/staging',
  'https://edensign.io/renovation',
  'https://edensign.io/pricing',
  'https://instagram.com/edensign',
  'https://youtube.com/edensign',
  'https://twitter.com/edensign',
  'https://linkedin.com/company/edensign',
  'https://wa.me/1234567890',
  'https://edensign.io/help/getting-started',
];

function linksFor(name: string, query: StatsRange): LinkStat[] {
  const days = daysIn(query).length;
  /* A single channel carries a slice of the traffic, so it clicks a slice too. */
  const share = query.channel === undefined ? 1 : CHANNEL_WEIGHT[query.channel] / 3;
  return LINK_POOL.map((url) => ({
    url,
    clicks: Math.round(days * share * (0.2 + pseudoRandom(`${name}:${url}`, 400) / 100)),
  })).sort((a, b) => b.clicks - a.clicks);
}

/* ------------------------------- Message stats ------------------------------- */

/** Walk the IR depth-first; branch arms, cohort arms and timeout lanes included. */
function walk(nodes: readonly NodeIR[], visit: (node: NodeIR) => void): void {
  for (const node of nodes) {
    visit(node);
    switch (node.type) {
      case 'branch':
        for (const branchCase of node.cases) walk(branchCase.flow, visit);
        if (node.otherwise) walk(node.otherwise, visit);
        break;
      case 'cohort':
        for (const arm of node.arms) walk(arm.flow, visit);
        break;
      case 'wait_until':
        if (Array.isArray(node.onTimeout)) walk(node.onTimeout, visit);
        break;
      default:
        break;
    }
  }
}

function messagesFor(ir: WorkflowIR, query: StatsRange): MessageStat[] {
  const days = daysIn(query).length;
  const rows: MessageStat[] = [];

  walk(ir.flow, (node) => {
    if (node.type !== 'message') return;
    const channel = analyticsChannel(node);
    if (channel === undefined) return;
    if (query.channel !== undefined && query.channel !== channel) return;

    const seed = `${ir.name}:${node.id}`;
    /* Sends taper down the flow: later nodes only see whoever is still in it. */
    const perDay = 4 + pseudoRandom(`${seed}:volume`, 44);
    const sent = Math.round(days * perDay * CHANNEL_WEIGHT[channel]);
    const delivered = Math.round(sent * (0.94 + pseudoRandom(`${seed}:d`, 6) / 100));
    const opened = Math.round(delivered * (0.2 + pseudoRandom(`${seed}:o`, 20) / 100));
    const clicked = Math.round(opened * (0.04 + pseudoRandom(`${seed}:c`, 12) / 100));
    const unsubscribed = Math.round(delivered * (pseudoRandom(`${seed}:u`, 20) / 1000));

    rows.push({
      nodeId: node.id,
      template: node.template,
      channel,
      sent,
      delivered,
      opened,
      clicked,
      unsubscribed,
    });
  });

  return rows;
}

/* --------------------------------- Reports ---------------------------------- */

/** 30 days ending today — what the list's sparklines and totals summarise. */
const RECENT: MetricsQuery = (() => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: isoDay(from), to: isoDay(to), granularity: 'day' };
})();

const reportFor = (name: string): WorkflowReport => {
  const points = metricsFor(name, RECENT);
  const sum = (key: 'delivered' | 'opened' | 'clicked' | 'converted') =>
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
const segmentDates = daysIn(RECENT);

const segmentReportFor = (name: string): SegmentReport => {
  const base = 400 + pseudoRandom(name, 12_000);
  const drift = (pseudoRandom(`${name}:drift`, 60) - 25) / 100;
  const series = segmentDates.map((date, index) => {
    const progress = index / Math.max(1, segmentDates.length - 1);
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
      // Deterministic placeholder portrait; the drawer falls back to initials without one
      picture: `https://i.pravatar.cc/80?u=${seed}`,
      subscription_plan: PLANS[pseudoRandom(`${seed}:plan`, PLANS.length)] ?? 'free',
      subscription_status: pseudoRandom(`${seed}:status`, 10) > 2 ? 'active' : 'cancelled',
      auto_renew_enabled: pseudoRandom(`${seed}:renew`, 10) > 3,
      docs_created: pseudoRandom(`${seed}:docs`, 240),
      last_seen_at: new Date(Date.now() - pseudoRandom(`${seed}:seen`, 30) * DAY_MS)
        .toISOString()
        .slice(0, 10),
      country: ['US', 'DE', 'JP', 'BR', 'NG'][pseudoRandom(`${seed}:cc`, 5)] ?? 'US',
      marketing_opt_in: pseudoRandom(`${seed}:opt`, 10) > 4,
    },
  };
};

const irOf = (workflowName: string): WorkflowIR | undefined =>
  WORKFLOWS.map((builder) => builder.toIR()).find((ir) => ir.name === workflowName);

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
  metrics: (workflowName, query) => metricsFor(workflowName, query),
  links: (workflowName, query) => linksFor(workflowName, query),
  messages: (workflowName, query) => {
    const ir = irOf(workflowName);
    return ir === undefined ? [] : messagesFor(ir, query);
  },
  nodeStats: (workflowName) => {
    const ir = irOf(workflowName);
    if (ir === undefined) return {};
    const stats: Record<string, number> = {};
    walk(ir.flow, (node) => {
      if (node.type === 'delay' || node.type === 'random_delay' || node.type === 'wait_until') {
        stats[node.id] = pseudoRandom(`${workflowName}:${node.id}`, 500);
      }
    });
    return stats;
  },
};
