import {
  Background,
  Controls,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import { Clock, LogOut } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import type { WorkflowIR } from '../ir';
import { CARD_SIZE, COMPACT_SIZE, type CanvasNodeData, type NodeIcon, layout } from './layout';

/** 只读 workflow 画布：消费 IR 渲染，结构 code-owned，UI 不提供编辑。 */
export interface WorkflowCanvasProps {
  ir: WorkflowIR;
}

const superellipse = { cornerShape: 'superellipse(1.2)' } as CSSProperties;

const baseCard: CSSProperties = {
  boxSizing: 'border-box',
  background: '#fff',
  border: '1px solid #e2e8f0',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  overflow: 'hidden',
  ...superellipse,
};

const cardStyle: CSSProperties = {
  ...baseCard,
  width: CARD_SIZE.w,
  height: CARD_SIZE.h,
  padding: '14px 16px',
  borderRadius: 12,
};

const compactStyle: CSSProperties = {
  ...baseCard,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: COMPACT_SIZE.w,
  height: COMPACT_SIZE.h,
  padding: '0 14px',
  borderRadius: 10,
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#0f172a',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const subtitleStyle: CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: '#64748b',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const compactTitleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#334155',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const handleStyle: CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0 };

const ICONS: Record<NodeIcon, typeof Clock> = { clock: Clock, exit: LogOut };

type WfNode = Node<CanvasNodeData, 'wf'>;

function WorkflowNode({ data }: NodeProps<WfNode>) {
  const Icon = data.icon ? ICONS[data.icon] : undefined;

  const body =
    data.variant === 'compact' ? (
      <div style={compactStyle}>
        {Icon && <Icon size={15} color="#64748b" strokeWidth={2} aria-hidden />}
        <span style={compactTitleStyle}>{data.title}</span>
      </div>
    ) : (
      <div style={cardStyle}>
        <div style={titleStyle}>{data.title}</div>
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

export function WorkflowCanvas({ ir }: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => layout(ir), [ir]);
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        defaultEdgeOptions={{
          type: 'smoothstep',
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
