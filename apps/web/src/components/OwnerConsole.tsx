/**
 * Owner console panels: real numbers, President Ore's office (chat, approvals, reports, members' requests, staff),
 * console settings, providers & AI cost, and the audit log. Every panel reads the API; nothing here is mock data.
 * Follows docs/standards (AI Company Standard v1.0).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Pill, StatBlock } from '@/components/ui';
import { ChartIcon, CheckIcon, SparkIcon, TrendIcon, UsersIcon } from '@/components/icons';
import { api, type ConsoleSetting, type PresPost, type PresStaff } from '@/lib/api';
import { formatMoney } from '@/lib/format';

const muted = 'text-[12px] text-white/50';
const row = 'rounded-[11px] border border-white/8 p-3';
const rowBg = { background: 'rgba(255,255,255,0.02)' };

function change(now: number, before: number): string | undefined {
  if (!before) return undefined;
  const p = Math.round(((now - before) / before) * 100);
  return `${p >= 0 ? '+' : ''}${p}% vs the period before`;
}

function Loading({ error }: { error?: boolean }) {
  return <p className={error ? 'text-[12.5px] text-[var(--mm-error)]' : muted}>{error ? 'Could not load this panel.' : 'Loading…'}</p>;
}

/* ── Overview ── */

export function OverviewStrip() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: api.adminOverview, refetchInterval: 60_000 });
  if (!q.data) return <Loading error={q.isError} />;
  const w = q.data.week;
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatBlock label="Sales, 7 days" value={formatMoney(w.now.gmv, 'USD', { compact: true })} hint={change(w.now.gmv, w.previous.gmv) ?? `${w.now.orders} orders`} tone="gold" icon={<ChartIcon size={15} />} />
      <StatBlock label="Buyer's premium, 7 days" value={formatMoney(w.now.buyersPremium, 'USD', { compact: true })} hint={`AI cost ${formatMoney(w.aiCost.usd, 'USD')} · ${w.aiCost.calls} calls`} tone="green" icon={<TrendIcon size={15} />} />
      <StatBlock label="Members" value={w.members} hint={`${w.newMembers} new · ${w.sellers} sellers`} icon={<UsersIcon size={15} />} />
      <StatBlock label="Waiting for you" value={q.data.approvalsWaiting} hint={`${w.liveShows} live · ${w.scheduledShows} scheduled shows`} icon={<SparkIcon size={15} />} />
    </div>
  );
}

/* ── President's office ── */

const KIND_LABEL: Record<string, string> = {
  draft_change: 'Change',
  draft_directive: 'Directive to every Ore',
  draft_member_message: 'Message to members',
  draft_post: 'Social post',
  draft_ad: 'Ad',
  report: 'Report',
  request: 'Member request',
  alert: 'Alert',
};

function ApprovalItem({ post, staff }: { post: PresPost; staff: PresStaff[] }) {
  const client = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'deny') => api.decidePresident(post.id, decision),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const who = post.staffId ? staff.find((s) => s.id === post.staffId)?.name ?? 'Staff' : 'President';
  const audience = typeof post.meta.audience === 'string' ? ` · to ${post.meta.audience}` : '';
  const why = typeof post.meta.why === 'string' ? post.meta.why : '';
  return (
    <li className={row} style={rowBg}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Pill tone="gold">{KIND_LABEL[post.kind] ?? post.kind}</Pill>
        <span className="text-[11.5px] text-white/45">
          {who}
          {audience}
        </span>
      </div>
      <p className="text-[13px] font-medium text-white/90">{post.title}</p>
      <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/65">{post.body}</p>
      {why ? <p className="mt-1.5 text-[11.5px] text-white/45">Why: {why}</p> : null}
      {post.result ? <p className="mt-1.5 text-[11.5px] text-[var(--mm-error)]">{post.result}</p> : null}
      {decide.isError ? <p className="mt-1.5 text-[11.5px] text-[var(--mm-error)]">{(decide.error as Error).message}</p> : null}
      <div className="mt-2.5 flex gap-2">
        <Button size="sm" variant="green" icon={<CheckIcon size={13} />} loading={decide.isPending && decide.variables === 'approve'} onClick={() => decide.mutate('approve')}>
          Approve
        </Button>
        <Button size="sm" variant="ghost" loading={decide.isPending && decide.variables === 'deny'} onClick={() => decide.mutate('deny')}>
          Deny
        </Button>
      </div>
    </li>
  );
}

function PresidentChat({ name, configured }: { name: string; configured: boolean }) {
  const client = useQueryClient();
  const chat = useQuery({ queryKey: ['admin', 'president', 'chat'], queryFn: () => api.presidentChat('main') });
  const [text, setText] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (message: string) => api.askPresident(message),
    onMutate: (message) => setPending(message),
    onSettled: () => {
      setPending(null);
      void client.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const lines = chat.data?.lines ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines.length, pending]);

  const send = () => {
    const message = text.trim();
    if (!message || ask.isPending) return;
    setText('');
    ask.mutate(message);
  };

  const bubble = (role: 'owner' | 'president', body: ReactNode, key: string) => (
    <div key={key} className={`flex ${role === 'owner' ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-[12px] px-3.5 py-2.5 text-[13px] leading-relaxed"
        style={role === 'owner' ? { background: 'rgba(245,166,35,0.12)', color: 'rgba(255,255,255,0.92)' } : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.85)' }}
      >
        {body}
      </div>
    </div>
  );

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[16px] text-white">President {name}</h3>
        <Pill tone={configured ? 'green' : 'neutral'}>{configured ? 'On duty' : 'Needs a Claude key'}</Pill>
      </div>
      <div className="mb-3 max-h-[420px] min-h-[160px] space-y-2.5 overflow-y-auto pr-1">
        {!lines.length && !pending ? <p className={muted}>Ask for the numbers, give the team a task, or have her draft a change for you to approve.</p> : null}
        {lines.map((line) => bubble(line.role, line.text, line.id))}
        {pending ? bubble('owner', pending, 'pending') : null}
        {ask.isPending ? bubble('president', <span className="text-white/45">Working on it…</span>, 'thinking') : null}
        {ask.isError ? <p className="text-[12px] text-[var(--mm-error)]">{(ask.error as Error).message}</p> : null}
        <div ref={end} />
      </div>
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder={`Message President ${name}`}
          className="min-w-0 flex-1 resize-none rounded-[11px] border border-white/10 bg-transparent px-3 py-2 text-[13px] text-white outline-none focus:border-[var(--mm-gold-line)]"
        />
        <Button onClick={send} loading={ask.isPending} disabled={!text.trim()}>
          Send
        </Button>
      </div>
    </Card>
  );
}

export function PresidentPanel() {
  const client = useQueryClient();
  const office = useQuery({ queryKey: ['admin', 'president'], queryFn: api.president, refetchInterval: 30_000 });
  const briefing = useMutation({
    mutationFn: api.presidentBriefing,
    onSettled: () => void client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const [open, setOpen] = useState<string | null>(null);
  if (!office.data) return <Loading error={office.isError} />;
  const { name, configured, staff, approvals, reports, requests } = office.data;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
      <div className="flex flex-col gap-5">
        <PresidentChat name={name} configured={configured} />

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[16px] text-white">Waiting for your approval</h3>
            <Pill tone={approvals.length ? 'gold' : 'neutral'}>{approvals.length}</Pill>
          </div>
          {approvals.length ? (
            <ul className="space-y-2.5">
              {approvals.map((post) => (
                <ApprovalItem key={post.id} post={post} staff={staff} />
              ))}
            </ul>
          ) : (
            <p className={muted}>Nothing waiting. Drafts from the President and her team appear here; nothing happens until you approve it.</p>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[16px] text-white">Reports</h3>
            <Button size="sm" variant="navy" loading={briefing.isPending} onClick={() => briefing.mutate()}>
              Brief me now
            </Button>
          </div>
          {briefing.data ? <p className="mb-2 text-[11.5px] text-white/45">{briefing.data.emailed ? 'Briefing filed and emailed.' : 'Briefing filed (email not sent — owner email or Resend not set).'}</p> : null}
          {reports.length ? (
            <ul className="space-y-2">
              {reports.slice(0, 12).map((post) => (
                <li key={post.id} className={row} style={rowBg}>
                  <button type="button" className="w-full text-left" onClick={() => setOpen(open === post.id ? null : post.id)}>
                    <span className="block text-[12.5px] font-medium text-white/90">{post.title}</span>
                    <span className="block text-[11px] text-white/40">{new Date(post.createdAt).toLocaleString()}</span>
                  </button>
                  {open === post.id ? <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/70">{post.body}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={muted}>No reports yet. The daily briefing arrives here and by email.</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 text-[16px] text-white">What members are asking Ore for</h3>
          <p className="mb-3 text-[11.5px] text-white/45">Anonymous; the same request from several members is counted together.</p>
          {requests.length ? (
            <ul className="space-y-2">
              {[...requests]
                .sort((a, b) => Number(b.meta.votes ?? 1) - Number(a.meta.votes ?? 1))
                .slice(0, 15)
                .map((post) => (
                  <li key={post.id} className={`${row} flex items-start justify-between gap-3`} style={rowBg}>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-white/90">{post.title}</span>
                      {post.body ? <span className="clamp-2 block text-[11.5px] text-white/50">{post.body}</span> : null}
                    </span>
                    <Pill tone="navy">{Number(post.meta.votes ?? 1)}</Pill>
                  </li>
                ))}
            </ul>
          ) : (
            <p className={muted}>No requests yet.</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-[16px] text-white">The team</h3>
          <ul className="space-y-2">
            {staff.map((member) => (
              <li key={member.id} className={row} style={rowBg}>
                <span className="block text-[12.5px] font-medium text-white/90">
                  {member.name} <span className="text-white/45">· {member.title}</span>
                </span>
                <span className="block text-[11.5px] text-white/50">{member.role}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/* ── Settings ── */

function SettingRow({ setting, owner }: { setting: ConsoleSetting; owner: boolean }) {
  const client = useQueryClient();
  const isObject = typeof setting.defaultValue === 'object' && setting.defaultValue !== null;
  const [draft, setDraft] = useState(() => (isObject ? JSON.stringify(setting.value, null, 2) : String(setting.value ?? '')));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (value: unknown) => api.saveAdminSettings([{ key: setting.key, value }]),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (e) => setError((e as Error).message),
  });
  const locked = setting.key.startsWith('ai.') && !owner;

  if (typeof setting.defaultValue === 'boolean') {
    const on = Boolean(setting.value);
    return (
      <li>
        <button type="button" disabled={save.isPending} onClick={() => save.mutate(!on)} className={`${row} flex w-full items-center justify-between gap-4 text-left`} style={rowBg}>
          <span className="block text-[12.5px] font-medium text-white/90">{setting.label}</span>
          <span className="relative h-[20px] w-[36px] shrink-0 rounded-full transition-colors" style={{ background: on ? 'var(--mm-green)' : 'rgba(255,255,255,0.14)' }}>
            <span className="absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all" style={{ left: on ? 19 : 3 }} />
          </span>
        </button>
        {error ? <p className="mt-1 text-[11.5px] text-[var(--mm-error)]">{error}</p> : null}
      </li>
    );
  }

  const parse = (): unknown => {
    if (isObject) return JSON.parse(draft || 'null');
    if (typeof setting.defaultValue === 'number') return Number(draft);
    return draft;
  };
  return (
    <li className={row} style={rowBg}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-white/90">{setting.label}</span>
      <div className="flex items-start gap-2">
        {isObject ? (
          <textarea value={draft} disabled={locked} onChange={(e) => setDraft(e.target.value)} rows={4} className="data min-w-0 flex-1 rounded-[9px] border border-white/10 bg-transparent px-2.5 py-1.5 text-[12px] text-white outline-none" />
        ) : (
          <input value={draft} disabled={locked} onChange={(e) => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-[9px] border border-white/10 bg-transparent px-2.5 py-1.5 text-[12.5px] text-white outline-none" />
        )}
        <Button
          size="sm"
          variant="navy"
          disabled={locked}
          loading={save.isPending}
          onClick={() => {
            try {
              save.mutate(parse());
            } catch {
              setError('That is not valid JSON.');
            }
          }}
        >
          Save
        </Button>
      </div>
      {locked ? <p className="mt-1 text-[11px] text-white/40">Owner only.</p> : null}
      {error ? <p className="mt-1 text-[11.5px] text-[var(--mm-error)]">{error}</p> : null}
    </li>
  );
}

export function SettingsPanel({ owner }: { owner: boolean }) {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: api.adminSettings });
  if (!q.data) return <Loading error={q.isError} />;
  const groups = [...new Set(q.data.settings.map((s) => s.group))];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {groups.map((group) => (
        <Card key={group} className="p-5">
          <h3 className="mb-3 text-[16px] capitalize text-white">{group === 'ai' ? 'AI models, prices & budgets' : group}</h3>
          <ul className="space-y-2">
            {q.data.settings
              .filter((s) => s.group === group)
              .map((s) => (
                <SettingRow key={`${s.key}:${JSON.stringify(s.value)}`} setting={s} owner={owner} />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

/* ── Providers & AI cost ── */

export function ProvidersPanel() {
  const q = useQuery({ queryKey: ['admin', 'providers'], queryFn: api.adminProviders });
  if (!q.data) return <Loading error={q.isError} />;
  const { ai, seats, cost30d } = q.data;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-1 text-[16px] text-white">Providers</h3>
        <p className="mb-3 text-[11.5px] text-white/45">Whether each key is on the server. Keys are never shown.</p>
        <ul className="space-y-2">
          {ai.map((p) => (
            <li key={p.id} className={`${row} flex items-center justify-between`} style={rowBg}>
              <span className="text-[12.5px] text-white/90">{p.label}</span>
              <Pill tone={p.configured ? 'green' : 'neutral'}>{p.configured ? 'Connected' : 'Not set'}</Pill>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h3 className="mb-1 text-[16px] text-white">AI seats & cost</h3>
        <p className="mb-3 text-[11.5px] text-white/45">
          Last 30 days: {formatMoney(cost30d.usd, 'USD')} over {cost30d.calls} calls
          {cost30d.unpriced.length ? ` · no price set for ${cost30d.unpriced.join(', ')}` : ''}. Change models in Settings › AI.
        </p>
        <ul className="space-y-2">
          {seats.map((s) => (
            <li key={s.name} className={`${row} flex items-center justify-between gap-3`} style={rowBg}>
              <span className="text-[12.5px] capitalize text-white/90">{s.name}</span>
              <span className="data text-right text-[11.5px] text-white/55">
                {s.provider} · {s.model}
                {s.backup ? ` → ${s.backup}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ── Audit ── */

export function AuditPanel() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.adminAudit(200) });
  if (!q.data) return <Loading error={q.isError} />;
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-[16px] text-white">Audit log</h3>
      {q.data.entries.length ? (
        <div className="overflow-x-auto rounded-[12px] border border-white/8">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                {['When', 'Who', 'Action', 'What'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-white/60">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data.entries.map((e) => (
                <tr key={e.id} className="border-t" style={{ borderColor: 'var(--mm-divider)' }}>
                  <td className="data whitespace-nowrap px-3 py-2 text-white/55">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-white/80">{e.actor}</td>
                  <td className="px-3 py-2 text-white/80">{e.action.replace(/_/g, ' ')}</td>
                  <td className="clamp-1 px-3 py-2 text-white/55">{typeof e.detail.title === 'string' ? e.detail.title : e.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={muted}>Nothing recorded yet.</p>
      )}
    </Card>
  );
}
