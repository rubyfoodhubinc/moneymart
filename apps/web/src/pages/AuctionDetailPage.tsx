/**
 * Auction Detail — blueprint §8.2 `/auctions/[id]` and §5.2 Auction Detail Screen.
 *
 * Lot number + title in Display type, full-bleed gallery, tabbed detail panel
 * (Description | Provenance | Condition Report), live bid history, reserve
 * indicator, increment-selecting bid input, D:H:M:S countdown, and a
 * non-dismissable buyer's premium disclosure at the base of the screen.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AuctionWithRelations } from '@moneymart/types';
import { AuctionCard, BidHistory, CountdownTimer, PriceHistoryChart, WatchButton } from '@/components/auction';
import {
  Avatar,
  Button,
  Card,
  ConfettiBlast,
  EmptyState,
  Pill,
  PriceTag,
  SectionHeader,
  Skeleton,
  Toast,
  ToastStack,
  VerifiedBadge,
} from '@/components/ui';
import {
  BellIcon,
  ChartIcon,
  CheckIcon,
  GlobeIcon,
  GavelIcon,
  HeartIcon,
  ShareIcon,
  ShieldIcon,
  TruckIcon,
  UsersIcon,
} from '@/components/icons';
import { api, queryKeys, ApiError } from '@/lib/api';
import {
  useAuctionDetail,
  useAuctionRoom,
  useAutoBid,
  useBidShortcuts,
  usePlaceBid,
  useWatchlist,
} from '@/lib/hooks';
import { formatAge, formatMoney, minimumIncrement, pct } from '@/lib/format';
import { auctionTypeLabel, categoryLabel, conditionHint, conditionLabel } from '@/lib/labels';
import { useSession } from '@/store/session';

type DetailTab = 'description' | 'provenance' | 'condition';

export default function AuctionDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useAuctionDetail(id);
  const user = useSession((state) => state.user);
  const watchlist = useWatchlist();

  const room = useAuctionRoom(id, {
    seedAuction: detail.data?.auction ?? null,
    seedBids: detail.data?.bids ?? [],
  });
  const auction = room.auction ?? detail.data?.auction ?? null;

  const placeBid = usePlaceBid(id);
  const autoBid = useAutoBid(id);

  const [tab, setTab] = useState<DetailTab>('description');
  const [gallery, setGallery] = useState(0);
  const [increment, setIncrement] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [maxAmount, setMaxAmount] = useState(0);
  const [aggressive, setAggressive] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'green' | 'error' | 'gold'; title: string; body?: string } | null>(null);
  const [shared, setShared] = useState(false);

  const market = useQuery({
    queryKey: queryKeys.market(auction?.item.categoryId ?? 'none'),
    queryFn: () => api.market(auction!.item.categoryId),
    enabled: Boolean(auction?.item.categoryId),
  });

  const minimum = useMemo(
    () =>
      auction
        ? detail.data?.minimumBid ??
          Math.round((auction.currentBid || auction.startingPrice) + minimumIncrement(auction.currentBid || auction.startingPrice))
        : 0,
    [auction, detail.data?.minimumBid],
  );

  const step = Math.max(1, Math.round(minimum - (auction?.currentBid || auction?.startingPrice || 0)));
  const effectiveIncrement = increment ?? step;
  const bidAmount = (auction?.currentBid || auction?.startingPrice || 0) + effectiveIncrement;
  const breakdown = detail.data?.breakdown;
  const premiumTotal = breakdown
    ? Math.round((bidAmount + bidAmount * breakdown.buyersPremiumRate) * 100) / 100
    : 0;

  const isLeading = Boolean(user && auction?.currentBidderId === user.id);
  const closed = auction ? Date.parse(auction.endTime) <= Date.now() || auction.status === 'sold' : false;

  const onBid = async () => {
    if (!auction) return;
    setNotice(null);
    try {
      await placeBid.mutateAsync(bidAmount);
      setNotice({ tone: 'green', title: 'Bid placed', body: `${formatMoney(bidAmount, auction.currency)} is now the high bid.` });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Bid rejected';
      setNotice({ tone: 'error', title: 'Bid not accepted', body: message });
    }
  };

  const onAutoBid = async () => {
    if (!auction) return;
    setAutoOpen(false);
    try {
      await autoBid.mutateAsync({ maxAmount, increment: effectiveIncrement, aggressive });
      setNotice({
        tone: 'green',
        title: 'Auto-bid active',
        body: `We will bid on your behalf up to ${formatMoney(maxAmount, auction.currency)} — never more.`,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Auto-bid rejected';
      setNotice({ tone: 'error', title: 'Auto-bid not accepted', body: message });
    }
  };

  useBidShortcuts({
    onBid: () => void onBid(),
    onWatch: () => auction && watchlist.toggle(auction.id),
    onEscape: () => setAutoOpen(false),
  });

  if (detail.isLoading) {
    return (
      <div className="mm-container grid gap-6 py-8 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="aspect-[4/3] w-full" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="mm-container py-16">
        <EmptyState
          title="Lot not found"
          body="The lot you followed may have been withdrawn or removed by moderation."
          action={
            <Link to="/auctions">
              <Button variant="gold">Browse all lots</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { item, seller } = auction;
  const image = item.images[gallery] ?? item.images[0];

  return (
    <div className="mm-container py-6">
      <ConfettiBlast active={room.won} />

      {/* Breadcrumb */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[12.5px] text-white/45">
        <Link to="/auctions" className="hover:text-white">
          Auctions
        </Link>
        <span>/</span>
        <Link to={`/auctions?category=${item.categoryId}`} className="hover:text-white">
          {categoryLabel(item.categoryId)}
        </Link>
        <span>/</span>
        <span className="text-white/70">{auction.lotNumber ?? auction.title}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        {/* ── Gallery + detail panel ───────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden">
            <div className="relative aspect-[4/3]">
              <img src={image} alt={item.title} className="h-full w-full object-cover" />
              <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                {auction.isLive ? <Pill tone="green">Live now</Pill> : null}
                <Pill tone="gold">{auctionTypeLabel(auction.auctionType)}</Pill>
                {item.isVerified ? <VerifiedBadge /> : null}
              </div>
              <div className="absolute right-4 top-4">
                <Pill tone={auction.reserveMet ? 'green' : 'neutral'}>
                  {auction.reserveMet ? 'Reserve met' : 'Reserve not met'}
                </Pill>
              </div>
              {item.images.length > 1 ? (
                <div className="absolute inset-x-4 bottom-4 flex justify-center gap-2">
                  {item.images.map((entry, index) => (
                    <button
                      key={entry.slice(-24) + index}
                      type="button"
                      aria-label={`View image ${index + 1}`}
                      onClick={() => setGallery(index)}
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: index === gallery ? 28 : 8,
                        background: index === gallery ? 'var(--mm-gold)' : 'rgba(255,255,255,0.4)',
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            {item.images.length > 1 ? (
              <div className="flex gap-2 p-3">
                {item.images.map((entry, index) => (
                  <button
                    key={`thumb-${index}`}
                    type="button"
                    onClick={() => setGallery(index)}
                    className="h-14 w-16 overflow-hidden rounded-[9px] border transition-all"
                    style={{ borderColor: index === gallery ? 'var(--mm-gold-line)' : 'transparent' }}
                  >
                    <img src={entry} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </Card>

          {/* Lot heading */}
          <div>
            {auction.lotNumber ? (
              <p className="data mb-1 text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--mm-gold)' }}>
                {auction.lotNumber}
              </p>
            ) : null}
            <h1 className="text-[clamp(22px,3vw,36px)] text-white">{item.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Pill>{conditionLabel(item.condition)}</Pill>
              <Pill>
                <GlobeIcon size={11} /> {seller.countryCode}
              </Pill>
              <Pill>
                <UsersIcon size={11} /> {auction.watchers} watching
              </Pill>
              <span className="text-[12.5px] text-white/45">{auction.bidCount} bids placed</span>
            </div>
          </div>

          {/* Tabbed detail panel */}
          <Card className="p-5">
            <div className="mb-4 flex gap-1 rounded-[11px] border border-white/8 p-1" style={{ background: 'rgba(255,255,255,0.03)' }}>
              {([
                ['description', 'Description'],
                ['provenance', 'Provenance'],
                ['condition', 'Condition Report'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className="flex-1 rounded-[8px] py-2 text-[12.5px] font-semibold transition-all"
                  style={{
                    background: tab === key ? 'rgba(245,166,35,0.14)' : 'transparent',
                    color: tab === key ? 'var(--mm-gold)' : 'rgba(255,255,255,0.6)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'description' ? (
              <div>
                <p className={`text-[14px] leading-relaxed text-white/72 ${showMore ? '' : 'clamp-3'}`}>{item.description}</p>
                {item.description.length > 180 ? (
                  <button
                    type="button"
                    onClick={() => setShowMore((value) => !value)}
                    className="mt-3 text-[12.5px] font-semibold"
                    style={{ color: 'var(--mm-gold)' }}
                  >
                    {showMore ? 'Show less' : 'Show more'}
                  </button>
                ) : null}
              </div>
            ) : null}

            {tab === 'provenance' ? (
              <div>
                <p className="flex items-center gap-2 text-[13px] text-white/72">
                  <ShieldIcon size={14} />
                  {item.provenance ?? 'Provenance research is in progress for this lot.'}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MetaCell
                    label="Authenticity"
                    value={item.isVerified ? 'MV Verified' : 'Pending review'}
                    tone={item.isVerified ? 'green' : 'neutral'}
                  />
                  <MetaCell label="Lifetime sales" value={seller.totalSales.toLocaleString()} />
                  <MetaCell label="Seller rating" value={`${seller.rating.toFixed(1)} ★`} />
                  <MetaCell label="Response time" value={`${seller.responseTimeMinutes} min`} />
                </div>
              </div>
            ) : null}

            {tab === 'condition' ? (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Pill tone="gold">{conditionLabel(item.condition)}</Pill>
                  <span className="text-[12.5px] text-white/55">{conditionHint(item.condition)}</span>
                </div>
                <p className="text-[13.5px] leading-relaxed text-white/72">
                  {item.conditionReport ?? 'A conservator condition report will be published before the sale closes.'}
                </p>
              </div>
            ) : null}
          </Card>

          {/* Market data */}
          <Card className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-[15px] text-white">
              <ChartIcon size={16} />
              Market data — {categoryLabel(item.categoryId)}
            </h3>
            <PriceHistoryChart points={market.data?.points ?? []} currency={auction.currency} />
            <p className="mt-2 text-[12px] text-white/45">
              Last 12 months of completed MoneyMart sales in this category. Use it to judge fair market value.
            </p>
          </Card>

          {/* Related lots */}
          {(detail.data?.related?.length ?? 0) > 0 ? (
            <div>
              <SectionHeader eyebrow="More like this" title="Related lots" />
              <div className="rail">
                {detail.data!.related.map((entry: AuctionWithRelations) => (
                  <AuctionCard key={entry.id} auction={entry} />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Sticky bid column ────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-[88px] lg:self-start">
          <Card className="p-5">
            <div className="flex items-end justify-between gap-4">
              <PriceTag
                formatted={formatMoney(auction.currentBid || auction.startingPrice, auction.currency)}
                label={auction.bidCount ? `Current bid · ${auction.bidCount} bids` : 'Starting bid'}
                size="xl"
              />
              <div className="text-right">
                <CountdownTimer endTime={auction.endTime} size="lg" label />
                {auction.auctionType === 'traditional' && auction.status === 'scheduled' ? (
                  <p className="mt-1 text-[11px] text-white/45">Preview period open</p>
                ) : null}
              </div>
            </div>

            {auction.reservePrice ? (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                  <span className="text-white/50">Reserve {auction.reserveMet ? 'met' : 'not met'}</span>
                  <span className="text-white/40">Amount confidential</span>
                </div>
                <div className="h-[5px] w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, ((auction.currentBid || auction.startingPrice) / (auction.reservePrice || 1)) * 100)}%`,
                      background: auction.reserveMet ? 'var(--mm-green)' : 'var(--mm-gold)',
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* Increment selector (§5.2 dropdown: Minimum / Standard / Jump bid) */}
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Bid increment — {formatMoney(effectiveIncrement, auction.currency)}
              </p>
              <div className="flex gap-2">
                {(['Minimum', 'Standard', 'Jump bid'] as const).map((label, index) => {
                  const multiplier = [1, 2, 5][index];
                  const value = step * multiplier;
                  const selected = effectiveIncrement === value;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setIncrement(value)}
                      className="flex-1 rounded-[10px] border px-3 py-2 text-left transition-all"
                      style={{
                        borderColor: selected ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                        background: selected ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.03)',
                      }}
                    >
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
                        {label}
                      </span>
                      <span
                        className="data block text-[13.5px] font-semibold"
                        style={{ color: selected ? 'var(--mm-gold)' : 'rgba(255,255,255,0.8)' }}
                      >
                        +{formatMoney(value, auction.currency)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bid input */}
            <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-white/40">Your bid</span>
              <input
                type="number"
                value={bidAmount}
                min={minimum}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setIncrement(Math.max(1, Math.round(next - (auction.currentBid || auction.startingPrice))));
                }}
                className="data min-w-0 flex-1 bg-transparent text-right text-[20px] font-bold outline-none"
              />
              <span className="data text-[13px] text-white/50">{auction.currency}</span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <Button
                variant={isLeading ? 'navy' : 'gold'}
                size="lg"
                full
                loading={placeBid.isPending}
                disabled={closed || isLeading}
                onClick={() => void onBid()}
                icon={<GavelIcon size={16} />}
              >
                {closed ? 'Auction closed' : isLeading ? 'You hold the high bid' : `Place bid · ${formatMoney(bidAmount, auction.currency)}`}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  full
                  disabled={closed}
                  onClick={() => {
                    setMaxAmount(Math.round(minimum * 1.3));
                    setAutoOpen(true);
                  }}
                  icon={<BellIcon size={15} />}
                >
                  Auto-bid
                </Button>
                <WatchButton
                  watching={watchlist.has(auction.id)}
                  onToggle={() => watchlist.toggle(auction.id)}
                  count={auction.watchers}
                />
              </div>
              {auction.buyItNowPrice ? (
                <Button variant="green" full icon={<CheckIcon size={15} />}>
                  Buy it now · {formatMoney(auction.buyItNowPrice, auction.currency)}
                </Button>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4" style={{ borderColor: 'var(--mm-divider)' }}>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(window.location.href);
                  setShared(true);
                  window.setTimeout(() => setShared(false), 2200);
                }}
                className="inline-flex items-center gap-2 text-[12.5px] text-white/60 transition-colors hover:text-white"
              >
                <ShareIcon size={14} />
                {shared ? 'Link copied' : 'Share lot'}
              </button>
              <span className="inline-flex items-center gap-2 text-[12.5px] text-white/45">
                <HeartIcon size={14} />
                Press B to bid · W to watch
              </span>
            </div>
          </Card>

          {/* Seller card */}
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <Avatar name={seller.displayName} src={seller.avatarUrl} size={46} isLive={seller.isLive} isVerified={seller.isVerified} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[14.5px] font-semibold text-white">
                  {seller.displayName}
                  {seller.isVerified ? <VerifiedBadge compact /> : null}
                </p>
                <p className="text-[12.5px] text-white/55">
                  {seller.rating.toFixed(1)} ★ · {seller.totalSales} sales · {seller.followersCount.toLocaleString()} followers
                </p>
              </div>
              <Link to={`/seller/${seller.handle}`}>
                <Button size="sm" variant="navy">
                  View
                </Button>
              </Link>
            </div>
            {seller.bio ? <p className="mt-3 text-[12.5px] leading-relaxed text-white/55">{seller.bio}</p> : null}
          </Card>

          {/* Cost breakdown */}
          {breakdown ? (
            <Card className="p-5">
              <h3 className="mb-3 text-[14.5px] text-white">If you win at this price</h3>
              <dl className="space-y-2 text-[13px]">
                <Row label="Hammer price" value={formatMoney(bidAmount, auction.currency)} />
                <Row
                  label={`Buyer's premium (${pct(breakdown.buyersPremiumRate)})`}
                  value={formatMoney(bidAmount * breakdown.buyersPremiumRate, auction.currency)}
                />
                <Row label="Estimated shipping" value={formatMoney(breakdown.shipping, auction.currency)} />
                <Row label="Tax & duties" value={formatMoney(breakdown.tax, auction.currency)} />
                <div className="border-t pt-2.5" style={{ borderColor: 'var(--mm-divider)' }}>
                  <Row label="Total" value={formatMoney(premiumTotal, auction.currency)} strong />
                </div>
              </dl>
            </Card>
          ) : null}

          {/* Live bid history */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[14.5px] text-white">Bid history</h3>
              <span className="text-[11.5px] text-white/40">
                {room.connected ? 'Live' : 'Reconnecting…'}
              </span>
            </div>
            <BidHistory bids={room.bids} currentUserId={user?.id} maxVisible={8} />
          </Card>

          <div className="flex items-center gap-3 text-[11.5px] text-white/40">
            <TruckIcon size={14} />
            Cross-border shipping and duty calculated at checkout. Escrow releases on your confirmation.
          </div>
        </div>
      </div>

      {/* Non-dismissable buyer's premium disclosure (§5.2) */}
      {breakdown ? (
        <div
          className="mt-8 rounded-[12px] border p-4"
          style={{ borderColor: 'var(--mm-border)', background: 'rgba(245,166,35,0.07)' }}
        >
          <p className="text-[12.5px] leading-relaxed text-white/72">
            <strong className="text-white">Buyer’s premium disclosure.</strong> A buyer’s premium of{' '}
            {pct(breakdown.buyersPremiumRate)} is added to the hammer price of this lot
            {breakdown.buyersPremiumRate >= 0.2 ? ' (luxury category rate)' : ''} and is payable by the buyer in
            addition to the hammer price, shipping, and any applicable taxes or cross-border fees. The premium is
            included in the total shown above and is never charged after the fact.
          </p>
        </div>
      ) : null}

      {/* Auto-bid modal */}
      {autoOpen ? (
        <div
          className="fixed inset-0 z-[900] grid place-items-center p-4"
          style={{ background: 'rgba(7,15,24,0.82)', backdropFilter: 'blur(8px)' }}
          onClick={() => setAutoOpen(false)}
        >
          <div className="animate-scale-in w-full max-w-[440px]" onClick={(event) => event.stopPropagation()}>
            <div className="card-surface p-6">
              <h3 className="text-[18px] text-white">Set an auto-bid ceiling</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/55">
                MoneyMart bids the smallest amount needed to keep you ahead. Your maximum stays private and is
                never used to inflate the price against you.
              </p>

              <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Maximum bid
              </label>
              <input
                type="number"
                value={maxAmount}
                min={minimum}
                onChange={(event) => setMaxAmount(Number(event.target.value))}
                className="data mt-2 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[18px] font-semibold outline-none"
              />

              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Increment</p>
                <div className="flex gap-2">
                  {[1, 2, 5].map((multiplier) => {
                    const value = step * multiplier;
                    const selected = effectiveIncrement === value;
                    return (
                      <button
                        key={multiplier}
                        type="button"
                        onClick={() => setIncrement(value)}
                        className="flex-1 rounded-[10px] border px-3 py-2 transition-all"
                        style={{
                          borderColor: selected ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                          background: selected ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <span
                          className="data block text-[13.5px] font-semibold"
                          style={{ color: selected ? 'var(--mm-gold)' : 'rgba(255,255,255,0.8)' }}
                        >
                          +{formatMoney(value, auction.currency)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAggressive((value) => !value)}
                className="mt-4 flex w-full items-center justify-between rounded-[12px] border border-white/8 px-3.5 py-3"
                style={{ background: 'rgba(255,255,255,0.025)' }}
              >
                <span className="text-[13px] text-white/80">Aggressive mode</span>
                <span
                  className="relative h-[22px] w-[40px] rounded-full transition-colors"
                  style={{ background: aggressive ? 'var(--mm-green)' : 'rgba(255,255,255,0.14)' }}
                >
                  <span
                    className="absolute top-[3px] h-4 w-4 rounded-full bg-white transition-all"
                    style={{ left: aggressive ? 21 : 3 }}
                  />
                </span>
              </button>

              <div className="mt-5 flex gap-2">
                <Button variant="navy" full onClick={() => setAutoOpen(false)}>
                  Cancel
                </Button>
                <Button variant="gold" full loading={autoBid.isPending} onClick={() => void onAutoBid()}>
                  Activate auto-bid
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ToastStack>
        {notice ? <Toast tone={notice.tone} title={notice.title} body={notice.body} onDismiss={() => setNotice(null)} /> : null}
        {room.outbidNotice ? (
          <Toast
            tone="gold"
            title="You were outbid"
            body={`Another bidder moved ahead ${formatAge(new Date().toISOString())}. Bid again to stay in.`}
            onDismiss={room.clearNotices}
          />
        ) : null}
        {room.won ? (
          <Toast
            tone="green"
            title="You won this lot 🎉"
            body="Invoice generated, funds held in escrow. Shipping instructions are in your orders."
            action={
              <Button size="sm" variant="green" onClick={() => navigate('/account/orders')}>
                View order
              </Button>
            }
          />
        ) : null}
      </ToastStack>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'text-white' : 'text-white/55'}>{label}</dt>
      <dd className={`data ${strong ? 'text-[16px] font-bold' : 'font-semibold'}`} style={{ color: strong ? 'var(--mm-green)' : 'rgba(255,255,255,0.88)' }}>
        {value}
      </dd>
    </div>
  );
}

function MetaCell({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'green' }) {
  return (
    <div className="rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/40">{label}</p>
      <p
        className="data mt-1 text-[14px] font-semibold"
        style={{ color: tone === 'green' ? 'var(--mm-green)' : 'rgba(255,255,255,0.9)' }}
      >
        {value}
      </p>
    </div>
  );
}
