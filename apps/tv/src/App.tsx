/**
 * MoneyMart TV — application root.
 *
 * A hash-routed four-screen flow, because TV browsers and IPTV middleware often
 * cannot rewrite paths (§7.1). The D-pad focus provider wraps everything.
 */
import { useCallback, useEffect, useState } from 'react';
import { FocusProvider } from '@/lib/focus';
import { TvHomeScreen } from '@/screens/HomeScreen';
import { TvStreamScreen } from '@/screens/StreamScreen';
import { TvBrowseScreen, TvItemScreen } from '@/screens/BrowseScreen';
import { TvAccountScreen, pushWatchHistory } from '@/screens/AccountScreen';

type Route =
  | { name: 'home' }
  | { name: 'browse' }
  | { name: 'account' }
  | { name: 'stream'; id: string }
  | { name: 'item'; id: string };

const TABS: { route: Route; label: string }[] = [
  { route: { name: 'home' }, label: 'Home' },
  { route: { name: 'browse' }, label: 'Browse' },
  { route: { name: 'account' }, label: 'Account' },
];

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [segment, id] = hash.split('/');
  if (segment === 'browse') return { name: 'browse' };
  if (segment === 'account') return { name: 'account' };
  if (segment === 'stream' && id) return { name: 'stream', id: decodeURIComponent(id) };
  if (segment === 'item' && id) return { name: 'item', id: decodeURIComponent(id) };
  return { name: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [history, setHistory] = useState<Route[]>([]);

  /* Hash routing keeps deep links working inside IPTV wrappers. */
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback(
    (next: Route, pushHistory = true) => {
      setHistory((stack) => (pushHistory ? [...stack, route] : stack));
      setRoute(next);
      const hash =
        next.name === 'home'
          ? '#/'
          : next.name === 'stream' || next.name === 'item'
            ? `#/${next.name}/${encodeURIComponent(next.id)}`
            : `#/${next.name}`;
      window.location.hash = hash;
    },
    [route],
  );

  const goBack = useCallback(() => {
    setHistory((stack) => {
      const previous = stack[stack.length - 1];
      if (previous) {
        setRoute(previous);
        const hash =
          previous.name === 'home'
            ? '#/'
            : previous.name === 'stream' || previous.name === 'item'
              ? `#/${previous.name}/${encodeURIComponent(previous.id)}`
              : `#/${previous.name}`;
        window.location.hash = hash;
        return stack.slice(0, -1);
      }
      setRoute({ name: 'home' });
      window.location.hash = '#/';
      return stack;
    });
  }, []);

  /* Hardware Back key on Tizen/webOS remotes, plus Escape for dev. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const back =
        event.key === 'Escape' ||
        event.key === 'GoBack' ||
        event.key === 'Backspace' ||
        event.keyCode === 461 ||
        event.keyCode === 10009;
      if (back) {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack]);

  const openAuction = useCallback(
    (id: string) => {
      pushWatchHistory(id);
      navigate({ name: 'item', id });
    },
    [navigate],
  );

  const openStream = useCallback((id: string) => navigate({ name: 'stream', id }), [navigate]);

  return (
    <FocusProvider>
      {/* Persistent top-level tabs, present on the three root screens. */}
      {route.name === 'home' || route.name === 'browse' || route.name === 'account' ? (
        <TopTabs route={route} onNavigate={navigate} />
      ) : null}

      {route.name === 'home' ? <TvHomeScreen onOpenStream={openStream} onOpenAuction={openAuction} /> : null}
      {route.name === 'browse' ? <TvBrowseScreen onOpenAuction={openAuction} /> : null}
      {route.name === 'account' ? <TvAccountScreen onOpenAuction={openAuction} /> : null}
      {route.name === 'stream' ? <TvStreamScreen streamId={route.id} onBack={goBack} /> : null}
      {route.name === 'item' ? <TvItemScreen auctionId={route.id} onBack={goBack} /> : null}
    </FocusProvider>
  );
}

function TopTabs({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  return (
    <nav
      style={{
        position: 'fixed',
        top: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: '0.75rem',
        zIndex: 40,
        background: 'rgba(9,18,29,0.85)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '999px',
        padding: '0.5rem',
        backdropFilter: 'blur(12px)',
      }}
    >
      {TABS.map((tab) => {
        const active = tab.route.name === route.name;
        return (
          <button
            key={tab.label}
            onClick={() => onNavigate(tab.route)}
            style={{
              padding: '0.7rem 1.6rem',
              fontSize: '1.4rem',
              fontWeight: 600,
              fontFamily: 'var(--mm-font-body)',
              borderRadius: '999px',
              border: 'none',
              cursor: 'pointer',
              background: active ? 'var(--mm-gradient-gold)' : 'transparent',
              color: active ? '#0D1B2A' : 'rgba(255,255,255,0.7)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
