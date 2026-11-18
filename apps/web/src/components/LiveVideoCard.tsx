/**
 * Admin › Live video. Picks which service new shows broadcast on and whether the
 * other one takes over automatically when it fails. Shows already live keep
 * their service, so switching never cuts a broadcast off.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Pill } from '@/components/ui';
import { api, type LiveVideoProviderId, type LiveVideoStatus } from '@/lib/api';

const REASONS: Record<string, string> = {
  not_configured: 'not configured',
  timeout: 'timed out',
  unreachable: 'unreachable',
  host_requested: 'moved by the host',
};

export function LiveVideoCard() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['admin', 'live-video'], queryFn: api.liveVideoStatus, refetchInterval: 15_000 });
  const update = useMutation({
    mutationFn: api.setLiveVideo,
    onSuccess: (next) => queryClient.setQueryData<LiveVideoStatus>(['admin', 'live-video'], next),
  });

  const data = status.data;
  const choose = (primary: LiveVideoProviderId) => update.mutate({ primary });

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[16px] text-white">Live video</h3>
        <span className="text-[11.5px] text-white/40">Which service new shows broadcast on</span>
      </div>

      {status.isLoading && <p className="text-[12.5px] text-white/50">Loading…</p>}
      {status.isError && <p className="text-[12.5px] text-[var(--mm-error)]">Could not load the live video settings.</p>}

      {data && (
        <div className="space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.providers.map((provider) => {
              const active = provider.id === data.primary;
              const count = data.liveShows.filter((show) => show.provider === provider.id).length;
              return (
                <button
                  key={provider.id}
                  type="button"
                  disabled={!provider.configured || active || update.isPending}
                  onClick={() => choose(provider.id)}
                  className="rounded-[12px] border p-3.5 text-left transition-colors disabled:cursor-default"
                  style={{
                    borderColor: active ? 'var(--mm-gold)' : 'rgba(255,255,255,0.08)',
                    background: active ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.02)',
                    opacity: provider.configured ? 1 : 0.55,
                  }}
                  aria-pressed={active}
                >
                  <span className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-white">{provider.label}</span>
                    {active ? <Pill tone="gold">Primary</Pill> : data.autoFallback && provider.configured ? <Pill tone="navy">Backup</Pill> : null}
                  </span>
                  <span className="block text-[11.5px] text-white/55">
                    {provider.configured ? `${count} show${count === 1 ? '' : 's'} live now` : 'No credentials on the server'}
                  </span>
                  {!active && provider.configured && <span className="mt-2 block text-[11.5px] font-medium text-[var(--mm-gold)]">Make primary</span>}
                </button>
              );
            })}
          </div>

          <label className="flex items-center justify-between gap-3 rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <span>
              <span className="block text-[13px] font-medium text-white/90">Automatic backup</span>
              <span className="block text-[11.5px] text-white/50">If the primary can’t open a show, use the other service.</span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--mm-gold)]"
              checked={data.autoFallback}
              disabled={update.isPending}
              onChange={(event) => update.mutate({ autoFallback: event.target.checked })}
            />
          </label>

          {data.lastFailover && (
            <p className="text-[11.5px] text-white/55">
              Last failover: {new Date(data.lastFailover.at).toLocaleString()} — {labelOf(data, data.lastFailover.from)} → {labelOf(data, data.lastFailover.to)} (
              {REASONS[data.lastFailover.reason] ?? data.lastFailover.reason}).
            </p>
          )}
          {update.isError && <p className="text-[12px] text-[var(--mm-error)]">{(update.error as Error).message}</p>}
          <p className="text-[11px] text-white/40">Shows already live keep their service. Switching affects shows that start from now.</p>
          {data.updatedBy && (
            <p className="text-[11px] text-white/35">
              Changed {data.updatedAt ? new Date(data.updatedAt).toLocaleString() : ''} by {data.updatedByName ?? data.updatedBy}
            </p>
          )}
          <Button size="sm" variant="navy" onClick={() => void status.refetch()} loading={status.isFetching}>
            Refresh
          </Button>
        </div>
      )}
    </Card>
  );
}

function labelOf(data: LiveVideoStatus, id: LiveVideoProviderId) {
  return data.providers.find((provider) => provider.id === id)?.label ?? id;
}
