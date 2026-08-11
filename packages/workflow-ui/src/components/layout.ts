import type { ConditionIR, NodeIR, WorkflowIR } from '@shware/workflow';
import type { NodeStats } from '../config';

/**
 * Tree layout: IR → react-flow nodes and edges.
 *
 * IR is a structured tree rather than an arbitrary graph, so dagre/elkjs are
 * unnecessary: a vertical spine, branch columns fanning out left and right,
 * and rejoin edges — customer.io's look, computed in a single recursion.
 * Layout is a pure function: the same IR (plus optional stats) always yields
 * the same picture.
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
  /** card: the regular card (icon + title + subtitle + count badge); icon: icon-only pill (exit). */
  variant: 'card' | 'icon';
  icon: NodeIcon;
  /** How many users currently sit on this node (runtime stats, injected via `stats`). */
  count?: number;
  /** Template key referenced by a message node; the host uses it to open a preview. */
  templateKey?: string;
}

/** Card sizes: the single source shared by layout and renderer, all on the 16/8 grid. */
export const CARD_SIZE = { w: 288, h: 64 } as const;
/** The icon variant renders as an auto-width pill; `w` here is a positioning estimate ('Exit' measures ≈ 69px). */
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
  /** Label anchor: `target` = the arm's entry corner (real arm); `source` = just below the deciding node (empty pass-through arm). */
  data?: { anchor: 'source' | 'target' };
}

/**
 * Tiered spacing: straight sequences stay tight, forks open up (room for the
 * rounded split, the hanging labels, and a future insert-action button), and
 * rejoins get slightly more than a sequence gap so merge lines have space.
 */
const W = CARD_SIZE.w;
const VGAP = 48; // node → node inside a sequence
const FORK_GAP = 112; // branching node's bottom → arm top (stem splits at 28, labels hang at 56)
const REJOIN_EXTRA = 24; // added on top of VGAP at a rejoin
const HGAP = 88;

function nodeSize(n: NodeIR): { w: number; h: number } {
  return n.type === 'exit' ? ICON_SIZE : CARD_SIZE;
}

/** Common abstraction for nodes with child groups: branch cases/otherwise, cohort arms, waitUntil's timeout lane. */
interface Group {
  label: string;
  nodes: NodeIR[];
}

/** Property operator → label symbol (math signs for eq/ne/gt/lt; set and text operators keep short words). */
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
        templateKey: n.template,
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
        // reason stays off the canvas and lives in the hover tooltip
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

  /** Lay out one sequence recursively: `cx` is the centre line; returns the bottom y and the tails that continue downward. */
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
        tails = []; // terminal: nothing connects downward
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
          // Empty group: the parent rejoins straight down, so anchor the label right below it
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

  // Trigger node
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

  // Closing Exit node (customer.io's explicit terminus); unnecessary when every path exits early
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
