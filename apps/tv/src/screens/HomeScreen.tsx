/**
 * MoneyMart TV — Home screen (§7.3).
 *
 * Row-based composition only: a hero row that rotates every 8 seconds, then
 * "Ending Soon", "Top Creators Live Now" and "Just Added" rows. D-pad travels
 * left/right within a row and up/down between rows.
 */
import { useEffect, useState } from 'react';
import type { AuctionWithRelations, StreamWithRelations } from '@moneymart/types';
import { api } from '@/lib/api';
import { useFocus, useFocusable } from '@/lib/focus';
import { TvAuctionCard, TvButton, TvCountdown, TvPill, TvRow, TvSkeletonRow, TvStreamCard } from '@/components/tv';
import { formatCountdown, formatMoney, formatViewers } from '@/lib/format';

export function TvHomeScreen({
  onOpenStream,
  onOpenAuction,
}: {
  onOpenStream: (id: string) => void;
  onOpenAuction: (id: string) => void;
}) {
  const [streams, setStreams] = useState<StreamWithRelations[]>([]);
  const [ending, setEnding] = useState<AuctionWithRelations[]>([]);
  const [fresh, setFresh] = useState<AuctionWithRelations[]>([]);
  const [sold, setSold] = useState<AuctionWithRelations[]>([]);
  const [hero, setHero] = useState(0);
  const [loading, setLoading] = useState(true);
  const { setActiveGroup, focusFirst } = useFocus();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [streamList, endingList, freshList, soldList] = await Promise.all([
          api.streams(),
          api.auctions({ status: 'ending', sort: 'ending' }),
          api.auctions({ sort: 'ending', limit: 14 }),
          api.auctions({ status: 'sold', sort: 'price', limit: 10 }),
        ]);
        if (cancelled) return;
        setStreams(streamList.items);
        setEnding(endingList.items);
        setFresh(freshList.items);
        setSold(soldList.items);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const live = streams.filter((stream) => stream.status === 'live');

  // §7.2: the hero carousel advances every 8 seconds.
  useEffect(() => {
    if (live.length < 2) return;
    const timer = setInterval(() => setHero((value) => (value + 1) % live.length), 8000);
    return () => clearInterval(timer);
  }, [live.length]);

  useEffect(() => setActiveGroup('home'), [setActiveGroup]);
  useEffect(() => {
    if (!loading) focusFirst('home');
  }, [loading, focusFirst]);

  const featured = live[hero];

  return (
    <div className="tv-screen" style={{ overflowY: 'auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <MoneyMartWordmark />
          <span className="tv-pill" style={{ fontSize: '1.3rem' }}>
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <TvPill tone="live">
            <span className="tv-live-dot" style={{ width: '0.7rem', height: '0.7rem' }} />
            {live.length} LIVE NOW
          </TvPill>
          <span className="tv-caption" style={{ fontSize: '1.4rem' }}>
            Press ← → ↑ ↓ to browse · OK to select · Back to return
          </span>
        </div>
      </header>

      {/* Hero row — one full-width item (§7.2 row-based layout) */}
      {featured ? (
        <HeroSpotlight
          stream={featured}
          onOpen={() => onOpenStream(featured.id)}
          onNext={() => setHero((value) => (value + 1) % live.length)}
          index={hero}
          total={live.length}
        />
      ) : loading ? (
        <div className="tv-skeleton" style={{ height: '22rem' }} />
      ) : null}

      {loading ? (
        <>
          <TvSkeletonRow />
          <TvSkeletonRow />
        </>
      ) : (
        <>
          {ending.length ? (
            <TvRow title="Ending Soon" subtitle="Closing within the hour — scan to bid from your phone">
              {ending.map((auction) => (
                <TvAuctionCard
                  key={auction.id}
                  auction={auction}
                  group="home"
                  onSelect={() => onOpenAuction(auction.id)}
                />
              ))}
            </TvRow>
          ) : null}

          <TvRow title="Top Creators Live Now" subtitle={`${live.length} rooms streaming`}>
            {live.map((stream) => (
              <TvStreamCard key={stream.id} stream={stream} group="home" onSelect={() => onOpenStream(stream.id)} />
            ))}
          </TvRow>

          <TvRow title="Just Added" subtitle="Fresh lots across every category">
            {fresh.map((auction) => (
              <TvAuctionCard key={auction.id} auction={auction} group="home" onSelect={() => onOpenAuction(auction.id)} />
            ))}
          </TvRow>

          {sold.length ? (
            <TvRow title="Recently Sold" subtitle="Completed results feed the category price history">
              {sold.map((auction) => (
                <TvAuctionCard key={auction.id} auction={auction} group="home" onSelect={() => onOpenAuction(auction.id)} />
              ))}
            </TvRow>
          ) : null}
        </>
      )}

      <footer style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', paddingTop: '1rem' }}>
        <span className="tv-caption">MoneyMart TV · Bid. Stream. Win.</span>
        <span className="tv-caption">
          {streams.reduce((sum, stream) => sum + stream.viewerCount, 0).toLocaleString()} bidders watching
        </span>
      </footer>
    </div>
  );
}

/** Hero row: one full-width featured item with a rotating indicator. */
function HeroSpotlight({
  stream,
  onOpen,
  onNext,
  index,
  total,
}: {
  stream: StreamWithRelations;
  onOpen: () => void;
  onNext: () => void;
  index: number;
  total: number;
}) {
  const { ref, focused, focusProps } = useFocusable({ id: 'hero', group: 'home', onSelect: onOpen, priority: 100 });
  const auction = stream.activeAuction;

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      {...focusProps}
      onClick={onOpen}
      className={`tv-card tv-focusable ${focused ? 'tv-card--focused' : ''}`}
      style={{ display: 'flex', height: '24rem', cursor: 'pointer' }}
    >
      <div style={{ position: 'relative', flex: '1 1 62%', overflow: 'hidden' }}>
        <img
          src={auction?.item.images[0] ?? stream.posterUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(90deg, rgba(7,15,24,0.1) 40%, rgba(7,15,24,0.95) 100%)',
          }}
        />
      </div>

      <div style={{ flex: '1 1 38%', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <TvPill tone="live">
            <span className="tv-live-dot" style={{ width: '0.7rem', height: '0.7rem' }} />
            LIVE · {formatViewers(stream.viewerCount)} WATCHING
          </TvPill>
          {auction?.item.isVerified ? <TvPill tone="gold">MV VERIFIED</TvPill> : null}
        </div>

        <h1 className="tv-heading" style={{ fontSize: '3.4rem' }}>
          {stream.creator.displayName}
        </h1>
        <p className="tv-body tv-body-lg" style={{ color: 'rgba(255,255,255,0.9)' }}>
          {stream.title}
        </p>

        {auction ? (
          <>
            <p className="tv-body" style={{ color: 'rgba(255,255,255,0.66)' }}>
              Now: {auction.item.title}
            </p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '2rem', marginTop: 'auto' }}>
              <span className="tv-data" style={{ fontSize: '3.6rem', fontWeight: 700, color: 'var(--mm-gold)' }}>
                {formatMoney(auction.currentBid || auction.startingPrice, auction.currency)}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="tv-caption" style={{ fontSize: '1.2rem' }}>
                  ENDS IN
                </span>
                <TvCountdown endsAt={auction.endTime} size="2.4rem" />
              </span>
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.7rem' }}>
            {Array.from({ length: Math.min(total, 6) }).map((_, dot) => (
              <span
                key={dot}
                style={{
                  width: dot === index % 6 ? '2.4rem' : '0.8rem',
                  height: '0.5rem',
                  borderRadius: '999px',
                  background: dot === index % 6 ? 'var(--mm-gold)' : 'rgba(255,255,255,0.25)',
                }}
              />
            ))}
          </div>
          <TvButton id="hero-next" label="Next room" variant="navy" group="home" onSelect={onNext} />
        </div>
      </div>
    </section>
  );
}

export function MoneyMartWordmark() {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      <svg width="46" height="50" viewBox="0 0 44 48" fill="none" aria-hidden>
        <path d="M2 30V12l9 10 9-10v18" stroke="#F5A623" strokeWidth="4.4" strokeLinecap="square" fill="none" />
        <path d="M22 30V12l9 10 9-10v18" stroke="#F5A623" strokeWidth="4.4" strokeLinecap="square" fill="none" />
        <path d="M31 20.4h9.6" stroke="#00D4A1" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M2 39h8l3-5 3.4 10L20 39h6l2.4-3.4L31 39h11"
          stroke="#00D4A1"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontFamily: 'var(--mm-font-display)', fontSize: '2.2rem', fontWeight: 700, color: '#fff' }}>
          Money<span style={{ color: 'var(--mm-gold)' }}>Mart</span>
        </span>
        <span
          style={{
            fontSize: '0.95rem',
            letterSpacing: '0.3em',
            color: 'var(--mm-gold)',
            fontWeight: 600,
          }}
        >
          BID. STREAM. WIN.
        </span>
      </span>
    </span>
  );
}

export function TvCountdownInline({ endsAt }: { endsAt: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => force((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tv-data">{formatCountdown(Math.max(0, Date.parse(endsAt) - Date.now()))}</span>;
}
