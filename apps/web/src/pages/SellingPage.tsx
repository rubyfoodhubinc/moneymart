/**
 * Selling dashboard — blueprint §5.2 Private Dashboard and §8.2 `/account`.
 * Upcoming stream calendar, listing performance, moderation queue state and payouts.
 */

import { Link } from 'react-router-dom';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Pill,
  SectionHeader,
  Skeleton,
  StatBlock,
  VerifiedBadge,
} from '@/components/ui';
import { ChartIcon, CheckIcon, GavelIcon, SparkIcon, StoreIcon, TrendIcon, UsersIcon, WalletIcon } from '@/components/icons';
import { useAuctions, useEarnings, useOrders, useStreams, useWallet } from '@/lib/hooks';
import { formatAge, formatMoney, formatViewers, pct } from '@/lib/format';
import { statusTone, orderStatusLabel, auctionTypeLabel } from '@/lib/labels';
import { useSession } from '@/store/session';
import { MONETIZATION } from '@moneymart/tokens';

export default function SellingPage() {
  const user = useSession((state) => state.user);
  const profile = useSession((state) => state.profile);
  const earnings = useEarnings();
  const wallet = useWallet();
  const orders = useOrders();
  const streams = useStreams();
  const listings = useAuctions({ sort: 'ending' });

  const mine = (listings.data?.items ?? []).filter((auction) => auction.sellerId === user?.id);
  const live = mine.filter((auction) => auction.isLive);
  const scheduled = mine.filter((auction) => auction.status === 'scheduled');
  const sold = mine.filter((auction) => auction.status === 'sold');
  const myStreams = (streams.data?.items ?? []).filter((stream) => stream.creatorId === user?.id);
  const selling = orders.data?.selling ?? [];

  const gmv = mine.reduce((sum, auction) => sum + (auction.currentBid || auction.startingPrice), 0);
  const fees = mine.reduce((sum, auction) => sum + auction.currentBid * auction.buyersPremiumRate, 0);

  return (
    <Section>
      <PageHeader
        eyebrow="Selling dashboard"
        title="Your shop performance"
        subtitle="Everything you have on the block, what is scheduled, what sold, and what you are owed."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/sell">
              <Button variant="gold" icon={<GavelIcon size={15} />}>
                New listing
              </Button>
            </Link>
            <Link to="/studio">
              <Button variant="navy" icon={<StoreIcon size={15} />}>
                Studio
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="On the block" value={mine.length} tone="gold" icon={<GavelIcon size={15} />} />
        <StatBlock label="Live now" value={live.length} tone="green" icon={<SparkIcon size={15} />} />
        <StatBlock label="Open exposure" value={formatMoney(gmv, 'USD', { compact: true })} icon={<TrendIcon size={15} />} />
        <StatBlock
          label="Pending payouts"
          value={formatMoney(wallet.data?.pending ?? 0, 'USD', { compact: true })}
          hint="Escrow releases post-confirmation"
          icon={<WalletIcon size={15} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-white">Your listings</h3>
              <span className="text-[11.5px] text-white/40">Moderation queue for traditional consignments</span>
            </div>
            {listings.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : !mine.length ? (
              <EmptyState
                title="You have no active listings"
                body="Creators who keep at least five lots live at all times convert the most repeat bidders."
                icon={<GavelIcon size={20} />}
                action={
                  <Link to="/sell">
                    <Button variant="gold">Create your first listing</Button>
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-2.5">
                {mine.map((auction) => (
                  <li
                    key={auction.id}
                    className="flex items-center gap-3 rounded-[11px] border border-white/8 p-3"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    <img src={auction.item.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-[9px] object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-[13px] font-medium text-white/90">{auction.item.title}</span>
                      <span className="data block text-[11.5px] text-white/45">
                        {auction.bidCount} bids · {formatMoney(auction.currentBid || auction.startingPrice, auction.currency as 'USD')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1.5">
                      <Pill tone={auction.isLive ? 'green' : auction.status === 'sold' ? 'gold' : 'neutral'}>
                        {auction.isLive ? 'Live' : auction.status}
                      </Pill>
                      <span className="text-[10.5px] text-white/40">{auctionTypeLabel(auction.auctionType)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-white">Sales & payouts</h3>
              <Link to="/account/wallet" className="text-[12.5px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
                Wallet →
              </Link>
            </div>
            {selling.length ? (
              <ul className="space-y-2.5">
                {selling.map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-3 rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <span className="min-w-0">
                      <span className="clamp-1 block text-[12.5px] font-medium text-white/90">
                        {order.auction?.title ?? order.id}
                      </span>
                      <span className="block text-[11.5px] text-white/45">
                        {order.counterparty?.displayName} · {formatAge(order.createdAt)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="data block text-[14px] font-semibold" style={{ color: 'var(--mm-green)' }}>
                        {formatMoney(order.hammerPrice * 0.9, order.currency as 'USD')}
                      </span>
                      <Pill tone={statusTone(order.orderStatus)}>{orderStatusLabel(order.orderStatus)}</Pill>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-white/50">
                No sales yet. Payouts are released {MONETIZATION.creatorShare * 100}% to you after buyer confirmation.
              </p>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h3 className="mb-4 text-[16px] text-white">Creator snapshot</h3>
            <div className="flex items-center gap-3">
              <Avatar name={profile?.displayName ?? 'You'} src={profile?.avatarUrl} size={46} isVerified={profile?.isVerified} />
              <div>
                <p className="text-[14px] font-semibold text-white">{profile?.displayName}</p>
                <p className="text-[12px] text-white/50">
                  {profile?.rating.toFixed(1)} ★ · {profile?.totalSales} lifetime sales
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Followers" value={formatViewers(profile?.followersCount ?? 0)} />
              <Metric label="Response" value={`${profile?.responseTimeMinutes ?? 0} min`} />
              <Metric label="Revenue share" value={pct(MONETIZATION.creatorShare)} />
              <Metric label="Items sold" value={String(earnings.data?.itemsSold ?? sold.length)} />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 text-[16px] text-white">Stream calendar</h3>
            {myStreams.length ? (
              <ul className="space-y-2.5">
                {myStreams.map((stream) => (
                  <li key={stream.id} className="rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="clamp-1 text-[12.5px] font-medium text-white/90">{stream.title}</span>
                      <Pill tone={stream.status === 'live' ? 'green' : 'neutral'}>{stream.status}</Pill>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-white/45">
                      {stream.status === 'live'
                        ? `${formatViewers(stream.viewerCount)} watching now`
                        : new Date(stream.scheduledStartTime).toLocaleString()}{' '}
                      · {stream.queuedCount} lots queued
                    </p>
                    {stream.status === 'live' ? (
                      <Link to={`/stream/${stream.id}`} className="mt-2 inline-block text-[12px] font-semibold" style={{ color: 'var(--mm-green)' }}>
                        Open the room →
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div>
                <p className="text-[12.5px] leading-relaxed text-white/55">
                  No streams scheduled for this identity. Switch to a creator account (AdaLuxe, Bell Vault, Haute
                  Hour, Maison Jules) from the account menu to run a live room.
                </p>
                <Link to="/creators">
                  <Button size="sm" variant="navy" className="mt-3" icon={<UsersIcon size={13} />}>
                    See how creators stream
                  </Button>
                </Link>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-[16px] text-white">
              <ChartIcon size={15} /> Fee summary
            </h3>
            <dl className="space-y-2 text-[12.5px]">
              <Row label="Open exposure" value={formatMoney(gmv, 'USD')} />
              <Row label="Buyer's premium accrued" value={formatMoney(fees, 'USD')} />
              <Row label="Platform share (live)" value={pct(MONETIZATION.creatorPlatformShare)} />
              <Row label="Your share (live)" value={pct(MONETIZATION.creatorShare)} strong />
            </dl>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader eyebrow={`${scheduled.length} awaiting`} title="Scheduled to go live" />
        {scheduled.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scheduled.map((auction) => (
              <Card key={auction.id} className="p-4">
                <div className="flex items-center gap-3">
                  <img src={auction.item.images[0]} alt="" className="h-14 w-14 rounded-[10px] object-cover" />
                  <div className="min-w-0">
                    <p className="clamp-2 text-[13px] font-medium text-white/90">{auction.item.title}</p>
                    <p className="text-[11.5px] text-white/45">
                      {auction.auctionType === 'traditional' ? 'Expert review complete' : 'Scheduled'}
                    </p>
                  </div>
                </div>
                {auction.item.isVerified ? (
                  <div className="mt-3">
                    <VerifiedBadge />
                  </div>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-white/45">
                    <CheckIcon size={12} /> Awaiting authentication review
                  </p>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-white/45">Nothing scheduled from this identity right now.</p>
        )}
      </div>
    </Section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/8 p-2.5" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <p className="data text-[14px] font-semibold text-white/90">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? 'text-white' : 'text-white/55'}>{label}</dt>
      <dd className="data font-semibold" style={{ color: strong ? 'var(--mm-green)' : 'rgba(255,255,255,0.88)' }}>
        {value}
      </dd>
    </div>
  );
}
