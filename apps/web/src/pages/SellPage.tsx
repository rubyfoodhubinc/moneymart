/**
 * Selling Flow — blueprint §5.2 (5 steps) and §8.2 `/sell`.
 *
 * Step 1 item type · Step 2 item details · Step 3 photo upload ·
 * Step 4 pricing & duration (with a live fee calculator) ·
 * Step 5 review & publish.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { MONETIZATION, categories, conditionGrades, currency as currencyMeta } from '@moneymart/tokens';
import type { CurrencyCode } from '@moneymart/tokens';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Button,
  Card,
  CategoryChip,
  Pill,
  PriceTag,
  SectionHeader,
  StatBlock,
  Toast,
  ToastStack,
  VerifiedBadge,
} from '@/components/ui';
import {
  CameraIcon,
  ChartIcon,
  CheckIcon,
  GavelIcon,
  GlobeIcon,
  ShieldIcon,
  SparkIcon,
  StoreIcon,
  TruckIcon,
} from '@/components/icons';
import { api } from '@/lib/api';
import { buyersPremiumRate, formatMoney, isLuxury, round2 } from '@/lib/format';
import { categoryLabel, conditionHint } from '@/lib/labels';
import { useSession } from '@/store/session';

const TRACKS = [
  {
    id: 'live_stream',
    title: 'Live Stream Listing',
    body: 'Drop it during a scheduled stream. Highest engagement and fastest bidding on the platform.',
    fee: '15% platform share of live GMV',
    icon: <SparkIcon size={18} />,
    accent: 'green' as const,
  },
  {
    id: 'traditional',
    title: 'Traditional Auction',
    body: 'Expert-catalogued consignment with provenance research, condition report and a preview period.',
    fee: "15–20% buyer's premium",
    icon: <GavelIcon size={18} />,
    accent: 'gold' as const,
  },
  {
    id: 'buy_now',
    title: 'Buy Now',
    body: 'Fixed price, instant checkout. The simplest way to move stock between auctions.',
    fee: '10% seller fee',
    icon: <StoreIcon size={18} />,
    accent: 'gold' as const,
  },
  {
    id: 'make_offer',
    title: 'Make an Offer',
    body: 'Let buyers name a price. Accept, decline or counter within 48 hours.',
    fee: '10% seller fee',
    icon: <GlobeIcon size={18} />,
    accent: 'green' as const,
  },
] as const;

const DURATIONS = [1, 3, 5, 7, 10, 14];

export default function SellPage() {
  const { track: trackParam } = useParams<{ track?: string }>();
  const navigate = useNavigate();
  const user = useSession((state) => state.user);

  const [step, setStep] = useState(trackParam ? 2 : 1);
  const [track, setTrack] = useState<string>(trackParam ?? 'live_stream');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('watches');
  const [condition, setCondition] = useState<string>('good');
  const [photos, setPhotos] = useState<string[]>([]);
  const [startingPrice, setStartingPrice] = useState(500);
  const [reservePrice, setReservePrice] = useState<number | ''>('');
  const [buyItNow, setBuyItNow] = useState<number | ''>('');
  const [duration, setDuration] = useState(7);
  const [currency, setCurrency] = useState<CurrencyCode>((user?.currencyCode as CurrencyCode) ?? 'USD');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createListing({
        title,
        description,
        categoryId,
        condition,
        auctionType: track,
        startingPrice,
        reservePrice: reservePrice === '' ? undefined : Number(reservePrice),
        buyItNowPrice: buyItNow === '' ? undefined : Number(buyItNow),
        durationDays: duration,
        images: photos,
        sellerId: user?.id,
      }),
    onSuccess: (data) => navigate(`/auctions/${data.auction.id}`),
    onError: (mutationError: unknown) =>
      setError(mutationError instanceof Error ? mutationError.message : 'Could not publish the listing'),
  });

  const premiumRate = useMemo(() => buyersPremiumRate(categoryId, false), [categoryId]);
  const sellerFeeRate = track === 'live_stream' ? MONETIZATION.creatorPlatformShare : 0.1;

  /** Fee calculator across a spread of plausible sale prices (§5.2 Step 4). */
  const feeTable = useMemo(() => {
    const prices = [startingPrice, startingPrice * 2, startingPrice * 5, startingPrice * 10].map((value) =>
      Math.max(1, Math.round(value)),
    );
    return prices.map((price) => {
      const fee = round2(price * sellerFeeRate);
      return { price, fee, net: round2(price - fee), premium: round2(price * premiumRate) };
    });
  }, [startingPrice, sellerFeeRate, premiumRate]);

  const photosFromSeed = (seed: string, color: string) => {
    // Studio-style procedural artwork so a seller without photos still previews well.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0D1B2A"/><stop offset="100%" stop-color="${color}"/></linearGradient></defs><rect width="600" height="450" fill="url(#g)"/><text x="300" y="240" text-anchor="middle" font-family="Inter, sans-serif" font-size="64" font-weight="700" fill="#FFFFFF" fill-opacity="0.14">${seed}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const steps = ['Item type', 'Item details', 'Photos', 'Pricing', 'Review'];

  const next = () => setStep((value) => Math.min(steps.length, value + 1));
  const back = () => setStep((value) => Math.max(1, value - 1));

  const canAdvance =
    (step === 1 && Boolean(track)) ||
    (step === 2 && title.trim().length >= 4 && description.trim().length >= 10) ||
    (step === 3 && photos.length > 0) ||
    (step === 4 && startingPrice > 0) ||
    step === 5;

  return (
    <Section>
      <PageHeader
        eyebrow="Sell on MoneyMart"
        title="List a lot in five steps"
        subtitle="Choose your format, describe the item, upload photos, set your price and duration — then publish. Traditional consignments enter expert review first."
        action={
          <div className="flex flex-wrap gap-2">
            <Pill tone="gold">85% creator share on live GMV</Pill>
            <Pill tone="green">Escrow protected payouts</Pill>
          </div>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Live stream share" value="85%" hint="Creator keeps 85% of live GMV" tone="green" icon={<SparkIcon size={15} />} />
        <StatBlock label="Seller fee" value="10–15%" hint="By format and category" tone="gold" icon={<ChartIcon size={15} />} />
        <StatBlock label="Payout speed" value="7–10d" hint="After buyer confirmation" icon={<TruckIcon size={15} />} />
        <StatBlock label="Listing reach" value="5 markets" hint="NG · US · UK · CA · Africa" icon={<GlobeIcon size={15} />} />
      </div>

      {/* Step rail */}
      <div className="mb-7 flex flex-wrap items-center gap-2">
        {steps.map((label, index) => {
          const number = index + 1;
          const active = step === number;
          const done = step > number;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setStep(number)}
              className="flex items-center gap-2 rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition-all"
              style={{
                borderColor: active ? 'var(--mm-gold-line)' : done ? 'rgba(0,212,161,0.4)' : 'rgba(255,255,255,0.1)',
                background: active ? 'rgba(245,166,35,0.12)' : done ? 'rgba(0,212,161,0.1)' : 'transparent',
                color: active ? 'var(--mm-gold)' : done ? 'var(--mm-green)' : 'rgba(255,255,255,0.6)',
              }}
            >
              <span className="data grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold" style={{ background: 'rgba(255,255,255,0.1)' }}>
                {done ? <CheckIcon size={11} /> : number}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Step body ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">
          {step === 1 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {TRACKS.map((entry) => {
                const selected = track === entry.id;
                const color = entry.accent === 'gold' ? 'var(--mm-gold)' : 'var(--mm-green)';
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setTrack(entry.id);
                      setStep(2);
                    }}
                    className="card-surface p-5 text-left transition-all duration-300"
                    style={{
                      borderColor: selected ? 'var(--mm-gold-line)' : undefined,
                      transform: selected ? 'translateY(-2px)' : undefined,
                    }}
                  >
                    <span
                      className="mb-3.5 grid h-11 w-11 place-items-center rounded-[13px]"
                      style={{ background: `${color}1F`, color }}
                    >
                      {entry.icon}
                    </span>
                    <h3 className="text-[16px] text-white">{entry.title}</h3>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-white/60">{entry.body}</p>
                    <p className="mt-3 text-[11.5px] font-semibold" style={{ color }}>
                      {entry.fee}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : null}

          {step === 2 ? (
            <Card className="p-5">
              <h3 className="mb-4 text-[16px] text-white">Item details</h3>

              <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Category</label>
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.map((entry) => (
                  <CategoryChip
                    key={entry.id}
                    label={entry.label}
                    emoji={entry.emoji}
                    selected={categoryId === entry.id}
                    onClick={() => setCategoryId(entry.id)}
                  />
                ))}
              </div>
              {isLuxury(categoryId) ? (
                <p className="mt-2 text-[11.5px]" style={{ color: 'var(--mm-gold)' }}>
                  Luxury category — traditional sales carry a {(MONETIZATION.buyersPremiumLuxury * 100).toFixed(0)}% buyer’s premium.
                </p>
              ) : null}

              <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Title — {title.length}/80
              </label>
              <input
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Rolex Datejust 36 — 2016, Full Set"
                className="mt-2 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[14px] outline-none"
              />

              <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Description — {description.length}/2000
              </label>
              <textarea
                value={description}
                maxLength={2000}
                rows={6}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Maker, period, materials, provenance, what is included, any flaws."
                className="mt-2 w-full resize-y rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[13.5px] leading-relaxed outline-none"
              />

              <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Condition grading
              </label>
              <div className="mt-2 grid gap-2 sm:grid-cols-5">
                {conditionGrades.map((grade) => {
                  const selected = condition === grade.value;
                  return (
                    <button
                      key={grade.value}
                      type="button"
                      onClick={() => setCondition(grade.value)}
                      className="rounded-[11px] border p-3 text-left transition-all"
                      style={{
                        borderColor: selected ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                        background: selected ? 'rgba(245,166,35,0.12)' : 'rgba(255,255,255,0.02)',
                      }}
                      title={grade.hint}
                    >
                      <span
                        className="block text-[12.5px] font-semibold"
                        style={{ color: selected ? 'var(--mm-gold)' : 'rgba(255,255,255,0.85)' }}
                      >
                        {grade.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11.5px] text-white/45">{conditionHint(condition)}</p>
            </Card>
          ) : null}

          {step === 3 ? (
            <Card className="p-5">
              <h3 className="mb-1.5 text-[16px] text-white">Photos</h3>
              <p className="mb-4 text-[12.5px] text-white/55">
                Up to 20 images. Studio-white or light grey backgrounds only for item listings — no lifestyle shots.
                Your first image becomes the lot cover.
              </p>

              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {photos.map((photo, index) => (
                  <div key={photo.slice(-20) + index} className="relative aspect-square overflow-hidden rounded-[12px] border border-white/10">
                    <img src={photo} alt={`Upload ${index + 1}`} className="h-full w-full object-cover" />
                    {index === 0 ? (
                      <span className="absolute left-1.5 top-1.5 rounded-full px-2 py-[2px] text-[9.5px] font-bold uppercase" style={{ background: 'var(--mm-gold)', color: '#0D1B2A' }}>
                        Cover
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                      className="absolute right-1.5 top-1.5 rounded-full px-2 py-[2px] text-[10px] font-bold"
                      style={{ background: 'rgba(7,15,24,0.8)', color: '#FF8080' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setPhotos((current) =>
                      current.length >= 20
                        ? current
                        : [
                            ...current,
                            photosFromSeed(
                              String(current.length + 1).padStart(2, '0'),
                              current.length % 2 === 0 ? '#F5A623' : '#00D4A1',
                            ),
                          ],
                    )
                  }
                  className="grid aspect-square place-items-center rounded-[12px] border border-dashed transition-colors hover:border-[var(--mm-gold-line)]"
                  style={{ borderColor: 'rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.02)' }}
                >
                  <span className="text-center">
                    <CameraIcon size={20} />
                    <span className="mt-1.5 block text-[11px] text-white/55">Add photo</span>
                  </span>
                </button>
              </div>

              <p className="mt-4 text-[11.5px] text-white/40">
                {photos.length} of 20 added. In production this step uses Expo Image Picker (mobile) or a direct
                upload to S3 with AI background removal.
              </p>
            </Card>
          ) : null}

          {step === 4 ? (
            <Card className="p-5">
              <h3 className="mb-4 text-[16px] text-white">Pricing & duration</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Currency</label>
                  <select
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
                    className="mt-2 w-full rounded-[12px] border border-white/10 bg-[#0F1E2E] px-3.5 py-3 text-[14px] outline-none"
                  >
                    {Object.values(currencyMeta).map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {entry.flag} {entry.code} — {entry.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Starting price</label>
                  <input
                    type="number"
                    value={startingPrice}
                    min={1}
                    onChange={(event) => setStartingPrice(Number(event.target.value))}
                    className="data mt-2 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[16px] font-semibold outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    Reserve price (optional)
                  </label>
                  <input
                    type="number"
                    value={reservePrice}
                    onChange={(event) => setReservePrice(event.target.value === '' ? '' : Number(event.target.value))}
                    placeholder="Confidential minimum"
                    className="data mt-2 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[15px] outline-none"
                  />
                  <p className="mt-1.5 text-[11px] text-white/40">
                    Buyers only ever see “Reserve met” or “Reserve not met”.
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    Buy It Now price (optional)
                  </label>
                  <input
                    type="number"
                    value={buyItNow}
                    onChange={(event) => setBuyItNow(event.target.value === '' ? '' : Number(event.target.value))}
                    placeholder="Instant purchase price"
                    className="data mt-2 w-full rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[15px] outline-none"
                  />
                </div>
              </div>

              <label className="mt-5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Duration
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {DURATIONS.map((days) => (
                  <CategoryChip
                    key={days}
                    label={`${days} day${days > 1 ? 's' : ''}`}
                    selected={duration === days}
                    onClick={() => setDuration(days)}
                  />
                ))}
              </div>

              <div className="mt-6">
                <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  <ChartIcon size={13} /> Fee calculator
                </p>
                <div className="overflow-hidden rounded-[12px] border border-white/8">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                        <th className="px-3 py-2.5 text-left font-semibold text-white/60">Sale price</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-white/60">Platform fee</th>
                        <th className="px-3 py-2.5 text-right font-semibold text-white/60">You receive</th>
                        <th className="hidden px-3 py-2.5 text-right font-semibold text-white/60 sm:table-cell">
                          Buyer pays premium
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {feeTable.map((row) => (
                        <tr key={row.price} className="border-t" style={{ borderColor: 'var(--mm-divider)' }}>
                          <td className="data px-3 py-2.5 text-white/85">{formatMoney(row.price, currency)}</td>
                          <td className="data px-3 py-2.5 text-right text-white/60">−{formatMoney(row.fee, currency)}</td>
                          <td className="data px-3 py-2.5 text-right font-semibold" style={{ color: 'var(--mm-green)' }}>
                            {formatMoney(row.net, currency)}
                          </td>
                          <td className="data hidden px-3 py-2.5 text-right text-white/50 sm:table-cell">
                            {formatMoney(row.premium, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11.5px] text-white/45">
                  {track === 'live_stream'
                    ? `Live stream: platform retains ${(MONETIZATION.creatorPlatformShare * 100).toFixed(0)}%, you keep ${(MONETIZATION.creatorShare * 100).toFixed(0)}%.`
                    : `Fixed-format listing: ${(sellerFeeRate * 100).toFixed(0)}% seller fee.`}{' '}
                  Buyer’s premium on traditional sales is {(premiumRate * 100).toFixed(0)}% for this category.
                </p>
              </div>
            </Card>
          ) : null}

          {step === 5 ? (
            <Card className="p-5">
              <h3 className="mb-4 text-[16px] text-white">Review & publish</h3>
              <div className="flex gap-4">
                <div className="h-[110px] w-[140px] shrink-0 overflow-hidden rounded-[12px] border border-white/10">
                  {photos[0] ? (
                    <img src={photos[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-[11.5px] text-white/35">No photo</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Pill tone="gold">{TRACKS.find((entry) => entry.id === track)?.title}</Pill>
                    <Pill>{categoryLabel(categoryId)}</Pill>
                    <Pill>{conditionGrades.find((grade) => grade.value === condition)?.label}</Pill>
                    {photos.length > 0 ? <VerifiedBadge compact /> : null}
                  </div>
                  <h4 className="clamp-2 text-[15.5px] font-semibold text-white">{title || 'Untitled lot'}</h4>
                  <p className="clamp-2 mt-1.5 text-[12.5px] text-white/55">{description || 'No description yet.'}</p>
                </div>
              </div>

              <dl className="mt-5 space-y-2 text-[13px]">
                <ReviewRow label="Starting price" value={formatMoney(startingPrice, currency)} />
                {reservePrice !== '' ? <ReviewRow label="Reserve (private)" value={formatMoney(Number(reservePrice), currency)} /> : null}
                {buyItNow !== '' ? <ReviewRow label="Buy It Now" value={formatMoney(Number(buyItNow), currency)} /> : null}
                <ReviewRow label="Duration" value={`${duration} day${duration > 1 ? 's' : ''}`} />
                <ReviewRow label="Platform fee" value={`${(sellerFeeRate * 100).toFixed(0)}%`} />
                <ReviewRow
                  label="Estimated net at starting price"
                  value={formatMoney(round2(startingPrice * (1 - sellerFeeRate)), currency)}
                  strong
                />
              </dl>

              {track === 'traditional' ? (
                <div className="mt-5 rounded-[12px] border p-3.5" style={{ borderColor: 'var(--mm-border)', background: 'rgba(245,166,35,0.08)' }}>
                  <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-white/75">
                    <ShieldIcon size={15} />
                    Traditional consignment enters expert review (3–5 business days). Our team produces the catalogue
                    entry, valuation range and condition report before your lot goes live.
                  </p>
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-2">
                <Button
                  variant="gold"
                  size="lg"
                  loading={create.isPending}
                  onClick={() => create.mutate()}
                  icon={<CheckIcon size={16} />}
                >
                  {track === 'traditional' ? 'Submit for review' : 'Publish listing'}
                </Button>
                <Button variant="navy" size="lg" onClick={back}>
                  Back
                </Button>
              </div>
            </Card>
          ) : null}

          {step < 5 ? (
            <div className="flex items-center justify-between gap-3">
              <Button variant="navy" onClick={back} disabled={step === 1}>
                Back
              </Button>
              <div className="flex items-center gap-3">
                {!canAdvance ? (
                  <span className="text-[12px] text-white/45">
                    {step === 2
                      ? 'Add a title and a description to continue'
                      : step === 3
                        ? 'Add at least one photo to continue'
                        : 'Complete this step to continue'}
                  </span>
                ) : null}
                <Button variant="gold" onClick={next} disabled={!canAdvance}>
                  Continue
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Live preview column ────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-[88px] lg:self-start">
          <Card className="overflow-hidden">
            <div className="relative aspect-[4/3]">
              {photos[0] ? (
                <img src={photos[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center" style={{ background: 'linear-gradient(140deg,#12233A,#0D1B2A)' }}>
                  <span className="text-[12.5px] text-white/35">Cover photo preview</span>
                </div>
              )}
              <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(7,15,24,0.05) 40%, rgba(7,15,24,0.9) 100%)' }} />
              <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
                <PriceTag
                  formatted={formatMoney(startingPrice, currency)}
                  label={startingPrice ? 'Starting bid' : 'Set a price'}
                  size="lg"
                />
                <Pill tone="gold">{duration}d</Pill>
              </div>
            </div>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                {categoryLabel(categoryId)}
              </p>
              <h3 className="clamp-2 mt-1.5 text-[15px] font-semibold text-white">{title || 'Your lot title appears here'}</h3>
              <div className="mt-3 flex items-center gap-2">
                {user ? <Avatarish name={user.displayName} /> : null}
                <span className="text-[12.5px] text-white/55">{user?.displayName ?? 'Your shop'}</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-[14.5px] text-white">Why sellers choose MoneyMart</h3>
            <ul className="space-y-2.5 text-[12.5px] text-white/65">
              <Bullet>85% creator share on live-stream GMV — no listing fee for your first 10 lots each month.</Bullet>
              <Bullet>Multi-currency settlement: Paystack (NGN), Stripe (USD/GBP/CAD), Interac, M-Pesa.</Bullet>
              <Bullet>Escrow releases 7–10 days after buyer confirmation, or instantly to your wallet balance.</Bullet>
              <Bullet>Every lot feeds the category price-history chart, deepening buyer trust in your pricing.</Bullet>
            </ul>
            <Link to="/fees" className="mt-4 inline-block text-[12.5px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
              Full fee schedule →
            </Link>
          </Card>

          <Card className="p-5">
            <h3 className="mb-2 text-[14.5px] text-white">Compliance reminders</h3>
            <p className="text-[12.5px] leading-relaxed text-white/60">
              Sellers must be 18+. High-value lots require KYC (BVN in Nigeria, Stripe Identity in the US/UK,
              SIN/ID in Canada). Prohibited categories are screened automatically before publication.
            </p>
          </Card>
        </div>
      </div>

      <ToastStack>
        {error ? <Toast tone="error" title="Listing not published" body={error} onDismiss={() => setError(null)} /> : null}
      </ToastStack>
    </Section>
  );
}

function ReviewRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? 'text-white' : 'text-white/55'}>{label}</dt>
      <dd className={`data font-semibold ${strong ? 'text-[16px]' : ''}`} style={{ color: strong ? 'var(--mm-green)' : 'rgba(255,255,255,0.9)' }}>
        {value}
      </dd>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckIcon size={13} />
      <span>{children}</span>
    </li>
  );
}

function Avatarish({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white"
      style={{ background: 'linear-gradient(140deg, #16294280, #0D1B2A)', border: '1px solid rgba(245,166,35,0.4)' }}
    >
      {initials}
    </span>
  );
}
