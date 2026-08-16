import { semanticHash } from '../hash';
import {
  type BundleIR,
  BundleIR as BundleIRSchema,
  type ConditionIR,
  IR_VERSION,
  type NodeIR,
  type SegmentIR,
  type WorkflowIR,
} from '../ir';
import type { SegmentInternal, SegmentRef } from './condition';
import type { TemplateRef } from './template';
import type { WorkflowBuilder } from './workflow';

/**
 * The deployment unit — compileBundle gathers workflows, segments and the
 * template manifest into one BundleIR snapshot (terraform-apply mental model);
 * the server diffs each definition by contentHash (see plan.ts).
 */
export function compileBundle(input: {
  workflows: readonly WorkflowBuilder[];
  segments?: readonly SegmentRef[];
  templates?: readonly TemplateRef[];
}): BundleIR {
  const segments = (input.segments ?? []).map((segment) => {
    const { name, definition, loc } = segment as SegmentInternal;
    const compiled: SegmentIR = {
      irVersion: IR_VERSION,
      name,
      contentHash: semanticHash(definition),
      condition: definition,
    };
    if (loc !== undefined) compiled.meta = { loc };
    return compiled;
  });

  const templates = (input.templates ?? []).map((template) => ({
    irVersion: IR_VERSION,
    key: template.key,
    channel: template.channel,
  }));

  const workflows = input.workflows.map((builder) => builder.toIR());

  // Names are wire identity (routing tables, entry ledger, by-name refs):
  // duplicates would silently last-write-win on deploy, so fail the compile.
  assertUniqueNames(
    workflows.map((w) => w.name),
    'workflow'
  );
  assertUniqueNames(
    segments.map((s) => s.name),
    'segment'
  );
  assertUniqueNames(
    templates.map((t) => t.key),
    'template'
  );

  // Deploy replaces the whole segment table, so every by-name reference must
  // resolve inside this bundle — catching it here turns a runtime "Unknown
  // segment" in some user's journey into a compile error.
  assertSegmentRefsResolve(workflows, segments);

  return BundleIRSchema.parse({ irVersion: IR_VERSION, workflows, segments, templates });
}

function assertUniqueNames(names: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`compileBundle: duplicate ${kind} name '${name}'`);
    seen.add(name);
  }
}

function assertSegmentRefsResolve(
  workflows: readonly WorkflowIR[],
  segments: readonly SegmentIR[]
): void {
  const defined = new Set(segments.map((s) => s.name));
  const check = (refs: ReadonlySet<string>, owner: string): void => {
    for (const ref of refs) {
      if (!defined.has(ref)) {
        throw new Error(
          `compileBundle: ${owner} references segment '${ref}' that is not in the bundle — pass it in 'segments'`
        );
      }
    }
  };
  for (const workflow of workflows) {
    check(referencedSegments(workflow), `workflow '${workflow.name}'`);
  }
  // Segments may reference other segments; those must resolve too
  for (const segment of segments) {
    const refs = new Set<string>();
    collectConditionRefs(segment.condition, refs);
    check(refs, `segment '${segment.name}'`);
  }
}

function referencedSegments(workflow: WorkflowIR): Set<string> {
  const refs = new Set<string>();
  if (workflow.trigger.type === 'segment') refs.add(workflow.trigger.segment);
  if (workflow.trigger.type === 'event' && workflow.trigger.filter !== undefined) {
    collectConditionRefs(workflow.trigger.filter, refs);
  }
  if (workflow.goal !== undefined) collectConditionRefs(workflow.goal.condition, refs);
  if (workflow.exitWhen !== undefined) collectConditionRefs(workflow.exitWhen, refs);
  collectNodeRefs(workflow.flow, refs);
  return refs;
}

function collectConditionRefs(condition: ConditionIR, into: Set<string>): void {
  switch (condition.type) {
    case 'and':
    case 'or':
      for (const child of condition.conditions) collectConditionRefs(child, into);
      break;
    case 'not':
      collectConditionRefs(condition.condition, into);
      break;
    case 'segment':
      into.add(condition.segment);
      break;
    default:
      break;
  }
}

function collectNodeRefs(nodes: readonly NodeIR[], into: Set<string>): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'wait_until':
        collectConditionRefs(node.condition, into);
        if (Array.isArray(node.onTimeout)) collectNodeRefs(node.onTimeout, into);
        break;
      case 'branch':
        for (const branchCase of node.cases) {
          collectConditionRefs(branchCase.condition, into);
          collectNodeRefs(branchCase.flow, into);
        }
        if (node.otherwise) collectNodeRefs(node.otherwise, into);
        break;
      case 'filter':
        collectConditionRefs(node.condition, into);
        break;
      case 'cohort':
        for (const arm of node.arms) collectNodeRefs(arm.flow, into);
        break;
      default:
        break;
    }
  }
}
