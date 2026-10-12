'use client';

/**
 * Live stream room — blueprint §8.2 `/stream/[id]`, §4.1 Creator-Led Live Stream Flow.
 * Desktop: stream left, bid panel + chat right (§4.1 Step 3).
 * Mobile: video top, bid panel anchored bottom with a tab switcher.
 *
 * Held-item flow: drop → countdown → bid → confetti win → auto-advance.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ITEM_TIMER } from '@moneymart/tokens';
import type { AuctionWithRelations } from '@moneymart/types';
import {
  BidButton,
  BidHistory,
  ChatPanel,
  CountdownTimer,
  IncrementSelector,
  LiveViewerPill,
  PriceHistoryChart,
  TimeRemainingBar,
  WatchButton,
} from '@/components/auction';
import {
  Avatar,
  Button,
  Card,
  ConfettiBlast,
  EmptyState,
  LiveBadge,
  Pill,
  PriceTag,
  Skeleton,
  Toast,
  ToastStack,
  VerifiedBadge,
} from '@/components/ui';
import {
  BellIcon,
  ChartIcon,
  CheckIcon,
  CloseIcon,
  GavelIcon,
  HeartIcon,
  LiveDot,
  PlayIcon,
  ShareIcon,
  ShieldIcon,
  SparkIcon,
  UsersIcon,
} from '@/components/icons';
import { useAuctionRoom, useAutoBid, usePlaceBid, useSendChat, useStreamDetail, useStreamRoom, useWatchlist } from '@/lib/hooks';
import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatMoney, formatViewers, minimumNextBid } from '@/lib/format';
import { useSession } from '@/store/session';

export default function StreamPage() {
  const params = useParams<{ id: string }>();
  const streamId = params?.id ?? '';
  const detail = useStreamDetail(streamId);
  const stream = detail.data?.stream;
  const queue = detail.data?.queue ?? [];
  const seededChat = detail.data?.chat;

  const room = useStreamRoom(streamId, {
    viewerCount: stream?.viewerCount,
    messages: seededChat,
  });

  const [pendingAuction, setPendingAuction] = useState<AuctionWithRelations | null>(null);
  const activeAuctionId = room.activeAuctionId ?? stream?.activeAuctionId;

  // When the stream advances to a new lot, follow it.
  useEffect(() => {
    if (!room.activeAuctionId) return;
    const match = queue.find((entry) => entry.id === room.activeAuctionId);
    if (match) setPendingAuction(match);
  }, [room.activeAuctionId, queue]);

  const activeAuction = pendingAuction ?? stream?.activeAuction ?? queue[0] ?? null;
  const user = useSession((state) => state.user);

  const auctionRoom = useAuctionRoom(activeAuction?.id, {
    seedAuction: activeAuction,
    seedBids: undefined,
  });
  const liveAuction = auctionRoom.auction ?? activeAuction;

  const placeBid = usePlaceBid(liveAuction?.id ?? '');
  const autoBid = useAutoBid(liveAuction?.id ?? '');
  const sendChat = useSendChat(streamId);
  const watchlist = useWatchlist();
  const market = useQuery({
    queryKey: queryKeys.market(liveAuction?.item.categoryId ?? 'none'),
    queryFn: () => api.market(liveAuction!.item.categoryId),
    enabled: Boolean(liveAuction?.item.categoryId),
  });

  const [tab, setTab] = useState<'bid' | 'chat' | 'queue'>('bid');
  const [autoOpen, setAutoOpen] = useState(false);
  const [aggressive, setAggressive] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const minimum = useMemo(
    () =>
      liveAuction
        ? minimumNextBid(liveAuction.startingPrice, liveAuction.currentBid, liveAuction.bidCount)
        : 0,
    [liveAuction],
  );

  // Auto-bid inputs follow the current lot without an extra render pass.
  const [maxAmountOverride, setMaxAmountOverride] = useState<number | null>(null);
  const [incrementOverride, setIncrementOverride] = useState<number | null>(null);
  const step = Math.max(1, Math.round((minimum - (liveAuction?.currentBid ?? 0)) || 1));
  const maxAmount = maxAmountOverride ?? Math.round(minimum * 1.25);
  const increment = incrementOverride ?? step;

  // Reset the overrides whenever the lot changes.
  const lotId = liveAuction?.id;
  useEffect(() => {
    setMaxAmountOverride(null);
    setIncrementOverride(null);
  }, [lotId]);

  useEffect(() => {
    if (auctionRoom.rejectNotice) {
      setBidError(auctionRoom.rejectNotice);
      const timer = window.setTimeout(() => {
        setBidError(null);
        auctionRoom.clearNotices();
      }, 4200);
      return () => window.clearTimeout(timer);
    }
  }, [auctionRoom, auctionRoom.rejectNotice]);

  const onBid = async () => {
    if (!liveAuction) return;
    setBidError(null);
    try {
      await placeBid.mutateAsync(minimum);
    } catch (error) {
      setBidError(error instanceof Error ? error.message : 'Bid rejected');
    }
  };

  const onAutoBid = async () => {
    if (!liveAuction) return;
    setAutoOpen(false);
    try {
      await autoBid.mutateAsync({ maxAmount, increment, aggressive });
    } catch (error) {
      setBidError(error instanceof Error ? error.message : 'Auto-bid rejected');
    }
  };

  const pinMessage = (messageId: string) => {
    if (!user) return;
    getSocket().emit('chat:pin', { streamId, messageId, userId: user.id });
  };

  if (detail.isLoading) {
    return (
      <div className="mm-container grid gap-5 py-8 lg:grid-cols-[1.55fr_1fr]">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="mm-container py-16">
        <EmptyState
          title="This stream has ended"
          body="The room is closed, but the replay and sold lots stay on the platform."
          action={
            <Link href="/live">
              <Button variant="gold">Find another live room</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mm-container py-6">
      <ConfettiBlast active={auctionRoom.won} />

      {/* Breadcrumb + top bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12.5px] text-white/45">
          <Link href="/live" className="hover:text-white">
            Live
          </Link>
          <span>/</span>
          <span className="text-white/70">{stream.title}</span>
          <Pill tone={stream.status === 'live' ? 'green' : 'neutral'}>
            {stream.status === 'live' ? <LiveDot size={7} /> : null}
            {stream.status}
          </Pill>
        </div>
        <div className="flex items-center gap-2">
          <LiveViewerPill count={room.viewerCount || stream.viewerCount} />
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href);
              setShared(true);
              window.setTimeout(() => setShared(false), 2200);
            }}
            className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold text-white/85 transition-colors hover:text-white"
          >
            <ShareIcon size={14} />
            {shared ? 'Link copied' : 'Share'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* ── Stream + current item ─────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          <div className="card-surface relative overflow-hidden">
            <div className="relative aspect-video">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={liveAuction?.item.images[0] ?? stream.posterUrl}
                alt={stream.title}
                className="h-full w-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(180deg, rgba(7,15,24,0.1) 30%, rgba(7,15,24,0.9) 100%)' }}
              />

              {/* Overlaid top bar (§5.2) */}
              <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    name={stream.creator.displayName}
                    src={stream.creator.avatarUrl}
                    size={38}
                    isLive={stream.status === 'live'}
                    isVerified={stream.creator.isVerified}
                  />
                  <div className="glass rounded-[11px] px-3 py-1.5">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                      {stream.creator.displayName}
                      {stream.creator.isVerified ? <VerifiedBadge compact /> : null}
                    </p>
                    <p className="text-[11px] text-white/55">{stream.title}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold text-white"
                >
                  <HeartIcon size={14} filled />
                  Following
                </button>
              </div>

              <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
                <div className="glass max-w-[62%] rounded-[13px] p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--mm-gold)' }}>
                    <SparkIcon size={11} /> Now dropping
                  </p>
                  <p className="clamp-2 text-[14px] font-semibold text-white">{liveAuction?.item.title ?? 'Waiting for the next drop'}</p>
                  {liveAuction ? (
                    <div className="mt-2 flex items-center gap-3">
                      <PriceTag
                        formatted={formatMoney(liveAuction.currentBid || liveAuction.startingPrice, liveAuction.currency)}
                        size="sm"
                      />
                      <CountdownTimer endTime={liveAuction.endTime} size="sm" label />
                    </div>
                  ) : null}
                </div>
                <span
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-[#0D1B2A]"
                  style={{ background: 'var(--mm-gradient-gold)', boxShadow: 'var(--mm-shadow-gold)' }}
                >
                  <PlayIcon size={20} />
                </span>
              </div>
            </div>

            {liveAuction ? (
              <div className="px-4 pb-4 pt-3">
                <TimeRemainingBar endTime={liveAuction.endTime} durationMs={ITEM_TIMER.default * 1000} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Pill tone="gold">{liveAuction.bidCount} bids</Pill>
                    <Pill tone={liveAuction.reserveMet ? 'green' : 'neutral'}>
                      {liveAuction.reserveMet ? 'Reserve met' : 'Reserve not met'}
                    </Pill>
                    {auctionRoom.connected ? (
                      <Pill tone="green">
                        <CheckIcon size={11} /> Realtime
                      </Pill>
                    ) : (
                      <Pill tone="neutral">Reconnecting…</Pill>
                    )}
                  </div>
                  <WatchButton
                    watching={watchlist.has(liveAuction.id)}
                    onToggle={() => watchlist.toggle(liveAuction.id)}
                    count={liveAuction.watchers}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Bid bar — always visible on mobile (§5.2 anchored bid panel) */}
          {liveAuction ? (
            <div className="card-surface p-4 lg:hidden">
              <div className="mb-3 flex items-end justify-between">
                <PriceTag
                  formatted={formatMoney(liveAuction.currentBid || liveAuction.startingPrice, liveAuction.currency)}
                  label={`Bid ${formatMoney(minimum, liveAuction.currency)} or more`}
                  size="lg"
                />
                <CountdownTimer endTime={liveAuction.endTime} size="md" />
              </div>
              <BidButton
                price={minimum}
                formatted={formatMoney(minimum, liveAuction.currency)}
                currency={liveAuction.currency}
                isActive={Date.now() - auctionRoom.lastBidAt < 1200}
                loading={placeBid.isPending}
                onPress={onBid}
                onLongPress={() => setAutoOpen(true)}
              />
              <button
                type="button"
                onClick={() => setAutoOpen(true)}
                className="mt-2 w-full text-[12px] font-semibold uppercase tracking-wider text-white/45"
              >
                Set auto-bid ceiling
              </button>
            </div>
          ) : null}

          {liveAuction ? (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[15px] text-white">Bid history</h3>
                <span className="text-[11.5px] text-white/40">Anonymised · live-updating</span>
              </div>
              <BidHistory bids={auctionRoom.bids} currentUserId={user?.id} maxVisible={6} />
            </Card>
          ) : null}
        </div>

        {/* ── Right panel: bid / chat / queue ──────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-4 lg:sticky lg:top-[88px] lg:h-[calc(100vh-108px)]">
          <div
            className="flex shrink-0 gap-1 rounded-[12px] border border-white/8 p-1"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            {([
              ['bid', 'Bid panel'],
              ['chat', 'Chat'],
              ['queue', `Queue (${queue.length})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className="flex-1 rounded-[9px] py-2 text-[12.5px] font-semibold transition-all duration-200"
                style={{
                  background: tab === key ? 'rgba(245,166,35,0.14)' : 'transparent',
                  color: tab === key ? 'var(--mm-gold)' : 'rgba(255,255,255,0.6)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'bid' ? (
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {liveAuction ? (
                <>
                  <div className="border-b p-4" style={{ borderColor: 'var(--mm-divider)' }}>
                    <p className="text-[11px] text-white/40">Current lot</p>
                    <h3 className="clamp-2 mt-1 text-[15px] font-semibold text-white">{liveAuction.item.title}</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Current</p>
                        <p className="data text-[24px] font-bold" style={{ color: 'var(--mm-gold)' }}>
                          {formatMoney(liveAuction.currentBid || liveAuction.startingPrice, liveAuction.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Next bid</p>
                        <p className="data text-[24px] font-bold text-white">
                          {formatMoney(minimum, liveAuction.currency)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <CountdownTimer endTime={liveAuction.endTime} size="md" label />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                      Choose your increment
                    </p>
                    <IncrementSelector
                      current={liveAuction.currentBid || liveAuction.startingPrice}
                      value={increment}
                      onChange={setIncrementOverride}
                    />
                    <div className="mt-4 rounded-[12px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.025)' }}>
                      <div className="flex items-center justify-between text-[12.5px]">
                        <span className="text-white/55">Your bid</span>
                        <span className="data font-semibold text-white">
                          {formatMoney(minimum, liveAuction.currency)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[12.5px]">
                        <span className="text-white/55">Buyer’s premium</span>
                        <span className="data font-semibold text-white/85">
                          {Math.round(liveAuction.buyersPremiumRate * 100)}%
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[12.5px]">
                        <span className="text-white/55">Total if you win</span>
                        <span className="data font-semibold" style={{ color: 'var(--mm-green)' }}>
                          {formatMoney(minimum * (1 + liveAuction.buyersPremiumRate), liveAuction.currency)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                        Latest bids
                      </p>
                      <BidHistory bids={auctionRoom.bids.slice(0, 5)} currentUserId={user?.id} maxVisible={5} />
                    </div>

                    {liveAuction.item.provenance ? (
                      <div className="mt-5 rounded-[12px] border p-3" style={{ borderColor: 'var(--mm-border)' }}>
                        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--mm-gold)' }}>
                          <ShieldIcon size={11} /> Provenance
                        </p>
                        <p className="text-[12.5px] leading-relaxed text-white/65">{liveAuction.item.provenance}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t p-4" style={{ borderColor: 'var(--mm-divider)' }}>
                    <BidButton
                      price={minimum}
                      formatted={formatMoney(minimum, liveAuction.currency)}
                      currency={liveAuction.currency}
                      isActive={Date.now() - auctionRoom.lastBidAt < 1200}
                      loading={placeBid.isPending}
                      onPress={onBid}
                      onLongPress={() => setAutoOpen(true)}
                    />
                    <button
                      type="button"
                      onClick={() => setAutoOpen(true)}
                      className="mt-2 w-full text-[12px] font-semibold uppercase tracking-wider text-white/45 transition-colors hover:text-white/80"
                    >
                      Set auto-bid ceiling
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-6">
                  <EmptyState
                    title="No lot on the block"
                    body="The creator is between drops. The next lot loads automatically."
                    icon={<GavelIcon size={22} />}
                  />
                </div>
              )}
            </Card>
          ) : null}

          {tab === 'chat' ? (
            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ChatPanel
                messages={room.messages}
                pinned={room.pinned}
                onSend={sendChat}
                onPin={pinMessage}
                canPin={user?.id === stream.creatorId || user?.role === 'admin'}
                currentUserId={user?.id}
                disabled={!stream.chatEnabled}
              />
            </Card>
          ) : null}

          {tab === 'queue' ? (
            <Card className="min-h-0 flex-1 overflow-y-auto p-3">
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
                Up next in this stream
              </p>
              <div className="space-y-2">
                {queue.map((entry, index) => {
                  const isActive = entry.id === liveAuction?.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setPendingAuction(entry);
                        setTab('bid');
                      }}
                      className="flex w-full items-center gap-3 rounded-[12px] border p-2.5 text-left transition-all duration-200"
                      style={{
                        borderColor: isActive ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.08)',
                        background: isActive ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.02)',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={entry.item.images[0]}
                        alt={entry.item.title}
                        className="h-12 w-12 shrink-0 rounded-[9px] object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="clamp-1 block text-[13px] font-medium text-white/90">{entry.item.title}</span>
                        <span className="data mt-0.5 block text-[11.5px] text-white/45">
                          {formatMoney(entry.currentBid || entry.startingPrice, entry.currency)}
                        </span>
                      </span>
                      {isActive ? (
                        <Pill tone="green">Live</Pill>
                      ) : (
                        <span className="data shrink-0 text-[11px] text-white/35">#{index + 1}</span>
                      )}
                    </button>
                  );
                })}
                {!queue.length ? (
                  <p className="px-1 py-6 text-center text-[12.5px] text-white/45">Queue finished for this stream.</p>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Card className="shrink-0 p-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[12.5px] text-white/55">
                <ChartIcon size={14} />
                Creator dashboard
              </span>
              <Link href="/account/selling" className="text-[12px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
                Open →
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="data text-[16px] font-bold text-white">{formatViewers(stream.peakViewerCount)}</p>
                <p className="text-[10.5px] uppercase tracking-wider text-white/40">Peak</p>
              </div>
              <div>
                <p className="data text-[16px] font-bold" style={{ color: 'var(--mm-green)' }}>
                  {formatMoney(stream.totalGMV, 'USD', { compact: true })}
                </p>
                <p className="text-[10.5px] uppercase tracking-wider text-white/40">Stream GMV</p>
              </div>
              <div>
                <p className="data text-[16px] font-bold" style={{ color: 'var(--mm-gold)' }}>
                  {queue.filter((entry) => entry.status === 'sold').length}
                </p>
                <p className="text-[10.5px] uppercase tracking-wider text-white/40">Sold</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Market context for the active category */}
      {liveAuction ? (
        <Card className="mt-5 p-5">
          <h3 className="mb-4 text-[15px] text-white">
            Market data — {liveAuction.item.categoryId} (12-month completed sales)
          </h3>
          <PriceHistoryChart points={market.data?.points ?? []} currency={liveAuction.currency} />
          {!market.data?.points?.length ? (
            <p className="text-[12px] text-white/45">Loading market history from the market service…</p>
          ) : null}
        </Card>
      ) : null}

      {/* Auto-bid modal (§5.2 long-press bid button) */}
      {autoOpen && liveAuction ? (
        <div
          className="fixed inset-0 z-[900] grid place-items-center p-4"
          style={{ background: 'rgba(7,15,24,0.82)', backdropFilter: 'blur(8px)' }}
          onClick={() => setAutoOpen(false)}
        >
          <div className="animate-scale-in w-full max-w-[440px]" onClick={(event) => event.stopPropagation()}>
            <div className="card-surface p-6">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h3 className="text-[18px] text-white">Auto-bid</h3>
                  <p className="mt-1 text-[12.5px] text-white/55">
                    Set your ceiling. MoneyMart bids the minimum needed to keep you on top — never your maximum.
                  </p>
                </div>
                <button type="button" onClick={() => setAutoOpen(false)} className="text-white/45 hover:text-white">
                  <CloseIcon size={18} />
                </button>
              </div>

              <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Maximum bid
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <span className="data text-[16px] text-white/50">
                  {formatMoney(0, liveAuction.currency).replace(/[\d.,]/g, '')}
                </span>
                <input
                  type="number"
                  value={maxAmount}
                  min={minimum}
                  onChange={(event) => setMaxAmountOverride(Number(event.target.value))}
                  className="data min-w-0 flex-1 bg-transparent text-[18px] font-semibold outline-none"
                />
              </div>

              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  Increment size
                </p>
                <div className="flex gap-2">
                  {[
                    { label: 'Minimum', value: Math.max(1, Math.round((minimum - liveAuction.currentBid) || 1)) },
                    { label: 'Mid', value: Math.max(2, Math.round(((minimum - liveAuction.currentBid) || 1) * 2)) },
                    { label: 'Aggressive', value: Math.max(5, Math.round(((minimum - liveAuction.currentBid) || 1) * 5)) },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => setIncrementOverride(option.value)}
                      className="flex-1 rounded-[10px] border px-3 py-2 text-left transition-all duration-200"
                      style={{
                        borderColor: increment === option.value ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                        background: increment === option.value ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.03)',
                      }}
                    >
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
                        {option.label}
                      </span>
                      <span
                        className="data block text-[14px] font-semibold"
                        style={{ color: increment === option.value ? 'var(--mm-gold)' : 'rgba(255,255,255,0.8)' }}
                      >
                        +{option.value}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAggressive((value) => !value)}
                className="mt-4 flex w-full items-center justify-between rounded-[12px] border border-white/8 px-3.5 py-3"
                style={{ background: 'rgba(255,255,255,0.025)' }}
              >
                <span className="text-[13px] text-white/80">Aggressive mode — jump the ladder faster</span>
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

              <div className="mt-4 rounded-[12px] border p-3" style={{ borderColor: 'var(--mm-border)' }}>
                <p className="flex items-center gap-1.5 text-[12px] text-white/60">
                  <BellIcon size={13} />
                  You will be notified within 1 second of being outbid.
                </p>
              </div>

              <div className="mt-5 flex gap-2">
                <Button variant="navy" full onClick={() => setAutoOpen(false)}>
                  Cancel
                </Button>
                <Button variant="gold" full loading={autoBid.isPending} onClick={onAutoBid} icon={<GavelIcon size={15} />}>
                  Activate auto-bid
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ToastStack>
        {bidError ? (
          <Toast tone="error" title="Bid not accepted" body={bidError} onDismiss={() => setBidError(null)} />
        ) : null}
        {auctionRoom.outbidNotice ? (
          <Toast
            tone="gold"
            title="You were outbid"
            body="Another bidder moved ahead. Bid again to reclaim the lot."
            onDismiss={auctionRoom.clearNotices}
          />
        ) : null}
        {auctionRoom.won ? (
          <Toast
            tone="green"
            title="You won the lot 🎉"
            body="Invoice generated and payment held in escrow. Check your orders for shipping."
          />
        ) : null}
        {shared ? <Toast tone="green" title="Room link copied" body="Share it anywhere — the recipient lands straight in the room." /> : null}
      </ToastStack>

      <p className="mt-6 flex items-center gap-2 text-[11.5px] text-white/35">
        <UsersIcon size={13} />
        Viewer counts, bids and chat are delivered over a single Socket.IO connection with exponential-backoff
        reconnection.
      </p>
    </div>
  );
}
