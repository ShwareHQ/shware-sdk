import { createRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { WorkflowUIConfig } from '../config';
import { I18nProvider, getI18nContext } from './integrations/i18n/root-provider';
import {
  TanstackQueryProvider,
  getTanstackQueryContext,
} from './integrations/tanstack-query/root-provider';
import { ThemeProvider } from './integrations/theme/root-provider';
import { routeTree } from './routes';

/**
 * The studio owns the URL, so views are shareable: `/workflows/$name`,
 * `/emails/$key`, `/segments`. The exported components stay router-free, so a
 * host app that embeds them keeps ownership of its own routing.
 */
export const getRouter = (config: WorkflowUIConfig) => {
  const { queryClient } = getTanstackQueryContext();
  const { i18n } = getI18nContext();

  return createRouter({
    routeTree,
    context: { queryClient, config, i18n },
    defaultPreload: 'intent',
    scrollRestoration: true,
    Wrap: (props: { children: ReactNode }) => (
      <ThemeProvider>
        <I18nProvider i18n={i18n}>
          <TanstackQueryProvider queryClient={queryClient}>{props.children}</TanstackQueryProvider>
        </I18nProvider>
      </ThemeProvider>
    ),
  });
};

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
