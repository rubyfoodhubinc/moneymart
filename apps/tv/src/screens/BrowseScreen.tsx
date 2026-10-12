/**
 * MoneyMart TV — Auction Browse and Item Detail (§7.3).
 *
 * "Auction Browse: 4x3 grid layout; D-pad navigation highlighted in gold; filter
 *  row at top (Category chips, Sort chips); item cards show: thumbnail, lot
 *  title, current bid, time remaining bar."
 *
 * "Item Detail (TV): Two-column layout — full image left 60%, detail panel right
 *  40%; D-pad focus manages column switching."
 */
import { useEffect, useState } from 'react';
import type { AuctionWithRelations } from '@moneymart/types';
import { api } from '@/lib/api';
import { useFocus, useFocusable } from '@/lib/focus';
import { TvAuctionCard, TvButton, TvCountdown, TvPill, TvRow, TvSkeletonRow } from '@/components/tv';
import { formatMoney } from '@/lib/format';
import { MoneyMartWordmark } from './HomeScreen';

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'watches', label: 'Watches' },
  { value: 'sneakers', label: 'Sneakers' },
  { value: 'art', label: 'Art' },
  { value: 'cards', label: 'Cards' },
  { value: 'collectibles', label: 'Collectibles' },
  { value: 'jewelry', label: 'Jewelry' },
];

const SORTS = [
  { value: 'ending', label: 'Ending soonest' },
  { value: 'price', label: 'Highest price' },
  { value: 'bids', label: 'Most bids' },
];

export function TvBrowseScreen({ onOpenAuction }: { onOpenAuction: (id: string) => void }) {
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('ending');
  const [items, setItems] = useState<AuctionWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const { setActiveGroup, focusFirst } = useFocus();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await api.auctions({ category: category || undefined, sort });
        if (!cancelled) setItems(result.items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, sort]);

  useEffect(() => setActiveGroup('browse'), [setActiveGroup]);
  useEffect(() => {
    if (!loading) focusFirst('browse');
  }, [loading, focusFirst]);

  return (
    <div className="tv-screen" style={{ overflowY: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <MoneyMartWordmark />
        <span className="tv-caption" style={{ fontSize: '1.4rem' }}>
          {items.length} lots · highlighted in gold
        </span>
      </header>

      {/* Filter row (chips at top per §7.2 row-based composition) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <FilterChips
          id="cat"
          label="Category"
          options={CATEGORIES}
          active={category}
          onSelect={setCategory}
        />
        <FilterChips id="sort" label="Sort" options={SORTS} active={sort} onSelect={setSort} />
      </div>

      {loading ? (
        <TvSkeletonRow count={4} width="24rem" height="20rem" />
      ) : (
        <TvRow title={category ? category.toUpperCase() : 'All Lots'} subtitle="D-pad to browse, OK to open">
          {items.map((auction) => (
            <TvAuctionCard
              key={auction.id}
              auction={auction}
              group="browse"
              width="26rem"
              onSelect={() => onOpenAuction(auction.id)}
            />
          ))}
        </TvRow>
      )}
    </div>
  );
}

function FilterChips({
  id,
  label,
  options,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  active: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
      <span className="tv-caption" style={{ fontSize: '1.3rem', minWidth: '8rem' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>
        {options.map((option) => (
          <Chip
            key={option.value}
            id={`${id}-${option.value}`}
            label={option.label}
            selected={option.value === active}
            onSelect={() => onSelect(option.value)}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({
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
  const { ref, focused, focusProps } = useFocusable({ id, group: 'browse', onSelect });
  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      {...focusProps}
      onClick={onSelect}
      className="tv-focusable"
      style={{
        padding: '0.9rem 1.9rem',
        fontSize: '1.6rem',
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

/* ── Item Detail (TV): 60/40 two-column (§7.3) ─────────────────────────── */

export function TvItemScreen({ auctionId, onBack }: { auctionId: string; onBack: () => void }) {
  const [auction, setAuction] = useState<AuctionWithRelations | null>(null);
  const [bids, setBids] = useState<{ id: string; amount: number; bidderHandle: string; timestamp: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { setActiveGroup, focusFirst } = useFocus();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await api.auction(auctionId);
        if (cancelled) return;
        setAuction(detail.auction);
        setBids(detail.bids);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the lot');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auctionId]);

  useEffect(() => setActiveGroup('item'), [setActiveGroup]);
  useEffect(() => {
    if (auction) focusFirst('item');
  }, [auction, focusFirst]);

  if (error) {
    return (
      <div className="tv-screen" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <h1 className="tv-heading">Lot unavailable</h1>
        <p className="tv-body">{error}</p>
        <TvButton id="item-back" label="Back to browse" onSelect={onBack} />
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="tv-screen">
        <div className="tv-skeleton" style={{ height: '60%' }} />
      </div>
    );
  }

  return (
    <div className="tv-screen" style={{ overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <MoneyMartWordmark />
        <div style={{ display: 'flex', gap: '1rem' }}>
          {auction.isLive ? <TvPill tone="live">LIVE</TvPill> : <TvPill>{auction.status.toUpperCase()}</TvPill>}
          {auction.item.isVerified ? <TvPill tone="gold">MV VERIFIED</TvPill> : null}
          {auction.reservePrice ? (
            <TvPill tone={auction.reserveMet ? 'live' : 'neutral'}>
              {auction.reserveMet ? 'RESERVE MET' : 'RESERVE NOT MET'}
            </TvPill>
          ) : null}
        </div>
      </header>

      {/* Two columns: image left 60%, detail right 40% */}
      <div style={{ flex: 1, display: 'flex', gap: '2.5rem', overflow: 'hidden' }}>
        <div style={{ flex: '0 0 58%', borderRadius: '20px', overflow: 'hidden', position: 'relative' }}>
          <img
            src={auction.item.images[0]}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, transparent 55%, rgba(7,15,24,0.85) 100%)',
            }}
          />
          <div style={{ position: 'absolute', bottom: '2rem', left: '2rem', right: '2rem' }}>
            <p className="tv-caption" style={{ fontSize: '1.3rem' }}>
              {auction.lotNumber ?? auction.item.categoryId.toUpperCase()} · {auction.bidCount} bids
            </p>
            <h1 className="tv-heading" style={{ fontSize: '2.8rem', marginTop: '0.4rem' }}>
              {auction.item.title}
            </h1>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.6rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '2rem' }}>
            <span className="tv-data" style={{ fontSize: '3.4rem', fontWeight: 700, color: 'var(--mm-gold)' }}>
              {formatMoney(auction.currentBid || auction.startingPrice, auction.currency)}
            </span>
            <TvCountdown endsAt={auction.endTime} size="2.2rem" />
          </div>

          <p className="tv-body" style={{ fontSize: '1.6rem', lineHeight: 1.5 }}>
            {auction.item.description.slice(0, 260)}
            {auction.item.description.length > 260 ? '…' : ''}
          </p>

          {auction.item.provenance ? (
            <div>
              <p className="tv-caption" style={{ fontSize: '1.2rem', color: 'var(--mm-gold)', fontWeight: 700 }}>
                PROVENANCE
              </p>
              <p className="tv-body" style={{ fontSize: '1.5rem' }}>
                {auction.item.provenance}
              </p>
            </div>
          ) : null}

          <div>
            <p className="tv-caption" style={{ fontSize: '1.2rem', color: 'var(--mm-gold)', fontWeight: 700 }}>
              BID HISTORY
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
              {bids.slice(0, 5).map((bid, index) => (
                <div
                  key={bid.id}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.5rem' }}
                >
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>Bidder #{String(index + 41).padStart(4, '0')}</span>
                  <span className="tv-data" style={{ color: index === 0 ? 'var(--mm-gold)' : 'rgba(255,255,255,0.8)' }}>
                    {formatMoney(bid.amount, auction.currency)}
                  </span>
                </div>
              ))}
              {!bids.length ? <p className="tv-caption">No bids yet.</p> : null}
            </div>
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: '1.2rem' }} id="item-actions">
            <TvButton
              id="item-bid"
              label="Bid on your phone"
              variant="gold"
              group="item"
              autofocus
              onSelect={onBack}
            />
            <TvButton id="item-back" label="Back" variant="ghost" group="item" onSelect={onBack} />
          </div>
        </div>
      </div>
    </div>
  );
}
