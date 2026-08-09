import type { ConditionIR, NodeIR, WorkflowIR } from '../ir';

/**
 * IR → react-flow 节点/边的树布局。
 *
 * IR 是结构化的树（非任意图），所以不需要 dagre/elkjs：垂直主脊 +
 * 分支列左右展开 + 汇合边，customer.io 同款视觉，递归一次算完。
 * 布局是纯函数：同一份 IR 永远得到同一张图（diff 截图稳定）。
 */

export type NodeCategory = 'trigger' | 'message' | 'delay' | 'control' | 'data' | 'exit';

export interface CanvasNodeData extends Record<string, unknown> {
  title: string;
  subtitle?: string;
  category: NodeCategory;
}

export interface CanvasNode {
  id: string;
  type: 'wf';
  position: { x: number; y: number };
  data: CanvasNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

const W = 260;
const H = 76;
const VGAP = 64;
const HGAP = 56;

/** 有子分组的节点统一抽象：branch 的 cases/otherwise、cohort 的臂、waitUntil 的超时侧线。 */
interface Group {
  label: string;
  nodes: NodeIR[];
}

function conditionLabel(c: ConditionIR, fallback: string): string {
  if (c.type === 'segment') return c.segment;
  if (c.type === 'not') return `not ${conditionLabel(c.condition, fallback)}`;
  if (c.type === 'property') return `${c.path} ${c.op}`;
  if (c.type === 'performed') return `did ${c.event}`;
  return fallback;
}

function groupsOf(n: NodeIR): Group[] | null {
  switch (n.type) {
    case 'branch': {
      const groups = n.cases.map((c, i) => ({
        label: c.label ?? conditionLabel(c.condition, `case ${i + 1}`),
        nodes: c.flow,
      }));
      groups.push({ label: 'else', nodes: n.otherwise ?? [] });
      return groups;
    }
    case 'cohort':
      return n.arms.map((a) => ({ label: `${a.name} · ${a.weight}%`, nodes: a.flow }));
    case 'wait_until':
      if (Array.isArray(n.onTimeout)) {
        return [
          { label: 'met', nodes: [] },
          { label: 'timeout', nodes: n.onTimeout },
        ];
      }
      return null;
    default:
      return null;
  }
}

function seqWidth(nodes: NodeIR[]): number {
  return nodes.length === 0 ? W : Math.max(...nodes.map(nodeWidth));
}

function nodeWidth(n: NodeIR): number {
  const groups = groupsOf(n);
  if (!groups) return W;
  return (
    groups.reduce((sum, g) => sum + Math.max(W, seqWidth(g.nodes)), 0) + HGAP * (groups.length - 1)
  );
}

function nodeData(n: NodeIR): CanvasNodeData {
  switch (n.type) {
    case 'message': {
      const channel: Record<string, string> = {
        email: 'Email',
        sms: 'SMS',
        push: 'Push Notification',
        in_app: 'In-App Message',
        slack: 'Slack Message',
        survey: 'Survey',
      };
      return { title: channel[n.channel] ?? n.channel, subtitle: n.template, category: 'message' };
    }
    case 'delay':
      return { title: 'Time Delay', subtitle: `Wait ${n.duration.value}`, category: 'delay' };
    case 'random_delay':
      return {
        title: 'Randomized Delay',
        subtitle: `${n.min.value} – ${n.max.value}`,
        category: 'delay',
      };
    case 'time_window':
      return {
        title: 'Time Window',
        subtitle: `${n.days.join(' ')} ${n.between[0]}–${n.between[1]}`,
        category: 'delay',
      };
    case 'wait_until':
      return { title: 'Wait Until…', subtitle: `timeout ${n.timeout.value}`, category: 'delay' };
    case 'branch': {
      const arms = n.cases.length + 1;
      return {
        title: n.label ?? (n.cases.length > 1 ? 'Multi-Split Branch' : 'True/False Branch'),
        subtitle: `${arms} arms, first match`,
        category: 'control',
      };
    }
    case 'filter':
      return { title: 'Filter', subtitle: n.reason ?? 'only continue if…', category: 'control' };
    case 'cohort':
      return {
        title: 'Random Cohort',
        subtitle: n.arms.map((a) => `${a.name} ${a.weight}%`).join(' / '),
        category: 'control',
      };
    case 'exit':
      return { title: 'Exit', subtitle: n.reason, category: 'exit' };
    case 'send_event':
      return { title: 'Send Event', subtitle: n.event, category: 'data' };
  }
}

interface Tail {
  id: string;
  label?: string;
}

export function layout(ir: WorkflowIR): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  let edgeSeq = 0;

  const addNode = (id: string, x: number, y: number, data: CanvasNodeData): void => {
    nodes.push({ id, type: 'wf', position: { x, y }, data });
  };

  const addEdges = (tails: Tail[], target: string): void => {
    for (const t of tails) {
      edges.push({
        id: `e${edgeSeq++}`,
        source: t.id,
        target,
        ...(t.label !== undefined ? { label: t.label } : {}),
      });
    }
  };

  /** 递归布局一段序列：cx 为水平中心线，返回底部 y 与继续向下的尾巴。 */
  function layoutSeq(
    seq: NodeIR[],
    cx: number,
    y: number,
    incoming: Tail[]
  ): {
    bottom: number;
    tails: Tail[];
  } {
    let curY = y;
    let tails = incoming;

    for (const n of seq) {
      addNode(n.id, cx - W / 2, curY, nodeData(n));
      addEdges(tails, n.id);
      curY += H + VGAP;

      if (n.type === 'exit') {
        tails = []; // 终止：不再向下连
        continue;
      }

      const groups = groupsOf(n);
      if (!groups) {
        tails = [{ id: n.id }];
        continue;
      }

      const widths = groups.map((g) => Math.max(W, seqWidth(g.nodes)));
      const total = widths.reduce((a, b) => a + b, 0) + HGAP * (groups.length - 1);
      let gx = cx - total / 2;
      const groupTop = curY;
      let maxBottom = groupTop;
      const groupTails: Tail[] = [];

      groups.forEach((g, gi) => {
        const center = gx + (widths[gi] ?? W) / 2;
        if (g.nodes.length === 0) {
          // 空分组：父节点直接向下汇合，边带分组标签
          groupTails.push({ id: n.id, label: g.label });
        } else {
          const r = layoutSeq(g.nodes, center, groupTop, [{ id: n.id, label: g.label }]);
          groupTails.push(...r.tails);
          maxBottom = Math.max(maxBottom, r.bottom);
        }
        gx += (widths[gi] ?? W) + HGAP;
      });

      tails = groupTails;
      curY = maxBottom;
    }

    return { bottom: curY, tails };
  }

  // Trigger 节点
  const t = ir.trigger;
  const triggerSubtitle =
    t.type === 'event'
      ? `${t.event}${t.filter ? ' · +filter' : ''}`
      : t.type === 'segment'
        ? `enters ${t.segment}`
        : t.type === 'date'
          ? t.at
          : 'webhook';
  addNode('__trigger', -W / 2, 0, {
    title: 'Trigger',
    subtitle: triggerSubtitle,
    category: 'trigger',
  });

  const { bottom, tails } = layoutSeq(ir.flow, 0, H + VGAP, [{ id: '__trigger' }]);

  // 收尾 Exit 节点（customer.io 同款显式终点）；全部提前 exit 则不需要
  if (tails.length > 0) {
    addNode('__end', -W / 2, bottom, { title: 'Exit', category: 'exit' });
    addEdges(tails, '__end');
  }

  return { nodes, edges };
}
