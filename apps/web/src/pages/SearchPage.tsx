/**
 * Search — blueprint §5.2 Search Screen and §9.1 Search Service.
 * Unified search with trending searches, recent searches, creator suggestions,
 * and results across lots, creators and categories.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { categories } from '@moneymart/tokens';
import { AuctionCard, StreamCard } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import { Avatar, Button, Card, CategoryChip, EmptyState, Pill, SectionHeader, Skeleton } from '@/components/ui';
import { GavelIcon, SearchIcon, SparkIcon, TrendIcon, UsersIcon } from '@/components/icons';
import { useAuctions, useStreams } from '@/lib/hooks';

const TRENDING = [
  'rolex datejust',
  'air max 1',
  'adire eleko',
  'charizard psa 9',
  'banksy print',
  'kente cloth',
  'lebron rookie',
];

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [submitted, setSubmitted] = useState(params.get('q') ?? '');
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem('mm:recent-searches');
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const auctions = useAuctions({ q: submitted || undefined });
  const streams = useStreams();

  const resultingLots = auctions.data?.items ?? [];
  const resultingCreators = useMemo(() => {
    if (!submitted) return [];
    const needle = submitted.toLowerCase();
    const list = streams.data?.items ?? [];
    const seen = new Map<string, (typeof list)[number]>();
    list.forEach((stream) => {
      if (
        stream.creator.displayName.toLowerCase().includes(needle) ||
        stream.creator.handle.toLowerCase().includes(needle) ||
        !needle
      ) {
        seen.set(stream.creatorId, stream);
      }
    });
    return [...seen.values()];
  }, [streams.data, submitted]);

  const suggestedCreators = (streams.data?.items ?? []).slice(0, 6);

  const runSearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setSubmitted(trimmed);
    const next = [trimmed, ...recent.filter((entry) => entry !== trimmed)].slice(0, 8);
    setRecent(next);
    try {
      window.localStorage.setItem('mm:recent-searches', JSON.stringify(next));
    } catch {
      /* storage unavailable — recent searches stay in memory */
    }
  };

  const clearRecent = () => {
    setRecent([]);
    try {
      window.localStorage.removeItem('mm:recent-searches');
    } catch {
      /* ignore */
    }
  };

  return (
    <Section>
      <PageHeader
        eyebrow="Search"
        title="Find a lot, a creator or a category"
        subtitle="Full-text search across listings and creators with faceted filtering by category, price, condition and location."
      />

      {/* Search bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="flex h-14 flex-1 items-center gap-3 rounded-[14px] border border-white/10 bg-white/[0.04] px-4">
          <SearchIcon size={18} />
          <input
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch(query);
            }}
            placeholder="Search lots, creators, categories…"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/35"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSubmitted('');
              }}
              className="text-[11.5px] text-white/45 hover:text-white"
            >
              Clear
            </button>
          ) : null}
        </div>
        <Button size="lg" variant="gold" onClick={() => runSearch(query)} icon={<SearchIcon size={16} />}>
          Search
        </Button>
      </div>

      {/* Trending + recent */}
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-[14px] text-white">
            <TrendIcon size={15} /> Trending searches
          </h3>
          <div className="flex flex-wrap gap-2">
            {TRENDING.map((entry) => (
              <CategoryChip key={entry} label={entry} onClick={() => runSearch(entry)} />
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] text-white">Recent searches</h3>
            {recent.length ? (
              <button type="button" onClick={clearRecent} className="text-[11.5px] text-white/45 hover:text-white">
                Clear all
              </button>
            ) : null}
          </div>
          {recent.length ? (
            <div className="flex flex-wrap gap-2">
              {recent.map((entry) => (
                <CategoryChip key={entry} label={entry} onClick={() => runSearch(entry)} />
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-white/45">Your recent searches appear here.</p>
          )}
        </Card>
      </div>

      {/* Categories */}
      <div className="mb-8">
        <SectionHeader eyebrow="Browse" title="Categories" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {categories.map((category) => (
            <Link key={category.id} to={`/auctions?category=${category.id}`}>
              <Card interactive className="p-4 text-center">
                <span className="block text-[26px]" aria-hidden>
                  {category.emoji}
                </span>
                <span className="mt-2 block text-[13px] font-medium text-white/85">{category.label}</span>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Results */}
      {submitted ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[22px] text-white">
              Results for “{submitted}” <span className="text-white/40">· {resultingLots.length} lots</span>
            </h2>
            <Button variant="navy" size="sm" onClick={() => navigate(`/auctions?q=${encodeURIComponent(submitted)}`)}>
              Open in advanced browse
            </Button>
          </div>

          {auctions.isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-[330px] w-full" />
              ))}
            </div>
          ) : !resultingLots.length && !resultingCreators.length ? (
            <EmptyState
              title="No matches"
              body="Try a broader term, a category name, or a creator handle."
              icon={<SearchIcon size={22} />}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {TRENDING.slice(0, 3).map((entry) => (
                    <Button key={entry} size="sm" variant="navy" onClick={() => runSearch(entry)}>
                      {entry}
                    </Button>
                  ))}
                </div>
              }
            />
          ) : (
            <div className="space-y-10">
              {resultingCreators.length ? (
                <div>
                  <SectionHeader eyebrow="Creators" title="Matching creators" />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {resultingCreators.map((stream) => (
                      <Card key={stream.creatorId} interactive className="p-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={stream.creator.displayName}
                            src={stream.creator.avatarUrl}
                            size={44}
                            isLive={stream.status === 'live'}
                            isVerified={stream.creator.isVerified}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="clamp-1 text-[14px] font-semibold text-white">{stream.creator.displayName}</p>
                            <p className="data text-[11.5px] text-white/45">@{stream.creator.handle}</p>
                          </div>
                          {stream.status === 'live' ? <Pill tone="green">Live</Pill> : null}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Link to={`/seller/${stream.creator.handle}`} className="flex-1">
                            <Button size="sm" variant="navy" full>
                              Visit shop
                            </Button>
                          </Link>
                          {stream.status === 'live' ? (
                            <Link to={`/stream/${stream.id}`} className="flex-1">
                              <Button size="sm" variant="green" full>
                                Join
                              </Button>
                            </Link>
                          ) : null}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : null}

              {resultingLots.length ? (
                <div>
                  <SectionHeader eyebrow={`${resultingLots.length} lots`} title="Matching lots" />
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {resultingLots.map((auction) => (
                      <AuctionCard key={auction.id} auction={auction} size="lg" />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : (
        <div>
          <SectionHeader
            eyebrow="Creators to follow"
            title="Popular shops right now"
            action={
              <Link to="/creators" className="text-[13px] font-semibold" style={{ color: 'var(--mm-gold)' }}>
                See all →
              </Link>
            }
          />
          <div className="rail">
            {suggestedCreators.map((stream) => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Pill tone="gold">
              <GavelIcon size={11} /> {auctions.data?.total ?? 0} lots indexed
            </Pill>
            <Pill tone="green">
              <UsersIcon size={11} /> {streams.data?.total ?? 0} creators
            </Pill>
            <Pill>
              <SparkIcon size={11} /> autocomplete + similarity recommendations
            </Pill>
          </div>
        </div>
      )}
    </Section>
  );
}
