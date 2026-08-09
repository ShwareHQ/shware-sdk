import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  getSmoothStepPath,
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
  User,
  Zap,
} from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import type { WorkflowIR } from '../ir';
import {
  CARD_SIZE,
  type CanvasNodeData,
  ICON_SIZE,
  type NodeIcon,
  type NodeStats,
  layout,
} from './layout';

/**
 * 只读 workflow 画布：消费 IR 渲染，结构 code-owned，UI 不提供编辑。
 *
 * 渲染原则：HTML-first、像素可控——节点卡片与边标签一律 HTML（字体/行高
 * 对齐 tailwind 规格，支持 corner-shape 等新 CSS）；SVG 仅保留 react-flow
 * 架构必需的连线 path 与箭头 marker，其参数（stroke/箭头尺寸颜色）全部
 * 经 props 显式控制。不用 SVG EdgeText（尺寸随字体 bbox 浮动，不可钉死）。
 */
export interface WorkflowCanvasProps {
  ir: WorkflowIR;
  /** 节点 id → 当前停留人数（引擎统计接口提供；缺省不渲染徽标）。 */
  stats?: NodeStats;
}

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

/** 无描边，纯阴影浮起（customer.io 同款）。 */
const baseCard: CSSProperties = {
  boxSizing: 'border-box',
  background: '#fff',
  boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.04), 0 2px 4px rgba(15, 23, 42, 0.08)',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  overflow: 'hidden',
  ...superellipse,
};

/** flex 列垂直居中：上下留白恒等，不依赖 padding 与行高的手工对账。 */
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
  width: ICON_SIZE.w,
  height: ICON_SIZE.h,
  borderRadius: 10,
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

type WfNode = Node<CanvasNodeData, 'wf'>;

function WorkflowNode({ data }: NodeProps<WfNode>) {
  const Icon = ICONS[data.icon];

  const body =
    data.variant === 'icon' ? (
      // 小胶囊卡（exit）：图标 + 短文案，reason 进 tooltip
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

/** 边标签胶囊：28px 高、全圆角，字体对齐 tailwind text-xs（12px / 16px）。 */
const edgeLabelStyle: CSSProperties = {
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  height: 28,
  padding: '0 14px',
  borderRadius: 14,
  background: '#fff',
  border: '1px solid #e2e8f0',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  fontSize: 12,
  lineHeight: '16px',
  fontWeight: 500,
  color: '#475569',
  pointerEvents: 'none',
};

type WfEdge = Edge<{ anchor?: 'source' | 'target' }, 'wf'>;

/**
 * HTML 标签的自定义边：SVG EdgeText 的高度随字体 bbox 浮动，HTML 才能钉死像素。
 * 标签锚点两档（不用路径中点——短水平段会被胶囊整段盖住）：
 * - target：臂入口拐角上方（实臂，customer.io 的分支标签位）
 * - source：决策节点正下方（空臂直落，避免多条汇合边的标签在远端相撞）
 */
function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  label,
  markerEnd,
  style,
  data,
}: EdgeProps<WfEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12, // 大圆角：分叉读作"一条主线劈开"而非直角折线
  });
  // 标签垂在分叉线（arm gap 112 的中线 56）下方，钉在所属臂的立柱上
  const labelPos = {
    x: data?.anchor === 'source' ? sourceX : targetX,
    y: sourceY + 80,
  };
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
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

export function WorkflowCanvas({ ir, stats }: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => layout(ir, stats), [ir, stats]);
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
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#94a3b8' },
          style: { stroke: '#cbd5e1' },
        }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
