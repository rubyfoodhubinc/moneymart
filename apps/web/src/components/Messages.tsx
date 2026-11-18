/**
 * Owner console: messages to members (in-app inbox + iPhone push) and seller identity checks (Didit).
 * Reads and writes the API only; every send is audited on the server.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Pill } from '@/components/ui';
import { api, type NotifyInput } from '@/lib/api';

const muted = 'text-[12px] text-white/50';
const row = 'rounded-[11px] border border-white/8 p-3';
const rowBg = { background: 'rgba(255,255,255,0.02)' };
const field = 'w-full rounded-[11px] border border-white/10 bg-transparent px-3 py-2 text-[13px] text-white outline-none focus:border-[var(--mm-gold-line)]';
const AUDIENCE_LABEL: Record<string, string> = {
  everyone: 'Everyone',
  buyers: 'Buyers',
  sellers: 'Sellers',
  verified_sellers: 'Verified sellers',
  pro: 'Pro members',
};
const audienceLabel = (a: string) => AUDIENCE_LABEL[a] ?? (a.startsWith('member:') ? `@${a.slice(7)}` : a);

export function MessagesPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'notify'], queryFn: api.adminNotify });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('everyone');
  const [handle, setHandle] = useState('');
  const [kind, setKind] = useState<NotifyInput['kind']>('announcement');
  const [href, setHref] = useState('');
  const [confirming, setConfirming] = useState(false);
  const input: NotifyInput = { title, body, kind, audience: audience === 'member' ? `member:${handle.replace(/^@/, '')}` : audience, href: href || undefined };

  const preview = useMutation({ mutationFn: () => api.previewNotify(input) });
  const send = useMutation({
    mutationFn: () => api.sendNotify(input),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setHref('');
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['admin', 'notify'] });
      qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });
  useEffect(() => setConfirming(false), [title, body, audience, handle, kind, href]);

  if (!q.data) return <p className={q.isError ? 'text-[12.5px] text-[var(--mm-error)]' : muted}>{q.isError ? 'Could not load this panel.' : 'Loading…'}</p>;
  const { delivery, audiences, history } = q.data;
  const ready = title.trim() && body.trim() && (audience !== 'member' || handle.trim());

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <Card className="p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-[16px] text-white">Message members</h3>
          <Pill tone={delivery.push ? 'green' : 'neutral'}>{delivery.push ? `iPhone push on · ${delivery.devices} phones` : 'Inbox only (push keys not set)'}</Pill>
        </div>
        <p className="mb-4 text-[11.5px] text-white/45">
          Lands in each member's Notifications, and on their iPhone when push is on. Offers respect each member's “News and offers” switch.
        </p>
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <select aria-label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)} className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[var(--mm-surface,#0b1220)] px-2.5 py-2 text-[12.5px] text-white">
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {audienceLabel(a.id)} ({a.count})
                </option>
              ))}
              <option value="member">One member…</option>
            </select>
            <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as NotifyInput['kind'])} className="rounded-[10px] border border-white/10 bg-[var(--mm-surface,#0b1220)] px-2.5 py-2 text-[12.5px] text-white">
              <option value="announcement">Announcement</option>
              <option value="marketing">Offer (opt-out respected)</option>
            </select>
          </div>
          {audience === 'member' && <input aria-label="Member handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle or email" className={field} />}
          <input aria-label="Title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={field} />
          <textarea aria-label="Message" value={body} maxLength={600} rows={4} onChange={(e) => setBody(e.target.value)} placeholder="Message" className={`${field} resize-none`} />
          <input aria-label="Link" value={href} onChange={(e) => setHref(e.target.value)} placeholder="Optional app link, e.g. /stream/abc123" className={field} />
          <div className="flex flex-wrap items-center gap-2">
            {!confirming ? (
              <Button
                disabled={!ready}
                loading={preview.isPending}
                onClick={() => preview.mutate(undefined, { onSuccess: (r) => r.ok && setConfirming(true) })}
              >
                Review
              </Button>
            ) : (
              <>
                <Button variant="green" loading={send.isPending} onClick={() => send.mutate()}>
                  Send to {preview.data?.recipients ?? 0} {preview.data?.recipients === 1 ? 'member' : 'members'}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Edit
                </Button>
              </>
            )}
            <span className="text-[11.5px] text-white/45">{body.length}/600</span>
          </div>
          {preview.data?.problem && <p className="text-[12px] text-[var(--mm-error)]">{preview.data.problem}</p>}
          {send.isError && <p className="text-[12px] text-[var(--mm-error)]">{(send.error as Error).message}</p>}
          {send.isSuccess && <p className="text-[12px] text-[var(--mm-green,#3ecf8e)]">Sent to {send.data.broadcast.recipients} members.</p>}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 text-[16px] text-white">Sent</h3>
        {history.length ? (
          <ul className="space-y-2">
            {history.map((b) => (
              <li key={b.id} className={row} style={rowBg}>
                <div className="flex items-center justify-between gap-2">
                  <span className="clamp-1 text-[13px] text-white">{b.title}</span>
                  <Pill tone={b.kind === 'marketing' ? 'gold' : 'navy'}>{audienceLabel(b.audience)}</Pill>
                </div>
                <p className="clamp-2 mt-1 text-[12px] text-white/60">{b.body}</p>
                <p className="mt-1 text-[11px] text-white/40">
                  {new Date(b.createdAt).toLocaleString()} · {b.recipients} members{b.pushed ? ` · ${b.pushed} phones` : ''} · {b.by}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={muted}>Nothing sent yet. Automatic alerts (outbid, live, won, sold, paid, shipped, verification) go out on their own.</p>
        )}
      </Card>
    </div>
  );
}

const STATUS_TONE: Record<string, 'green' | 'gold' | 'error' | 'neutral'> = { verified: 'green', pending: 'gold', rejected: 'error' };

export function SellerChecksPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'verifications'], queryFn: api.adminVerifications, refetchInterval: 30_000 });
  const toggle = useMutation({
    mutationFn: (value: boolean) => api.saveAdminSettings([{ key: 'sellers.verification_required', value }]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'verifications'] });
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });
  if (!q.data) return <p className={q.isError ? 'text-[12.5px] text-[var(--mm-error)]' : muted}>{q.isError ? 'Could not load this panel.' : 'Loading…'}</p>;
  const { configured, required, rows } = q.data;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
      <Card className="p-5">
        <h3 className="mb-1 text-[16px] text-white">Identity checks (Didit)</h3>
        <p className="mb-3 text-[11.5px] text-white/45">Documents and selfies go to Didit. MoneyMart keeps only the outcome.</p>
        <ul className="space-y-2">
          {[
            ['Person checks (KYC)', configured.person],
            ['Business checks (KYB)', configured.business],
            ['Webhook (DIDIT_WEBHOOK_SECRET)', configured.webhook],
          ].map(([label, on]) => (
            <li key={String(label)} className={`${row} flex items-center justify-between`} style={rowBg}>
              <span className="text-[12.5px] text-white/90">{label}</span>
              <Pill tone={on ? 'green' : 'neutral'}>{on ? 'Connected' : 'Not set'}</Pill>
            </li>
          ))}
        </ul>
        {!configured.webhook && (
          <p className="mt-2 text-[11.5px] text-white/45">Without the webhook, results still arrive when the member returns to the app.</p>
        )}
        <div className={`${row} mt-4 flex items-center justify-between gap-3`} style={rowBg}>
          <div>
            <p className="text-[13px] text-white">Verified sellers only</p>
            <p className="text-[11.5px] text-white/45">Sellers must pass a check before scheduling shows.</p>
          </div>
          <Button size="sm" variant={required ? 'green' : 'ghost'} loading={toggle.isPending} onClick={() => toggle.mutate(!required)}>
            {required ? 'On' : 'Off'}
          </Button>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 text-[16px] text-white">Checks</h3>
        {rows.length ? (
          <div className="overflow-x-auto rounded-[12px] border border-white/8">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {['Member', 'Type', 'Status', 'Started', 'Decided'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-white/60">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-t" style={{ borderColor: 'var(--mm-divider)' }}>
                    <td className="px-3 py-2 text-white/85">
                      {r.name} <span className="text-white/45">@{r.handle}</span>
                    </td>
                    <td className="px-3 py-2 text-white/70">{r.kind === 'business' ? 'Business' : 'Person'}</td>
                    <td className="px-3 py-2">
                      <Pill tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.providerStatus}</Pill>
                      {r.reason && <span className="ml-2 text-white/45">{r.reason}</span>}
                    </td>
                    <td className="data whitespace-nowrap px-3 py-2 text-white/55">{new Date(r.startedAt).toLocaleDateString()}</td>
                    <td className="data whitespace-nowrap px-3 py-2 text-white/55">{r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={muted}>No checks yet. Sellers start one in the app under Profile › Verification.</p>
        )}
      </Card>
    </div>
  );
}
