/**
 * Notifications — blueprint §5.2 Notifications screen.
 * Categorised tabs (Bids / Streams / Orders / System) with per-tab unread counts,
 * "mark all read", relative ages, and deep links into the relevant screen.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader, Section } from '@/components/site-shell';
import { Button, Card, EmptyState, Pill, Skeleton, StatBlock } from '@/components/ui';
import { BellIcon, CheckIcon, GavelIcon, StoreIcon, UsersIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { useNotifications } from '@/lib/hooks';
import { formatAge } from '@/lib/format';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'bids', label: 'Bids' },
  { value: 'streams', label: 'Streams' },
  { value: 'orders', label: 'Orders' },
  { value: 'system', label: 'System' },
] as const;

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  bids: <GavelIcon size={15} />,
  streams: <UsersIcon size={15} />,
  orders: <StoreIcon size={15} />,
  system: <BellIcon size={15} />,
};

export default function NotificationsPage() {
  const notifications = useNotifications();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string>('all');

  const items = useMemo(() => {
    const list = notifications.data?.items ?? [];
    return tab === 'all' ? list : list.filter((entry) => entry.category === tab);
  }, [notifications.data, tab]);

  const markAll = async () => {
    await api.markRead({});
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const markOne = async (id: string) => {
    await api.markRead({ id });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const unread = notifications.data?.unread ?? 0;

  return (
    <Section>
      <PageHeader
        eyebrow="Notifications"
        title="Everything that needs your attention"
        subtitle="Deep-linked: tapping an outbid alert opens the lot, a stream alert opens the room, an order alert opens the order."
        action={
          <Button variant="navy" onClick={() => void markAll()} disabled={!unread} icon={<CheckIcon size={15} />}>
            Mark all read
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Unread" value={unread} tone="gold" icon={<BellIcon size={15} />} />
        <StatBlock label="Bid alerts" value={notifications.data?.byCategory.bids ?? 0} hint="Outbid and winning" />
        <StatBlock label="Stream alerts" value={notifications.data?.byCategory.streams ?? 0} hint="Creators going live" tone="green" />
        <StatBlock label="Order updates" value={notifications.data?.byCategory.orders ?? 0} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((entry) => {
          const count =
            entry.value === 'all'
              ? notifications.data?.items.length ?? 0
              : notifications.data?.byCategory[entry.value] ?? 0;
          return (
            <button
              key={entry.value}
              type="button"
              onClick={() => setTab(entry.value)}
              className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-all"
              style={{
                borderColor: tab === entry.value ? 'transparent' : 'rgba(255,255,255,0.1)',
                background: tab === entry.value ? 'var(--mm-gradient-gold)' : 'rgba(255,255,255,0.035)',
                color: tab === entry.value ? '#0D1B2A' : 'rgba(255,255,255,0.72)',
              }}
            >
              {entry.label}
              <span className="data text-[11px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {notifications.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <EmptyState
          title="Nothing in this category"
          body="When a lot you follow closes, a creator goes live, or an order ships, it lands here."
          icon={<BellIcon size={22} />}
          action={
            <Link to="/live">
              <Button variant="gold">Browse live rooms</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((entry) => (
            <Card key={entry.id} className="p-4" interactive>
              <div className="flex items-start gap-3.5">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px]"
                  style={{
                    background: entry.read ? 'rgba(255,255,255,0.05)' : 'rgba(245,166,35,0.14)',
                    color: entry.read ? 'rgba(255,255,255,0.5)' : 'var(--mm-gold)',
                  }}
                >
                  {CATEGORY_ICON[entry.category] ?? <BellIcon size={15} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={entry.href}
                      className="text-[14px] font-semibold text-white transition-colors hover:text-[var(--mm-gold)]"
                    >
                      {entry.title}
                    </Link>
                    {!entry.read ? <Pill tone="gold">New</Pill> : null}
                    <span className="text-[11.5px] text-white/35">{formatAge(entry.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{entry.body}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link to={entry.href}>
                      <Button size="sm" variant="navy">
                        Open
                      </Button>
                    </Link>
                    {!entry.read ? (
                      <Button size="sm" variant="ghost" onClick={() => void markOne(entry.id)}>
                        Mark read
                      </Button>
                    ) : null}
                  </div>
                </div>

                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: entry.read ? 'rgba(255,255,255,0.16)' : 'var(--mm-gold)' }}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
