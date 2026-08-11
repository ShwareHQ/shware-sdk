import './index.css';
import { createRoot } from 'react-dom/client';
import config from 'virtual:workflow-config';
import { Studio } from './studio';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');
createRoot(rootElement).render(<Studio config={config} />);
