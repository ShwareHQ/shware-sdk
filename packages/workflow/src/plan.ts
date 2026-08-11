import { fullHash, stripMeta } from './hash';
import type { BundleIR, NodeIR, SegmentIR, WorkflowIR } from './ir';

/**
 * Plan —— 本地定义 vs 线上已部署的差异（terraform plan 同款心智）。
 *
 * 这是 code-first 相对 UI 画布的核心优势：部署前能机器判定"改了什么、
 * 影响多少在途用户"。纯函数、零 IO——CLI、UI、CI 三方共用同一份结论。
 *
 * 状态判定基于两层比较：
 * - contentHash 不同 → `changed`（执行语义变了，在途用户涉及迁移）
 * - contentHash 相同、完整内容不同 → `metadata_only`（只改了描述/label，
 *   不影响任何执行；这正是元数据不进哈希的价值所在）
 */

export type ChangeStatus = 'added' | 'removed' | 'changed' | 'metadata_only' | 'unchanged';

/** 语义变更是否需要人工关注（新增/删除/改语义都算；纯元数据不算）。 */
export function isSemanticChange(status: ChangeStatus): boolean {
  return status === 'added' || status === 'removed' || status === 'changed';
}

export interface NodeChange {
  id: string;
  status: 'added' | 'removed' | 'changed';
  /** 节点类型：removed 时取线上的，其余取本地的。 */
  type: NodeIR['type'];
}

export interface WorkflowChange {
  name: string;
  status: ChangeStatus;
  /** 线上的 contentHash（added 时无）。 */
  before?: string;
  /** 本地的 contentHash（removed 时无）。 */
  after?: string;
  /** workflow 级语义字段的变更（trigger / goal / exitWhen）。 */
  fields: ('trigger' | 'goal' | 'exitWhen')[];
  /**
   * 节点级明细。按结构路径 id 比对——**插入节点会让后续兄弟 id 位移**，
   * 于是一次插入可能报成一串 changed。这是结构 id 的已知取舍（见 ir.ts），
   * 结论仍然正确，只是噪音偏多。
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
  /** 是否存在语义变更（纯元数据变更不计）。 */
  hasChanges: boolean;
}

/** 深度遍历节点树，展平成 id → 节点（分支臂 / cohort 臂 / 超时子流程都下钻）。 */
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

/** 节点的执行语义指纹：剥元数据、且不含子流程（子节点各自单独比对）。 */
function nodeFingerprint(node: NodeIR): string {
  const bare: Record<string, unknown> = { ...node };
  delete bare.cases;
  delete bare.otherwise;
  delete bare.arms;
  if (node.type === 'wait_until' && Array.isArray(node.onTimeout)) {
    // 子流程单独比对，但"有无超时子流程"本身是语义
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

/** 空 bundle：首次部署时 deployed 缺省用它，全部资源报 added。 */
const EMPTY: Pick<BundleIR, 'workflows' | 'segments' | 'templates'> = {
  workflows: [],
  segments: [],
  templates: [],
};

/**
 * 计算部署计划。deployed 省略 = 首次部署。
 *
 *   const changes = plan(compileBundle({ workflows }), await fetchDeployed());
 *   if (changes.hasChanges) { ... }
 */
export function plan(local: BundleIR, deployed?: BundleIR): BundlePlan {
  const base = deployed ?? EMPTY;
  const workflows = diffWorkflows(local.workflows, base.workflows);
  const segments = diffSegments(local.segments, base.segments);
  const templates = diffTemplates(local.templates, base.templates);

  const hasChanges = [...workflows, ...segments, ...templates].some((change) =>
    isSemanticChange(change.status)
  );

  return { workflows, segments, templates, hasChanges };
}
