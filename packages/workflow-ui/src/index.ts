/**
 * Components for embedding the studio views in your own app. The CLI
 * (`workflow-ui`) composes exactly these — nothing is held back for it.
 */
export * from './config';
export { WorkflowCanvas } from './components/workflow-canvas';
export type { WorkflowCanvasProps } from './components/workflow-canvas';
export { TemplatesPage } from './components/templates-page';
export type { TemplatePreview, TemplatesPageProps } from './components/templates-page';
export { ReportsPage } from './components/reports-page';
export type { ReportsPageProps } from './components/reports-page';
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
