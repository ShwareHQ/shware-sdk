import {
  Background,
  Controls,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import { type CSSProperties, useMemo } from 'react';
import type { WorkflowIR } from '../ir';
import { type CanvasNodeData, layout } from './layout';

/** 只读 workflow 画布：消费 IR 渲染，结构 code-owned，UI 不提供编辑。 */
export interface WorkflowCanvasProps {
  ir: WorkflowIR;
}

const cardStyle = {
  width: 260,
  height: 76,
  boxSizing: 'border-box',
  padding: '14px 16px',
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  cornerShape: 'superellipse(1.2)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  overflow: 'hidden',
} as CSSProperties;

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

const handleStyle: CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0 };

type WfNode = Node<CanvasNodeData, 'wf'>;

function WorkflowNode({ data }: NodeProps<WfNode>) {
  return (
    <div style={cardStyle}>
      <Handle type="target" position={Position.Top} style={handleStyle} isConnectable={false} />
      <div style={titleStyle}>{data.title}</div>
      {data.subtitle !== undefined && <div style={subtitleStyle}>{data.subtitle}</div>}
      <Handle type="source" position={Position.Bottom} style={handleStyle} isConnectable={false} />
    </div>
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
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
