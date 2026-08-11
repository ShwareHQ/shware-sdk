import { Route as rootRoute } from './__root';
import { emailRoute, emailsIndexRoute } from './emails';
import { homeRoute } from './home';
import { workflowMetricsRoute } from './metrics';
import { segmentsRoute } from './segments';
import { settingsRoute } from './settings';
import { workflowCanvasRoute, workflowDetailRoute, workflowsIndexRoute } from './workflows';

export const routeTree = rootRoute.addChildren([
  homeRoute,
  workflowsIndexRoute,
  workflowDetailRoute.addChildren([workflowCanvasRoute, workflowMetricsRoute]),
  segmentsRoute,
  emailsIndexRoute,
  emailRoute,
  settingsRoute,
]);
