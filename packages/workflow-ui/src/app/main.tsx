import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import config from 'virtual:workflow-config';
import type { ResolvedStudioConfig } from '../config';
import { applyStoredTheme } from './integrations/theme/root-provider';
import { getRouter } from './router';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');

/* Names the tab after the project; the sidebar always reads "Workflow Studio". */
if (config.title !== undefined) document.title = config.title;

/* Before the first paint, so a dark-mode user never sees a white flash. */
applyStoredTheme();

const router = getRouter(config);
createRoot(rootElement).render(<RouterProvider router={router} />);

/*
 * Write-back HMR boundary. Saving an edit patches a source file, and every
 * project source the studio shows is imported by `virtual:workflow-config` —
 * without an accept the update would bubble past the entry and Vite would
 * full-reload the page on each save. Accepting the config module here swaps
 * the fresh config into the router's context and invalidates the active
 * matches instead, so views re-render in place.
 */
if (import.meta.hot) {
  import.meta.hot.accept('virtual:workflow-config', (mod) => {
    const next = (mod as { default?: ResolvedStudioConfig } | undefined)?.default;
    if (next === undefined) return;
    if (next.title !== undefined) document.title = next.title;
    router.update({ ...router.options, context: { ...router.options.context, config: next } });
    void router.invalidate();
  });
}
