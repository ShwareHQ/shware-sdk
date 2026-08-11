import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import {
  AlarmClock,
  BellRing,
  CalendarClock,
  ClipboardList,
  Filter,
  GitBranch,
  Hourglass,
  LogOut,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Send,
  Shuffle,
  SquareArrowOutUpRight,
  User,
  Zap,
} from 'lucide-react';
import { type CSSProperties, createContext, useContext, useMemo } from 'react';
import type { WorkflowIR } from '../ir';
import {
  CARD_SIZE,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  ICON_SIZE,
  type NodeIcon,
  type NodeStats,
  layout,
} from './layout';

/**
 * Read-only workflow canvas: renders IR. Structure is code-owned, so the UI
 * offers no editing.
 *
 * Rendering principle — HTML-first and pixel-exact: node cards and edge labels
 * are always HTML (fonts and line heights on tailwind's scale, and new CSS such
 * as corner-shape is available). SVG is kept only for what react-flow's
 * architecture requires — the connector paths and their endpoint markers — with
 * every parameter passed explicitly. SVG EdgeText is not used: its size follows
 * the font's bounding box and cannot be pinned to exact pixels.
 */
export interface WorkflowCanvasProps {
  ir: WorkflowIR;
  /** Node id → users currently waiting there (from the engine's stats API); no badge without it. */
  stats?: NodeStats;
  /**
   * Open the template a message node references; the host decides how to
   * navigate (route, new window, side panel). The icon only appears on message
   * cards when this is provided — the library never assumes the host has a
   * template preview.
   */
  onOpenTemplate?: (templateKey: string) => void;
}

/** The callback travels by context: react-flow node data should carry serializable data only. */
const OpenTemplateContext = createContext<((templateKey: string) => void) | undefined>(undefined);

const ICONS: Record<NodeIcon, LucideIcon> = {
  trigger: Zap,
  email: Mail,
  sms: MessageSquareText,
  push: BellRing,
  in_app: MessageCircle,
  slack: MessagesSquare,
  survey: ClipboardList,
  delay: AlarmClock,
  time_window: CalendarClock,
  wait_until: Hourglass,
  branch: GitBranch,
  filter: Filter,
  cohort: Shuffle,
  exit: LogOut,
  send_event: Send,
};

const superellipse = { cornerShape: 'superellipse(1.2)' } as CSSProperties;

/** No border — elevation comes from shadow alone (customer.io's look). */
const baseCard: CSSProperties = {
  boxSizing: 'border-box',
  background: '#fff',
  boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.04), 0 2px 4px rgba(15, 23, 42, 0.08)',
  fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
  overflow: 'hidden',
  ...superellipse,
};

/** Flex column, centred: top and bottom whitespace stay equal without hand-balancing padding against line height. */
const cardStyle: CSSProperties = {
  ...baseCard,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  width: CARD_SIZE.w,
  height: CARD_SIZE.h,
  padding: '0 16px',
  borderRadius: 12,
};

const iconStyle: CSSProperties = {
  ...baseCard,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  // Width follows content; 12 on the icon side, 16 on the text side — optical balance for icon+label
  width: 'fit-content',
  height: ICON_SIZE.h,
  padding: '0 16px 0 12px',
  // Stadium pill: radius = half the height, with round corners restored (superellipse would flatten the ends)
  borderRadius: 16,
  ...({ cornerShape: 'round' } as CSSProperties),
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 600,
  color: '#334155',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const titleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: '#0f172a',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const countStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
  color: '#0f172a',
};

const subtitleStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  lineHeight: '16px',
  color: '#64748b',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const handleStyle: CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0 };

/** Open-template button: a borderless icon button in the card's top-right corner. */
const linkButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer',
  pointerEvents: 'auto',
};

type WfNode = Node<CanvasNodeData, 'wf'>;

function WorkflowNode({ data }: NodeProps<WfNode>) {
  const Icon = ICONS[data.icon];
  const onOpenTemplate = useContext(OpenTemplateContext);
  const templateKey = data.templateKey;

  const body =
    data.variant === 'icon' ? (
      // Small pill (exit): icon plus a short label, with reason in the tooltip
      <div
        style={iconStyle}
        title={data.subtitle ? `${data.title} · ${data.subtitle}` : data.title}
      >
        <Icon size={14} color="#334155" strokeWidth={2} aria-hidden />
        {data.title}
      </div>
    ) : (
      <div style={cardStyle}>
        <div style={headerStyle}>
          <Icon size={15} color="#334155" strokeWidth={2} aria-hidden />
          <span style={titleStyle}>{data.title}</span>
          {data.count !== undefined && (
            <span style={countStyle}>
              <User size={14} color="#64748b" strokeWidth={2} aria-hidden />
              {data.count}
            </span>
          )}
          {onOpenTemplate !== undefined && templateKey !== undefined && (
            <button
              type="button"
              className="nodrag nopan"
              style={linkButtonStyle}
              title={`Open template: ${templateKey}`}
              aria-label={`Open template ${templateKey}`}
              onClick={() => onOpenTemplate(templateKey)}
            >
              <SquareArrowOutUpRight size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
        {data.subtitle !== undefined && <div style={subtitleStyle}>{data.subtitle}</div>}
      </div>
    );

  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      {body}
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
    </>
  );
}

const nodeTypes = { wf: WorkflowNode };

/** Edge label pill: 32px tall (8-grid), fully rounded, typography on tailwind's text-xs (12px / 16px). */
const edgeLabelStyle: CSSProperties = {
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  height: 32,
  padding: '0 12px',
  borderRadius: 16,
  background: '#fff',
  border: '1px solid #e2e8f0',
  fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 500,
  color: '#475569',
  pointerEvents: 'none',
};

type WfEdge = Edge<{ anchor?: 'source' | 'target' }, 'wf'>;

/* ----------------------------- Connector routing ---------------------------- */

/** One bend radius for every corner. */
const BEND = 16;
/**
 * Corner control-point factor. A circular arc's classic value is 0.552; pulling
 * it out to 0.9 squares the shoulder off, approximating the look of
 * corner-shape: superellipse. (CSS corner-shape does not apply to SVG paths, so
 * the shape is built by hand from cubic béziers.)
 */
const SQUIRCLE = 0.9;

/** A superellipse shoulder bending from (x1,y1) through the corner (cx,cy) to (x2,y2). */
function corner(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number): string {
  const c1x = x1 + (cx - x1) * SQUIRCLE;
  const c1y = y1 + (cy - y1) * SQUIRCLE;
  const c2x = x2 + (cx - x2) * SQUIRCLE;
  const c2y = y2 + (cy - y2) * SQUIRCLE;
  return `C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

/** Three-segment orthogonal route (down, across, down); `splitY` is where the horizontal run sits. */
function orthogonalPath(sx: number, sy: number, tx: number, ty: number, splitY: number): string {
  const dx = tx - sx;
  if (Math.abs(dx) < 1) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const dir = Math.sign(dx);
  const r = Math.max(0, Math.min(BEND, Math.abs(dx) / 2, splitY - sy, ty - splitY));
  return [
    `M ${sx} ${sy}`,
    `L ${sx} ${splitY - r}`,
    corner(sx, splitY - r, sx, splitY, sx + dir * r, splitY),
    `L ${tx - dir * r} ${splitY}`,
    corner(tx - dir * r, splitY, tx, splitY, tx, splitY + r),
    `L ${tx} ${ty}`,
  ].join(' ');
}

/**
 * Custom edge with an HTML label: SVG EdgeText's height floats with the font's
 * bounding box, and only HTML can be pinned to exact pixels.
 *
 * Labels anchor one of two ways — never at the path midpoint, since a short
 * horizontal run would disappear entirely behind the pill:
 * - target: above the arm's entry corner (a real arm; customer.io's position)
 * - source: right below the deciding node (empty pass-through arm, which also
 *   keeps several merge-edge labels from colliding at the far end)
 */
function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  style,
  data,
}: EdgeProps<WfEdge>) {
  // Fork edges (labelled) split after a 28px stem; everything else (merges) runs through the midpoint
  const splitY = label ? sourceY + 28 : (sourceY + targetY) / 2;
  const path = orthogonalPath(sourceX, sourceY, targetX, targetY, splitY);
  // The label hangs below the split line, pinned to its own arm's column
  const labelPos = {
    x: data?.anchor === 'source' ? sourceX : targetX,
    y: sourceY + 56,
  };
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {/* Connection point: a hollow circle instead of an arrowhead, matching the wire's stroke and colour */}
      <circle cx={targetX} cy={targetY - 4} r={3.5} fill="#fff" stroke="#cbd5e1" strokeWidth={1} />
      {!!label && (
        <EdgeLabelRenderer>
          <div
            style={{
              ...edgeLabelStyle,
              transform: `translate(-50%, -50%) translate(${labelPos.x}px, ${labelPos.y}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { wf: WorkflowEdge };

export function WorkflowCanvas({ ir, stats, onOpenTemplate }: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => layout(ir, stats), [ir, stats]);
  return (
    <OpenTemplateContext value={onOpenTemplate}>
      <CanvasSurface nodes={nodes} edges={edges} />
    </OpenTemplateContext>
  );
}

function CanvasSurface({ nodes, edges }: { nodes: CanvasNode[]; edges: CanvasEdge[] }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        defaultEdgeOptions={{
          type: 'wf',
          style: { stroke: '#cbd5e1' },
        }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
