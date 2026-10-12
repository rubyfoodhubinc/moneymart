/**
 * MoneyMart TV — entry point.
 * Mounts the D-pad driven SPA that wraps for Tizen, webOS, HbbTV and IPTV.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('MoneyMart TV: #root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
