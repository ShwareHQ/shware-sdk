import { fullHash, stripMeta } from './hash';
import type { BundleIR, NodeIR, SegmentIR, WorkflowIR } from './ir';

/**
 * Plan — the diff between local definitions and what is deployed (terraform
 * plan, same mental model).
 *
 * This is the core advantage of code-first over a UI canvas: before deploying,
 * a machine can answer "what changed, and how many in-flight users does it
 * affect". Pure function, zero IO — CLI, UI and CI share one verdict.
 *
 * Status comes from two levels of comparison:
 * - contentHash differs → `changed` (semantics moved; in-flight users may need
 *   migration)
 * - contentHash equal but full content differs → `metadata_only` (description
 *   or labels only, nothing about execution) — exactly what keeping metadata
 *   out of the hash buys us.
 */

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'metadata_only' | 'unchanged';

/** Whether a status warrants human attention (metadata-only edits do not). */
export function isSemanticChange(status: ChangeStatus): boolean {
  return status === 'added' || status === 'removed' || status === 'changed';
}

export interface NodeChange {
  id: string;
  status: 'added' | 'removed' | 'changed';
  /** Node type: taken from the deployed side when removed, local otherwise. */
  type: NodeIR['type'];
}

export interface WorkflowChange {
  name: string;
  status: ChangeStatus;
  /** Deployed contentHash (absent when added). */
  before?: string;
  /** Local contentHash (absent when removed). */
  after?: string;
  /** Workflow-level semantic fields that moved (trigger / goal / exitWhen). */
  fields: ('trigger' | 'goal' | 'exitWhen')[];
  /**
   * Node-level detail, matched by structural-path id — so **inserting a node
   * shifts the ids of its later siblings**, and one insert can report as a run
   * of `changed` entries. That is the known trade-off of structural ids (see
   * ir.ts): the verdict stays correct, it is just noisier than ideal.
   */
  nodes: NodeChange[];
}

export interface ResourceChange {
  name: string;
  status: ChangeStatus;
  before?: string;
  after?: string;
}

export interface BundlePlan {
  workflows: WorkflowChange[];
  segments: ResourceChange[];
  templates: ResourceChange[];
  actions: ResourceChange[];
  /** Whether any semantic change exists (metadata-only edits do not count). */
  hasChanges: boolean;
}

/** Walk the node tree into a flat id → node map (branch arms, cohort arms and timeout flows included). */
function flatten(nodes: readonly NodeIR[], into: Map<string, NodeIR>): Map<string, NodeIR> {
  for (const node of nodes) {
    into.set(node.id, node);
    switch (node.type) {
      case 'branch':
        for (const branchCase of node.cases) flatten(branchCase.flow, into);
        if (node.otherwise) flatten(node.otherwise, into);
        break;
      case 'cohort':
        for (const arm of node.arms) flatten(arm.flow, into);
        break;
      case 'wait_until':
        if (Array.isArray(node.onTimeout)) flatten(node.onTimeout, into);
        break;
      default:
        break;
    }
  }
  return into;
}

/**
 * A node's semantic fingerprint: metadata stripped, child flows excluded (they
 * diff on their own ids). Everything else a compound node owns — branch case
 * conditions, cohort arm names and weights, *having* a default arm or a
 * timeout flow — is this node's semantics and stays in the fingerprint, so
 * editing a branch condition or reweighting an A/B shows up on the node itself.
 */
function nodeFingerprint(node: NodeIR): string {
  const bare: Record<string, unknown> = { ...node };
  if (node.type === 'branch') {
    bare.cases = node.cases.map((branchCase) => ({ condition: branchCase.condition }));
    delete bare.otherwise;
    if (node.otherwise !== undefined) bare.otherwise = '<flow>';
  }
  if (node.type === 'cohort') {
    bare.arms = node.arms.map((arm) => ({ name: arm.name, weight: arm.weight }));
  }
  if (node.type === 'wait_until' && Array.isArray(node.onTimeout)) {
    bare.onTimeout = '<flow>';
  }
  return fullHash(stripMeta(bare));
}

function diffNodes(local: WorkflowIR, deployed: WorkflowIR): NodeChange[] {
  const localNodes = flatten(local.flow, new Map());
  const deployedNodes = flatten(deployed.flow, new Map());
  const changes: NodeChange[] = [];

  for (const [id, node] of localNodes) {
    const before = deployedNodes.get(id);
    if (!before) {
      changes.push({ id, status: 'added', type: node.type });
    } else if (nodeFingerprint(node) !== nodeFingerprint(before)) {
      changes.push({ id, status: 'changed', type: node.type });
    }
  }
  for (const [id, node] of deployedNodes) {
    if (!localNodes.has(id)) changes.push({ id, status: 'removed', type: node.type });
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id));
}

function diffFields(local: WorkflowIR, deployed: WorkflowIR): WorkflowChange['fields'] {
  const fields: WorkflowChange['fields'] = [];
  for (const field of ['trigger', 'goal', 'exitWhen'] as const) {
    if (fullHash(stripMeta(local[field])) !== fullHash(stripMeta(deployed[field]))) {
      fields.push(field);
    }
  }
  return fields;
}

function statusOf(local: { contentHash: string }, deployed: { contentHash: string }): ChangeStatus {
  if (local.contentHash !== deployed.contentHash) return 'changed';
  return fullHash(local) === fullHash(deployed) ? 'unchanged' : 'metadata_only';
}

function diffWorkflows(
  local: readonly WorkflowIR[],
  deployed: readonly WorkflowIR[]
): WorkflowChange[] {
  const deployedByName = new Map(deployed.map((item) => [item.name, item]));
  const changes: WorkflowChange[] = [];

  for (const item of local) {
    const before = deployedByName.get(item.name);
    if (!before) {
      changes.push({
        name: item.name,
        status: 'added',
        after: item.contentHash,
        fields: [],
        nodes: [],
      });
      continue;
    }
    const status = statusOf(item, before);
    changes.push({
      name: item.name,
      status,
      before: before.contentHash,
      after: item.contentHash,
      fields: status === 'changed' ? diffFields(item, before) : [],
      nodes: status === 'changed' ? diffNodes(item, before) : [],
    });
  }

  const localNames = new Set(local.map((item) => item.name));
  for (const item of deployed) {
    if (!localNames.has(item.name)) {
      changes.push({
        name: item.name,
        status: 'removed',
        before: item.contentHash,
        fields: [],
        nodes: [],
      });
    }
  }

  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

function diffSegments(
  local: readonly SegmentIR[],
  deployed: readonly SegmentIR[]
): ResourceChange[] {
  const deployedByName = new Map(deployed.map((item) => [item.name, item]));
  const changes: ResourceChange[] = local.map((item) => {
    const before = deployedByName.get(item.name);
    if (!before) return { name: item.name, status: 'added' as const, after: item.contentHash };
    return {
      name: item.name,
      status: statusOf(item, before),
      before: before.contentHash,
      after: item.contentHash,
    };
  });

  const localNames = new Set(local.map((item) => item.name));
  for (const item of deployed) {
    if (!localNames.has(item.name)) {
      changes.push({ name: item.name, status: 'removed', before: item.contentHash });
    }
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

function diffTemplates(local: BundleIR['templates'], deployed: BundleIR['templates']) {
  const deployedByKey = new Map(deployed.map((item) => [item.key, item]));
  const changes: ResourceChange[] = local.map((item) => {
    const before = deployedByKey.get(item.key);
    if (!before) return { name: item.key, status: 'added' as const };
    return { name: item.key, status: before.channel === item.channel ? 'unchanged' : 'changed' };
  });

  const localKeys = new Set(local.map((item) => item.key));
  for (const item of deployed) {
    if (!localKeys.has(item.key)) changes.push({ name: item.key, status: 'removed' });
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Actions diff on codeHash — the manifest's only semantic content (the code itself lives in the Worker bundle). */
function diffActions(local: BundleIR['actions'], deployed: BundleIR['actions']) {
  const deployedByName = new Map(deployed.map((item) => [item.name, item]));
  const changes: ResourceChange[] = local.map((item) => {
    const before = deployedByName.get(item.name);
    if (!before) return { name: item.name, status: 'added' as const, after: item.codeHash };
    return {
      name: item.name,
      status: before.codeHash === item.codeHash ? ('unchanged' as const) : ('changed' as const),
      before: before.codeHash,
      after: item.codeHash,
    };
  });

  const localNames = new Set(local.map((item) => item.name));
  for (const item of deployed) {
    if (!localNames.has(item.name)) {
      changes.push({ name: item.name, status: 'removed', before: item.codeHash });
    }
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

/** Empty bundle: the default `deployed` on a first deploy, so everything reports as added. */
const EMPTY: Pick<BundleIR, 'workflows' | 'segments' | 'templates' | 'actions'> = {
  workflows: [],
  segments: [],
  templates: [],
  actions: [],
};

/**
 * Compute a deployment plan. Omitting `deployed` means a first deploy.
 *
 *   const changes = plan(compileBundle({ workflows }), await fetchDeployed());
 *   if (changes.hasChanges) { ... }
 */
export function plan(local: BundleIR, deployed?: BundleIR): BundlePlan {
  const base = deployed ?? EMPTY;
  const workflows = diffWorkflows(local.workflows, base.workflows);
  const segments = diffSegments(local.segments, base.segments);
  const templates = diffTemplates(local.templates, base.templates);
  const actions = diffActions(local.actions, base.actions);

  const hasChanges = [...workflows, ...segments, ...templates, ...actions].some((change) =>
    isSemanticChange(change.status)
  );

  return { workflows, segments, templates, actions, hasChanges };
}
