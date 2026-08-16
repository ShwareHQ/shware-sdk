import { semanticHash } from '../hash';
import {
  type GoalIR,
  IR_VERSION,
  type MetaIR,
  type NodeIR,
  type SourceLocIR,
  type WorkflowIR,
  WorkflowIR as WorkflowIRSchema,
} from '../ir';
import { captureLoc } from '../provenance';
import { type Duration, durationIR } from './base';
import { type Condition, condIR } from './condition';
import { type FlowBuilder, FlowBuilderImpl } from './flow';
import type { TriggerInternal, TriggerRef } from './trigger';

/**
 * The workflow — a named flow chain plus its configuration (options =
 * configuration, the chain = steps), and the compiler back half: `toIR()`
 * deep-clones the collected nodes, assigns structural-path ids, computes the
 * contentHash (metadata stripped, see hash.ts) and self-checks the result
 * against the authoritative IR schema.
 */

/** Full conversion-goal configuration (customer.io's Goal & Exit semantics). */
export interface GoalOptions {
  condition: Condition;
  /** Attribution window: how long after entry a match still counts as a conversion. Unbounded by default. */
  within?: Duration;
  /** Exit on conversion. Defaults to true — this is what absorbs all those True→Exit arms in a UI canvas. */
  exitOnMatch?: boolean;
}

export interface WorkflowOptions {
  /** Trigger: a trigger.xxx() asset. TODO: multiple triggers, entry frequency / re-entry policy. */
  trigger: TriggerRef;

  /**
   * Conversion goal: feeds reporting (conversion rate / attribution) and by
   * default exits on match. Checked before each node runs. Pass a condition
   * for the shorthand, or GoalOptions for the full form.
   */
  goal?: Condition | GoalOptions;

  /** Plain exit condition: leaving without counting as a conversion (unsubscribed, no longer eligible). Coexists with goal. */
  exitWhen?: Condition;

  /*
   * Everything below is human-facing metadata: it lands in IR's `meta` field
   * and is **excluded from contentHash**. Editing it neither invalidates the
   * version in-flight users are pinned to nor shows up as a change in plan.
   */

  /**
   * Human label. The first argument to `workflow()` is wire identity — engine
   * instances, the entry ledger and stats keys are all built on it — so it is
   * not something to rename for readability. This is.
   */
  name?: string;

  /** One line on what this flow does (UI lists, plan output). */
  description?: string;
  /** Grouping tags (UI filtering). */
  tags?: readonly string[];
  /** Owner (shown in the UI, used for alert routing). */
  owner?: string;
}

export interface WorkflowBuilder extends FlowBuilder {
  toIR(): WorkflowIR;
}

/**
 * Assign node ids from the structural path (rules in ir.ts's header). Written
 * in place into the tree toIR deep-cloned, never into the builder's own nodes.
 */
function assignIds(nodes: NodeIR[], prefix: string): void {
  nodes.forEach((node, i) => {
    const id = prefix === '' ? String(i) : `${prefix}.${i}`;
    node.id = id;
    switch (node.type) {
      case 'branch':
        node.cases.forEach((c, ci) => assignIds(c.flow, `${id}.c${ci}`));
        if (node.otherwise) assignIds(node.otherwise, `${id}.o`);
        break;
      case 'cohort':
        node.arms.forEach((arm) => assignIds(arm.flow, `${id}.${arm.name}`));
        break;
      case 'wait_until':
        if (Array.isArray(node.onTimeout)) assignIds(node.onTimeout, `${id}.t`);
        break;
      default:
        break;
    }
  });
}

class WorkflowBuilderImpl extends FlowBuilderImpl implements WorkflowBuilder {
  constructor(
    private readonly name: string,
    private readonly options: WorkflowOptions,
    /** Callsite of the workflow() call (provenance; lands in meta.loc). */
    private readonly loc: SourceLocIR | undefined
  ) {
    super();
  }

  private goalIR(): GoalIR | undefined {
    const goal = this.options.goal;
    if (goal === undefined) return undefined;
    if ('__condition' in goal) {
      return { condition: condIR(goal), exitOnMatch: true };
    }
    return {
      condition: condIR(goal.condition),
      ...(goal.within !== undefined ? { within: durationIR(goal.within) } : {}),
      exitOnMatch: goal.exitOnMatch ?? true,
    };
  }

  private metaIR(): MetaIR | undefined {
    const { name, description, tags, owner } = this.options;
    if (
      name === undefined &&
      description === undefined &&
      tags === undefined &&
      owner === undefined &&
      this.loc === undefined
    ) {
      return undefined;
    }
    return {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(tags !== undefined ? { tags: [...tags] } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(this.loc !== undefined ? { loc: this.loc } : {}),
    };
  }

  toIR(): WorkflowIR {
    const flowNodes = structuredClone(this.nodes);
    assignIds(flowNodes, '');
    const goal = this.goalIR();
    const meta = this.metaIR();
    const body = {
      irVersion: IR_VERSION,
      name: this.name,
      ...(meta !== undefined ? { meta } : {}),
      trigger: (this.options.trigger as TriggerInternal).ir,
      ...(goal !== undefined ? { goal } : {}),
      ...(this.options.exitWhen !== undefined ? { exitWhen: condIR(this.options.exitWhen) } : {}),
      flow: flowNodes,
    };
    // semanticHash strips meta / label, so metadata edits leave contentHash alone
    // Self-check: the compiler's output must pass IR's authoritative schema
    return WorkflowIRSchema.parse({ ...body, contentHash: semanticHash(body) });
  }
}

/** Workflow definition: a name, configuration (trigger / goal / exitWhen), and chained steps. */
export function workflow(name: string, options: WorkflowOptions): WorkflowBuilder {
  return new WorkflowBuilderImpl(name, options, captureLoc(workflow));
}
