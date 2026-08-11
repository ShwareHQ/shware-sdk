import { createRoute, redirect } from '@tanstack/react-router';
import { Route as rootRoute } from './__root';
import { reportsRoute } from './reports';
import { templateRoute, templatesIndexRoute } from './templates';
import { workflowRoute, workflowsIndexRoute } from './workflows';

/** `/` is not a view of its own; the studio opens on the canvas. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({ to: '/workflows' });
  },
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  workflowsIndexRoute,
  workflowRoute,
  templatesIndexRoute,
  templateRoute,
  reportsRoute,
]);
