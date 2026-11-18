/**
 * Owner console: countries open for buying and selling, today's exchange rates, and members' safety reports.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Pill } from '@/components/ui';
import { api } from '@/lib/api';

const muted = 'text-[12px] text-white/50';
const row = 'rounded-[11px] border border-white/8 p-3';
const rowBg = { background: 'rgba(255,255,255,0.02)' };
const loading = (isError: boolean) => <p className={isError ? 'text-[12.5px] text-[var(--mm-error)]' : muted}>{isError ? 'Could not load this panel.' : 'Loading…'}</p>;

export function CountriesPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'markets'], queryFn: api.adminMarkets });
  const save = useMutation({
    mutationFn: (change: Record<string, { buy?: boolean; sell?: boolean }>) => api.saveMarkets(change),
    onSuccess: (data) => {
      qc.setQueryData(['admin', 'markets'], (old: typeof q.data) => ({ ...(old ?? data), ...data }));
      qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
  if (!q.data) return loading(q.isError);
  const { countries, usdPerUnit, ratesUpdatedAt, ratesSource, members } = q.data;
  const toggle = (code: string, field: 'buy' | 'sell', value: boolean) => save.mutate({ [code]: { [field]: value } });

  return (
    <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
      <Card className="p-5">
        <h3 className="mb-1 text-[16px] text-white">Countries</h3>
        <p className="mb-3 text-[11.5px] text-white/45">
          Buying: members there can bid and buy, and we ship there. Selling: members there can set up a shop, list and host shows. Changes apply at once and are audited.
        </p>
        <div className="overflow-x-auto rounded-[12px] border border-white/8">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                {['Country', 'Currency', 'Members', 'Buying', 'Selling'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-white/60">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.code} className="border-t" style={{ borderColor: 'var(--mm-divider)' }}>
                  <td className="px-3 py-2 text-white/90">{c.flag} {c.name}</td>
                  <td className="data px-3 py-2 text-white/60">{c.currency}</td>
                  <td className="data px-3 py-2 text-white/60">{members?.[c.code] ?? 0}</td>
                  {(['buy', 'sell'] as const).map((field) => (
                    <td key={field} className="px-3 py-2">
                      <Button size="sm" variant={c[field] ? 'green' : 'ghost'} disabled={save.isPending} onClick={() => toggle(c.code, field, !c[field])} aria-label={`${c.name} ${field === 'buy' ? 'buying' : 'selling'} ${c[field] ? 'open' : 'closed'}`}>
                        {c[field] ? 'Open' : 'Closed'}
                      </Button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {save.isError && <p className="mt-2 text-[12px] text-[var(--mm-error)]">{(save.error as Error).message}</p>}
      </Card>
      <Card className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[16px] text-white">Exchange rates</h3>
          <Pill tone={ratesSource === 'live' ? 'green' : 'neutral'}>{ratesSource === 'live' ? 'Live' : 'Built-in table'}</Pill>
        </div>
        <p className="mb-3 text-[11.5px] text-white/45">
          {ratesUpdatedAt ? `Updated ${new Date(ratesUpdatedAt).toLocaleString()} · refreshed every 6 hours.` : 'Live rates load on the production server.'} Buyers see “≈ in your currency”; they are charged in the seller’s currency.
        </p>
        <ul className="space-y-2">
          {Object.entries(usdPerUnit).filter(([code]) => code !== 'USD').map(([code, usd]) => (
            <li key={code} className={`${row} flex items-center justify-between`} style={rowBg}>
              <span className="text-[12.5px] text-white/90">1 USD</span>
              <span className="data text-[12.5px] text-white/70">{usd ? (1 / usd).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'} {code}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function ReportsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'reports'], queryFn: api.adminReports, refetchInterval: 30_000 });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'actioned' | 'dismissed' | 'open' }) => api.resolveReport(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });
  if (!q.data) return loading(q.isError);
  const open = q.data.items.filter((r) => r.status === 'open');
  const done = q.data.items.filter((r) => r.status !== 'open').slice(0, 40);
  const item = (r: (typeof q.data.items)[number]) => (
    <li key={r.id} className={row} style={rowBg}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-white">{r.target}</span>
        <Pill tone={r.status === 'open' ? 'gold' : r.status === 'actioned' ? 'green' : 'neutral'}>{r.kind} · {r.reason}</Pill>
      </div>
      {r.note && <p className="mt-1 text-[12px] text-white/60">“{r.note}”</p>}
      <p className="mt-1 text-[11px] text-white/40">Reported by {r.reporter} · {new Date(r.createdAt).toLocaleString()}</p>
      {r.status === 'open' ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="green" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.status === 'actioned'} onClick={() => decide.mutate({ id: r.id, status: 'actioned' })}>Actioned</Button>
          <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, status: 'dismissed' })}>Dismiss</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => decide.mutate({ id: r.id, status: 'open' })}>Reopen</Button>
      )}
    </li>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 text-[16px] text-white">Open reports ({open.length})</h3>
        {open.length ? <ul className="space-y-2">{open.map(item)}</ul> : <p className={muted}>No open reports.</p>}
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 text-[16px] text-white">Closed</h3>
        {done.length ? <ul className="space-y-2">{done.map(item)}</ul> : <p className={muted}>Nothing closed yet.</p>}
      </Card>
    </div>
  );
}
