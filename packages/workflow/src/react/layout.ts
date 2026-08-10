import type { ConditionIR, NodeIR, WorkflowIR } from '../ir';

/**
 * IR → react-flow 节点/边的树布局。
 *
 * IR 是结构化的树（非任意图），所以不需要 dagre/elkjs：垂直主脊 +
 * 分支列左右展开 + 汇合边，customer.io 同款视觉，递归一次算完。
 * 布局是纯函数：同一份 IR（+ 可选 stats）永远得到同一张图。
 */

export type NodeCategory = 'trigger' | 'message' | 'delay' | 'control' | 'data' | 'exit';

export type NodeIcon =
  | 'trigger'
  | 'email'
  | 'sms'
  | 'push'
  | 'in_app'
  | 'slack'
  | 'survey'
  | 'delay'
  | 'time_window'
  | 'wait_until'
  | 'branch'
  | 'filter'
  | 'cohort'
  | 'exit'
  | 'send_event';

export interface CanvasNodeData extends Record<string, unknown> {
  title: string;
  subtitle?: string;
  category: NodeCategory;
  /** card：常规卡（图标 + 标题 + 副标题 + 人数徽标）；icon：纯图标（exit）。 */
  variant: 'card' | 'icon';
  icon: NodeIcon;
  /** 当前停留在该节点的人数（运行时统计，经 stats 注入）。 */
  count?: number;
}

/** 卡片尺寸：布局与渲染的单一来源（组件按 variant 取用）。全部对齐 16/8 网格。 */
export const CARD_SIZE = { w: 288, h: 64 } as const;
/** icon 变体渲染为自适应宽度胶囊，此处 w 是定位用的估计值（实测 'Exit' ≈ 69px）。 */
export const ICON_SIZE = { w: 68, h: 32 } as const;

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
  /** 标签锚点：target=臂入口拐角（实臂）；source=决策节点正下方（空臂直落）。 */
  data?: { anchor: 'source' | 'target' };
}

/** 节点 id → 当前停留人数（将来由引擎统计接口提供）。 */
export type NodeStats = Record<string, number>;

/**
 * 间距分层：直落序列紧凑，分叉处铺开（容纳圆角劈开 + 垂标签 +
 * 将来的插入动作按钮）；汇合处比序列稍松让合流线有余量。
 */
const W = CARD_SIZE.w;
const VGAP = 48; // 序列内 node → node
const FORK_GAP = 112; // 分叉节点底 → 臂顶（短柄 24 即劈开，标签垂在 54）
const REJOIN_EXTRA = 24; // 汇合处在 VGAP 之上追加
const HGAP = 88;

function nodeSize(n: NodeIR): { w: number; h: number } {
  return n.type === 'exit' ? ICON_SIZE : CARD_SIZE;
}

/** 有子分组的节点统一抽象：branch 的 cases/otherwise、cohort 的臂、waitUntil 的超时侧线。 */
interface Group {
  label: string;
  nodes: NodeIR[];
}

/** 属性运算符 → 标签符号（eq/ne/gt/lt 用数学符号，集合与文本类保留短词）。 */
const OP_LABEL: Record<string, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  lt: '<',
  between: 'between',
  in_array: 'in',
  not_in_array: 'not in',
  exists: 'exists',
  not_exists: 'not exists',
  contains: 'contains',
  not_contains: 'not contains',
};

function conditionLabel(c: ConditionIR, fallback: string): string {
  if (c.type === 'segment') return c.segment;
  if (c.type === 'not') return `not ${conditionLabel(c.condition, fallback)}`;
  if (c.type === 'property') {
    const op = OP_LABEL[c.op] ?? c.op;
    const value =
      c.op === 'between'
        ? `${c.values?.[0]} – ${c.values?.[1]}`
        : c.op === 'in_array' || c.op === 'not_in_array'
          ? `[${c.values?.join(', ')}]`
          : c.value !== undefined
            ? String(c.value)
            : '';
    return value === '' ? `${c.path} ${op}` : `${c.path} ${op} ${value}`;
  }
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
  if (!groups) return nodeSize(n).w;
  return (
    groups.reduce((sum, g) => sum + Math.max(W, seqWidth(g.nodes)), 0) + HGAP * (groups.length - 1)
  );
}

const CHANNEL_TITLE: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  push: 'Push Notification',
  in_app: 'In-App Message',
  slack: 'Slack Message',
  survey: 'Survey',
};

function nodeData(n: NodeIR): CanvasNodeData {
  switch (n.type) {
    case 'message':
      return {
        title: CHANNEL_TITLE[n.channel] ?? n.channel,
        subtitle: n.template,
        category: 'message',
        variant: 'card',
        icon: n.channel,
      };
    case 'delay':
      return {
        title: 'Time Delay',
        subtitle: `Wait ${n.duration.value}`,
        category: 'delay',
        variant: 'card',
        icon: 'delay',
      };
    case 'random_delay':
      return {
        title: 'Randomized Delay',
        subtitle: `Wait ${n.min.value} – ${n.max.value}`,
        category: 'delay',
        variant: 'card',
        icon: 'delay',
      };
    case 'time_window':
      return {
        title: 'Time Window',
        subtitle: `${n.days.join(' ')} ${n.between[0]}–${n.between[1]}`,
        category: 'delay',
        variant: 'card',
        icon: 'time_window',
      };
    case 'wait_until':
      return {
        title: 'Wait Until…',
        subtitle: `timeout ${n.timeout.value}`,
        category: 'delay',
        variant: 'card',
        icon: 'wait_until',
      };
    case 'branch': {
      const arms = n.cases.length + 1;
      return {
        title: n.label ?? (n.cases.length > 1 ? 'Multi-Split Branch' : 'True/False Branch'),
        subtitle: `${arms} arms, first match`,
        category: 'control',
        variant: 'card',
        icon: 'branch',
      };
    }
    case 'filter':
      return {
        title: 'Filter',
        subtitle: n.reason ?? 'only continue if…',
        category: 'control',
        variant: 'card',
        icon: 'filter',
      };
    case 'cohort':
      return {
        title: 'Random Cohort',
        subtitle: n.arms.map((a) => `${a.name} ${a.weight}%`).join(' / '),
        category: 'control',
        variant: 'card',
        icon: 'cohort',
      };
    case 'exit':
      return {
        title: 'Exit',
        // reason 不占画布，进 hover tooltip
        ...(n.reason !== undefined ? { subtitle: n.reason } : {}),
        category: 'exit',
        variant: 'icon',
        icon: 'exit',
      };
    case 'send_event':
      return {
        title: 'Send Event',
        subtitle: n.event,
        category: 'data',
        variant: 'card',
        icon: 'send_event',
      };
  }
}

interface Tail {
  id: string;
  label?: string;
  anchor?: 'source' | 'target';
}

export function layout(
  ir: WorkflowIR,
  stats?: NodeStats
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  let edgeSeq = 0;

  const addNode = (id: string, x: number, y: number, data: CanvasNodeData): void => {
    const count = stats?.[id];
    nodes.push({
      id,
      type: 'wf',
      position: { x, y },
      data: count === undefined ? data : { ...data, count },
    });
  };

  const addEdges = (tails: Tail[], target: string): void => {
    for (const t of tails) {
      edges.push({
        id: `e${edgeSeq++}`,
        source: t.id,
        target,
        ...(t.label !== undefined ? { label: t.label } : {}),
        ...(t.anchor !== undefined ? { data: { anchor: t.anchor } } : {}),
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
      const size = nodeSize(n);
      addNode(n.id, cx - size.w / 2, curY, nodeData(n));
      addEdges(tails, n.id);
      const bottom = curY + size.h;

      if (n.type === 'exit') {
        tails = []; // 终止：不再向下连
        curY = bottom + VGAP;
        continue;
      }

      const groups = groupsOf(n);
      if (!groups) {
        tails = [{ id: n.id }];
        curY = bottom + VGAP;
        continue;
      }

      const widths = groups.map((g) => Math.max(W, seqWidth(g.nodes)));
      const total = widths.reduce((a, b) => a + b, 0) + HGAP * (groups.length - 1);
      let gx = cx - total / 2;
      const groupTop = bottom + FORK_GAP;
      let maxBottom = groupTop;
      const groupTails: Tail[] = [];

      groups.forEach((g, gi) => {
        const center = gx + (widths[gi] ?? W) / 2;
        if (g.nodes.length === 0) {
          // 空分组：父节点直接向下汇合，标签锚在父节点正下方
          groupTails.push({ id: n.id, label: g.label, anchor: 'source' });
        } else {
          const r = layoutSeq(g.nodes, center, groupTop, [
            { id: n.id, label: g.label, anchor: 'target' },
          ]);
          groupTails.push(...r.tails);
          maxBottom = Math.max(maxBottom, r.bottom);
        }
        gx += (widths[gi] ?? W) + HGAP;
      });

      tails = groupTails;
      curY = maxBottom + REJOIN_EXTRA;
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
  addNode('__trigger', -CARD_SIZE.w / 2, 0, {
    title: 'Trigger',
    subtitle: triggerSubtitle,
    category: 'trigger',
    variant: 'card',
    icon: 'trigger',
  });

  const { bottom, tails } = layoutSeq(ir.flow, 0, CARD_SIZE.h + VGAP, [{ id: '__trigger' }]);

  // 收尾 Exit 节点（customer.io 同款显式终点）；全部提前 exit 则不需要
  if (tails.length > 0) {
    addNode('__end', -ICON_SIZE.w / 2, bottom, {
      title: 'Exit',
      category: 'exit',
      variant: 'icon',
      icon: 'exit',
    });
    addEdges(tails, '__end');
  }

  return { nodes, edges };
}
