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
 *     because it is what types `templates<Emails>()` keys at compile time.
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

/** One day (or bucket) of a workflow's delivery funnel. */
export interface MetricPoint {
  /** ISO date or any label; used verbatim on the x axis. */
  date: string;
  delivered: number;
  opened: number;
  clicked: number;
  converted: number;
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
  /** Time series for one workflow's Metrics tab. */
  metrics?: (workflowName: string) => Promise<MetricPoint[]> | MetricPoint[];
}

/**
 * Email-sending settings for the project. This is data the code cannot derive:
 * which sender identities exist. The studio's from / reply-to pickers list
 * them, and "add address" in the UI writes back into this file.
 */
export interface EmailSettings {
  /** Sender identities, e.g. 'Acme <hello@acme.io>'. */
  addresses?: string[];
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
  /** Discovered named segments. */
  segments: SegmentRef[];
  /** Sender address book from the config (empty if none). */
  addresses: string[];
  stats?: StatsSource;
}
