/**
 * MoneyMart TV — presentational components.
 * Every interactive element here is D-pad focusable and sized to the §7.2
 * minimums (80px tall, 200px wide) so it reads at three metres.
 */
import type { ReactNode } from 'react';
import type { AuctionWithRelations, StreamWithRelations } from '@moneymart/types';
import { useFocusable } from '@/lib/focus';
import { formatCountdown, formatMoney, formatViewers } from '@/lib/format';
import { useEffect, useState } from 'react';

/* ── Primitives ────────────────────────────────────────────────────────── */

export function TvPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'live' | 'gold';
}) {
  const className =
    tone === 'live' ? 'tv-pill tv-pill--live' : tone === 'gold' ? 'tv-pill tv-pill--gold' : 'tv-pill';
  return <span className={className}>{children}</span>;
}

export function TvButton({
  id,
  label,
  onSelect,
  variant = 'gold',
  group,
  autofocus = false,
  disabled = false,
}: {
  id: string;
  label: string;
  onSelect: () => void;
  variant?: 'gold' | 'green' | 'navy' | 'ghost';
  group?: string;
  autofocus?: boolean;
  disabled?: boolean;
}) {
  const { ref, focused, focusProps } = useFocusable({ id, group, onSelect, priority: autofocus ? 100 : 0 });

  const background =
    variant === 'gold'
      ? 'var(--mm-gradient-gold)'
      : variant === 'green'
        ? 'var(--mm-gradient-live)'
        : variant === 'navy'
          ? 'rgba(255,255,255,0.07)'
          : 'transparent';

  const color = variant === 'gold' || variant === 'green' ? '#0D1B2A' : 'rgba(255,255,255,0.88)';

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      {...focusProps}
      disabled={disabled}
      className="tv-focusable"
      style={{
        background,
        color,
        border: variant === 'navy' || variant === 'ghost' ? '2px solid rgba(255,255,255,0.16)' : 'none',
        padding: '0 2.5rem',
        fontSize: '2rem',
        fontWeight: 600,
        fontFamily: 'var(--mm-font-body)',
        cursor: 'pointer',
        opacity: disabled ? 0.4 : 1,
        ...(focused
          ? { outline: '4px solid var(--mm-gold)', outlineOffset: '3px', transform: 'scale(1.03)' }
          : {}),
      }}
    >
      {label}
    </button>
  );
}

/* ── Countdown (§5.3 CountdownTimer, TV sizing) ────────────────────────── */

export function TvCountdown({ endsAt, size = '2rem' }: { endsAt: string; size?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const remaining = Math.max(0, Date.parse(endsAt) - now);
  const colour = remaining <= 0 ? 'rgba(255,255,255,0.4)' : remaining < 600_000 ? '#FF7A7A' : 'rgba(255,255,255,0.9)';

  return (
    <span className="tv-data" style={{ fontSize: size, color: colour, fontWeight: 700 }}>
      {formatCountdown(remaining)}
    </span>
  );
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

export function TvRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="tv-row">
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '1.5rem' }}>
        <h2 className="tv-heading" style={{ fontSize: '2.75rem' }}>
          {title}
        </h2>
        {subtitle ? <p className="tv-caption">{subtitle}</p> : null}
      </header>
      <div className="tv-row__track">{children}</div>
    </section>
  );
}

/* ── Stream card ───────────────────────────────────────────────────────── */

export function TvStreamCard({
  stream,
  group,
  onSelect,
  width = '30rem',
}: {
  stream: StreamWithRelations;
  group?: string;
  onSelect: () => void;
  width?: string;
}) {
  const isLive = stream.status === 'live';
  const { ref, focused, focusProps } = useFocusable({ id: `stream-${stream.id}`, group, onSelect });

  return (
    <article
      ref={ref as React.RefObject<HTMLElement>}
      {...focusProps}
      onClick={onSelect}
      className={`tv-card tv-focusable ${focused ? 'tv-card--focused' : ''}`}
      style={{ width, flex: '0 0 auto', cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 9' }}>
        <img
          src={stream.activeAuction?.item.images[0] ?? stream.posterUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(7,15,24,0.1) 35%, rgba(7,15,24,0.92) 100%)',
          }}
        />
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', display: 'flex', gap: '0.75rem' }}>
          {isLive ? (
            <TvPill tone="live">
              <span className="tv-live-dot" style={{ width: '0.75rem', height: '0.75rem' }} />
              LIVE · {formatViewers(stream.viewerCount)}
            </TvPill>
          ) : (
            <TvPill>SCHEDULED</TvPill>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', right: '1rem' }}>
          <p className="tv-body tv-body-lg" style={{ fontWeight: 600, color: '#fff' }}>
            {stream.creator.displayName}
          </p>
          <p className="tv-caption" style={{ fontSize: '1.4rem' }}>
            {stream.title}
          </p>
        </div>
      </div>
      {stream.activeAuction ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1.1rem 1.25rem',
          }}
        >
          <span className="tv-data" style={{ fontSize: '1.9rem', color: 'var(--mm-gold)', fontWeight: 700 }}>
            {formatMoney(stream.activeAuction.currentBid || stream.activeAuction.startingPrice, stream.activeAuction.currency)}
          </span>
          <TvCountdown endsAt={stream.activeAuction.endTime} size="1.7rem" />
        </div>
      ) : null}
    </article>
  );
}

/* ── Auction card ──────────────────────────────────────────────────────── */

export function TvAuctionCard({
  auction,
  group,
  onSelect,
  width = '28rem',
}: {
  auction: AuctionWithRelations;
  group?: string;
  onSelect: () => void;
  width?: string;
}) {
  const { ref, focused, focusProps } = useFocusable({ id: `auction-${auction.id}`, group, onSelect });

  return (
    <article
      ref={ref as React.RefObject<HTMLElement>}
      {...focusProps}
      onClick={onSelect}
      className={`tv-card tv-focusable ${focused ? 'tv-card--focused' : ''}`}
      style={{ width, flex: '0 0 auto', cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
        <img
          src={auction.item.images[0]}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(7,15,24,0.05) 45%, rgba(7,15,24,0.9) 100%)',
          }}
        />
        <div style={{ position: 'absolute', top: '1rem', left: '1rem', display: 'flex', gap: '0.6rem' }}>
          {auction.isLive ? <TvPill tone="live">LIVE</TvPill> : null}
          {auction.item.isVerified ? <TvPill tone="gold">MV VERIFIED</TvPill> : null}
        </div>
        <div style={{ position: 'absolute', bottom: '1rem', left: '1.25rem', right: '1.25rem' }}>
          <p className="tv-caption" style={{ fontSize: '1.3rem', color: 'rgba(255,255,255,0.6)' }}>
            {auction.lotNumber ?? auction.item.categoryId.toUpperCase()}
          </p>
          <p
            className="tv-data"
            style={{ fontSize: '2.2rem', fontWeight: 700, color: 'var(--mm-gold)', marginTop: '0.25rem' }}
          >
            {formatMoney(auction.currentBid || auction.startingPrice, auction.currency)}
          </p>
        </div>
      </div>
      <div style={{ padding: '1.1rem 1.25rem' }}>
        <p
          className="tv-body"
          style={{
            fontSize: '1.5rem',
            color: '#fff',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '4.2rem',
          }}
        >
          {auction.item.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem' }}>
          <TvCountdown endsAt={auction.endTime} size="1.6rem" />
          <span className="tv-caption" style={{ fontSize: '1.25rem' }}>
            {auction.bidCount} bids
          </span>
        </div>
      </div>
    </article>
  );
}

/* ── Row of chips (category / sort filters) ────────────────────────────── */

export function TvChipRow({
  id,
  options,
  active,
  group,
  onSelect,
}: {
  id: string;
  options: { value: string; label: string }[];
  active: string;
  group?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
      {options.map((option) => (
        <TvChip
          key={option.value}
          id={`${id}-${option.value}`}
          label={option.label}
          selected={option.value === active}
          group={group}
          onSelect={() => onSelect(option.value)}
        />
      ))}
    </div>
  );
}

function TvChip({
  id,
  label,
  selected,
  group,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  group?: string;
  onSelect: () => void;
}) {
  const { ref, focused, focusProps } = useFocusable({ id, group, onSelect });

  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      {...focusProps}
      onClick={onSelect}
      className="tv-focusable"
      style={{
        padding: '1rem 2rem',
        fontSize: '1.75rem',
        fontWeight: 600,
        fontFamily: 'var(--mm-font-body)',
        borderRadius: '999px',
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

/* ── QR bridge (§7.3) ──────────────────────────────────────────────────── */

/**
 * Renders a QR code from the API's handoff payload. The code is generated
 * server-side as an SVG matrix so no client-side QR dependency is needed.
 */
export function TvQrCode({ matrix, size = 240 }: { matrix: string; size?: number }) {
  return (
    <img
      className="tv-qr"
      src={matrix}
      width={size}
      height={size}
      alt="Scan to bid on your phone"
      style={{ width: size, height: size }}
    />
  );
}

/* ── Loading skeleton ──────────────────────────────────────────────────── */

export function TvSkeletonRow({ count = 5, width = '30rem', height = '18rem' }: { count?: number; width?: string; height?: string }) {
  return (
    <div className="tv-row__track">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="tv-skeleton" style={{ width, height, flex: '0 0 auto' }} />
      ))}
    </div>
  );
}
