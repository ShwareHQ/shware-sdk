import type {
  DiscordTemplate,
  EmailTemplate,
  PushTemplate,
  SegmentIR,
  SlackTemplate,
  WorkflowIR,
} from '@shware/workflow';

/**
 * The studio's own types: the stats source it reads numbers from
 * (`workflow.stats.ts`, `defineStats`) and the shape the app receives from the
 * dev server. The project itself is `@shware/workflow`'s `defineConfig({...})`
 * in workflow.config.ts — the studio reads it, it defines nothing of its own.
 */

/** Node id → how many users currently sit on that node. */
export type NodeStats = Record<string, number>;

/** Per-workflow totals for the list and metrics views. */
export interface WorkflowReport {
  /** The workflow's id, matching `WorkflowIR.id`. */
  id: string;
  entered: number;
  completed: number;
  /** Reached the goal (a conversion). */
  converted: number;
  /** Currently in flight. */
  active: number;
  /** Messages delivered; rates below are computed against it. */
  delivered?: number;
  opened?: number;
  clicked?: number;
  /** Recent daily counts, oldest first — drives the sparklines in the list. */
  series?: {
    delivered?: number[];
    opened?: number[];
    clicked?: number[];
    converted?: number[];
  };
}

/* ------------------------------ Overview query ------------------------------ */

/**
 * The channel dimension analytics reports on.
 *
 * Deliberately *not* the DSL's `ChannelIR`. That enum says what the author
 * asked for ("send a push"); this says where the message actually landed, and
 * the two do not line up: one `push` node fans out to iOS and Android, whose
 * delivery and open behaviour differ enough that reading them summed hides the
 * problem you opened this page to find. Going the other way, a project can
 * report on a transport the DSL has no builder for yet — a webhook — without
 * the IR having to grow a node type first.
 *
 * So the mapping is many-to-many and belongs to whoever measures delivery, not
 * to the compiler. In-product surfaces (`in_app`, `survey`) are absent on
 * purpose: they have no transport receipt, no open pixel and no unsubscribe,
 * so none of the funnel below is defined for them.
 */
export type MetricChannel =
  | 'email'
  | 'push_ios'
  | 'push_android'
  | 'push_web'
  | 'slack'
  | 'discord'
  | 'sms'
  | 'webhook';

/** Every channel, in the order the studio's pickers list them. */
export const METRIC_CHANNELS = [
  'email',
  'push_ios',
  'push_android',
  'push_web',
  'slack',
  'discord',
  'sms',
  'webhook',
] as const satisfies readonly MetricChannel[];

/** Bucket width for a time series. */
export type Granularity = 'day' | 'week' | 'month';

/**
 * What every Overview panel is scoped by. Dates are ISO `YYYY-MM-DD` and both
 * ends are inclusive — a report reads "Aug 21 to Sep 19", not "up to but
 * excluding Sep 20".
 */
export interface StatsRange {
  from: string;
  to: string;
  /** Absent means every channel summed. */
  channel?: MetricChannel;
}

/** A range plus the bucket width, for the time series behind the chart cards. */
export interface MetricsQuery extends StatsRange {
  granularity: Granularity;
}

/**
 * One bucket of a workflow's delivery funnel.
 *
 * `sent` and `delivered` are two different facts and the UI shows both: sent is
 * what we handed the transport, delivered is what it accepted. The gap between
 * them is the bounce rate, which is invisible if you only keep one of them —
 * which is why `delivered` was not simply renamed when the Sent card arrived.
 *
 * Opens and clicks carry an optional human/machine split. Not every transport
 * can tell the two apart — most have nothing to tell apart — so the halves are
 * optional, and the studio plots three lines only for a query whose every
 * bucket reports them. Where they are reported, `opened` must equal
 * `openedHuman + openedMachine` and `clicked` its own pair: the studio rates
 * all three against one denominator so the lines add up on screen, and a
 * source that recounts the halves independently would draw a chart that
 * visibly does not.
 */
export interface MetricPoint {
  /** Bucket start, ISO `YYYY-MM-DD`; used verbatim on the x axis. */
  date: string;
  sent: number;
  delivered: number;
  opened: number;
  /**
   * Opens a person caused. The rest is infrastructure: Apple's Mail Privacy
   * Protection prefetches the tracking pixel for everything it relays, whether
   * or not the mail is ever read, and Gmail's image proxy caches it — which is
   * why a raw open rate has been unusable as a measure of attention since 2021.
   */
  openedHuman?: number;
  /** Opens attributed to a proxy, relay or scanner rather than a reader. */
  openedMachine?: number;
  clicked: number;
  /** Clicks a person caused. */
  clickedHuman?: number;
  /** Clicks attributed to a link prefetcher or a security scanner following links. */
  clickedMachine?: number;
  /** Users who entered the workflow in this bucket: the conversion rate's denominator. */
  entered: number;
  /**
   * Of the users who entered in this bucket, those who reached the goal — counted against their
   * entry, not the day they converted, so `converted / entered` is a share of one cohort and
   * never passes 100%.
   */
  converted: number;
}

/** One destination URL and how often it was clicked over the queried range. */
export interface LinkStat {
  /** The URL as it appears in the message, before any click-tracking rewrite. */
  url: string;
  clicks: number;
}

/**
 * One message node's funnel over the queried range.
 *
 * Identity is the node id, not the template: the same template sent twice in a
 * flow is two rows, because "which send underperforms" is the question this
 * table answers. No display name here — the studio already holds the IR and the
 * template registries, so it resolves the label itself and this stays about
 * numbers.
 */
export interface MessageStat {
  /** IR node id (the structural path), pinpointing the send site. */
  nodeId: string;
  /** Template registry key; the row links to it. */
  template: string;
  channel: MetricChannel;
  sent: number;
  /** Accepted by the transport — `sent` minus bounces. */
  delivered: number;
  opened: number;
  clicked: number;
  /** Opt-outs attributed to this send. */
  unsubscribed: number;
}

/**
 * How many users a segment currently holds, and how that has moved.
 *
 * A segment's definition is code, but its size is not derivable from code at
 * all — it is a fact about the user base, and the only thing that tells you
 * whether a condition matches the population you meant.
 */
export interface SegmentReport {
  /** The segment's id, matching `SegmentIR.id`. */
  id: string;
  /** Users in the segment right now. */
  size: number;
  /** Recent daily sizes, oldest first — drives the sparkline in the list. */
  series?: number[];
}

/**
 * One person in the audience. `id` and the timestamps are the columns every
 * project has; everything else it knows about them lives in `properties`,
 * because a profile's shape is the user's schema, not ours.
 */
export interface Profile {
  id: string;
  email?: string;
  /** ISO timestamp; rendered as a date. */
  createdAt?: string;
  /** Whatever the project stores — the same keys the DSL's `u.xxx` references. */
  properties?: Record<string, unknown>;
}

/** One page of profiles, plus the total so the UI can say "showing N of M". */
export interface ProfilePage {
  profiles: Profile[];
  total: number;
}

/** Paging window for a profile query. */
export interface ProfileQuery {
  limit: number;
  offset: number;
}

/**
 * Where runtime numbers come from. Without one the studio renders the reports
 * view in demo mode and says so — it never passes mock data off as real.
 */
export interface StatsSource {
  /** Totals per workflow. */
  reports?: () => Promise<WorkflowReport[]> | WorkflowReport[];
  /** Size per segment. */
  segments?: () => Promise<SegmentReport[]> | SegmentReport[];
  /** Who is in one segment right now, a page at a time. */
  profiles?: (segmentName: string, query: ProfileQuery) => Promise<ProfilePage> | ProfilePage;
  /** Users waiting on each node of one workflow (drives the canvas badges). */
  nodeStats?: (workflowName: string) => Promise<NodeStats> | NodeStats;
  /** Time series behind the Overview's chart cards, bucketed as asked. */
  metrics?: (workflowName: string, query: MetricsQuery) => Promise<MetricPoint[]> | MetricPoint[];
  /** Most-clicked destinations across the whole workflow, any order. */
  links?: (workflowName: string, query: StatsRange) => Promise<LinkStat[]> | LinkStat[];
  /** Per-send funnel, one row per message node. */
  messages?: (workflowName: string, query: StatsRange) => Promise<MessageStat[]> | MessageStat[];
}

/**
 * Identity helper for `workflow.stats.ts` — the studio's optional runtime
 * data source, kept apart from the project: the project describes what is
 * deployed, this is how the studio reads numbers about it. It runs on the
 * studio's dev server (Node), so it can query the project's database or API
 * with credentials from the environment; the page calls it over HTTP, and
 * every answer must be JSON.
 */
export function defineStats(stats: StatsSource): StatsSource {
  return stats;
}

/** Why the studio has nothing to show: the project failed to load, or to compile. */
export interface StudioError {
  /** `compile`: compileConfig refused it (the message names the workflow and node). */
  kind: 'load' | 'compile';
  message: string;
}

/**
 * What the app actually receives from the virtual config module. Everything
 * here is either compiled output (workflow and segment IR, from the same
 * `compileConfig` the Worker deploys) or preview-safe template data — the
 * project object itself never reaches the browser.
 */
export interface ResolvedStudioConfig {
  title?: string;
  /** Compiled workflows, keyed by workflow name (empty when `error` is set). */
  workflows: Record<string, WorkflowIR>;
  /** The project's email registry (empty if none). */
  emails: Record<string, EmailTemplate>;
  /** The project's push registry (empty if none). */
  pushes: Record<string, PushTemplate>;
  /** The project's Discord webhook registry (empty if none). */
  discords: Record<string, DiscordTemplate>;
  /** The project's Slack webhook registry (empty if none). */
  slacks: Record<string, SlackTemplate>;
  /** Compiled named segments. */
  segments: SegmentIR[];
  /** The project's envelope (`emails.from` / `replyTo`), formatted as `Name <email>`. */
  emailDefaults: { from?: string; replyTo?: string };
  /** Set when the project failed to load or compile; the shell shows it instead of the views. */
  error?: StudioError;
  stats?: StatsSource;
}
