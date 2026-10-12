/**
 * Creators — blueprint §8.2 `/creators` and §3.2 multi-country strategy.
 * Every creator with a live room, their reach, and a direct route into the shop.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StreamCard } from '@/components/auction';
import { PageHeader, Section } from '@/components/site-shell';
import { Avatar, Button, Card, EmptyState, Pill, Skeleton, StatBlock } from '@/components/ui';
import { GlobeIcon, LiveDot, SearchIcon, SparkIcon, UsersIcon, GavelIcon } from '@/components/icons';
import { useStreams } from '@/lib/hooks';
import { formatMoney, formatViewers } from '@/lib/format';

export default function CreatorsPage() {
  const streams = useStreams();
  const [query, setQuery] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);

  const creators = useMemo(() => {
    const list = streams.data?.items ?? [];
    const seen = new Map<string, (typeof list)[number]>();
    list.forEach((stream) => {
      const existing = seen.get(stream.creatorId);
      if (!existing || (stream.status === 'live' && existing.status !== 'live')) seen.set(stream.creatorId, stream);
    });
    let result = [...seen.values()];
    if (liveOnly) result = result.filter((stream) => stream.status === 'live');
    if (query) {
      const needle = query.toLowerCase();
      result = result.filter(
        (stream) =>
          stream.creator.displayName.toLowerCase().includes(needle) ||
          stream.creator.handle.toLowerCase().includes(needle),
      );
    }
    return result.sort((a, b) => b.viewerCount - a.viewerCount);
  }, [streams.data, liveOnly, query]);

  const totalViewers = creators.reduce((sum, stream) => sum + stream.viewerCount, 0);

  return (
    <Section>
      <PageHeader
        eyebrow="Creators"
        title="The people running the room"
        subtitle="MoneyMart creators keep 85% of live-stream GMV. Every shop is built in Studio, streams on schedule, and ships with escrow protection."
        action={
          <Link to="/sell">
            <Button variant="gold" icon={<SparkIcon size={15} />}>
              Become a creator
            </Button>
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Creators" value={creators.length} tone="gold" icon={<SparkIcon size={15} />} />
        <StatBlock label="Live now" value={creators.filter((s) => s.status === 'live').length} tone="green" icon={<LiveDot size={9} />} />
        <StatBlock label="Combined audience" value={formatViewers(totalViewers)} icon={<UsersIcon size={15} />} />
        <StatBlock label="Revenue split" value="85 / 15" hint="Creator / platform on live GMV" icon={<GavelIcon size={15} />} />
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-11 flex-1 items-center gap-2.5 rounded-[12px] border border-white/10 bg-white/[0.035] px-4">
          <SearchIcon size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search creators by name or handle…"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-white/35"
          />
        </div>
        <Button variant={liveOnly ? 'green' : 'navy'} onClick={() => setLiveOnly((value) => !value)}>
          {liveOnly ? 'Showing live only' : 'Show live only'}
        </Button>
      </div>

      {streams.isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[220px] w-full" />
          ))}
        </div>
      ) : !creators.length ? (
        <EmptyState
          title="No creators match that search"
          body="Try a different name, or clear the live-only filter."
          action={
            <Button
              variant="gold"
              onClick={() => {
                setQuery('');
                setLiveOnly(false);
              }}
            >
              Reset
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {creators.map((stream) => (
            <Card key={stream.creatorId} interactive className="p-5">
              <div className="flex items-start gap-3.5">
                <Avatar
                  name={stream.creator.displayName}
                  src={stream.creator.avatarUrl}
                  size={54}
                  isLive={stream.status === 'live'}
                  isVerified={stream.creator.isVerified}
                />
                <div className="min-w-0 flex-1">
                  <h3 className="clamp-1 text-[15.5px] font-semibold text-white">{stream.creator.displayName}</h3>
                  <p className="data text-[12px] text-white/45">@{stream.creator.handle}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {stream.status === 'live' ? <Pill tone="green">Live</Pill> : <Pill>Offline</Pill>}
                    <Pill>
                      <GlobeIcon size={10} /> {stream.creator.countryCode}
                    </Pill>
                  </div>
                </div>
              </div>

              {stream.creator.bio ? (
                <p className="clamp-2 mt-3.5 text-[12.5px] leading-relaxed text-white/55">{stream.creator.bio}</p>
              ) : null}

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Metric label="Sales" value={stream.creator.totalSales.toLocaleString()} />
                <Metric label="Followers" value={formatViewers(stream.creator.followersCount)} />
                <Metric label="Rating" value={`${stream.creator.rating.toFixed(1)} ★`} />
              </div>

              {stream.status === 'live' ? (
                <div className="mt-4 flex items-center justify-between rounded-[11px] border p-2.5" style={{ borderColor: 'rgba(0,212,161,0.3)', background: 'rgba(0,212,161,0.08)' }}>
                  <span className="min-w-0">
                    <span className="clamp-1 block text-[12.5px] font-medium text-white/90">{stream.title}</span>
                    <span className="data block text-[11.5px]" style={{ color: 'var(--mm-green)' }}>
                      {formatViewers(stream.viewerCount)} watching · {formatMoney(stream.totalGMV, 'USD', { compact: true })} GMV
                    </span>
                  </span>
                  <Link to={`/stream/${stream.id}`}>
                    <Button size="sm" variant="green">
                      Join
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="mt-4 flex gap-2">
                  <Link to={`/seller/${stream.creator.handle}`} className="flex-1">
                    <Button size="sm" variant="navy" full>
                      Visit shop
                    </Button>
                  </Link>
                  <Link to={`/seller/${stream.creator.handle}`} className="flex-1">
                    <Button size="sm" variant="outline" full>
                      Follow
                    </Button>
                  </Link>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="mt-14">
        <h2 className="mb-5 text-[22px] text-white">Scheduled next</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {(streams.data?.items ?? [])
            .filter((stream) => stream.status === 'scheduled')
            .map((stream) => (
              <StreamCard key={stream.id} stream={stream} variant="wide" />
            ))}
          {!(streams.data?.items ?? []).some((stream) => stream.status === 'scheduled') ? (
            <p className="text-[13px] text-white/45">No streams scheduled yet — check the live rooms instead.</p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/8 py-2" style={{ background: 'rgba(255,255,255,0.025)' }}>
      <p className="data text-[13.5px] font-semibold text-white/90">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
    </div>
  );
}
