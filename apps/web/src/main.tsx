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
import { useSession } from '@/store/session';

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
/**
 * Adopt a session handed back by a social sign-in.
 *
 * The token arrives in the URL FRAGMENT — chosen deliberately, because a fragment
 * is never sent to a server and so stays out of access logs, proxy logs and
 * Referer headers. That means the app must read it and then erase it from the
 * address bar, or the credential lingers in history and in anything the user
 * copies out of it.
 *
 * Runs BEFORE the first render so the session screen does not flash a signed-out
 * state and then correct itself.
 */
function adoptFragmentSession(): void {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const token = params.get('token');
  const authError = params.get('auth_error');

  if (token) {
    // Clear the fragment first: if the exchange below throws, the token must not
    // be left visible in the URL.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    void useSession.getState().adoptToken(token);
    return;
  }

  if (authError) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    /**
     * Reported through the store AND used to open the sign-in panel, because the
     * user lands on whatever page they started from — where no panel is open, so
     * the reason would otherwise be stored and never seen.
     */
    useSession.getState().requestSignIn(`Sign-in failed: ${authError.replace(/_/g, ' ')}`);
  }
}

adoptFragmentSession();

void loadConfig().finally(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
