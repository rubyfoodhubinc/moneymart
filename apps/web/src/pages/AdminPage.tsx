/**
 * Admin CMS — blueprint §8.2 `/admin`.
 * Internal-only console: listing approval queue, stream management with a kill
 * switch, user management, financial reporting, moderation queue and feature flags.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  Toast,
  ToastStack,
} from '@/components/ui';
import {
  BellIcon,
  ChartIcon,
  CheckIcon,
  GavelIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
  StoreIcon,
  TrendIcon,
  UsersIcon,
} from '@/components/icons';
import { api } from '@/lib/api';
import { useAuctions, useStreams } from '@/lib/hooks';
import { formatMoney, formatViewers, pct } from '@/lib/format';
import { MONETIZATION } from '@moneymart/tokens';
import { useSession } from '@/store/session';

const FLAGS = [
  { key: 'live_streams', label: 'Live stream auctions', on: true, hint: 'Core creator flow' },
  { key: 'traditional', label: 'Traditional auction house', on: true, hint: 'Consignment + catalogue' },
  { key: 'marketplace', label: 'Secondary marketplace', on: true, hint: 'Buy Now / Make Offer' },
  { key: 'auto_bid', label: 'Auto-bid proxy', on: true, hint: 'Second-price settlement' },
  { key: 'cross_border', label: 'Cross-border fees', on: true, hint: '1.5% buyer-side' },
  { key: 'tv_apps', label: 'TV & IPTV apps', on: false, hint: 'Phase 3 — Q3 2027' },
];

export default function AdminPage() {
  const user = useSession((state) => state.user);
  const users = useSession((state) => state.users);
  const auctions = useAuctions({ sort: 'ending' });
  const streams = useStreams();
  const queryClient = useQueryClient();
  const [flags, setFlags] = useState<Record<string, boolean>>(
    Object.fromEntries(FLAGS.map((flag) => [flag.key, flag.on])),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState<string | null>(null);

  const endStream = useMutation({
    mutationFn: (streamId: string) => api.endStream(streamId),
    onSuccess: () => {
      setMessage('Stream terminated. Viewers were moved to the post-stream summary.');
      void queryClient.invalidateQueries({ queryKey: ['streams'] });
    },
  });

  const lots = auctions.data?.items ?? [];
  const queue = lots.filter((lot) => lot.status === 'scheduled');
  const liveStreams = (streams.data?.items ?? []).filter((stream) => stream.status === 'live');
  const gmv = lots.reduce((sum, lot) => sum + (lot.currentBid || lot.startingPrice), 0);
  const platformRevenue = gmv * MONETIZATION.creatorPlatformShare;

  if (user?.role !== 'admin' && user?.id !== 'usr_house') {
    return (
      <Section>
        <EmptyState
          title="Admin access required"
          body="This console is restricted to MoneyMart staff. Switch to the MoneyMart House identity to explore it in this demo."
          icon={<ShieldIcon size={22} />}
          action={
            <Link to="/account/settings">
              <Button variant="gold">Switch identity in settings</Button>
            </Link>
          }
        />
      </Section>
    );
  }

  return (
    <Section>
      <PageHeader
        eyebrow="Internal console"
        title="Admin CMS"
        subtitle="Listing approval, stream control, user management, financial reporting and feature flags."
        action={
          <div className="flex flex-wrap gap-2">
            <Pill tone="green">
              <ShieldIcon size={11} /> {liveStreams.length} live rooms
            </Pill>
            <Pill tone="gold">{queue.length} awaiting approval</Pill>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Platform GMV (open)" value={formatMoney(gmv, 'USD', { compact: true })} tone="gold" icon={<ChartIcon size={15} />} />
        <StatBlock
          label="Projected platform revenue"
          value={formatMoney(platformRevenue, 'USD', { compact: true })}
          hint={`${pct(MONETIZATION.creatorPlatformShare)} of live GMV`}
          tone="green"
          icon={<TrendIcon size={15} />}
        />
        <StatBlock label="Registered users" value={users.length} hint="Demo dataset" icon={<UsersIcon size={15} />} />
        <StatBlock label="Lots listed" value={lots.length} icon={<GavelIcon size={15} />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-5">
          {/* Moderation queue */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-white">Listing approval queue</h3>
              <span className="text-[11.5px] text-white/40">Traditional consignments + flagged items</span>
            </div>
            {auctions.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : queue.length ? (
              <ul className="space-y-2.5">
                {queue.map((lot) => (
                  <li key={lot.id} className="flex items-center gap-3 rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <img src={lot.item.images[0]} alt="" className="h-12 w-12 shrink-0 rounded-[9px] object-cover" />
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-[13px] font-medium text-white/90">{lot.item.title}</span>
                      <span className="data block text-[11.5px] text-white/45">
                        {lot.seller.displayName} · {formatMoney(lot.startingPrice, lot.currency as 'USD')} start
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="green"
                        onClick={() => setMessage(`Approved: ${lot.item.title} published to the catalogue.`)}
                        icon={<CheckIcon size={13} />}
                      >
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setMessage(`Rejected with a moderation note: ${lot.item.title}`)}>
                        Reject
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-white/50">Queue is clear — no lots awaiting review.</p>
            )}
          </Card>

          {/* Stream control */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] text-white">Stream management</h3>
              <span className="text-[11.5px] text-white/40">Kill switch, viewer counts, stream health</span>
            </div>
            {liveStreams.length ? (
              <ul className="space-y-2.5">
                {liveStreams.map((stream) => (
                  <li key={stream.id} className="flex flex-wrap items-center gap-3 rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <Avatar name={stream.creator.displayName} src={stream.creator.avatarUrl} size={34} isLive />
                    <span className="min-w-0 flex-1">
                      <span className="clamp-1 block text-[13px] font-medium text-white/90">{stream.title}</span>
                      <span className="data block text-[11.5px]" style={{ color: 'var(--mm-green)' }}>
                        {formatViewers(stream.viewerCount)} viewers · peak {formatViewers(stream.peakViewerCount)} ·{' '}
                        {formatMoney(stream.totalGMV, 'USD', { compact: true })} GMV
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-2">
                      <Link to={`/stream/${stream.id}`}>
                        <Button size="sm" variant="navy">
                          Watch
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={endStream.isPending && killTarget === stream.id}
                        onClick={() => {
                          setKillTarget(stream.id);
                          endStream.mutate(stream.id);
                        }}
                      >
                        End stream
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-white/50">No live streams right now.</p>
            )}
          </Card>

          {/* Financial reporting */}
          <Card className="p-5">
            <h3 className="mb-4 text-[16px] text-white">Financial reporting</h3>
            <div className="overflow-hidden rounded-[12px] border border-white/8">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <th className="px-3 py-2.5 text-left font-semibold text-white/60">Revenue stream</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-white/60">Rate</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-white/60">Modelled Y1</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Creator revenue share', `${pct(MONETIZATION.creatorPlatformShare)} of live GMV`, '$3.75M'],
                    ["Buyer's premium (traditional)", '15% / 20% luxury', '$1.10M'],
                    ['Subscriptions (Pro + creator)', '$4.99–$19.99 / mo', '$2.40M'],
                    ['Featured listing boosts', '$5–$50 per slot', '$0.35M'],
                    ['Cross-border transaction fee', pct(MONETIZATION.crossBorderFee), '$0.28M'],
                    ['Brand partnerships', 'Custom · min $5,000', '$0.60M'],
                  ].map(([label, rate, value]) => (
                    <tr key={label} className="border-t" style={{ borderColor: 'var(--mm-divider)' }}>
                      <td className="px-3 py-2.5 text-white/85">{label}</td>
                      <td className="data px-3 py-2.5 text-right text-white/60">{rate}</td>
                      <td className="data px-3 py-2.5 text-right font-semibold" style={{ color: 'var(--mm-green)' }}>
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-white/45">
              Combined projected Year-1 revenue of $7–9M at the $25M GMV target across Nigeria and the USA. Figures
              mirror the master blueprint’s monetisation model.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {/* User management */}
          <Card className="p-5">
            <h3 className="mb-4 text-[16px] text-white">User management</h3>
            <ul className="space-y-2.5">
              {users.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <Avatar name={entry.displayName} src={entry.avatarUrl} size={34} isVerified={entry.isVerified} />
                  <span className="min-w-0 flex-1">
                    <span className="clamp-1 block text-[12.5px] font-medium text-white/90">{entry.displayName}</span>
                    <span className="data block text-[11px] text-white/45">
                      @{entry.handle} · {entry.countryCode} · {entry.totalSales} sales
                    </span>
                  </span>
                  <Pill tone={entry.isVerified ? 'green' : 'neutral'}>{entry.isVerified ? 'verified' : 'basic'}</Pill>
                </li>
              ))}
            </ul>
          </Card>

          {/* Feature flags */}
          <Card className="p-5">
            <h3 className="mb-1.5 flex items-center gap-2 text-[16px] text-white">
              <SettingsIcon size={15} /> Feature flags
            </h3>
            <p className="mb-4 text-[12px] text-white/50">
              Roll out capabilities by market and phase without a deploy.
            </p>
            <ul className="space-y-2">
              {FLAGS.map((flag) => (
                <li key={flag.key}>
                  <button
                    type="button"
                    onClick={() => setFlags((current) => ({ ...current, [flag.key]: !current[flag.key] }))}
                    className="flex w-full items-center justify-between gap-4 rounded-[11px] border border-white/8 px-3.5 py-2.5 text-left"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-white/90">{flag.label}</span>
                      <span className="block text-[11px] text-white/45">{flag.hint}</span>
                    </span>
                    <span
                      className="relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors"
                      style={{ background: flags[flag.key] ? 'var(--mm-green)' : 'rgba(255,255,255,0.14)' }}
                    >
                      <span
                        className="absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all"
                        style={{ left: flags[flag.key] ? 19 : 3 }}
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {/* Moderation */}
          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-[16px] text-white">
              <ShieldIcon size={15} /> Moderation
            </h3>
            <ul className="space-y-3 text-[12.5px] text-white/65">
              <li className="flex items-start gap-2">
                <CheckIcon size={13} />
                AWS Rekognition screens listing imagery for prohibited content before publication.
              </li>
              <li className="flex items-start gap-2">
                <BellIcon size={13} />
                Live chat keyword filtering escalates to a human moderator queue automatically.
              </li>
              <li className="flex items-start gap-2">
                <SparkIcon size={13} />
                Counterfeit signals (brand + price outliers) flag lots for physical inspection.
              </li>
              <li className="flex items-start gap-2">
                <StoreIcon size={13} />
                Stream kill switch drops viewers to a summary page and preserves the VOD.
              </li>
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader eyebrow="Roadmap" title="Phase gates" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Phase 1 — MVP', 'Q1 2027', 'Mobile apps, live stream auctions, Stripe + Paystack, FCM alerts, admin CMS', true],
            ['Phase 2 — Expansion', 'Q2 2027', 'UK + Canada, web platform, traditional flow, subscriptions, MV Verified', false],
            ['Phase 3 — Scale', 'Q3 2027', 'TV + IPTV apps, Africa expansion, multi-language, duty/VAT, Pro tier', false],
            ['Phase 4 — Platform', 'Q4 2027', 'Browser extension, public API, 2-up watch mode, Tizen/webOS, HbbTV', false],
          ].map(([phase, when, detail, current]) => (
            <Card key={phase as string} className="p-5" glow={Boolean(current)}>
              <Pill tone={current ? 'green' : 'neutral'}>{when as string}</Pill>
              <h3 className="mt-3 text-[15px] text-white">{phase as string}</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">{detail as string}</p>
            </Card>
          ))}
        </div>
      </div>

      <ToastStack>
        {message ? <Toast tone="green" title="Admin action" body={message} onDismiss={() => setMessage(null)} /> : null}
      </ToastStack>
    </Section>
  );
}
