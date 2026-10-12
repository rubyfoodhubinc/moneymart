/**
 * MoneyMart landing page — blueprint §8.2 `/`.
 * Hero with a live stream embed preview + CTA, featured auctions row,
 * "how it works" explainer, testimonials, country selector, app CTA.
 */

import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { categories, currency as currencyMeta, type CurrencyCode } from '@moneymart/tokens';
import { AuctionCard, CountdownTimer, StreamCard } from '@/components/auction';
import { Section } from '@/components/site-shell';
import {
  Button,
  Card,
  CategoryChip,
  LiveBadge,
  Pill,
  PriceTag,
  SectionHeader,
  Skeleton,
  StatBlock,
  VerifiedBadge,
} from '@/components/ui';
import {
  GavelIcon,
  GlobeIcon,
  LiveDot,
  MoneyMartMark,
  PlayIcon,
  ShieldIcon,
  SparkIcon,
  TrendIcon,
  TruckIcon,
  UsersIcon,
} from '@/components/icons';
import { useAuctions, useStreams } from '@/lib/hooks';
import { formatMoney, formatViewers } from '@/lib/format';

const STEPS = [
  {
    title: 'Join the stream',
    body: 'Creators go live on a schedule. Walk into the room, watch the item drop, and see the price move in real time.',
    icon: <PlayIcon size={18} />,
  },
  {
    title: 'Bid in sub-second time',
    body: 'Every bid lands over a WebSocket and settles atomically. Anti-snipe protects the last ten seconds.',
    icon: <GavelIcon size={18} />,
  },
  {
    title: 'Win and pay in escrow',
    body: 'Confetti fires, the invoice generates, and your funds sit in escrow until the item is confirmed.',
    icon: <ShieldIcon size={18} />,
  },
  {
    title: 'Ship anywhere',
    body: 'DHL, FedEx and local couriers across Nigeria, the USA, the UK and Canada — duties calculated at checkout.',
    icon: <TruckIcon size={18} />,
  },
];

const TESTIMONIALS = [
  {
    quote:
      'I have run live drops on three platforms. MoneyMart is the only one where the bid ladder never once desynced on a 5,000-viewer room.',
    name: 'Marcus Bell',
    role: 'Creator · Bell Vault, New York',
  },
  {
    quote:
      'The buyer’s premium is disclosed before I bid and the invoice matches to the penny. That is what an auction house should feel like.',
    name: 'Priya Raman',
    role: 'Collector · London',
  },
  {
    quote:
      'Paystack settles to my Lagos account and the adire cloth I sold on a Thursday stream shipped Friday. No friction.',
    name: 'Ada Okonkwo',
    role: 'Creator · AdaLuxe, Lagos',
  },
];

export default function LandingPage() {
  const streams = useStreams();
  const featured = useAuctions({ sort: 'ending', limit: 8 });
  const endingSoon = useAuctions({ status: 'ending', sort: 'ending', limit: 4 });
  const live = useMemo(() => (streams.data?.items ?? []).filter((stream) => stream.status === 'live'), [streams.data]);
  const [activeStream, setActiveStream] = useState(0);
  const [country, setCountry] = useState<CurrencyCode>('USD');
  const [testimonial, setTestimonial] = useState(0);

  // Hero rotates through live streams every 8 seconds (§7.2 TV hero cadence).
  useEffect(() => {
    if (live.length < 2) return;
    const timer = window.setInterval(() => setActiveStream((value) => (value + 1) % live.length), 8000);
    return () => window.clearInterval(timer);
  }, [live.length]);

  useEffect(() => {
    const timer = window.setInterval(() => setTestimonial((value) => (value + 1) % TESTIMONIALS.length), 7000);
    return () => window.clearInterval(timer);
  }, []);

  const hero = live[activeStream];

  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="mm-container grid items-center gap-12 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          <div className="animate-rise">
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <Pill tone="green">
                <LiveDot size={7} />
                {live.length || 4} streams live now
              </Pill>
              <Pill tone="gold">
                <SparkIcon size={12} />
                Sub-second bidding
              </Pill>
            </div>

            <h1 className="text-[clamp(38px,6vw,74px)] leading-[0.98] text-white">
              Bid.
              <br />
              Stream.
              <br />
              <span className="gold-text">Win.</span>
            </h1>

            <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-white/65">
              MoneyMart fuses the energy of creator-led live shopping with the trust and prestige of a
              traditional auction house. One platform, four pillars: live auctions, creator streams,
              catalogued sales, and a verified secondary marketplace.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/live">
                <Button size="lg" variant="gold" icon={<PlayIcon size={16} />}>
                  Watch live auctions
                </Button>
              </Link>
              <Link to="/sell">
                <Button size="lg" variant="navy" icon={<GavelIcon size={16} />}>
                  Start selling
                </Button>
              </Link>
            </div>

            <div className="mt-9 grid max-w-lg grid-cols-3 gap-5">
              <HeroStat value="$25M+" label="Year-1 GMV target" />
              <HeroStat value="5" label="Launch markets" />
              <HeroStat value="99.95%" label="Uptime SLA" />
            </div>
          </div>

          {/* Live embed preview */}
          <div className="animate-rise" style={{ animationDelay: '0.08s' }}>
            <div className="relative">
              <div
                className="card-surface relative overflow-hidden"
                style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.55)' }}
              >
                {hero ? (
                  <Link to={`/stream/${hero.id}`} className="block">
                    <div className="relative aspect-[16/11]">
                                            <img
                        src={hero.activeAuction?.item.images[0] ?? hero.posterUrl}
                        alt={hero.title}
                        className="h-full w-full object-cover"
                      />
                      <div
                        className="absolute inset-0"
                        style={{ background: 'linear-gradient(180deg, rgba(7,15,24,0.05) 34%, rgba(7,15,24,0.94) 100%)' }}
                      />
                      <div className="absolute left-4 top-4 flex items-center gap-2">
                        <LiveBadge viewers={hero.viewerCount} />
                      </div>
                      <div className="absolute inset-x-4 bottom-4">
                        <div className="flex items-center gap-2.5">
                                                    <img
                            src={hero.creator.avatarUrl}
                            alt={hero.creator.displayName}
                            className="h-9 w-9 rounded-full border-2"
                            style={{ borderColor: 'var(--mm-green)' }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-[13.5px] font-semibold text-white">
                              {hero.creator.displayName}
                              {hero.creator.isVerified ? ' ✓' : ''}
                            </p>
                            <p className="truncate text-[11.5px] text-white/60">{hero.title}</p>
                          </div>
                        </div>
                      </div>
                      <span className="absolute inset-0 grid place-items-center">
                        <span
                          className="grid h-14 w-14 place-items-center rounded-full text-[#0D1B2A] transition-transform duration-300 hover:scale-110"
                          style={{ background: 'var(--mm-gradient-gold)', boxShadow: '0 10px 34px rgba(245,166,35,0.4)' }}
                        >
                          <PlayIcon size={20} />
                        </span>
                      </span>
                    </div>
                  </Link>
                ) : (
                  <div className="skeleton aspect-[16/11] w-full" />
                )}

                {/* Floating live bid panel preview */}
                {hero?.activeAuction ? (
                  <div className="border-t p-4" style={{ borderColor: 'var(--mm-divider)' }}>
                    <div className="flex items-end justify-between gap-3">
                      <PriceTag
                        formatted={formatMoney(
                          hero.activeAuction.currentBid || hero.activeAuction.startingPrice,
                          hero.activeAuction.currency,
                        )}
                        label={`Now bidding · ${hero.activeAuction.bidCount} bids`}
                        size="lg"
                      />
                      <div className="text-right">
                        <CountdownTimer endTime={hero.activeAuction.endTime} size="md" label />
                        <p className="mt-1 text-[11px] text-white/40">Anti-snipe armed</p>
                      </div>
                    </div>
                    <Link to={`/stream/${hero.id}`} className="mt-3 block">
                      <Button variant="green" full size="md" icon={<GavelIcon size={15} />}>
                        Enter the room and bid
                      </Button>
                    </Link>
                  </div>
                ) : null}
              </div>

              {live.length > 1 ? (
                <div className="mt-3 flex items-center justify-center gap-2">
                  {live.map((stream, index) => (
                    <button
                      key={stream.id}
                      type="button"
                      aria-label={`Show ${stream.title}`}
                      onClick={() => setActiveStream(index)}
                      className="h-1.5 rounded-full transition-all duration-300"
                      style={{
                        width: index === activeStream ? 26 : 8,
                        background: index === activeStream ? 'var(--mm-gold)' : 'rgba(255,255,255,0.22)',
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ── Pillars ────────────────────────────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Four pillars, one platform"
          title="Built for every kind of collector"
          subtitle="Live auctions, creator streams, traditional auction house sales and an always-on marketplace — sharing one authentication, payments and notifications backbone."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <PillarCard
            title="Live Auctions"
            body="Creator-hosted real-time bidding streamed to mobile, web and TV."
            href="/live"
            accent="green"
            icon={<LiveDot size={9} />}
          />
          <PillarCard
            title="Creator Streams"
            body="Monetised live shopping with drops, chat and 85/15 creator revenue share."
            href="/creators"
            accent="gold"
            icon={<SparkIcon size={16} />}
          />
          <PillarCard
            title="Traditional Auctions"
            body="Expert-catalogued consignments with provenance, condition reports and paddles."
            href="/auctions?type=traditional"
            accent="gold"
            icon={<GavelIcon size={16} />}
          />
          <PillarCard
            title="Secondary Marketplace"
            body="Buy Now, Make Offer and MV Verified authenticated resale between sales."
            href="/marketplace"
            accent="green"
            icon={<ShieldIcon size={16} />}
          />
        </div>
      </Section>

      {/* ── Live now ───────────────────────────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Happening right now"
          title="Live creators"
          subtitle="Muted auto-playing previews. Tap any card to enter the room full-screen."
          action={
            <Link to="/live" className="text-[13px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
              See all live →
            </Link>
          }
        />
        {streams.isLoading ? (
          <div className="rail">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[280px] w-[288px]" />
            ))}
          </div>
        ) : (
          <div className="rail">
            {(streams.data?.items ?? []).map((stream) => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        )}
      </Section>

      {/* ── Ending soon ────────────────────────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Closing within the hour"
          title="Ending soon"
          subtitle="Countdowns in MM:SS, live prices, and reserve status at a glance."
          action={
            <Link to="/auctions?status=ending" className="text-[13px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
              All ending soon →
            </Link>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(endingSoon.data?.items ?? featured.data?.items ?? []).slice(0, 4).map((auction) => (
            <AuctionCard key={auction.id} auction={auction} size="lg" />
          ))}
        </div>
      </Section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <Section>
        <SectionHeader eyebrow="How it works" title="From the lobby to your doorstep" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Card key={step.title} className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <span
                  className="grid h-10 w-10 place-items-center rounded-[12px]"
                  style={{ background: 'rgba(245,166,35,0.12)', color: 'var(--mm-gold)' }}
                >
                  {step.icon}
                </span>
                <span className="data text-[26px] font-bold text-white/10">0{index + 1}</span>
              </div>
              <h3 className="text-[16px] text-white">{step.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">{step.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* ── Trust + stats ──────────────────────────────────────────────── */}
      <Section>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card className="p-7">
            <Pill tone="green">
              <ShieldIcon size={12} />
              MoneyMart Verified
            </Pill>
            <h2 className="mt-4 text-[clamp(22px,2.6vw,32px)] text-white">
              Trust infrastructure, not trust by vibes
            </h2>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/62">
              Every high-value lot carries provenance records and a conservator condition report. Buyers pay
              into escrow and sellers are paid out after confirmation. Anti-snipe extensions mean the last
              ten seconds can never steal a lot.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <StatBlock label="Escrow held" value="100%" hint="Released post-confirmation" tone="green" icon={<ShieldIcon size={16} />} />
              <StatBlock label="Anti-snipe" value="+30s" hint="Final 10-second protection" tone="gold" icon={<GavelIcon size={16} />} />
              <StatBlock label="Payout speed" value="7–10d" hint="After buyer confirmation" icon={<TrendIcon size={16} />} />
            </div>
          </Card>

          <Card className="flex flex-col justify-between p-7">
            <div>
              <Pill tone="gold">
                <GlobeIcon size={12} />
                Multi-country from day one
              </Pill>
              <h3 className="mt-4 text-[20px] text-white">Localised currency, payment rails and compliance</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-white/60">
                Geo-IP currency defaulting, local rails (Paystack, Stripe, Interac, M-Pesa), and
                country-specific buyer’s premium and VAT disclosures.
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2">
              {(Object.keys(currencyMeta) as CurrencyCode[]).map((code) => {
                const meta = currencyMeta[code];
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setCountry(code)}
                    className="flex items-center gap-2 rounded-[11px] border px-3 py-2.5 text-left transition-all duration-200"
                    style={{
                      borderColor: country === code ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.09)',
                      background: country === code ? 'rgba(245,166,35,0.1)' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <span aria-hidden className="text-[15px]">
                      {meta.flag}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-white/90">{meta.country}</span>
                      <span className="data block text-[11px] text-white/45">
                        {meta.code} {meta.symbol}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      </Section>

      {/* ── Categories ─────────────────────────────────────────────────── */}
      <Section>
        <SectionHeader
          eyebrow="Browse"
          title="Shop the categories"
          action={
            <Link to="/auctions" className="text-[13px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
              All lots →
            </Link>
          }
        />
        <div className="flex flex-wrap gap-2.5">
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              label={category.label}
              emoji={category.emoji}
              href={`/auctions?category=${category.id}`}
            />
          ))}
        </div>
      </Section>

      {/* ── Testimonials ───────────────────────────────────────────────── */}
      <Section>
        <SectionHeader eyebrow="From the floor" title="What the room says" />
        <Card className="relative overflow-hidden p-8">
          <span className="data pointer-events-none absolute right-6 top-2 text-[110px] leading-none text-white/[0.04]">
            ”
          </span>
          <p className="relative max-w-3xl text-[clamp(16px,1.9vw,21px)] leading-relaxed text-white/88">
            {TESTIMONIALS[testimonial].quote}
          </p>
          <div className="mt-6 flex items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-semibold text-white">{TESTIMONIALS[testimonial].name}</p>
              <p className="text-[12.5px] text-white/50">{TESTIMONIALS[testimonial].role}</p>
            </div>
            <div className="flex gap-2">
              {TESTIMONIALS.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  aria-label={`Testimonial ${index + 1}`}
                  onClick={() => setTestimonial(index)}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: index === testimonial ? 24 : 8,
                    background: index === testimonial ? 'var(--mm-gold)' : 'rgba(255,255,255,0.2)',
                  }}
                />
              ))}
            </div>
          </div>
        </Card>
      </Section>

      {/* ── App CTA ────────────────────────────────────────────────────── */}
      <Section className="pb-4">
        <Card className="relative overflow-hidden p-8 md:p-12">
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-[340px] w-[340px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(245,166,35,0.22), transparent 68%)' }}
          />
          <div className="relative grid gap-8 lg:grid-cols-[1.2fr_auto] lg:items-center">
            <div>
              <MoneyMartMark size={40} />
              <h2 className="mt-5 text-[clamp(24px,3vw,38px)] text-white">
                Bid from your pocket. <span className="gold-text">Never miss a drop.</span>
              </h2>
              <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-white/62">
                The MoneyMart mobile app delivers outbid alerts in under a second, auto-bid with biometric
                confirmation, and live streams in your hand. TV and IPTV apps follow in Phase 3.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Button size="lg" variant="gold" icon={<PlayIcon size={16} />}>
                Download for iOS
              </Button>
              <Button size="lg" variant="green" icon={<UsersIcon size={16} />}>
                Download for Android
              </Button>
              <Link to="/live" className="text-center text-[12.5px] text-white/50 hover:text-white/80">
                or continue in the browser →
              </Link>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="data text-[24px] font-bold" style={{ color: 'var(--mm-gold)' }}>
        {value}
      </p>
      <p className="mt-1 text-[11.5px] uppercase tracking-[0.1em] text-white/45">{label}</p>
    </div>
  );
}

function PillarCard({
  title,
  body,
  href,
  accent,
  icon,
}: {
  title: string;
  body: string;
  href: string;
  accent: 'gold' | 'green';
  icon: React.ReactNode;
}) {
  const color = accent === 'gold' ? 'var(--mm-gold)' : 'var(--mm-green)';
  return (
    <Link to={href} className="group block">
      <Card interactive className="h-full p-5">
        <span
          className="mb-4 grid h-10 w-10 place-items-center rounded-[12px]"
          style={{ background: `${color}1F`, color }}
        >
          {icon}
        </span>
        <h3 className="text-[16px] text-white transition-colors group-hover:text-[var(--mm-gold)]">{title}</h3>
        <p className="mt-2 text-[13px] leading-relaxed text-white/60">{body}</p>
        <span className="mt-4 inline-block text-[12.5px] font-semibold" style={{ color }}>
          Explore →
        </span>
      </Card>
    </Link>
  );
}

export { LiveBottomRail };

function LiveBottomRail({ count, viewers }: { count: number; viewers: number }) {
  return (
    <div className="glass flex items-center gap-3 rounded-full px-4 py-2">
      <LiveDot size={8} label="Live" />
      <span className="data text-[13px] text-white">{count} rooms</span>
      <span className="text-[12px] text-white/50">{formatViewers(viewers)} watching</span>
      <VerifiedBadge compact />
    </div>
  );
}
