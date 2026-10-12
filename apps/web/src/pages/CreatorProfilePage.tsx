/**
 * Seller / creator profile — blueprint §8.2 `/seller/[id]`.
 *
 * This is also the renderer for a Studio storefront: the same document a creator
 * designs in the editor is drawn here, public and shareable.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AuctionCard, StreamCard } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Pill,
  SectionHeader,
  Skeleton,
  VerifiedBadge,
} from '@/components/ui';
import {
  ChartIcon,
  CheckIcon,
  GlobeIcon,
  GavelIcon,
  ShareIcon,
  ShieldIcon,
  SparkIcon,
  StoreIcon,
  TrendIcon,
  TruckIcon,
  UsersIcon,
} from '@/components/icons';
import { api, queryKeys } from '@/lib/api';
import {
  DENSITY_SCALE,
  RADIUS_SCALE,
  SURFACE_BG,
  type StoreBlock,
} from '@/lib/storefront';
import { formatMoney, formatViewers } from '@/lib/format';
import { useSession } from '@/store/session';

export default function CreatorProfilePage() {
  const { handle = '' } = useParams<{ handle: string }>();
  const user = useSession((state) => state.user);
  const [followed, setFollowed] = useState(false);
  const [shared, setShared] = useState(false);

  const shop = useQuery({
    queryKey: ['storefront', handle],
    queryFn: () => api.storefront(handle),
    enabled: Boolean(handle),
  });

  const storefront = shop.data?.storefront;
  const profile = shop.data?.profile;
  const lots = shop.data?.lots ?? [];
  const stream = shop.data?.stream ?? null;

  const visibleBlocks = useMemo(
    () => (storefront?.blocks ?? []).filter((block) => block.visible),
    [storefront],
  );

  const theme = storefront?.theme;
  const accent = theme?.accent ?? '#F5A623';
  const radius = RADIUS_SCALE[theme?.radius ?? 'soft'];
  const density = DENSITY_SCALE[theme?.density ?? 'comfortable'];
  const isOwner = user?.id === profile?.id;

  if (shop.isLoading) {
    return (
      <Section>
        <Skeleton className="h-40 w-full" />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[320px]" />
          ))}
        </div>
      </Section>
    );
  }

  if (!profile || !storefront) {
    return (
      <Section>
        <EmptyState
          title="Shop not found"
          body="This creator may have renamed their handle or closed their storefront."
          icon={<StoreIcon size={22} />}
          action={
            <Link to="/creators">
              <Button variant="gold">Browse creators</Button>
            </Link>
          }
        />
      </Section>
    );
  }

  return (
    <div style={{ background: SURFACE_BG[theme?.surface ?? 'navy'] }}>
      <Section>
        {/* Shop header — the storefront identity */}
        <div className="mb-8 flex flex-wrap items-start justify-between gap-5">
          <div className="flex items-center gap-4">
            <span
              className="grid h-16 w-16 place-items-center font-display text-[22px] font-bold"
              style={{
                background: `${accent}22`,
                color: accent,
                border: `2px solid ${accent}`,
                borderRadius: radius.md,
              }}
            >
              {storefront.logoText || 'MM'}
            </span>
            <div>
              <h1 className="text-[clamp(24px,3.4vw,38px)] text-white">{storefront.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {theme?.showTagline ? (
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: accent }}>
                    {storefront.tagline}
                  </span>
                ) : null}
                {profile.isVerified ? <VerifiedBadge /> : null}
                {stream ? <Pill tone="green">Live now</Pill> : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={followed ? 'navy' : 'gold'}
              icon={followed ? <CheckIcon size={15} /> : <SparkIcon size={15} />}
              onClick={() => setFollowed((value) => !value)}
            >
              {followed ? 'Following' : 'Follow shop'}
            </Button>
            <Button
              variant="navy"
              icon={<ShareIcon size={15} />}
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href);
                setShared(true);
                window.setTimeout(() => setShared(false), 2200);
              }}
            >
              {shared ? 'Link copied' : 'Share'}
            </Button>
            {isOwner ? (
              <Link to="/studio">
                <Button variant="outline" icon={<StoreIcon size={15} />}>
                  Edit in Studio
                </Button>
              </Link>
            ) : null}
          </div>
        </div>

        {/* Creator meta strip */}
        <Card className="mb-8 p-5">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <Avatar
                name={profile.displayName}
                src={profile.avatarUrl}
                size={46}
                isLive={Boolean(stream)}
                isVerified={profile.isVerified}
              />
              <div>
                <p className="text-[14px] font-semibold text-white">{profile.displayName}</p>
                <p className="data text-[12px] text-white/45">@{profile.handle}</p>
              </div>
            </div>
            <Divider />
            <Stat icon={<TrendIcon size={14} />} label="Sales" value={profile.totalSales.toLocaleString()} />
            <Stat icon={<UsersIcon size={13} />} label="Followers" value={formatViewers(profile.followersCount)} />
            <Stat icon={<GavelIcon size={13} />} label="Rating" value={`${profile.rating.toFixed(1)} ★`} />
            <Stat icon={<GlobeIcon size={13} />} label="Ships from" value={profile.countryCode} />
            <Stat icon={<ChartIcon size={13} />} label="Response" value={`${profile.responseTimeMinutes} min`} />
          </div>
          {profile.bio ? <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-white/60">{profile.bio}</p> : null}
        </Card>

        {/* Storefront blocks — rendered exactly as designed in Studio */}
        {visibleBlocks.length === 0 ? (
          <EmptyState
            title="This shop has no published blocks"
            body={isOwner ? 'Open Studio and add your first block to publish your shop.' : 'The creator has not published a layout yet.'}
            icon={<StoreIcon size={22} />}
            action={
              isOwner ? (
                <Link to="/studio">
                  <Button variant="gold">Open Studio</Button>
                </Link>
              ) : null
            }
          />
        ) : (
          visibleBlocks.map((block) => (
            <StoreBlockView
              key={block.id}
              block={block}
              accent={accent}
              radius={radius}
              density={density}
              lots={lots}
              profile={profile}
              stream={stream}
              sold={shop.data?.sold ?? 0}
            />
          ))
        )}

        {/* Always-on listings grid beneath the designed layout */}
        <div className="mt-12">
          <SectionHeader
            eyebrow={`${lots.length} lots`}
            title="All listings"
            subtitle="Every lot this creator currently has on MoneyMart."
          />
          {lots.length ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {lots.map((auction) => (
                <AuctionCard key={auction.id} auction={auction} size="lg" />
              ))}
            </div>
          ) : (
            <EmptyState title="No active listings" body="This creator has nothing on the block right now." />
          )}
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          <TrustCard icon={<ShieldIcon size={17} />} title="Escrow protected" body="Funds release only after you confirm the item arrived as described." />
          <TrustCard icon={<CheckIcon size={17} />} title="MV Verified lots" body="Authenticated items carry provenance and condition reports on the lot page." />
          <TrustCard icon={<TruckIcon size={17} />} title="Insured shipping" body="DHL, FedEx and local couriers with duty calculated at checkout." />
        </div>
      </Section>
    </div>
  );
}

/* ── Storefront block renderer (public view) ───────────────────────────── */

function StoreBlockView({
  block,
  accent,
  radius,
  density,
  lots,
  profile,
  stream,
  sold,
}: {
  block: StoreBlock;
  accent: string;
  radius: { sm: string; md: string; lg: string };
  density: string;
  lots: Parameters<typeof AuctionCard>[0]['auction'][];
  profile: { displayName: string; avatarUrl?: string; isVerified: boolean; rating: number; totalSales: number; followersCount: number };
  stream: Parameters<typeof StreamCard>[0]['stream'] | null;
  sold: number;
}) {
  const { copy, kind } = block;

  switch (kind) {
    case 'hero':
      return (
        <div className={`${density}`}>
          <h2 className="text-[clamp(22px,3.4vw,38px)] text-white">{copy.title}</h2>
          {copy.subtitle ? <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-white/65">{copy.subtitle}</p> : null}
          {copy.body ? <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-white/55">{copy.body}</p> : null}
          {copy.ctaLabel ? (
            <Link to={copy.ctaHref ?? '/live'}>
              <span
                className="mt-5 inline-block px-6 py-3 text-[13.5px] font-semibold text-[#0D1B2A]"
                style={{ background: accent, borderRadius: radius.md, boxShadow: `0 10px 34px ${accent}44` }}
              >
                {copy.ctaLabel}
              </span>
            </Link>
          ) : null}
        </div>
      );

    case 'liveNow':
      return (
        <div className={density}>
          <div
            className="flex flex-wrap items-center justify-between gap-4 p-4"
            style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.md }}
          >
            <div className="flex items-center gap-3">
              {stream ? (
                <span className="relative inline-flex h-3 w-3">
                  <span className="absolute inset-0 rounded-full" style={{ background: 'var(--mm-green)' }} />
                  <span className="pulse-ring" />
                </span>
              ) : null}
              <span>
                <span className="block text-[14.5px] font-semibold text-white">
                  {copy.title} — {stream?.title ?? 'No stream scheduled'}
                </span>
                <span className="data block text-[12px] text-white/50">
                  {stream ? `${formatViewers(stream.viewerCount)} watching` : 'Follow to be notified when the next drop starts'}
                </span>
              </span>
            </div>
            {copy.ctaLabel ? (
              <Link to={stream ? `/stream/${stream.id}` : '/'}>
                <Button variant="green" size="sm">
                  {copy.ctaLabel}
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      );

    case 'featuredLots': {
      const columns = block.options?.columns ?? 4;
      const shown = lots.slice(0, block.options?.limit ?? 8);
      return (
        <div className={`mt-6 ${density}`}>
          <h3 className="text-[20px] text-white">{copy.title}</h3>
          {copy.subtitle ? <p className="mt-1.5 text-[13px] text-white/55">{copy.subtitle}</p> : null}
          <div
            className="mt-5 grid gap-4"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {shown.map((auction) => (
              <AuctionCard key={auction.id} auction={auction} size="lg" />
            ))}
          </div>
        </div>
      );
    }

    case 'categoryGrid':
      return (
        <div className={`mt-6 ${density}`}>
          <h3 className="text-[20px] text-white">{copy.title}</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {(copy.items ?? []).map((item) => (
              <Link key={item} to={`/auctions?category=${item}`}>
                <span
                  className="inline-block px-4 py-2.5 text-[13px] capitalize text-white/80 transition-colors hover:text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', borderRadius: radius.sm }}
                >
                  {item}
                </span>
              </Link>
            ))}
          </div>
        </div>
      );

    case 'about':
      return (
        <div className={`mt-6 ${density}`}>
          <h3 className="text-[20px] text-white">{copy.title}</h3>
          <div className="mt-4 flex items-center gap-3">
            <Avatar name={profile.displayName} src={profile.avatarUrl} size={42} isVerified={profile.isVerified} />
            <span>
              <span className="block text-[14px] font-semibold text-white/90">{profile.displayName}</span>
              <span className="block text-[12px] text-white/50">
                {profile.rating.toFixed(1)} ★ · {profile.totalSales} lifetime sales
              </span>
            </span>
          </div>
          {copy.body ? <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-white/65">{copy.body}</p> : null}
        </div>
      );

    case 'stats':
      return (
        <div className={`mt-6 ${density}`}>
          <h3 className="text-[20px] text-white">{copy.title}</h3>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ['Lifetime sales', profile.totalSales.toLocaleString()],
              ['Followers', formatViewers(profile.followersCount)],
              ['Rating', `${profile.rating.toFixed(1)} ★`],
              ['Lots sold here', String(sold)],
            ].map(([label, value]) => (
              <div key={label} className="p-4" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.sm }}>
                <p className="data text-[22px] font-bold" style={{ color: accent }}>
                  {value}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-white/45">{label}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'testimonials':
      return (
        <div className={`mt-6 ${density}`}>
          <h3 className="text-[20px] text-white">{copy.title}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(copy.items ?? []).map((quote) => (
              <p
                key={quote}
                className="p-4 text-[13px] italic leading-relaxed text-white/70"
                style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.sm }}
              >
                “{quote}”
              </p>
            ))}
          </div>
        </div>
      );

    case 'newsletter':
      return (
        <div className={`mt-6 ${density}`}>
          <div className="p-5" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: radius.md }}>
            <h3 className="text-[18px] text-white">{copy.title}</h3>
            {copy.subtitle ? <p className="mt-1.5 text-[13px] text-white/55">{copy.subtitle}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                placeholder="your@email.com"
                className="min-w-[220px] flex-1 px-4 py-3 text-[13px] outline-none"
                style={{ background: 'rgba(0,0,0,0.3)', borderRadius: radius.sm, border: '1px solid rgba(255,255,255,0.1)' }}
              />
              <Button variant="gold">Notify me</Button>
            </div>
          </div>
        </div>
      );

    case 'recentSales':
      return (
        <div className={`mt-6 ${density}`}>
          <h3 className="text-[20px] text-white">{copy.title}</h3>
          <p className="mt-3 text-[13px] text-white/55">
            {sold > 0
              ? `${sold} lots sold on MoneyMart. Completed results feed the category price history charts.`
              : 'Completed sales will be listed here as they settle.'}
          </p>
        </div>
      );

    case 'cta':
      return (
        <div className={`mt-6 ${density}`}>
          <div
            className="flex flex-wrap items-center justify-between gap-4 p-6"
            style={{ background: `${accent}18`, borderRadius: radius.md, border: `1px solid ${accent}44` }}
          >
            <p className="text-[clamp(17px,2vw,24px)] font-semibold text-white">{copy.title}</p>
            {copy.ctaLabel ? (
              <Link to={copy.ctaHref ?? '/creators'}>
                <span
                  className="inline-block px-5 py-2.5 text-[13px] font-semibold text-[#0D1B2A]"
                  style={{ background: accent, borderRadius: radius.sm }}
                >
                  {copy.ctaLabel}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      );

    default:
      return null;
  }
}

function Divider() {
  return <span className="hidden h-8 w-px sm:block" style={{ background: 'var(--mm-divider)' }} />;
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span style={{ color: 'var(--mm-gold)' }}>{icon}</span>
      <span>
        <span className="block text-[10.5px] uppercase tracking-wider text-white/40">{label}</span>
        <span className="data block text-[13.5px] font-semibold text-white/90">{value}</span>
      </span>
    </span>
  );
}

function TrustCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="p-5">
      <span
        className="mb-3 grid h-10 w-10 place-items-center rounded-[12px]"
        style={{ background: 'rgba(0,212,161,0.12)', color: 'var(--mm-green)' }}
      >
        {icon}
      </span>
      <h3 className="text-[15px] text-white">{title}</h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{body}</p>
    </Card>
  );
}
