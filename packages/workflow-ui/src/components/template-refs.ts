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

const TEMPLATE_CHANNELS = new Set(['email', 'push', 'discord', 'slack']);

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

/**
 * One entry per template — per channel and key, since one key can name an
 * email and a push, and their usages must not run together.
 */
export function collectTemplateRefs(irs: readonly WorkflowIR[]): TemplateRefInfo[] {
  const byKey = new Map<string, TemplateRefInfo>();
  for (const ir of irs) {
    walk(ir.flow, (node) => {
      // Only the template channels have registries; other channels' messages have nothing to preview
      if (node.type !== 'message' || !TEMPLATE_CHANNELS.has(node.channel)) return;
      const usage: TemplateUsage = { workflow: ir.id, nodeId: node.id, props: node.props };
      const id = `${node.channel}:${node.template}`;
      const found = byKey.get(id);
      if (found) {
        found.usages.push(usage);
        return;
      }
      byKey.set(id, {
        key: node.template,
        channel: node.channel,
        usages: [usage],
      });
    });
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel)
  );
}

/**
 * Every template the studio can show: each registered one — referenced or
 * not yet, so a template can be previewed before a flow uses it — plus each
 * one the IR references without registering it (shown as missing). The IR
 * only adds the use sites.
 */
export function collectTemplates(
  irs: readonly WorkflowIR[],
  registries: { emails?: object; pushes?: object; discords?: object; slacks?: object }
): TemplateRefInfo[] {
  const byKey = new Map(collectTemplateRefs(irs).map((ref) => [`${ref.channel}:${ref.key}`, ref]));
  for (const [channel, registry] of [
    ['email', registries.emails],
    ['push', registries.pushes],
    ['discord', registries.discords],
    ['slack', registries.slacks],
  ] as const) {
    for (const key of Object.keys(registry ?? {})) {
      if (!byKey.has(`${channel}:${key}`))
        byKey.set(`${channel}:${key}`, { key, channel, usages: [] });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.key.localeCompare(b.key) || a.channel.localeCompare(b.channel)
  );
}

/** Find one node by its structural id, arms and timeout lanes included. */
export function findNode(ir: WorkflowIR, id: string): NodeIR | undefined {
  let found: NodeIR | undefined;
  walk(ir.flow, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}
