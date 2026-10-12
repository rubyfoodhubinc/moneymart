'use client';

/**
 * MoneyMart auction surfaces — §5.3 component library.
 * CountdownTimer, AuctionCard, StreamCard, BidHistory, PriceTag contexts and the
 * live bid panel. Mobile, web and TV all render these same semantics.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuctionWithRelations, Bid, ChatMessage, StreamWithRelations } from '@moneymart/types';
import {
  formatMoney,
  formatCountdown,
  formatViewers,
  anonymiseBidder,
  formatAge,
  minimumIncrement,
} from '@/lib/format';
import { categoryEmoji, categoryLabel } from '@/lib/labels';
import { useCountdown } from '@/lib/hooks';
import {
  Avatar,
  Button,
  CategoryChip,
  EmptyState,
  LiveBadge,
  Pill,
  PriceTag,
  ProgressBar,
  VerifiedBadge,
} from './ui';
import { GavelIcon, HammerIcon, HeartIcon, LiveDot, PlayIcon, TrendIcon, UsersIcon } from './icons';

/* ── Countdown ─────────────────────────────────────────────────────────── */

export function CountdownTimer({
  endTime,
  size = 'md',
  label,
  serverTime,
}: {
  endTime: string;
  size?: 'sm' | 'md' | 'lg';
  label?: boolean;
  serverTime?: string;
}) {
  const { remainingMs, urgent, expired } = useCountdown(endTime, serverTime);
  const sizes = { sm: 'text-[13px]', md: 'text-[17px]', lg: 'text-[26px]' } as const;
  const color = expired
    ? 'rgba(255,255,255,0.4)'
    : remainingMs < 600_000
      ? '#FF7A7A'
      : urgent
        ? '#FFB454'
        : 'rgba(244,247,250,0.92)';
  return (
    <span className="inline-flex items-center gap-2" title={`Ends ${new Date(endTime).toLocaleString()}`}>
      {label ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
          {expired ? 'Closed' : 'Ends in'}
        </span>
      ) : null}
      <span className={`data font-bold tabular-nums ${sizes[size]}`} style={{ color }}>
        {expired ? '00:00' : formatCountdown(remainingMs)}
      </span>
    </span>
  );
}

/** Slim time-remaining bar used on live item cards (§4.1 Step 4). */
export function TimeRemainingBar({ endTime, durationMs = 45_000 }: { endTime: string; durationMs?: number }) {
  const { remainingMs } = useCountdown(endTime);
  const progress = Math.max(0, Math.min(100, (remainingMs / durationMs) * 100));
  return (
    <span className="block">
      <ProgressBar value={progress} tone={remainingMs < 10_000 ? 'error' : 'green'} />
    </span>
  );
}

/* ── Auction card ──────────────────────────────────────────────────────── */

export function AuctionCard({
  auction,
  size = 'md',
  showSeller = true,
}: {
  auction: AuctionWithRelations;
  size?: 'sm' | 'md' | 'lg';
  showSeller?: boolean;
}) {
  const { item, seller } = auction;
  const isEnding = useCountdown(auction.endTime).remainingMs < 3_600_000;
  const price = auction.currentBid || auction.startingPrice;
  const isBuyNow = auction.auctionType === 'buy_now';

  const width = size === 'sm' ? 'w-[224px]' : size === 'lg' ? 'w-full' : 'w-[264px]';

  return (
    <Link href={`/auctions/${auction.id}`} className={`group block ${width}`}>
      <article className="card-surface h-full transition-all duration-300 hover:-translate-y-[3px] hover:border-[var(--mm-gold-line)]">
        <div className="relative aspect-[4/3] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.images[0]}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(180deg, rgba(7,15,24,0) 42%, rgba(7,15,24,0.88) 100%)' }}
          />
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {auction.isLive ? <LiveBadge /> : null}
            {isEnding ? (
              <Pill tone="error">
                <HammerIcon size={11} />
                Ending soon
              </Pill>
            ) : null}
          </div>
          <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
            {item.isVerified ? <VerifiedBadge compact /> : null}
          </div>
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
            <PriceTag
              formatted={formatMoney(price, auction.currency)}
              label={isBuyNow ? 'Buy now' : auction.bidCount ? 'Current bid' : 'Starting bid'}
              size={size === 'lg' ? 'lg' : 'md'}
              tone={isBuyNow ? 'buyNow' : 'current'}
            />
            <CountdownTimer endTime={auction.endTime} size="sm" />
          </div>
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
              {categoryEmoji(item.categoryId)} {categoryLabel(item.categoryId)}
            </span>
            {auction.lotNumber ? (
              <span className="data text-[11px] text-white/40">· {auction.lotNumber}</span>
            ) : null}
          </div>
          <h3 className="clamp-2 text-[15px] font-semibold leading-snug text-white transition-colors group-hover:text-[var(--mm-gold)]">
            {item.title}
          </h3>

          <div className="mt-3 flex items-center justify-between gap-3">
            {showSeller ? (
              <span className="flex min-w-0 items-center gap-2">
                <Avatar name={seller.displayName} src={seller.avatarUrl} size={26} isLive={seller.isLive} />
                <span className="clamp-1 text-[12px] text-white/60">{seller.displayName}</span>
              </span>
            ) : (
              <span />
            )}
            <span className="data shrink-0 text-[11.5px] text-white/45">
              {auction.bidCount > 0 ? `${auction.bidCount} bids` : 'No bids'}
            </span>
          </div>

          {auction.reservePrice ? (
            <div className="mt-3">
              <Pill tone={auction.reserveMet ? 'green' : 'neutral'}>
                {auction.reserveMet ? 'Reserve met' : 'Reserve not met'}
              </Pill>
            </div>
          ) : null}
        </div>
      </article>
    </Link>
  );
}

/* ── Stream card ───────────────────────────────────────────────────────── */

export function StreamCard({
  stream,
  variant = 'poster',
}: {
  stream: StreamWithRelations;
  variant?: 'poster' | 'wide';
}) {
  const isLive = stream.status === 'live';
  const active = stream.activeAuction;

  if (variant === 'wide') {
    return (
      <Link href={`/stream/${stream.id}`} className="group block">
        <article className="card-surface flex gap-4 p-4 transition-all duration-300 hover:-translate-y-[2px] hover:border-[var(--mm-gold-line)]">
          <div className="relative h-[92px] w-[132px] shrink-0 overflow-hidden rounded-[12px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active?.item.images[0] ?? stream.posterUrl}
              alt={stream.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            {isLive ? (
              <span className="absolute left-2 top-2">
                <LiveBadge />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="clamp-1 text-[15px] font-semibold text-white group-hover:text-[var(--mm-gold)]">
              {stream.title}
            </h3>
            <div className="mt-1.5 flex items-center gap-2">
              <Avatar
                name={stream.creator.displayName}
                src={stream.creator.avatarUrl}
                size={22}
                isLive={isLive}
              />
              <span className="text-[12.5px] text-white/60">{stream.creator.displayName}</span>
            </div>
            {active ? (
              <p className="clamp-1 mt-2 text-[12px] text-white/45">
                Now: {active.item.title} ·{' '}
                <span className="data" style={{ color: 'var(--mm-gold)' }}>
                  {formatMoney(active.currentBid || active.startingPrice, active.currency)}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-white/45">
                {stream.status === 'scheduled'
                  ? `Starts ${new Date(stream.scheduledStartTime).toLocaleString()}`
                  : 'Stream ended'}
              </p>
            )}
          </div>
          {isLive ? (
            <div className="flex shrink-0 flex-col items-end justify-between">
              <Pill tone="green">
                <UsersIcon size={11} />
                <span className="data">{formatViewers(stream.viewerCount)}</span>
              </Pill>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
                Watch →
              </span>
            </div>
          ) : null}
        </article>
      </Link>
    );
  }

  return (
    <Link href={`/stream/${stream.id}`} className="group block w-[288px]">
      <article className="card-surface transition-all duration-300 hover:-translate-y-[3px] hover:border-[var(--mm-gold-line)]">
        <div className="relative aspect-[16/10] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active?.item.images[0] ?? stream.posterUrl}
            alt={stream.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          />
          <div className="absolute inset-0" style={{ background: 'var(--mm-gradient-hero, linear-gradient(180deg, rgba(7,15,24,0.1) 30%, rgba(7,15,24,0.92) 100%))' }} />
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {isLive ? <LiveBadge /> : <Pill tone="navy">Scheduled</Pill>}
          </div>
          <div className="absolute right-3 top-3">
            {isLive ? (
              <span className="glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[11px] font-semibold text-white">
                <UsersIcon size={12} />
                <span className="data">{formatViewers(stream.viewerCount)}</span>
              </span>
            ) : null}
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <div className="flex items-center gap-2">
              <Avatar
                name={stream.creator.displayName}
                src={stream.creator.avatarUrl}
                size={30}
                isLive={isLive}
                isVerified={stream.creator.isVerified}
              />
              <div className="min-w-0">
                <p className="clamp-1 text-[13px] font-semibold text-white">{stream.creator.displayName}</p>
                <p className="clamp-1 text-[11px] text-white/55">{stream.title}</p>
              </div>
            </div>
          </div>
          {isLive ? (
            <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              <span
                className="grid h-12 w-12 place-items-center rounded-full text-[#0D1B2A]"
                style={{ background: 'var(--mm-gradient-gold)' }}
              >
                <PlayIcon size={18} />
              </span>
            </span>
          ) : null}
        </div>
        <div className="p-3.5">
          {active ? (
            <>
              <p className="clamp-1 text-[13px] font-medium text-white/85">{active.item.title}</p>
              <div className="mt-2 flex items-center justify-between">
                <PriceTag
                  formatted={formatMoney(active.currentBid || active.startingPrice, active.currency)}
                  size="sm"
                  tone="current"
                />
                {isLive ? <TimeRemainingBar endTime={active.endTime} /> : null}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-white/55">
              {stream.status === 'scheduled'
                ? `Starts ${new Date(stream.scheduledStartTime).toLocaleString()}`
                : 'Stream ended'}
            </p>
          )}
        </div>
      </article>
    </Link>
  );
}

/* ── Bid history (§5.2 anonymised) ─────────────────────────────────────── */

export function BidHistory({
  bids,
  maxVisible = 8,
  anonymized = true,
  currentUserId,
}: {
  bids: Bid[];
  maxVisible?: number;
  anonymized?: boolean;
  currentUserId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? bids : bids.slice(0, maxVisible);

  if (!bids.length) {
    return <EmptyState title="No bids yet" body="Be the first to open this lot." icon={<GavelIcon size={24} />} />;
  }

  return (
    <div>
      <ul className="divide-y" style={{ borderColor: 'var(--mm-divider)' }}>
        {visible.map((bid, index) => {
          const isYou = currentUserId && bid.bidderId === currentUserId;
          const isTop = index === 0;
          return (
            <li key={bid.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                  style={{
                    background: isTop ? 'rgba(245,166,35,0.16)' : 'rgba(255,255,255,0.05)',
                    color: isTop ? 'var(--mm-gold)' : 'rgba(255,255,255,0.5)',
                  }}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-white/85">
                    {isYou ? 'You' : anonymized ? anonymiseBidder(bid.bidderId, index) : bid.bidderHandle}
                  </span>
                  <span className="block text-[11px] text-white/40">
                    {formatAge(bid.timestamp)}
                    {bid.isAutoBid ? ' · auto-bid' : ''}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                {isTop ? <Pill tone="gold">High bid</Pill> : null}
                <span
                  className="data text-[14px] font-semibold"
                  style={{ color: isTop ? 'var(--mm-gold)' : 'rgba(255,255,255,0.75)' }}
                >
                  {formatMoney(bid.amount, bid.currency)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {bids.length > maxVisible ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-3 text-[12.5px] font-semibold"
          style={{ color: 'var(--mm-gold)' }}
        >
          {expanded ? 'Show less' : `Show all ${bids.length} bids`}
        </button>
      ) : null}
    </div>
  );
}

/* ── Bid panel ─────────────────────────────────────────────────────────── */

export function BidButton({
  price,
  formatted,
  isActive,
  disabled,
  loading,
  onPress,
  onLongPress,
  currency,
}: {
  price: number;
  formatted: string;
  isActive: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  currency?: string;
}) {
  const pressTimer = useRef<number | null>(null);

  return (
    <Button
      variant="green"
      size="lg"
      full
      onClick={onPress}
      disabled={disabled}
      loading={loading}
      className={isActive ? 'animate-bid-flash' : ''}
      onPointerDown={() => {
        if (!onLongPress) return;
        pressTimer.current = window.setTimeout(() => onLongPress(), 480);
      }}
      onPointerUp={() => {
        if (pressTimer.current) window.clearTimeout(pressTimer.current);
      }}
      onPointerLeave={() => {
        if (pressTimer.current) window.clearTimeout(pressTimer.current);
      }}
      title={onLongPress ? 'Tap to bid · long-press for auto-bid' : 'Place bid'}
    >
      <GavelIcon size={18} />
      Bid {formatted}
      {currency ? <span className="data text-[12px] opacity-70">{currency}</span> : null}
    </Button>
  );
}

export function IncrementSelector({
  current,
  value,
  onChange,
}: {
  current: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const base = minimumIncrement(current);
  const options = useMemo(
    () => [
      { label: 'Minimum', amount: base },
      { label: 'Standard', amount: base * 2 },
      { label: 'Jump bid', amount: base * 5 },
    ],
    [base],
  );
  return (
    <div className="flex gap-2">
      {options.map((option) => {
        const selected = option.amount === value;
        return (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.amount)}
            className="flex-1 rounded-[10px] border px-3 py-2 text-left transition-all duration-200"
            style={{
              borderColor: selected ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
              background: selected ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.03)',
            }}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
              {option.label}
            </span>
            <span
              className="data block text-[14px] font-semibold"
              style={{ color: selected ? 'var(--mm-gold)' : 'rgba(255,255,255,0.8)' }}
            >
              +{option.amount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Price history sparkline (§4.3 market data) ────────────────────────── */

export function PriceHistoryChart({
  points,
  currency = 'USD',
  height = 72,
}: {
  points: { label: string; value: number }[];
  currency?: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points?.length) return null;

  const width = 520;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => ({
    x: (index / (points.length - 1)) * width,
    y: height - ((point.value - min) / span) * (height - 8) - 4,
    point,
  }));
  const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const trendUp = values[values.length - 1] >= values[0];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[72px] w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="mm-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendUp ? '#00D4A1' : '#F5A623'} stopOpacity="0.34" />
            <stop offset="100%" stopColor={trendUp ? '#00D4A1' : '#F5A623'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#mm-spark)" />
        <path d={line} fill="none" stroke={trendUp ? '#00D4A1' : '#F5A623'} strokeWidth="2" strokeLinejoin="round" />
        {coords.map((coord, index) => (
          <g key={coord.point.label}>
            <rect
              x={coord.x - width / points.length / 2}
              y={0}
              width={width / points.length}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
            {hover === index ? (
              <circle cx={coord.x} cy={coord.y} r="4" fill="#fff" stroke={trendUp ? '#00D4A1' : '#F5A623'} strokeWidth="2" />
            ) : null}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-white/40">
          {points[0].label} – {points[points.length - 1].label}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: trendUp ? 'var(--mm-green)' : 'var(--mm-gold)' }}>
          <TrendIcon size={13} />
          {hover !== null
            ? `${points[hover].label}: ${formatMoney(points[hover].value, currency, { compact: true })}`
            : `${trendUp ? '+' : ''}${Math.round(((values[values.length - 1] - values[0]) / (values[0] || 1)) * 100)}% 12-mo`}
        </span>
      </div>
    </div>
  );
}

/* ── Chat panel ────────────────────────────────────────────────────────── */

export function ChatPanel({
  messages,
  pinned,
  onSend,
  onPin,
  canPin = false,
  currentUserId,
  disabled,
}: {
  messages: ChatMessage[];
  pinned: ChatMessage | null;
  onSend: (body: string) => void;
  onPin?: (messageId: string) => void;
  canPin?: boolean;
  currentUserId?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {pinned ? (
        <div
          className="mx-3 mb-2 rounded-[11px] border p-3"
          style={{ borderColor: 'var(--mm-gold-line)', background: 'rgba(245,166,35,0.1)' }}
        >
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--mm-gold)' }}>
            <GavelIcon size={11} /> Pinned
          </p>
          <p className="text-[12.5px] text-white/85">{pinned.body}</p>
        </div>
      ) : null}

      <div ref={scroller} className="no-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pb-2">
        {messages.map((message) => {
          const accent = message.isCreator ? 'var(--mm-gold)' : message.userId === currentUserId ? 'var(--mm-green)' : 'rgba(255,255,255,0.7)';
          return (
            <div key={message.id} className="group flex items-start gap-2">
              <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
              <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
                <span className="font-semibold" style={{ color: accent }}>
                  {message.isCreator ? '★ ' : ''}
                  {message.displayName}
                </span>{' '}
                <span className="text-white/78">{message.body}</span>
              </p>
              {canPin && onPin ? (
                <button
                  type="button"
                  onClick={() => onPin(message.id)}
                  className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-white/25 opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--mm-gold)]"
                >
                  Pin
                </button>
              ) : null}
            </div>
          );
        })}
        {!messages.length ? <p className="pt-6 text-center text-[12.5px] text-white/40">Chat is quiet. Say hello 👋</p> : null}
      </div>

      <div className="border-t p-3" style={{ borderColor: 'var(--mm-divider)' }}>
        <div className="flex items-center gap-2 rounded-[11px] border border-white/10 bg-white/[0.04] px-3 py-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
            disabled={disabled}
            placeholder={disabled ? 'Chat unavailable' : 'Say something…'}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !draft.trim()}
            className="text-[12px] font-bold uppercase tracking-wider disabled:opacity-35"
            style={{ color: 'var(--mm-gold)' }}
          >
            Send
          </button>
        </div>
        <div className="mt-2 flex gap-1.5">
          {['🔥', '💛', '👏', '😮', '🚀', '💎', '🙌'].map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onSend(emoji)}
              className="rounded-[8px] border border-white/8 px-2 py-1 text-[13px] transition-colors hover:border-[var(--mm-gold-line)]"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Watch toggle ──────────────────────────────────────────────────────── */

export function WatchButton({
  watching,
  onToggle,
  count,
}: {
  watching: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-[11px] border px-3.5 py-2.5 text-[13px] font-semibold transition-all duration-200"
      style={{
        borderColor: watching ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.12)',
        background: watching ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.03)',
        color: watching ? 'var(--mm-gold)' : 'rgba(255,255,255,0.75)',
      }}
      title="Add to watchlist (W)"
    >
      <HeartIcon size={15} filled={watching} />
      {watching ? 'Watching' : 'Watch'}
      {count !== undefined ? <span className="data text-[11.5px] text-white/45">{count}</span> : null}
    </button>
  );
}

export function LiveViewerPill({ count }: { count: number }) {
  return (
    <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-[6px] text-[12px] font-semibold text-white">
      <LiveDot size={7} />
      <span className="data">{formatViewers(count)}</span>
      <span className="text-white/55">watching</span>
    </span>
  );
}

export function TagRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function CategoryRail({
  categories,
  active,
  baseHref = '/auctions',
  includeAll = true,
}: {
  categories: readonly { id: string; label: string; emoji: string }[];
  active?: string;
  baseHref?: string;
  includeAll?: boolean;
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
      {includeAll ? (
        <CategoryChip label="All" href={baseHref} selected={!active} emoji="✨" />
      ) : null}
      {categories.map((category) => (
        <CategoryChip
          key={category.id}
          label={category.label}
          emoji={category.emoji}
          selected={active === category.id}
          href={`${baseHref}?category=${category.id}`}
        />
      ))}
    </div>
  );
}
