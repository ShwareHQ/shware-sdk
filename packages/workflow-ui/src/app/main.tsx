import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import config from 'virtual:workflow-config';
import { getRouter } from './router';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');

/* Names the tab after the project; the sidebar always reads "Workflow Studio". */
if (config.title !== undefined) document.title = config.title;

createRoot(rootElement).render(<RouterProvider router={getRouter(config)} />);
