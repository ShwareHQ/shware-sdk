import type { WorkflowBuilder } from '@shware/workflow';
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

/** Per-workflow totals for the reports view. */
export interface WorkflowReport {
  /** Workflow name, matching the IR. */
  name: string;
  entered: number;
  completed: number;
  /** Reached the goal (a conversion). */
  converted: number;
  /** Currently in flight. */
  active: number;
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
}

export interface WorkflowUIConfig {
  /** Workflows to display, keyed by the name shown in the picker. */
  workflows: Record<string, WorkflowBuilder>;
  /** Email registry, keyed by the template key used in `template.email(key)`. */
  emails?: Record<string, EmailModule>;
  /** Optional runtime data source for the reports view and canvas badges. */
  stats?: StatsSource;
  /** Title shown in the header. */
  title?: string;
}

/** Identity helper that gives the config file full type checking. */
export function defineConfig(config: WorkflowUIConfig): WorkflowUIConfig {
  return config;
}
