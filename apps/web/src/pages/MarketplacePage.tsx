/**
 * Secondary Marketplace — blueprint §4.3 and §8.2.
 * Buy Now, Make Offer and MV Verified authenticated resale, always on alongside
 * the live and traditional auction calendars.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { categories } from '@moneymart/tokens';
import { AuctionCard } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Button,
  CategoryChip,
  EmptyState,
  Pill,
  SectionHeader,
  Skeleton,
  StatBlock,
} from '@/components/ui';
import { GavelIcon, SearchIcon, ShieldIcon, SparkIcon, TrendIcon } from '@/components/icons';
import { useAuctions } from '@/lib/hooks';
import { formatMoney } from '@/lib/format';

const TABS = [
  { value: '', label: 'Everything' },
  { value: 'buy_now', label: 'Buy Now' },
  { value: 'make_offer', label: 'Make an Offer' },
  { value: 'sold', label: 'Recently sold' },
] as const;

export default function MarketplacePage() {
  const [tab, setTab] = useState<string>('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const auctions = useAuctions({
    type: tab === 'buy_now' || tab === 'make_offer' ? tab : undefined,
    status: tab === 'sold' ? 'sold' : undefined,
    category: category || undefined,
    sort: tab === 'sold' ? 'price' : 'ending',
  });

  const items = useMemo(() => {
    let list = auctions.data?.items ?? [];
    if (verifiedOnly) list = list.filter((entry) => entry.item.isVerified);
    if (query) {
      const needle = query.toLowerCase();
      list = list.filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) ||
          entry.item.description.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [auctions.data, verifiedOnly, query]);

  const totalValue = items.reduce((sum, entry) => sum + (entry.currentBid || entry.startingPrice), 0);

  return (
    <Section>
      <PageHeader
        eyebrow="Secondary marketplace"
        title="Buy now, make an offer, or take a verified resale"
        subtitle="Always-on commerce between auction moments. MV Verified lots have passed authentication review — photo verification, provenance check, or physical inspection for high-value pieces."
        action={
          <div className="flex flex-wrap gap-2">
            <Pill tone="green">
              <ShieldIcon size={11} /> {items.filter((entry) => entry.item.isVerified).length} verified
            </Pill>
            <Pill tone="gold">{items.length} listings</Pill>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Listings" value={items.length} tone="gold" icon={<GavelIcon size={15} />} />
        <StatBlock
          label="Combined asking value"
          value={formatMoney(totalValue, 'USD', { compact: true })}
          icon={<TrendIcon size={15} />}
        />
        <StatBlock
          label="MV Verified"
          value={items.filter((entry) => entry.item.isVerified).length}
          tone="green"
          icon={<ShieldIcon size={15} />}
        />
        <StatBlock label="Formats" value={3} hint="Buy Now · Make Offer · Verified resale" icon={<SparkIcon size={15} />} />
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex h-12 flex-1 items-center gap-2.5 rounded-[13px] border border-white/10 bg-white/[0.035] px-4">
          <SearchIcon size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the marketplace…"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-white/35"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map((entry) => (
            <CategoryChip
              key={entry.value}
              label={entry.label}
              selected={tab === entry.value}
              onClick={() => setTab(entry.value)}
            />
          ))}
          <CategoryChip
            label="MV Verified only"
            emoji="🛡️"
            selected={verifiedOnly}
            onClick={() => setVerifiedOnly((value) => !value)}
          />
        </div>
      </div>

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

      {auctions.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[340px] w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          title="Nothing listed in this filter yet"
          body="Try another format, clear the verification filter, or browse the live auctions closing soon."
          action={
            <div className="flex justify-center gap-3">
              <Link to="/auctions">
                <Button variant="gold">Browse auctions</Button>
              </Link>
              <Button
                variant="navy"
                onClick={() => {
                  setTab('');
                  setCategory('');
                  setVerifiedOnly(false);
                  setQuery('');
                }}
              >
                Reset filters
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <SectionHeader eyebrow={`${items.length} listings`} title={tab === 'sold' ? 'Recently sold' : 'Available now'} />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((auction) => (
              <AuctionCard key={auction.id} auction={auction} size="lg" />
            ))}
          </div>
        </>
      )}

      <div className="mt-14 grid gap-4 lg:grid-cols-3">
        <InfoCard
          title="Buy Now"
          body="Fixed price, instant checkout, immediate order confirmation. No waiting for a clock to run down."
          icon={<SparkIcon size={17} />}
        />
        <InfoCard
          title="Make an Offer"
          body="Submit a price. The seller can accept, decline, or counter within 48 hours in a private thread."
          icon={<GavelIcon size={17} />}
        />
        <InfoCard
          title="MV Verified resale"
          body="Authenticated items carry the MoneyMart Verified badge across every listing surface and price history."
          icon={<ShieldIcon size={17} />}
        />
      </div>
    </Section>
  );
}

function InfoCard({ title, body, icon }: { title: string; body: string; icon: React.ReactNode }) {
  return (
    <div className="card-surface p-5">
      <span
        className="mb-3 grid h-10 w-10 place-items-center rounded-[12px]"
        style={{ background: 'rgba(245,166,35,0.12)', color: 'var(--mm-gold)' }}
      >
        {icon}
      </span>
      <h3 className="text-[15.5px] text-white">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-white/60">{body}</p>
    </div>
  );
}
