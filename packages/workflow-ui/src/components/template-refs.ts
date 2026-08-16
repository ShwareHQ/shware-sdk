import type { NodeIR, WorkflowIR } from '@shware/workflow';

/**
 * Derive template references from IR — "which flows use which template" is not
 * a hand-maintained list but something computed from the middle layer. It also
 * surfaces templates that are referenced but have no content registered yet.
 */
export interface TemplateUsage {
  /** Name of the workflow referencing this template. */
  workflow: string;
  /** Node id (structural path), pinpointing the exact node on the canvas. */
  nodeId: string;
  /** Props passed at this site: each value is a literal or a user-property reference. */
  props: Record<string, unknown>;
}

export interface TemplateRefInfo {
  key: string;
  channel: string;
  /** Every use site — one template can be used by several flows, each passing its own props. */
  usages: TemplateUsage[];
}

/** Walk the IR node tree depth-first (branch arms, cohort arms and waitUntil timeout flows all included). */
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

/** Find one node by its structural id, arms and timeout lanes included. */
export function findNode(ir: WorkflowIR, id: string): NodeIR | undefined {
  let found: NodeIR | undefined;
  walk(ir.flow, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

/**
 * How many nodes were built by each source position.
 *
 * A helper reused across arms — `const eduModule = (t) => (w) => w.email(t).delay('1 week')`
 * — produces one call site and many nodes, so editing "this node's" value edits
 * every node the helper made. That is faithful to the code, but the panel has to
 * say so rather than imply the edit is local.
 */
export function nodesPerSourcePosition(ir: WorkflowIR): Map<string, number> {
  const counts = new Map<string, number>();
  walk(ir.flow, (node) => {
    const loc = node.meta?.loc;
    if (loc === undefined) return;
    const key = `${loc.file}:${loc.line}:${loc.column}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}
