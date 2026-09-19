import type { SegmentRef, WorkflowBuilder } from '@shware/workflow';
import type { ReactElement } from 'react';

/**
 * `workflow.config.ts` — optional project configuration.
 *
 * Definitions are NOT listed here: the CLI discovers them by convention,
 * next.js-style —
 *   - `src/workflows/` (or `workflows/`): every exported workflow and segment
 *     in the directory shows up in the studio, keyed by its export name;
 *   - `src/emails/index.ts` (or `emails/index.ts`): the email registry
 *     (`export const emails = { ... }`), which stays an explicit object
 *     because it is what types `templates<Emails>()` keys at compile time;
 *   - `src/pushes/index.ts` (or `pushes/index.ts`): the push-notification
 *     registry (`export const pushes = { ... }`), same shape and same reason;
 *   - `src/slack/index.ts` and `src/discord/index.ts`: the chat-message
 *     registries (`export const slack` / `export const discord`), again the
 *     same contract — one registry per channel, because a key's content shape
 *     is the channel's, and a single merged map would have to guess.
 *
 * The config carries what conventions cannot: project settings (title, email
 * addresses) and runtime wiring (the stats source).
 */

/**
 * The envelope: everything about an email except its body. Values are plain
 * strings so they stay serializable, and may carry `{{ path }}` placeholders
 * the engine fills at send time — the same data-reference rule the DSL follows,
 * since a closure here could not survive the trip to the runtime.
 *
 * Every field is optional; the studio only shows what you set.
 */
export interface EmailEnvelope {
  from?: string;
  to?: string;
  replyTo?: string;
  /** Preview text after the subject in most inboxes. */
  preheader?: string;
  cc?: string[];
  bcc?: string[];
  /** Extra SMTP headers, e.g. `{ 'X-Campaign': 'onboarding' }`. */
  headers?: Record<string, string>;
}

/** One email module: a default-exported component plus its envelope and preview props. */
export interface EmailModule extends EmailEnvelope {
  /**
   * Human label for the studio. The registry key is the template's identity —
   * referenced by `t.xxx` and carried in IR — so it is not something to rename
   * for readability; this is. Excluded from every hash by construction: nothing
   * but the UI ever reads it.
   */
  name?: string;
  /** What this message is for, in a sentence. Same rules as `name`. */
  description?: string;
  default: (props: never) => ReactElement;
  /**
   * A string template — a plain literal, or `emailSubject(u, '... {prop} ...')`
   * when it personalizes. Data, never a closure: the studio edits it in place
   * and the engine fills `{prop}` placeholders from the profile at send time.
   */
  subject?: string;
  /** Sample props used when previewing this template. */
  preview?: object;
}

/**
 * One push-notification module: content plus labels and preview props.
 *
 * Unlike an email, a push has no document to render — its content is two short
 * strings, so they follow the subject's rule: plain string templates carrying
 * `{prop}` placeholders the engine fills at send time. Data, never a closure —
 * which is also what lets the studio edit them in place.
 */
export interface PushModule {
  /** Human label for the studio; same rules as EmailModule.name. */
  name?: string;
  /** What this message is for, in a sentence. */
  description?: string;
  /** Notification title — a string template, `{prop}` placeholders allowed. */
  title?: string;
  /** Notification body — same rules as `title`. */
  body?: string;
  /**
   * Optional rich image URL (iOS attachment / Android BigPicture). Delivered
   * with the push at send time; the studio's collapsed-banner preview does
   * not render it.
   */
  image?: string;
  /** Sample props used when previewing this template. */
  preview?: object;
}

/**
 * One chat-message module (Slack, Discord) — content plus labels.
 *
 * Same reasoning as PushModule: a chat message has no document to render, so
 * its content is a couple of short string templates carrying `{prop}`
 * placeholders the engine fills at send time. Data, never a closure — which is
 * what lets the studio edit it in place.
 *
 * One interface for both platforms because the payload genuinely is the same
 * shape: who it appears to come from, where it lands, a bold first line and a
 * body. Their chrome differs, and that difference belongs in the preview, not
 * in two identical types.
 */
export interface ChatModule {
  /** Human label for the studio; same rules as EmailModule.name. */
  name?: string;
  /** What this message is for, in a sentence. */
  description?: string;
  /**
   * Display name of the bot posting it. Absent falls back to the project
   * title, the same way a push banner falls back for its app name.
   */
  sender?: string;
  /** Destination, e.g. `#customer-success` — shown in the preview's header. */
  to?: string;
  /** First line, rendered bold — a string template, `{prop}` allowed. */
  title?: string;
  /** Message body — same rules as `title`. */
  body?: string;
  /** Sample props used when previewing this template. */
  preview?: object;
}

/** Node id → how many users currently sit on that node. */
export type NodeStats = Record<string, number>;

/** Per-workflow totals for the list and metrics views. */
export interface WorkflowReport {
  /** Workflow name, matching the IR. */
  name: string;
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
  | 'slack'
  | 'discord'
  | 'sms'
  | 'webhook';

/** Every channel, in the order the studio's pickers list them. */
export const METRIC_CHANNELS = [
  'email',
  'push_ios',
  'push_android',
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
 */
export interface MetricPoint {
  /** Bucket start, ISO `YYYY-MM-DD`; used verbatim on the x axis. */
  date: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
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
  /** Segment name, matching the one the DSL declares. */
  name: string;
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

/** What the studio hands to `sendTest`: the rendered template plus the target inbox. */
export interface SendTestArgs {
  /** Template key, for logging / subject prefixes. */
  key: string;
  /** Recipient typed into the test dialog. */
  to: string;
  subject?: string;
  /** Fully rendered HTML, exactly what the preview iframe shows. */
  html: string;
}

/**
 * Email-sending settings for the project. This is data the code cannot derive:
 * which sender identities exist. The studio's from / reply-to pickers list
 * them, and "add address" in the UI writes back into this file.
 */
export interface EmailSettings {
  /** Sender identities, e.g. 'Acme <hello@acme.io>'. */
  addresses?: string[];
  /**
   * Deliver a rendered template to a real inbox — the "send test" button on
   * the preview page, like react-email's. The studio renders and collects the
   * recipient; transport is the project's business (Resend, SES, an API
   * route…), so it stays a hook. The button only appears when this is set.
   */
  sendTest?: (args: SendTestArgs) => Promise<void>;
}

export interface WorkflowUIConfig {
  /**
   * Browser tab title. The sidebar always reads "Workflow Studio" — this names
   * the project, which matters when several studios are open at once.
   */
  title?: string;
  /** Email settings: the sender address book, and whatever joins it later. */
  emails?: EmailSettings;
  /** Optional runtime data source for the reports view and canvas badges. */
  stats?: StatsSource;
}

/** Identity helper that gives the config file full type checking. */
export function defineConfig(config: WorkflowUIConfig): WorkflowUIConfig {
  return config;
}

/**
 * What the app actually receives from the virtual config module: the
 * discovered definitions merged with the user's (optional) config.
 */
export interface ResolvedStudioConfig {
  title?: string;
  /** Discovered workflows, keyed by export name. */
  workflows: Record<string, WorkflowBuilder>;
  /** The email registry from the conventional emails/index.ts (empty if none). */
  emails: Record<string, EmailModule>;
  /** The push registry from the conventional pushes/index.ts (empty if none). */
  pushes: Record<string, PushModule>;
  /** The Slack registry from the conventional slack/index.ts (empty if none). */
  slack: Record<string, ChatModule>;
  /** The Discord registry from the conventional discord/index.ts (empty if none). */
  discord: Record<string, ChatModule>;
  /** Discovered named segments. */
  segments: SegmentRef[];
  /** Sender address book from the config (empty if none). */
  addresses: string[];
  /** Test-send hook from the config (absent if none). */
  sendTest?: (args: SendTestArgs) => Promise<void>;
  stats?: StatsSource;
}
