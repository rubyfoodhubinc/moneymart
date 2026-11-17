/**
 * Owner console › Boardroom. A round table chaired by President Ore with the five department heads, or one head in
 * a private room. Each round runs on the server; this page polls the meeting while someone is speaking. Closing has
 * the President write the minutes and file proposals in the Owner's approvals.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Pill } from '@/components/ui';
import { api, type BoardMeeting, type PresStaff } from '@/lib/api';

const initials = (name: string) =>
  name
    .replace(/^President\s+/, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function RoundTable({ staff, meeting, president }: { staff: PresStaff[]; meeting: BoardMeeting | null; president: string }) {
  const seats = meeting ? staff.filter((s) => meeting.seats.includes(s.id)) : staff;
  const chairs = [{ id: 'president', name: `President ${president}`, title: 'Chair' }, ...seats.map((s) => ({ id: s.id, name: s.name, title: s.department }))];
  if (meeting?.kind === 'room') chairs.shift();
  const owner = { id: 'owner', name: 'You', title: 'Owner' };
  const all = [...chairs, owner];
  const size = 300;
  const r = 118;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} aria-label="Round table">
      <div
        className="absolute rounded-full border"
        style={{ inset: 62, borderColor: 'var(--mm-gold-line)', background: 'radial-gradient(circle, rgba(245,166,35,0.10), rgba(255,255,255,0.02))' }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-center">
        <span className="max-w-[140px] text-[11px] leading-snug text-white/55">{meeting ? meeting.topic : 'Open a meeting to seat the team'}</span>
      </div>
      {all.map((chair, index) => {
        const angle = (index / all.length) * Math.PI * 2 - Math.PI / 2;
        const x = size / 2 + Math.cos(angle) * r;
        const y = size / 2 + Math.sin(angle) * r;
        const speaking = meeting?.speaking === chair.id;
        return (
          <div key={chair.id} className="absolute flex w-[84px] -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center" style={{ left: x, top: y }}>
            <span
              className={`flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-bold transition-all ${speaking ? 'animate-pulse' : ''}`}
              style={{
                background: chair.id === 'president' ? 'var(--mm-gradient-gold)' : chair.id === 'owner' ? 'rgba(255,255,255,0.12)' : 'rgba(26,43,74,0.9)',
                color: chair.id === 'president' ? '#1a1205' : 'white',
                boxShadow: speaking ? '0 0 0 3px var(--mm-gold), 0 0 22px rgba(245,166,35,0.55)' : '0 0 0 1px rgba(255,255,255,0.12)',
              }}
            >
              {initials(chair.name)}
            </span>
            <span className="mt-1 text-[10.5px] font-semibold leading-tight text-white/85">{chair.name.replace(/^President /, '')}</span>
            <span className="text-[9.5px] text-white/45">{speaking ? 'speaking…' : chair.title}</span>
          </div>
        );
      })}
    </div>
  );
}

export function BoardroomPanel() {
  const client = useQueryClient();
  const office = useQuery({ queryKey: ['admin', 'president'], queryFn: api.president });
  const list = useQuery({ queryKey: ['admin', 'boardroom'], queryFn: api.boardMeetings });
  const [current, setCurrent] = useState<string | null>(null);
  const meeting = useQuery({
    queryKey: ['admin', 'boardroom', current],
    queryFn: () => api.boardMeeting(current!),
    enabled: Boolean(current),
    refetchInterval: (q) => (q.state.data?.meeting.speaking ? 1500 : false),
  });
  const [topic, setTopic] = useState('');
  const [who, setWho] = useState<string>('board');
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const refresh = () => void client.invalidateQueries({ queryKey: ['admin'] });
  const open = useMutation({
    mutationFn: () => api.openBoardMeeting(topic.trim(), who === 'board' ? undefined : [who]),
    onSuccess: ({ meeting: m }) => {
      setTopic('');
      setCurrent(m.id);
      refresh();
    },
  });
  const say = useMutation({
    mutationFn: () => api.sayInBoardroom(current!, text.trim()),
    onSuccess: () => {
      setText('');
      refresh();
    },
  });
  const close = useMutation({ mutationFn: () => api.closeBoardMeeting(current!), onSettled: refresh });

  const m = meeting.data?.meeting ?? null;
  const busy = Boolean(m?.speaking) || close.isPending;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [m?.lines.length]);

  if (!office.data) return <p className="text-[12px] text-white/50">{office.isError ? 'Could not load the boardroom.' : 'Loading…'}</p>;
  const { staff, name } = office.data;
  const error = (open.error ?? say.error ?? close.error) as Error | null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_1.3fr]">
      <div className="flex flex-col gap-5">
        <Card className="p-5">
          <RoundTable staff={staff} meeting={m} president={name} />
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-[16px] text-white">New meeting</h3>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder="What should the team discuss?"
            className="mb-2.5 w-full resize-none rounded-[11px] border border-white/10 bg-transparent px-3 py-2 text-[13px] text-white outline-none focus:border-[var(--mm-gold-line)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select value={who} onChange={(e) => setWho(e.target.value)} className="min-w-0 flex-1 rounded-[10px] border border-white/10 bg-[var(--mm-surface,#0b1220)] px-2.5 py-2 text-[12.5px] text-white">
              <option value="board">Whole board (round table)</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  Private room — {s.name}, {s.department}
                </option>
              ))}
            </select>
            <Button loading={open.isPending} disabled={topic.trim().length < 3} onClick={() => open.mutate()}>
              Open meeting
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-[16px] text-white">Past meetings</h3>
          {list.data?.meetings.length ? (
            <ul className="space-y-2">
              {list.data.meetings.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    onClick={() => setCurrent(x.id)}
                    className="w-full rounded-[11px] border p-3 text-left"
                    style={{ borderColor: x.id === current ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
                  >
                    <span className="clamp-1 block text-[12.5px] font-medium text-white/90">{x.topic}</span>
                    <span className="block text-[11px] text-white/45">
                      {x.kind === 'room' ? 'Private room' : 'Board'} · {new Date(x.createdAt).toLocaleString()} · {x.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-white/50">No meetings yet.</p>
          )}
        </Card>
      </div>

      <Card className="flex flex-col p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="clamp-1 text-[16px] text-white">{m ? m.topic : 'Meeting record'}</h3>
          {m ? <Pill tone={m.status === 'open' ? (m.speaking ? 'gold' : 'green') : 'neutral'}>{m.status === 'closed' ? 'Closed' : m.speaking ? 'In discussion' : 'Your turn'}</Pill> : null}
        </div>
        <div className="mb-3 max-h-[560px] min-h-[260px] flex-1 space-y-3 overflow-y-auto pr-1">
          {!m ? <p className="text-[12.5px] text-white/50">Open a meeting or pick a past one. Each head answers from their own department and model; the President sums up each round.</p> : null}
          {m?.lines.map((l) => (
            <div key={l.id} className={`flex ${l.speaker === 'owner' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[88%] rounded-[12px] px-3.5 py-2.5"
                style={
                  l.speaker === 'owner'
                    ? { background: 'rgba(245,166,35,0.12)' }
                    : l.speaker === 'president'
                      ? { background: 'rgba(245,166,35,0.05)', border: '1px solid var(--mm-gold-line)' }
                      : { background: 'rgba(255,255,255,0.05)' }
                }
              >
                <span className="mb-0.5 block text-[11px] font-semibold" style={{ color: l.speaker === 'president' ? 'var(--mm-gold)' : 'rgba(255,255,255,0.55)' }}>
                  {l.speaker === 'owner' ? 'You' : l.name}
                  {l.speaker !== 'owner' && l.speaker !== 'president' ? ` · ${staff.find((s) => s.id === l.speaker)?.department ?? ''}` : ''}
                </span>
                <span className="block whitespace-pre-wrap text-[13px] leading-relaxed text-white/85">{l.text}</span>
              </div>
            </div>
          ))}
          {m?.speaking ? (
            <p className="text-[12px] text-white/45">
              {m.speaking === 'president' ? `President ${name}` : staff.find((s) => s.id === m.speaking)?.name ?? 'The team'} is speaking…
            </p>
          ) : null}
          <div ref={end} />
        </div>
        {error ? <p className="mb-2 text-[12px] text-[var(--mm-error)]">{error.message}</p> : null}
        {m && m.status === 'open' ? (
          <div className="flex flex-wrap gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && text.trim() && !busy) {
                  e.preventDefault();
                  say.mutate();
                }
              }}
              rows={2}
              disabled={busy}
              placeholder={busy ? 'The table is talking…' : 'Speak to the table'}
              className="min-w-0 flex-1 resize-none rounded-[11px] border border-white/10 bg-transparent px-3 py-2 text-[13px] text-white outline-none focus:border-[var(--mm-gold-line)]"
            />
            <div className="flex flex-col gap-2">
              <Button onClick={() => say.mutate()} loading={say.isPending} disabled={busy || !text.trim()}>
                Speak
              </Button>
              <Button variant="navy" onClick={() => close.mutate()} loading={close.isPending} disabled={busy}>
                Close &amp; minutes
              </Button>
            </div>
          </div>
        ) : m?.status === 'closed' ? (
          <p className="text-[12px] text-white/50">Closed. The minutes are in President › Reports, and any proposals wait in your approvals.</p>
        ) : null}
      </Card>
    </div>
  );
}
