/**
 * Live streams — blueprint §8.2 `/live`.
 * 3-column desktop, 2-column tablet, 1-column mobile; category filter + search;
 * embedded stream player modal.
 */

import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { categories } from '@moneymart/tokens';
import { StreamCard } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import { Button, CategoryChip, EmptyState, LiveBadge, Pill, Skeleton, StatBlock } from '@/components/ui';
import { GavelIcon, LiveDot, SearchIcon, UsersIcon } from '@/components/icons';
import { useStreams } from '@/lib/hooks';
import { formatViewers } from '@/lib/format';

export default function LivePage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const streams = useStreams();

  const items = streams.data?.items ?? [];
  const filtered = useMemo(
    () =>
      items.filter((stream) => {
        if (category && stream.category !== category) return false;
        if (query) {
          const needle = query.toLowerCase();
          return (
            stream.title.toLowerCase().includes(needle) ||
            stream.creator.displayName.toLowerCase().includes(needle)
          );
        }
        return true;
      }),
    [items, category, query],
  );

  const live = filtered.filter((stream) => stream.status === 'live');
  const scheduled = filtered.filter((stream) => stream.status === 'scheduled');
  const ended = filtered.filter((stream) => stream.status === 'ended');
  const totalViewers = live.reduce((sum, stream) => sum + stream.viewerCount, 0);
  const previewStream = items.find((stream) => stream.id === preview);

  return (
    <Section>
      <PageHeader
        eyebrow="Live now"
        title="Creator streams & live auctions"
        subtitle="Real-time bidding rooms with chat, item drops and anti-snipe protection. Enter any room and bid from the browser."
        action={
          <div className="flex items-center gap-3">
            <Pill tone="green">
              <LiveDot size={7} />
              {live.length} live
            </Pill>
            <Pill>
              <UsersIcon size={12} />
              <span className="data">{formatViewers(totalViewers)}</span> watching
            </Pill>
          </div>
        }
      />

      <div className="mb-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Live rooms" value={live.length} tone="green" icon={<LiveDot size={9} />} />
        <StatBlock label="Total viewers" value={formatViewers(totalViewers)} icon={<UsersIcon size={16} />} />
        <StatBlock
          label="Lots in play"
          value={live.reduce((sum, stream) => sum + stream.queuedCount, 0)}
          tone="gold"
          icon={<GavelIcon size={16} />}
        />
        <StatBlock label="Scheduled next" value={scheduled.length} hint="Set a reminder in-app" />
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
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
        <div className="flex h-11 items-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.035] px-3.5 lg:w-[300px]">
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search streams or creators…"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-white/35"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} className="text-[11px] text-white/45 hover:text-white">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {streams.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[300px] w-full" />
          ))}
        </div>
      ) : !live.length ? (
        <EmptyState
          title="No live rooms match that filter"
          body="Creators stream on a schedule. Check what is coming up next, or browse the auctions closing soon."
          icon={<LiveDot size={10} />}
          action={
            <div className="flex justify-center gap-3">
              <Link to="/auctions?status=ending">
                <Button variant="gold">Browse ending soon</Button>
              </Link>
              <Button variant="navy" onClick={() => { setCategory(''); setQuery(''); }}>
                Reset filters
              </Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {live.map((stream) => (
            <div key={stream.id} className="[&>a]:w-full">
              <StreamCard stream={stream} />
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="navy" onClick={() => setPreview(stream.id)}>
                  Quick preview
                </Button>
                <Button size="sm" variant="gold" onClick={() => navigate(`/stream/${stream.id}`)}>
                  Enter room
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {scheduled.length ? (
        <div className="mt-14">
          <h2 className="mb-5 text-[22px] text-white">Scheduled next</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {scheduled.map((stream) => (
              <StreamCard key={stream.id} stream={stream} variant="wide" />
            ))}
          </div>
        </div>
      ) : null}

      {ended.length ? (
        <div className="mt-14">
          <h2 className="mb-5 text-[22px] text-white">Recently ended — replay & results</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {ended.map((stream) => (
              <StreamCard key={stream.id} stream={stream} variant="wide" />
            ))}
          </div>
        </div>
      ) : null}

      {/* Embedded player modal (§8.2: embedded stream player modal) */}
      {previewStream ? (
        <div
          className="fixed inset-0 z-[900] grid place-items-center p-4"
          style={{ background: 'rgba(7,15,24,0.82)', backdropFilter: 'blur(8px)' }}
          onClick={() => setPreview(null)}
        >
          <div
            className="animate-scale-in w-full max-w-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="card-surface overflow-hidden">
              <div className="relative aspect-video">
                                <img
                  src={previewStream.activeAuction?.item.images[0] ?? previewStream.posterUrl}
                  alt={previewStream.title}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(7,15,24,0.45)' }}>
                  <div className="text-center">
                    <p className="mb-3 text-[13px] text-white/70">HLS adaptive preview · Mux playback SDK</p>
                    <Link to={`/stream/${previewStream.id}`}>
                      <Button variant="gold" size="lg" icon={<LiveDot size={9} />}>
                        Enter full room
                      </Button>
                    </Link>
                  </div>
                </div>
                <span className="absolute left-4 top-4">
                  <LiveBadge viewers={previewStream.viewerCount} />
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 p-4">
                <div>
                  <p className="text-[14px] font-semibold text-white">{previewStream.title}</p>
                  <p className="text-[12.5px] text-white/55">{previewStream.creator.displayName}</p>
                </div>
                <Button variant="navy" size="sm" onClick={() => setPreview(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
