'use client';
/* eslint-disable react-hooks/exhaustive-deps */

/**
 * MoneyMart — auction browse & search results.
 * §8.2 `/auctions` (browse, sort/filter, calendar) and the shared results grid.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { categories, conditionGrades } from '@moneymart/tokens';
import type { AuctionWithRelations } from '@moneymart/types';
import { AuctionCard, CountdownTimer } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Avatar,
  Button,
  Card,
  CategoryChip,
  EmptyState,
  Pill,
  PriceTag,
  Skeleton,
  StatBlock,
} from '@/components/ui';
import { ChartIcon, GavelIcon, SearchIcon, SparkIcon, TrendIcon } from '@/components/icons';
import { useAuctions } from '@/lib/hooks';
import { formatMoney } from '@/lib/format';
import { categoryEmoji, categoryLabel, conditionLabel } from '@/lib/labels';

const SORTS = [
  { value: 'ending', label: 'Ending soonest' },
  { value: 'price', label: 'Highest price' },
  { value: 'bids', label: 'Most bids' },
  { value: 'watchers', label: 'Most watched' },
  { value: 'featured', label: 'Featured first' },
];

const TYPES = [
  { value: '', label: 'All formats' },
  { value: 'live_stream', label: 'Live stream' },
  { value: 'traditional', label: 'Traditional' },
  { value: 'buy_now', label: 'Buy now' },
  { value: 'make_offer', label: 'Make an offer' },
];

export default function AuctionsPage() {
  const params = useSearchParams();
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [type, setType] = useState(params.get('type') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [sort, setSort] = useState(params.get('sort') ?? 'ending');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [condition, setCondition] = useState('');
  const [maxPrice, setMaxPrice] = useState<number>(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [page, setPage] = useState(1);

  const auctions = useAuctions({ category, type, status, sort, q: query || undefined });

  const items = useMemo(() => {
    let list = auctions.data?.items ?? [];
    if (condition) list = list.filter((entry) => entry.item.condition === condition);
    if (maxPrice > 0) list = list.filter((entry) => (entry.currentBid || entry.startingPrice) <= maxPrice);
    return list;
  }, [auctions.data, condition, maxPrice]);

  const pageSize = 12;
  const visible = items.slice(0, page * pageSize);

  const priceCeiling = useMemo(
    () => Math.max(100, ...(auctions.data?.items ?? []).map((entry) => entry.currentBid || entry.startingPrice)),
    [auctions.data],
  );

  const liveCount = items.filter((entry) => entry.isLive).length;
  const totalValue = items.reduce((sum, entry) => sum + (entry.currentBid || entry.startingPrice), 0);

  return (
    <Section>
      <PageHeader
        eyebrow="Auction browse"
        title="Every lot on the platform"
        subtitle="Live stream drops, catalogued auction house sales, Buy Now listings and lots open to offers — one search surface."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="green">{liveCount} live</Pill>
            <Pill tone="gold">{items.length} lots</Pill>
            <Button size="sm" variant="navy" onClick={() => setCalendarOpen((value) => !value)} icon={<ChartIcon size={14} />}>
              Auction calendar
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Lots matching" value={items.length} tone="gold" icon={<GavelIcon size={15} />} />
        <StatBlock label="Open for bidding now" value={liveCount} tone="green" />
        <StatBlock
          label="Combined current value"
          value={formatMoney(totalValue, 'USD', { compact: true })}
          icon={<TrendIcon size={15} />}
        />
        <StatBlock label="Formats" value={4} hint="Live · Traditional · Buy Now · Offer" icon={<SparkIcon size={15} />} />
      </div>

      {/* Search + sort bar */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex h-12 flex-1 items-center gap-2.5 rounded-[13px] border border-white/10 bg-white/[0.035] px-4">
          <SearchIcon size={16} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search lots, makers, creators, categories…"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-white/35"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="text-[11.5px] text-white/45 hover:text-white">
              Clear
            </button>
          ) : null}
        </div>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value)}
          className="h-12 rounded-[13px] border border-white/10 bg-[#0F1E2E] px-4 text-[13.5px] outline-none"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <Button variant="navy" onClick={() => setFiltersOpen((value) => !value)}>
            Filters {condition || maxPrice ? '•' : ''}
          </Button>
          <div className="flex overflow-hidden rounded-[13px] border border-white/10">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className="px-3.5 py-2.5 text-[13px] font-semibold capitalize transition-colors"
                style={{
                  background: view === mode ? 'rgba(245,166,35,0.14)' : 'transparent',
                  color: view === mode ? 'var(--mm-gold)' : 'rgba(255,255,255,0.55)',
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      {filtersOpen ? (
        <Card className="animate-scale-in mb-6 p-5">
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Format</p>
              <div className="flex flex-wrap gap-2">
                {TYPES.map((option) => (
                  <CategoryChip
                    key={option.value || 'all'}
                    label={option.label}
                    selected={type === option.value}
                    onClick={() => setType(option.value)}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Condition</p>
              <div className="flex flex-wrap gap-2">
                <CategoryChip label="Any" selected={!condition} onClick={() => setCondition('')} />
                {conditionGrades.map((grade) => (
                  <CategoryChip
                    key={grade.value}
                    label={grade.label}
                    selected={condition === grade.value}
                    onClick={() => setCondition(grade.value)}
                  />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Maximum price — {maxPrice ? formatMoney(maxPrice, 'USD') : 'no limit'}
              </p>
              <input
                type="range"
                min={0}
                max={Math.ceil(priceCeiling)}
                step={Math.max(1, Math.round(priceCeiling / 60))}
                value={maxPrice}
                onChange={(event) => setMaxPrice(Number(event.target.value))}
                className="w-full accent-[#F5A623]"
              />
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Status</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '', label: 'All' },
                    { value: 'live', label: 'Live now' },
                    { value: 'ending', label: 'Ending soon' },
                    { value: 'scheduled', label: 'Scheduled' },
                    { value: 'sold', label: 'Sold' },
                  ].map((option) => (
                    <CategoryChip
                      key={option.value || 'all'}
                      label={option.label}
                      selected={status === option.value}
                      onClick={() => setStatus(option.value)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setCategory('');
                setType('');
                setStatus('');
                setCondition('');
                setMaxPrice(0);
                setQuery('');
              }}
            >
              Reset all
            </Button>
            <Button variant="gold" onClick={() => setFiltersOpen(false)}>
              Apply filters
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Calendar */}
      {calendarOpen ? <AuctionCalendar items={auctions.data?.items ?? []} /> : null}

      {/* Category rail */}
      <div className="no-scrollbar mb-6 flex gap-2 overflow-x-auto pb-1">
        <CategoryChip label="All categories" emoji="✨" selected={!category} onClick={() => setCategory('')} />
        {categories.map((entry) => (
          <CategoryChip
            key={entry.id}
            label={entry.label}
            emoji={entry.emoji}
            selected={category === entry.id}
            onClick={() => setCategory(entry.id)}
          />
        ))}
      </div>

      {/* Results */}
      {auctions.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[340px] w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          title="No lots match those filters"
          body="Try widening the price range, clearing the condition filter, or browsing another category."
          action={
            <Button
              variant="gold"
              onClick={() => {
                setCategory('');
                setType('');
                setStatus('');
                setCondition('');
                setMaxPrice(0);
                setQuery('');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <div
            className={
              view === 'grid'
                ? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                : 'grid gap-3'
            }
          >
            {visible.map((auction) =>
              view === 'grid' ? (
                <AuctionCard key={auction.id} auction={auction} size="lg" />
              ) : (
                <ResultRow key={auction.id} auction={auction} />
              ),
            )}
          </div>

          <div className="mt-9 flex items-center justify-center gap-4">
            <span className="text-[12.5px] text-white/45">
              Showing {visible.length} of {items.length}
            </span>
            {visible.length < items.length ? (
              <Button variant="navy" onClick={() => setPage((value) => value + 1)}>
                Load more lots
              </Button>
            ) : null}
          </div>
        </>
      )}
    </Section>
  );
}

function ResultRow({ auction }: { auction: AuctionWithRelations }) {
  const { item, seller } = auction;
  const price = auction.currentBid || auction.startingPrice;
  return (
    <Link href={`/auctions/${auction.id}`} className="group block">
      <article className="card-surface flex gap-4 p-3.5 transition-all duration-300 hover:border-[var(--mm-gold-line)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.images[0]}
          alt={item.title}
          className="h-[104px] w-[136px] shrink-0 rounded-[11px] object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Pill tone="neutral">
              {categoryEmoji(item.categoryId)} {categoryLabel(item.categoryId)}
            </Pill>
            {auction.isLive ? <Pill tone="green">Live</Pill> : null}
            {item.isVerified ? <Pill tone="green">MV Verified</Pill> : null}
            {auction.lotNumber ? <Pill tone="gold">{auction.lotNumber}</Pill> : null}
          </div>
          <h3 className="clamp-1 text-[15.5px] font-semibold text-white transition-colors group-hover:text-[var(--mm-gold)]">
            {item.title}
          </h3>
          <p className="clamp-1 mt-1 text-[12.5px] text-white/55">{item.description}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-2">
              <Avatar name={seller.displayName} src={seller.avatarUrl} size={22} isLive={seller.isLive} />
              <span className="text-[12px] text-white/60">{seller.displayName}</span>
            </span>
            <span className="text-[12px] text-white/45">{conditionLabel(item.condition)}</span>
            <span className="data text-[12px] text-white/45">{auction.bidCount} bids</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-between">
          <PriceTag
            formatted={formatMoney(price, auction.currency as 'USD')}
            label={auction.bidCount ? 'Current bid' : 'Starting bid'}
            size="md"
          />
          <CountdownTimer endTime={auction.endTime} size="sm" label />
        </div>
      </article>
    </Link>
  );
}

function AuctionCalendar({ items }: { items: { id: string; title: string; endTime: string; startTime: string; auctionType: string; currency: string; currentBid: number; startingPrice: number }[] }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDay = useMemo(() => {
    const map = new Map<number, typeof items>();
    items.forEach((item) => {
      const date = new Date(item.endTime);
      if (date.getFullYear() === year && date.getMonth() === month) {
        const day = date.getDate();
        map.set(day, [...(map.get(day) ?? []), item]);
      }
    });
    return map;
  }, [items, year, month]);

  return (
    <Card className="animate-scale-in mb-6 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[16px] text-white">
          {base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="navy" onClick={() => setMonthOffset((value) => value - 1)}>
            Prev
          </Button>
          <Button size="sm" variant="navy" onClick={() => setMonthOffset(0)}>
            Today
          </Button>
          <Button size="sm" variant="navy" onClick={() => setMonthOffset((value) => value + 1)}>
            Next
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <span key={day} className="pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-white/40">
            {day}
          </span>
        ))}
        {Array.from({ length: firstDay }).map((_, index) => (
          <span key={`pad-${index}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const dayEvents = eventsByDay.get(day) ?? [];
          const isToday =
            new Date().getDate() === day && new Date().getMonth() === month && new Date().getFullYear() === year;
          return (
            <div
              key={day}
              className="min-h-[74px] rounded-[10px] border p-1.5 text-left"
              style={{
                borderColor: isToday ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.07)',
                background: dayEvents.length ? 'rgba(245,166,35,0.06)' : 'rgba(255,255,255,0.02)',
              }}
            >
              <span
                className="data text-[11.5px] font-semibold"
                style={{ color: isToday ? 'var(--mm-gold)' : 'rgba(255,255,255,0.6)' }}
              >
                {day}
              </span>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 2).map((event) => (
                  <Link
                    key={event.id}
                    href={`/auctions/${event.id}`}
                    className="block truncate rounded-[6px] px-1.5 py-1 text-[10px] text-white/80 transition-colors hover:text-white"
                    style={{ background: 'rgba(0,212,161,0.16)' }}
                    title={event.title}
                  >
                    {event.title}
                  </Link>
                ))}
                {dayEvents.length > 2 ? (
                  <span className="block px-1.5 text-[10px] text-white/45">+{dayEvents.length - 2} more</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
