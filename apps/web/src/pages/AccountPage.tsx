/**
 * Account dashboard — blueprint §8.2 `/account` and §5.2 Profile & Account.
 * 30-day earnings chart, live performance, wallet snapshot, upcoming streams.
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
import {
  BellIcon,
  ChartIcon,
  CheckIcon,
  GavelIcon,
  SettingsIcon,
  StoreIcon,
  TrendIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/icons';
import { useEarnings, useNotifications, useOrders, useStreams, useWallet } from '@/lib/hooks';
import { formatMoney, formatViewers, pct } from '@/lib/format';
import { statusTone, orderStatusLabel } from '@/lib/labels';
import { useSession } from '@/store/session';
import { MONETIZATION } from '@moneymart/tokens';

export default function AccountPage() {
  const user = useSession((state) => state.user);
  const profile = useSession((state) => state.profile);
  const earnings = useEarnings();
  const wallet = useWallet();
  const orders = useOrders();
  const streams = useStreams();
  const notifications = useNotifications();

  const series = earnings.data?.series ?? [];
  const maxValue = Math.max(1, ...series.map((point) => point.value));
  const scheduled = (streams.data?.items ?? []).filter((stream) => stream.status === 'scheduled');
  const buying = orders.data?.buying ?? [];
  const selling = orders.data?.selling ?? [];
  const unread = notifications.data?.unread ?? 0;

  return (
    <Section>
      <PageHeader
        eyebrow="Account"
        title={user ? `Welcome back, ${user.displayName.split(' ')[0]}` : 'Your MoneyMart account'}
        subtitle="Your dashboard brings earnings, orders, wallet and upcoming streams together."
        action={
          <div className="flex flex-wrap gap-2">
            {user?.isPro ? <Pill tone="gold">MoneyMart Pro</Pill> : null}
            {profile?.isVerified ? <VerifiedBadge /> : null}
            <Link to="/studio">
              <Button size="sm" variant="gold" icon={<StoreIcon size={14} />}>
                Open Studio
              </Button>
            </Link>
          </div>
        }
      />

      {/* Profile strip */}
      <Card className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={profile?.displayName ?? 'Guest'} src={profile?.avatarUrl} size={58} isVerified={profile?.isVerified} />
            <div>
              <p className="text-[16px] font-semibold text-white">{profile?.displayName ?? 'Sign in to continue'}</p>
              <p className="data text-[12.5px] text-white/45">@{profile?.handle ?? 'guest'}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Pill tone="neutral">{user?.role ?? 'buyer'}</Pill>
                <Pill tone="neutral">KYC level {user?.kycLevel ?? 0}</Pill>
                <Pill tone={user?.verificationStatus === 'verified' ? 'green' : 'neutral'}>
                  {user?.verificationStatus ?? 'unverified'}
                </Pill>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/account/wallet">
              <Button variant="navy" icon={<WalletIcon size={15} />}>
                Wallet
              </Button>
            </Link>
            <Link to="/account/orders">
              <Button variant="navy" icon={<TruckIcon size={15} />}>
                Orders {buying.length ? `(${buying.length})` : ''}
              </Button>
            </Link>
            <Link to="/account/settings">
              <Button variant="navy" icon={<SettingsIcon size={15} />}>
                Settings
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Key metrics */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="30-day GMV"
          value={formatMoney(earnings.data?.gmv ?? 0, wallet.data?.currency as 'USD' ?? 'USD', { compact: true })}
          hint={`${earnings.data?.itemsSold ?? 0} items sold`}
          tone="gold"
          icon={<ChartIcon size={15} />}
        />
        <StatBlock
          label="Creator earnings"
          value={formatMoney(earnings.data?.creatorShare ?? 0, 'USD', { compact: true })}
          hint={`${pct(MONETIZATION.creatorShare)} of live GMV`}
          tone="green"
          icon={<TrendIcon size={15} />}
        />
        <StatBlock
          label="Available balance"
          value={formatMoney(wallet.data?.available ?? 0, wallet.data?.currency as 'USD' ?? 'USD', { compact: true })}
          hint={`${formatMoney(wallet.data?.pending ?? 0, 'USD', { compact: true })} pending`}
          icon={<WalletIcon size={15} />}
        />
        <StatBlock
          label="Unread alerts"
          value={unread}
          hint="Outbid, order and stream notifications"
          icon={<BellIcon size={15} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* Earnings chart */}
        <Card className="p-5">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <h3 className="text-[16px] text-white">30-day earnings</h3>
              <p className="mt-1 text-[12.5px] text-white/50">
                Average sale {formatMoney(earnings.data?.avgSalePrice ?? 0, 'USD')} · {earnings.data?.newFollowers ?? 0} new followers
              </p>
            </div>
            <Pill tone="green">
              <TrendIcon size={11} /> live
            </Pill>
          </div>

          {earnings.isLoading ? (
            <Skeleton className="h-[180px] w-full" />
          ) : (
            <div className="flex h-[180px] items-end gap-[3px]">
              {series.map((point) => (
                <div key={point.label} className="group relative flex-1">
                  <div
                    className="w-full rounded-t-[3px] transition-all duration-300 group-hover:brightness-125"
                    style={{
                      height: `${Math.max(3, (point.value / maxValue) * 168)}px`,
                      background: 'linear-gradient(180deg, #F5A623 0%, #D98A0F 100%)',
                    }}
                  />
                  <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-[6px] px-2 py-1 text-[10.5px] group-hover:block" style={{ background: 'rgba(7,15,24,0.95)', color: '#fff' }}>
                    {point.label}: {formatMoney(point.value, 'USD')}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4" style={{ borderColor: 'var(--mm-divider)' }}>
            <MiniStat label="Gross GMV" value={formatMoney(earnings.data?.gmv ?? 0, 'USD', { compact: true })} />
            <MiniStat label="Platform fee" value={formatMoney(earnings.data?.platformFee ?? 0, 'USD', { compact: true })} />
            <MiniStat label="Items sold" value={String(earnings.data?.itemsSold ?? 0)} />
          </div>
        </Card>

        {/* Orders snapshot */}
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-white">Recent orders</h3>
              <Link to="/account/orders" className="text-[12.5px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
                All orders →
              </Link>
            </div>
            {buying.length === 0 && selling.length === 0 ? (
              <EmptyState title="No orders yet" body="Win a lot or make a sale and it will appear here." icon={<TruckIcon size={20} />} />
            ) : (
              <ul className="space-y-2.5">
                {[...buying, ...selling].slice(0, 4).map((order) => (
                  <li key={order.id} className="flex items-center gap-3 rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <img
                      src={order.auction?.item.images[0]}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-[9px] object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-[12.5px] font-medium text-white/90">
                        {order.auction?.title ?? order.id}
                      </span>
                      <span className="data block text-[11.5px] text-white/45">
                        {formatMoney(order.totalAmount, order.currency)}
                      </span>
                    </span>
                    <Pill tone={statusTone(order.orderStatus)}>{orderStatusLabel(order.orderStatus)}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-white">Upcoming streams</h3>
              <Link to="/studio" className="text-[12.5px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
                Schedule →
              </Link>
            </div>
            {scheduled.length ? (
              <ul className="space-y-2.5">
                {scheduled.slice(0, 3).map((stream) => (
                  <li key={stream.id} className="rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <p className="clamp-1 text-[12.5px] font-medium text-white/90">{stream.title}</p>
                    <p className="mt-1 text-[11.5px] text-white/45">
                      {new Date(stream.scheduledStartTime).toLocaleString()} · {stream.queuedCount} lots queued
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-white/50">
                No streams scheduled. Creators who stream weekly see roughly 3× the GMV of occasional sellers.
              </p>
            )}
          </Card>
        </div>
      </div>

      {/* Performance tips */}
      <div className="mt-8">
        <SectionHeader eyebrow="Grow faster" title="Performance tips" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Tip
            icon={<GavelIcon size={17} />}
            title="Stream at a fixed time"
            body="Creators on a fixed weekly slot build a returning audience and win more repeat bidders."
          />
          <Tip
            icon={<UsersIcon size={17} />}
            title="Answer in chat, not DMs"
            body="Public answers lift conversion on the lot you are promoting — everyone sees the assurance."
          />
          <Tip
            icon={<CheckIcon size={17} />}
            title="Get lots MV Verified"
            body="Verified lots command price premiums and display the badge on every listing surface."
          />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link to="/sell">
          <Button variant="gold" size="lg" icon={<GavelIcon size={16} />}>
            Create a listing
          </Button>
        </Link>
        <Link to="/live">
          <Button variant="navy" size="lg" icon={<UsersIcon size={16} />}>
            Join a live room
          </Button>
        </Link>
        <Link to="/admin">
          <Button variant="ghost" size="lg">
            Admin console
          </Button>
        </Link>
      </div>

      <p className="mt-8 text-[11.5px] text-white/35">
        {formatViewers(profile?.followersCount ?? 0)} followers · response time {profile?.responseTimeMinutes ?? 0} min ·
        {' '}{profile?.totalSales ?? 0} lifetime sales
      </p>
    </Section>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="data text-[15px] font-semibold text-white/90">{value}</p>
      <p className="text-[10.5px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}

function Tip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="p-5">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: 'rgba(0,212,161,0.12)', color: 'var(--mm-green)' }}>
        {icon}
      </span>
      <h3 className="text-[14.5px] text-white">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{body}</p>
    </Card>
  );
}
