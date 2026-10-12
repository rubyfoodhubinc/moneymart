/**
 * MoneyMart web — application entry.
 * Mounts the SPA and hands the document to the router.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import './index.css';
import { App } from './App';
import { loadConfig } from '@/lib/config';

const container = document.getElementById('root');
if (!container) throw new Error('MoneyMart: #root container missing from index.html');

/**
 * Resolve runtime configuration before the first render.
 *
 * The API origin is chosen here rather than at build time, so one bundle can be
 * pointed at Railway, a staging gateway or a local API without rebuilding. It
 * must complete before any request is issued, or the first fetch would target a
 * stale origin and fail.
 */
void loadConfig().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
