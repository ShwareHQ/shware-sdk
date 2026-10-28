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
import { type AnyTemplate, CHANNEL_OF } from '../templates';
import type { ActionRef } from './action';
import type { SegmentInternal, SegmentRef } from './condition';
import { actionUses } from './flow';
import type { WorkflowBuilder } from './workflow';

/**
 * The deployment unit — compileBundle gathers workflows, segments and the
 * template manifest into one BundleIR snapshot (terraform-apply mental model);
 * the server diffs each definition by contentHash (see plan.ts).
 */
export function compileBundle(input: {
  workflows: readonly WorkflowBuilder[];
  segments?: readonly SegmentRef[];
  /** The template manifest: these definitions, by channel and id. */
  templates?: readonly AnyTemplate[];
  actions?: readonly ActionRef[];
  /** The contract's subscription topics, carried for the engine (`compileConfig` passes them). */
  subscriptions?: { topics: readonly string[] };
}): BundleIR {
  const segments = (input.segments ?? []).map((segment) => {
    const { id, definition, loc, meta } = segment as SegmentInternal;
    const compiled: SegmentIR = {
      irVersion: IR_VERSION,
      id,
      // Labels and provenance both live in meta, which stripMeta drops before hashing
      contentHash: semanticHash(definition),
      condition: definition,
    };
    const merged = {
      ...(meta?.name !== undefined ? { name: meta.name } : {}),
      ...(meta?.description !== undefined ? { description: meta.description } : {}),
      ...(loc !== undefined ? { loc } : {}),
    };
    if (Object.keys(merged).length > 0) compiled.meta = merged;
    return compiled;
  });

  const templates = (input.templates ?? []).map((template) => ({
    irVersion: IR_VERSION,
    key: template.id,
    channel: CHANNEL_OF[template.kind],
  }));

  // Manifest only — names; the implementation ships in the Worker bundle, never in IR
  const actions = (input.actions ?? []).map((a) => ({ irVersion: IR_VERSION, name: a.name }));

  const workflows = input.workflows.map((builder) => builder.toIR());

  // Names are wire identity (routing tables, entry ledger, by-name refs):
  // duplicates would silently last-write-win on deploy, so fail the compile.
  assertUniqueNames(
    workflows.map((w) => w.id),
    'workflow'
  );
  assertUniqueNames(
    segments.map((s) => s.id),
    'segment'
  );
  // A message node names its template by channel and key, so the key is unique per channel:
  // an email and a push of one nudge may share it
  assertUniqueNames(
    templates.map((t) => `${t.channel}:${t.key}`),
    'template'
  );
  assertUniqueNames(
    actions.map((a) => a.name),
    'action'
  );

  // Deploy replaces the whole segment table, so every by-name reference must
  // resolve inside this bundle — catching it here turns a runtime "Unknown
  // segment" in some user's journey into a compile error.
  assertSegmentRefsResolve(workflows, segments);

  // A segment is evaluated by evaluating the segments it names; a cycle among
  // them has no evaluation order and would recurse until the stack ran out —
  // at run time, in some user's journey. Caught here, with the cycle spelled out.
  assertNoSegmentCycles(segments);

  // Payload predicates and profile predicates share the Condition type, so
  // placement is checked here: payload only inside where-trees, and where-trees
  // contain nothing but payload predicates and combinators.
  assertConditionPlacement(workflows, segments);

  // Same rationale as segments: the runtime registry is looked up by name, so
  // an action a workflow runs must be in the bundle — and it must be the very
  // definition listed there, or two same-named definitions are competing for
  // one identity (the IR names it; only the compile can tell them apart).
  assertActionRefsResolve(workflows, input.workflows, input.actions ?? []);

  return BundleIRSchema.parse({
    irVersion: IR_VERSION,
    workflows,
    segments,
    templates,
    actions,
    subscriptions: { topics: [...(input.subscriptions?.topics ?? [])] },
  });
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
  const defined = new Set(segments.map((s) => s.id));
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
    check(referencedSegments(workflow), `workflow '${workflow.id}'`);
  }
  // Segments may reference other segments; those must resolve too
  for (const segment of segments) {
    const refs = new Set<string>();
    collectConditionRefs(segment.condition, refs);
    check(refs, `segment '${segment.id}'`);
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

function assertActionRefsResolve(
  workflows: readonly WorkflowIR[],
  builders: readonly WorkflowBuilder[],
  actions: readonly ActionRef[]
): void {
  const listed = new Map(actions.map((a) => [a.name, a]));
  workflows.forEach((workflow, i) => {
    for (const used of actionUses(builders[i])) {
      const manifest = listed.get(used.name);
      if (manifest === undefined) {
        throw new Error(
          `compileBundle: workflow '${workflow.id}' runs action '${used.name}' that is not in the bundle — pass it in 'actions'`
        );
      }
      // Identity, not source text: the printed handler depends on the bundler.
      // Every use is checked, not one per name — with two definitions under one
      // name, whichever is listed, the *other* node would run the wrong code.
      if (manifest !== used && manifest.handler !== used.handler) {
        throw new Error(
          `compileBundle: workflow '${workflow.id}' runs action '${used.name}' that is not the definition listed in 'actions' — two definitions are sharing that name`
        );
      }
    }
  });
}

/** Walk segment → segment references depth-first; the first back edge is reported as the cycle path. */
function assertNoSegmentCycles(segments: readonly SegmentIR[]): void {
  const refsOf = new Map<string, Set<string>>();
  for (const segment of segments) {
    const refs = new Set<string>();
    collectConditionRefs(segment.condition, refs);
    refsOf.set(segment.id, refs);
  }
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): void => {
    const at = path.indexOf(id);
    if (at !== -1) {
      const cycle = [...path.slice(at), id].join(' → ');
      throw new Error(`compileBundle: segments reference each other in a cycle: ${cycle}`);
    }
    if (done.has(id)) return;
    path.push(id);
    for (const ref of refsOf.get(id) ?? []) visit(ref);
    path.pop();
    done.add(id);
  };
  for (const id of refsOf.keys()) visit(id);
}

/* --------------------- payload / profile placement checks --------------------- */

function assertConditionPlacement(
  workflows: readonly WorkflowIR[],
  segments: readonly SegmentIR[]
): void {
  for (const workflow of workflows) {
    if (workflow.trigger.type === 'event') {
      if (workflow.trigger.where !== undefined) {
        assertWhereTree(workflow.trigger.where, `workflow '${workflow.id}' trigger where`);
      }
      if (workflow.trigger.filter !== undefined) {
        assertProfileTree(workflow.trigger.filter, `workflow '${workflow.id}' trigger filter`);
      }
    }
    if (workflow.goal !== undefined) {
      assertProfileTree(workflow.goal.condition, `workflow '${workflow.id}' goal`);
    }
    if (workflow.exitWhen !== undefined) {
      assertProfileTree(workflow.exitWhen, `workflow '${workflow.id}' exitWhen`);
    }
    assertNodeTrees(workflow.flow, `workflow '${workflow.id}'`);
  }
  for (const segment of segments) {
    assertProfileTree(segment.condition, `segment '${segment.id}'`);
  }
}

/** A profile-context tree: payload predicates may appear only under a performed.where. */
function assertProfileTree(condition: ConditionIR, owner: string): void {
  switch (condition.type) {
    case 'and':
    case 'or':
      for (const child of condition.conditions) assertProfileTree(child, owner);
      break;
    case 'not':
      assertProfileTree(condition.condition, owner);
      break;
    case 'performed':
      if (condition.where !== undefined) assertWhereTree(condition.where, owner);
      break;
    case 'payload':
      throw new Error(
        `compileBundle: ${owner} uses a payload predicate outside a where clause — payload refs are only valid inside performed({ where }) or trigger.event({ where })`
      );
    default:
      break; // property / segment
  }
}

/** A where tree: payload predicates and combinators only — no profile facts in event scope. */
function assertWhereTree(condition: ConditionIR, owner: string): void {
  switch (condition.type) {
    case 'and':
    case 'or':
      for (const child of condition.conditions) assertWhereTree(child, owner);
      break;
    case 'not':
      assertWhereTree(condition.condition, owner);
      break;
    case 'payload':
      break;
    default:
      throw new Error(
        `compileBundle: ${owner} where clause may only contain payload predicates and and/or/not, found '${condition.type}'`
      );
  }
}

function assertNodeTrees(nodes: readonly NodeIR[], owner: string): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'wait_until':
        assertProfileTree(node.condition, owner);
        if (Array.isArray(node.onTimeout)) assertNodeTrees(node.onTimeout, owner);
        break;
      case 'branch':
        for (const branchCase of node.cases) {
          assertProfileTree(branchCase.condition, owner);
          assertNodeTrees(branchCase.flow, owner);
        }
        if (node.otherwise) assertNodeTrees(node.otherwise, owner);
        break;
      case 'filter':
        assertProfileTree(node.condition, owner);
        break;
      case 'cohort':
        for (const arm of node.arms) assertNodeTrees(arm.flow, owner);
        break;
      default:
        break;
    }
  }
}
