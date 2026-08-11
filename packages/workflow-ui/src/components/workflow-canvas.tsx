import type { WorkflowIR } from '@shware/workflow';
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
import type { NodeStats } from '../config';
import { superellipse } from './corner-shape';
import {
  CARD_SIZE,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  ICON_SIZE,
  type NodeCategory,
  type NodeIcon,
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
  /**
   * Drives react-flow's own chrome (background dots, zoom controls). The card
   * and connector colours come from CSS variables and follow the host's theme
   * on their own; this is only for the parts react-flow paints itself. Passed
   * in rather than sniffed from the DOM, so an embedding app stays in control.
   */
  colorMode?: 'light' | 'dark';
}

/** The callback travels by context: react-flow node data should carry serializable data only. */
const OpenTemplateContext = createContext<((templateKey: string) => void) | undefined>(undefined);

/**
 * One hue per category, not per icon: six colours make a message, a wait and a
 * branch tell themselves apart at a glance; fifteen would just be noise. Values
 * live in CSS so they shift with the theme.
 */
const CATEGORY_COLOR: Record<NodeCategory, string> = {
  trigger: 'var(--color-icon-trigger)',
  message: 'var(--color-icon-message)',
  delay: 'var(--color-icon-delay)',
  control: 'var(--color-icon-control)',
  data: 'var(--color-icon-data)',
  exit: 'var(--color-icon-exit)',
};

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

/**
 * A 1px border and nothing else — no drop shadow. It takes --color-edge rather
 * than --color-border, so a card's outline and the connectors between cards are
 * the same weight: on a canvas the wiring is as much a first-class line as the
 * boxes, and one darker step is what replaces the lift the shadow used to give.
 * boxSizing is border-box, so the border sits inside CARD_SIZE and the layout
 * stays on its 8px steps.
 */
const baseCard: CSSProperties = {
  boxSizing: 'border-box',
  background: 'var(--color-card)',
  border: '1px solid var(--color-edge)',
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
  color: 'var(--color-secondary)',
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
  color: 'var(--color-primary)',
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
  color: 'var(--color-primary)',
};

const subtitleStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  lineHeight: '16px',
  color: 'var(--color-muted)',
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
  color: 'var(--color-muted)',
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
        <Icon size={14} color={CATEGORY_COLOR[data.category]} strokeWidth={2} aria-hidden />
        {data.title}
      </div>
    ) : (
      <div style={cardStyle}>
        <div style={headerStyle}>
          <Icon size={15} color={CATEGORY_COLOR[data.category]} strokeWidth={2} aria-hidden />
          <span style={titleStyle}>{data.title}</span>
          {data.count !== undefined && (
            <span style={countStyle}>
              <User size={14} color="var(--color-muted)" strokeWidth={2} aria-hidden />
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

/**
 * Edge label pill: 32px tall (8-grid), fully rounded, typography on tailwind's
 * text-xs (12px / 16px). Border on --color-edge like every other outline on the
 * canvas — cards, the exit pill and the connectors all draw at one weight.
 */
const edgeLabelStyle: CSSProperties = {
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  height: 32,
  padding: '0 12px',
  borderRadius: 16,
  background: 'var(--color-card)',
  border: '1px solid var(--color-edge)',
  fontFamily: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 500,
  color: 'var(--color-secondary)',
  pointerEvents: 'none',
};

type WfEdge = Edge<{ anchor?: 'source' | 'target' }, 'wf'>;

/* ----------------------------- Connector routing ---------------------------- */

/** One bend radius for every corner. */
const BEND = 16;
const DOT_R = 3.5;
/**
 * react-flow anchors its 1px handles just outside the node box, so both ends of
 * a connector stop one pixel short of the card: the line leaves the bottom edge
 * with a visible hairline under it, and the endpoint dot floats above the top
 * edge. Growing the path by this much at each end — and placing the dot's
 * bottom at the same point — closes both seams.
 */
const HANDLE_INSET = 1;
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
  const path = orthogonalPath(
    sourceX,
    sourceY - HANDLE_INSET,
    targetX,
    targetY + HANDLE_INSET,
    splitY
  );
  // The label hangs below the split line, pinned to its own arm's column
  const labelPos = {
    x: data?.anchor === 'source' ? sourceX : targetX,
    y: sourceY + 56,
  };
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {/* Connection point: a hollow circle instead of an arrowhead, matching the wire's stroke and colour */}
      <circle
        cx={targetX}
        cy={targetY + HANDLE_INSET - DOT_R}
        r={DOT_R}
        fill="var(--color-card)"
        stroke="var(--color-edge)"
        strokeWidth={1}
      />
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

export function WorkflowCanvas({
  ir,
  stats,
  onOpenTemplate,
  colorMode = 'light',
}: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => layout(ir, stats), [ir, stats]);
  return (
    <OpenTemplateContext value={onOpenTemplate}>
      <CanvasSurface nodes={nodes} edges={edges} colorMode={colorMode} />
    </OpenTemplateContext>
  );
}

function CanvasSurface({
  nodes,
  edges,
  colorMode,
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  colorMode: 'light' | 'dark';
}) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={colorMode}
        // Overrides react-flow's own dark surface, which sits between our page and card
        style={{ background: 'var(--color-canvas)' }}
        fitView
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        defaultEdgeOptions={{
          type: 'wf',
          style: { stroke: 'var(--color-edge)' },
        }}
      >
        <Background gap={16} color="var(--color-grid)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
