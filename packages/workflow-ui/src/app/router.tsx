import { createRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { WorkflowUIConfig } from '../config';
import {
  TanstackQueryProvider,
  getTanstackQueryContext,
} from './integrations/tanstack-query/root-provider';
import { routeTree } from './routes';

/**
 * The studio owns the URL, so views are shareable: `/workflows/$name`,
 * `/templates/$key`, `/reports`. The exported components stay router-free, so a
 * host app that embeds them keeps ownership of its own routing.
 */
export const getRouter = (config: WorkflowUIConfig) => {
  const { queryClient } = getTanstackQueryContext();

  return createRouter({
    routeTree,
    context: { queryClient, config },
    defaultPreload: 'intent',
    scrollRestoration: true,
    Wrap: (props: { children: ReactNode }) => (
      <TanstackQueryProvider queryClient={queryClient}>{props.children}</TanstackQueryProvider>
    ),
  });
};

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
