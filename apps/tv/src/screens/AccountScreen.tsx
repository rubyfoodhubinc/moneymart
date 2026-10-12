/**
 * MoneyMart TV — Account (§7.3).
 *
 * "Account (TV — Simplified): Only three sections available on TV: Watch History
 *  (items watched in last 30 days), Watchlist (saved items with countdown
 *  timers), and Settings (display language, notification sound toggle). Full
 *  account management explicitly directed to mobile or web."
 */
import { useEffect, useState } from 'react';
import type { AuctionWithRelations } from '@moneymart/types';
import { api, type TvSession } from '@/lib/api';
import { useFocus, useFocusable } from '@/lib/focus';
import { TvRow, TvAuctionCard, TvButton, TvPill } from '@/components/tv';
import { MoneyMartWordmark } from './HomeScreen';

type Section = 'history' | 'watchlist' | 'settings';

const WATCH_HISTORY_KEY = 'mm-tv-watch-history';
const WATCHLIST_KEY = 'mm-tv-watchlist';

export function readWatchHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WATCH_HISTORY_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function pushWatchHistory(auctionId: string): void {
  try {
    const next = [auctionId, ...readWatchHistory().filter((id) => id !== auctionId)].slice(0, 30);
    localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable on some TV browsers — history is best-effort */
  }
}

export function readWatchlist(): string[] {
  try {
    return JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function TvAccountScreen({ onOpenAuction }: { onOpenAuction: (id: string) => void }) {
  const [section, setSection] = useState<Section>('watchlist');
  const [session, setSession] = useState<TvSession | null>(null);
  const [lots, setLots] = useState<AuctionWithRelations[]>([]);
  const [language, setLanguage] = useState('English');
  const [sound, setSound] = useState(true);
  const { setActiveGroup, focusFirst } = useFocus();

  useEffect(() => {
    (async () => {
      try {
        const [current, all] = await Promise.all([api.session(), api.auctions({ sort: 'ending' })]);
        setSession(current);
        setLots(all.items);
      } catch {
        /* TV account is read-only; degrade quietly */
      }
    })();
  }, []);

  const watchHistory = readWatchHistory();
  const watchlist = readWatchlist();

  const historyLots = watchHistory
    .map((id) => lots.find((lot) => lot.id === id))
    .filter((lot): lot is AuctionWithRelations => Boolean(lot));
  const watchlistLots = watchlist
    .map((id) => lots.find((lot) => lot.id === id))
    .filter((lot): lot is AuctionWithRelations => Boolean(lot));

  useEffect(() => setActiveGroup('account'), [setActiveGroup]);
  useEffect(() => focusFirst('account'), [section, focusFirst]);

  return (
    <div className="tv-screen" style={{ overflowY: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <MoneyMartWordmark />
        <span className="tv-caption" style={{ fontSize: '1.4rem' }}>
          Signed in as {session?.profile.displayName ?? 'guest'} · full account management on mobile or web
        </span>
      </header>

      <nav style={{ display: 'flex', gap: '1.2rem' }}>
        {(
          [
            ['watchlist', 'Watchlist'],
            ['history', 'Watch History'],
            ['settings', 'Settings'],
          ] as const
        ).map(([value, label]) => (
          <SectionTab
            key={value}
            id={`tab-${value}`}
            label={label}
            selected={section === value}
            onSelect={() => setSection(value)}
          />
        ))}
      </nav>

      {section === 'watchlist' ? (
        watchlistLots.length ? (
          <TvRow title="Watchlist" subtitle="Saved lots with live countdowns">
            {watchlistLots.map((auction) => (
              <TvAuctionCard key={auction.id} auction={auction} group="account" row="watchlist" onSelect={() => onOpenAuction(auction.id)} />
            ))}
          </TvRow>
        ) : (
          <p className="tv-body">
            Your watchlist is empty. Open a lot and add it on your phone — the TV shows what you saved.
          </p>
        )
      ) : null}

      {section === 'history' ? (
        historyLots.length ? (
          <TvRow title="Watch History" subtitle="Lots you opened in the last 30 days">
            {historyLots.map((auction) => (
              <TvAuctionCard key={auction.id} auction={auction} group="account" row="watch-history" onSelect={() => onOpenAuction(auction.id)} />
            ))}
          </TvRow>
        ) : (
          <p className="tv-body">Nothing watched yet in the last 30 days.</p>
        )
      ) : null}

      {section === 'settings' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '70rem' }}>
          <SettingRow
            id="set-lang"
            label="Display language"
            value={language}
            options={['English', 'Yoruba', 'Igbo', 'Hausa', 'Français']}
            onSelect={setLanguage}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
            <span className="tv-body" style={{ minWidth: '22rem' }}>
              Notification sound
            </span>
            <TvButton
              id="set-sound"
              label={sound ? 'Sound on' : 'Sound off'}
              variant={sound ? 'green' : 'navy'}
              group="account"
              onSelect={() => setSound((value) => !value)}
            />
          </div>

          <div className="tv-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <TvPill tone="gold">BIDDING ON TV</TvPill>
            <p className="tv-body" style={{ fontSize: '1.6rem' }}>
              Bids are placed by scanning the QR code with the MoneyMart mobile app. This keeps keyboard entry and
              biometric confirmation on a device that supports them, and lets us keep fund handling consistent
              across surfaces.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SectionTab({
  id,
  label,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { ref, focused, focusProps } = useFocusable({ id, group: 'account', onSelect });
  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      {...focusProps}
      onClick={onSelect}
      className="tv-focusable"
      style={{
        padding: '1.1rem 2.4rem',
        fontSize: '1.8rem',
        fontWeight: 600,
        fontFamily: 'var(--mm-font-body)',
        borderRadius: '14px',
        border: selected ? 'none' : '2px solid rgba(255,255,255,0.14)',
        background: selected ? 'var(--mm-gradient-gold)' : 'rgba(255,255,255,0.05)',
        color: selected ? '#0D1B2A' : 'rgba(255,255,255,0.82)',
        cursor: 'pointer',
        ...(focused ? { outline: '4px solid var(--mm-gold)', outlineOffset: '3px' } : {}),
      }}
    >
      {label}
    </button>
  );
}

function SettingRow({
  id,
  label,
  value,
  options,
  onSelect,
}: {
  id: string;
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
      <span className="tv-body" style={{ minWidth: '22rem' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>
        {options.map((option) => (
          <TvButton
            key={option}
            id={`${id}-${option}`}
            label={option}
            variant={option === value ? 'green' : 'navy'}
            group="account"
            onSelect={() => onSelect(option)}
          />
        ))}
      </div>
    </div>
  );
}
