/**
 * Components for embedding the studio views in your own app. The CLI
 * (`workflow-ui`) composes exactly these — nothing is held back for it.
 */
export * from './config';
export { Button } from './components/button';
export type { Size as ButtonSize } from './components/button';
export { superellipse } from './components/corner-shape';
export { WorkflowCanvas } from './components/workflow-canvas';
export type { WorkflowCanvasProps } from './components/workflow-canvas';
export { TemplatesPage } from './components/templates-page';
export type { TemplatePreview, TemplatesPageProps } from './components/templates-page';
export { WorkflowList } from './components/workflow-list';
export type { WorkflowListProps } from './components/workflow-list';
export { MetricsChart, METRIC_SERIES } from './components/metrics-chart';
export type { MetricsChartProps } from './components/metrics-chart';
export { Sparkline } from './components/sparkline';
export type { SparklineProps } from './components/sparkline';
export { collectTemplateRefs } from './components/template-refs';
export type { TemplateRefInfo, TemplateUsage } from './components/template-refs';
export { layout, CARD_SIZE, ICON_SIZE } from './components/layout';
export type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  NodeCategory,
  NodeIcon,
} from './components/layout';
