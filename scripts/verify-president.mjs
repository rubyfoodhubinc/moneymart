#!/usr/bin/env node
/**
 * MoneyMart — President Ore's office, approvals and Ore in the app.
 *
 * Runs the API against a scripted stand-in for Claude, so the whole path is exercised without a real key:
 * owner-only access, the President's tool loop, staff drafts, locked settings, atomic approvals (settings, signed
 * directives that reach every Ore, member messages), member requests reported up and merged, briefings, audit and
 * AI cost metering.
 *
 * Usage: node scripts/verify-president.mjs   (needs the compiled API)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_PRES_PORT ?? 4730);
const MOCK_PORT = PORT + 1;
const API = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures = [];
const check = (condition, label, extra = '') => {
  if (condition) {
    pass += 1;
    console.log(`  \u001b[32m✔\u001b[0m ${label}${extra ? `  \u001b[2m${extra}\u001b[0m` : ''}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}` : ''}`);
  }
};
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);

console.log('\n\u001b[1m════════ MoneyMart President Ore ════════\u001b[0m');

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

/* ── Claude stand-in: answers by who is speaking and what the owner asked ── */
const seen = [];
let toolSeq = 0;
const lastText = (messages) => {
  const last = messages[messages.length - 1];
  if (typeof last.content === 'string') return last.content;
  return last.content.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? `RESULT:${b.content}` : '')).join('');
};
const tool = (name, input) => ({ content: [{ type: 'tool_use', id: `tu_${(toolSeq += 1)}`, name, input }] });
const say = (text) => ({ content: [{ type: 'text', text }] });

function respond(body) {
  const system = String(body.system ?? '');
  const text = lastText(body.messages);
  const first = typeof body.messages[body.messages.length - 1].content === 'string';
  if (system.startsWith('You are Grace Mensah')) {
    return say(JSON.stringify({ kind: 'draft_member_message', title: 'Fees are lower this week', body: 'Sellers keep more of every sale this week. List an item or schedule a show to try it — nothing to switch on. Thanks for selling on MoneyMart.', remember: 'Owner likes short member messages' }));
  }
  if (system.startsWith('You are Ore')) {
    if (first) return tool('report_to_president', { kind: 'feature', title: 'Dark mode', detail: text.slice(0, 200) });
    return say('I’ve passed that to President Ore.');
  }
  if (system.startsWith('You are President')) {
    if (!first) return say(`Done. ${text.slice(0, 300)}`);
    const ask = text.split('OWNER:').pop();
    if (ask.includes('banner')) return tool('propose_setting_change', { title: 'Welcome banner', why: 'Greets new members', changes: [{ key: 'home.banner', value: 'Welcome to MoneyMart' }] });
    if (ask.includes('models')) return tool('propose_setting_change', { why: 'cheaper', changes: [{ key: 'ai.seats', value: { president: { provider: 'openai', model: 'x' } } }] });
    if (ask.includes('finance')) {
      const id = (system + JSON.stringify(body.messages)).match(/Grace Mensah, Chief Financial Officer \(Finance\) \[id ([^\]]+)\]/)?.[1];
      return tool('ask_staff', { staff_id: id, task: 'Draft a message to sellers about fees' });
    }
    if (ask.includes('directive')) return tool('propose_directive', { directive: 'Always mention Buy It Now when an item has it.', why: 'More sales' });
    if (ask.includes('numbers')) return tool('business_report', { days: 7 });
    if (ask.includes('requests')) return tool('member_requests', {});
    if (ask.includes('briefing')) return say('Briefing: sales steady, one approval waiting.');
    return say('Noted.');
  }
  return say('?');
}

const mock = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  seen.push({ key: req.headers['x-api-key'], body });
  const reply = respond(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ...reply, model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } }));
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

const child = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'development',
    MM_SEED: 'true',
    MM_PERSISTENCE: 'off',
    MM_AUTH_DEV_CODES: 'true',
    ANTHROPIC_PRESIDENT_API_KEY: 'test-claude-key',
    ANTHROPIC_API_KEY: 'test-member-key',
    MM_ANTHROPIC_BASE: `http://127.0.0.1:${MOCK_PORT}/v1/messages`,
    MM_DIRECTIVE_SECRET: 'test-directive-secret',
    RESEND_API_KEY: '',
    MM_OWNER_EMAILS: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
const cleanup = () => {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  mock.close();
};
process.on('exit', cleanup);

const deadline = Date.now() + 30_000;
let up = false;
while (Date.now() < deadline && !up) {
  try { up = (await fetch(`${API}/api/health`)).ok; } catch { /* starting */ }
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) {
  check(false, 'API started', serverLog.slice(-600));
  process.exit(1);
}

const call = async (pathname, options = {}) => {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* none */ }
  return { status: response.status, json };
};
const as = (id) => ({ 'x-mm-user': id });
const OWNER = 'usr_house';
const MEMBER = 'usr_ada';
const MEMBER2 = 'usr_marcus';
const chat = (text) => call('/api/admin/president/chat', { method: 'POST', headers: as(OWNER), body: { text } });
const office = async () => (await call('/api/admin/president', { headers: as(OWNER) })).json;
const decide = (id, decision) => call(`/api/admin/president/decide/${id}`, { method: 'POST', headers: as(OWNER), body: { decision } });

/* ── 1 ── */
section('1. Only the owner gets into the console');
check((await call('/api/admin/president', { headers: as(MEMBER) })).status === 404, 'a member gets 404 (the console is not confirmed)');
check((await call('/api/admin/president')).status === 404, 'nobody signed in gets 404');
const me = await call('/api/admin/me', { headers: as(OWNER) });
check(me.status === 200 && me.json?.role === 'owner' && me.json.tabs.includes('president'), 'the owner sees every tab', me.json?.role);
const start = await office();
check(start?.name === 'Ore' && start.configured === true, 'President Ore is configured');
check(start?.staff?.length === 5 && start.staff.map((s) => s.department).join(',') === 'Finance,Operations,Marketing,Sales,Technology', 'the office has its five department heads');

/* ── 2 ── */
section('2. She works with the business numbers');
const numbers = await chat('give me the numbers');
check(numbers.status === 200 && /orders, GMV \$/.test(numbers.json?.reply?.text ?? ''), 'business_report returns MoneyMart’s own numbers', (numbers.json?.reply?.text ?? '').slice(0, 80));
const ov = await call('/api/admin/overview', { headers: as(OWNER) });
check(ov.status === 200 && typeof ov.json?.week?.members === 'number' && ov.json.week.members > 0, 'the overview has members, orders and shows', `${ov.json?.week?.members} members`);
const lines = await call('/api/admin/president/chat?thread=main', { headers: as(OWNER) });
check(lines.json?.lines?.length === 2 && lines.json.lines[0].role === 'owner', 'the conversation is kept');

/* ── 3 ── */
section('3. Changes are drafts until the owner approves');
const before = (await call('/api/admin/settings', { headers: as(OWNER) })).json.settings.find((s) => s.key === 'home.banner').value;
const banner = await chat('please propose a welcome banner');
const draft = (await office()).approvals.find((p) => p.title.startsWith('Settings:'));
check(banner.status === 200 && draft && draft.status === 'pending', 'a settings change is filed as a pending draft', draft?.title);
const mid = (await call('/api/admin/settings', { headers: as(OWNER) })).json.settings.find((s) => s.key === 'home.banner').value;
check(mid === before, 'nothing changes before approval');
const ok = await decide(draft.id, 'approve');
const after = (await call('/api/admin/settings', { headers: as(OWNER) })).json.settings.find((s) => s.key === 'home.banner').value;
check(ok.status === 200 && ok.json.post.status === 'done' && after === 'Welcome to MoneyMart', 'approving applies it', after);
check((await decide(draft.id, 'approve')).status === 409, 'an item can only be decided once');

const locked = await chat('switch your models to something cheaper');
const lockedFiled = (await office()).approvals.some((p) => p.body.includes('ai.seats') || p.title.includes('AI model'));
check(/Not filed/.test(locked.json?.reply?.text ?? '') && !lockedFiled, 'she cannot propose changes to her own AI settings');

/* ── 4 ── */
section('4. Staff file drafts for the owner');
await chat('ask finance for a seller message');
const staffDraft = (await office()).approvals.find((p) => p.kind === 'draft_member_message' && p.staffId);
check(Boolean(staffDraft), 'the Finance head filed a member-message draft', staffDraft?.title);
const grace = (await office()).staff.find((s) => s.department === 'Finance');
check(grace?.brain?.includes('Owner likes short member messages'), 'staff keep their own notes');
const denied = await decide(staffDraft.id, 'deny');
check(denied.status === 200 && denied.json.post.status === 'denied', 'the owner can deny a draft');

/* ── 5 ── */
section('5. Directives reach every Ore');
await chat('propose a directive about Buy It Now');
const dir = (await office()).approvals.find((p) => p.kind === 'draft_directive');
check(Boolean(dir), 'a directive waits for approval');
const signed = await decide(dir.id, 'approve');
check(signed.json?.post?.status === 'done' && /signed/.test(signed.json.post.result), 'approved directives are signed');
const oreReply = await call('/api/ore/chat', { method: 'POST', headers: as(MEMBER), body: { text: 'Can MoneyMart have dark mode?' } });
const oreSystem = seen.filter((s) => String(s.body.system).startsWith('You are Ore')).pop()?.body.system ?? '';
check(oreReply.status === 200 && oreSystem.includes('Always mention Buy It Now'), 'Ore follows the signed directive', oreReply.json?.reply);

/* ── 6 ── */
section('6. Ore reports members’ needs up to the President');
check(oreReply.json?.reported?.length === 1, 'Ore filed the member’s request');
await call('/api/ore/chat', { method: 'POST', headers: as(MEMBER2), body: { text: 'Dark mode please' } });
await call('/api/ore/chat', { method: 'POST', headers: as(MEMBER), body: { text: 'dark mode again' } });
const req = (await office()).requests.find((r) => r.title === 'Dark mode');
check(req?.meta?.votes === 2, 'same requests are merged and counted per member', `votes ${req?.meta?.votes}`);
check(Boolean(req) && !JSON.stringify(req).includes(MEMBER) && !JSON.stringify(req).includes(MEMBER2), 'requests do not carry member ids');
const reqs = await chat('show me the member requests');
check(/Dark mode \(2 member/.test(reqs.json?.reply?.text ?? ''), 'the President reads member requests (wrapped as data)');
await call('/api/admin/settings', { method: 'PUT', headers: as(OWNER), body: { changes: [{ key: 'features.ore', value: false }] } });
check((await call('/api/ore/chat', { method: 'POST', headers: as(MEMBER), body: { text: 'hi' } })).status === 503, 'the owner can switch Ore off from the console');
await call('/api/admin/settings', { method: 'PUT', headers: as(OWNER), body: { changes: [{ key: 'features.ore', value: true }] } });

/* ── 7 ── */
section('7. Member messages go out only on approval');
const notesBefore = (await call('/api/notifications', { headers: as(MEMBER) })).json;
const countBefore = (notesBefore?.items ?? []).length;
// The President files one directly through her tool path via a staff draft re-filed by the owner's ask.
await chat('ask finance for a seller message');
const msg = (await office()).approvals.find((p) => p.kind === 'draft_member_message');
const sent = await decide(msg.id, 'approve');
const notesAfter = (await call('/api/notifications', { headers: as(MEMBER) })).json;
const countAfter = (notesAfter?.items ?? []).length;
check(sent.json?.post?.status === 'done' && /sent to \d+ member/.test(sent.json.post.result), 'approval sends it', sent.json?.post?.result);
check(countAfter === countBefore + 1, 'members find it in their inbox', `${countBefore} → ${countAfter}`);

/* ── 8 ── */
section('8. Briefing, audit, settings and cost');
const brief = await call('/api/admin/president/briefing', { method: 'POST', headers: as(OWNER), body: {} });
check(brief.status === 200 && brief.json.post.title.startsWith('Daily briefing') && /Briefing:/.test(brief.json.post.body) && /orders, GMV/.test(brief.json.post.body), 'the daily briefing has her summary and the numbers');
const bad = await call('/api/admin/settings', { method: 'PUT', headers: as(OWNER), body: { changes: [{ key: 'shows.default_timer', value: 999 }] } });
check(bad.status === 400, 'settings are checked by their own rule', bad.json?.detail);
const good = await call('/api/admin/settings', { method: 'PUT', headers: as(OWNER), body: { changes: [{ key: 'shows.default_timer', value: 20 }] } });
check(good.status === 200, 'the owner changes a setting directly');
check((await call('/api/admin/settings', { method: 'PUT', headers: as(MEMBER), body: { changes: [] } })).status === 404, 'members cannot change settings');
const log = (await call('/api/admin/audit', { headers: as(OWNER) })).json?.entries ?? [];
const actions = new Set(log.map((e) => e.action));
check(['president_approve', 'president_deny', 'settings_change', 'president_briefing'].every((a) => actions.has(a)), 'every decision is in the audit log', [...actions].join(','));
const prov = await call('/api/admin/providers', { headers: as(OWNER) });
check(prov.json?.cost30d?.calls > 0 && prov.json.cost30d.usd > 0, 'AI calls are priced into operating cost', `$${prov.json?.cost30d?.usd} / ${prov.json?.cost30d?.calls} calls`);
check(prov.json?.ai?.find((p) => p.id === 'anthropic')?.configured === true && !JSON.stringify(prov.json).includes('test-claude-key') && !JSON.stringify(prov.json).includes('test-member-key'), 'providers show key presence, never the key');
const oreCalls = seen.filter((s) => String(s.body.system).startsWith('You are Ore'));
check(oreCalls.length > 0 && oreCalls.every((s) => s.key === 'test-member-key') && seen.filter((s) => !String(s.body.system).startsWith('You are Ore')).every((s) => s.key === 'test-claude-key'), 'the office uses the President key; members’ Ore uses the general key');

const colour = fail ? '\u001b[31m' : '\u001b[32m';
console.log(`\n  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((label) => console.log(`  - ${label}`));
cleanup();
process.exit(fail ? 1 : 0);
