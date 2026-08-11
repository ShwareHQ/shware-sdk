import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import config from 'virtual:workflow-config';
import { applyStoredTheme } from './integrations/theme/root-provider';
import { getRouter } from './router';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');

/* Names the tab after the project; the sidebar always reads "Workflow Studio". */
if (config.title !== undefined) document.title = config.title;

/* Before the first paint, so a dark-mode user never sees a white flash. */
applyStoredTheme();

createRoot(rootElement).render(<RouterProvider router={getRouter(config)} />);
