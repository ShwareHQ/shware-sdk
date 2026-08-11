import type { SegmentRef, WorkflowBuilder } from '@shware/workflow';
import type { ReactElement } from 'react';

/**
 * `workflow.config.ts` — what the CLI loads to know about your project.
 *
 * The config imports your definitions directly, so there is no scanning or
 * convention magic: whatever you export here is what the studio shows.
 */

/** One email module: a default-exported component plus optional subject / preview props. */
export interface EmailModule {
  default: (props: never) => ReactElement;
  subject?: (props: never) => string;
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
 * Where runtime numbers come from. Without one the studio renders the reports
 * view in demo mode and says so — it never passes mock data off as real.
 */
export interface StatsSource {
  /** Totals per workflow. */
  reports?: () => Promise<WorkflowReport[]> | WorkflowReport[];
  /** Users waiting on each node of one workflow (drives the canvas badges). */
  nodeStats?: (workflowName: string) => Promise<NodeStats> | NodeStats;
  /** Time series for one workflow's Metrics tab. */
  metrics?: (workflowName: string) => Promise<MetricPoint[]> | MetricPoint[];
}

export interface WorkflowUIConfig {
  /** Workflows to display, keyed by the name shown in the picker. */
  workflows: Record<string, WorkflowBuilder>;
  /** Email registry, keyed by the template key used in `template.email(key)`. */
  emails?: Record<string, EmailModule>;
  /**
   * Named segments, so the studio can show each definition rather than just the
   * name a condition references. Pass the same values you hand to
   * `compileBundle({ segments })`.
   */
  segments?: SegmentRef[];
  /** Optional runtime data source for the reports view and canvas badges. */
  stats?: StatsSource;
  /** Title shown in the header. */
  title?: string;
}

/** Identity helper that gives the config file full type checking. */
export function defineConfig(config: WorkflowUIConfig): WorkflowUIConfig {
  return config;
}
