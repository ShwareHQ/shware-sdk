import type { NodeIR, WorkflowIR } from '@shware/workflow';

/**
 * 从 IR 反查模板引用——"哪些流程用了哪个模板"不是手工维护的清单，
 * 而是从中间层算出来的。顺带暴露"引用了但没注册内容"的模板。
 */
export interface TemplateUsage {
  /** 引用该模板的 workflow 名。 */
  workflow: string;
  /** 节点 id（结构路径），定位到画布上的具体节点。 */
  nodeId: string;
  /** 该处传入的 props：值可能是字面量或用户属性引用。 */
  props: Record<string, unknown>;
}

export interface TemplateRefInfo {
  key: string;
  channel: string;
  /** 全部引用处——同一模板可被多个流程用、且各传各的 props。 */
  usages: TemplateUsage[];
}

/** 深度遍历 IR 节点树（分支臂 / cohort 臂 / waitUntil 超时子流程都要下钻）。 */
function walk(nodes: readonly NodeIR[], visit: (node: NodeIR) => void): void {
  for (const node of nodes) {
    visit(node);
    switch (node.type) {
      case 'branch':
        for (const branchCase of node.cases) walk(branchCase.flow, visit);
        if (node.otherwise) walk(node.otherwise, visit);
        break;
      case 'cohort':
        for (const arm of node.arms) walk(arm.flow, visit);
        break;
      case 'wait_until':
        if (Array.isArray(node.onTimeout)) walk(node.onTimeout, visit);
        break;
      default:
        break;
    }
  }
}

export function collectTemplateRefs(irs: readonly WorkflowIR[]): TemplateRefInfo[] {
  const byKey = new Map<string, TemplateRefInfo>();
  for (const ir of irs) {
    walk(ir.flow, (node) => {
      if (node.type !== 'message') return;
      const usage: TemplateUsage = { workflow: ir.name, nodeId: node.id, props: node.props };
      const found = byKey.get(node.template);
      if (found) {
        found.usages.push(usage);
        return;
      }
      byKey.set(node.template, {
        key: node.template,
        channel: node.channel,
        usages: [usage],
      });
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}
