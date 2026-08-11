import './index.css';
import { RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import config from 'virtual:workflow-config';
import { getRouter } from './router';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');

createRoot(rootElement).render(<RouterProvider router={getRouter(config)} />);
