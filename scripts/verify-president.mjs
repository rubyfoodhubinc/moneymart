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
  if (/round table|private meeting with the Owner/.test(system)) {
    const name = system.match(/^You are ([^,]+),/)?.[1];
    return say(`${name} here: on this topic my department recommends one concrete step.`);
  }
  if (system.includes('chairing MoneyMart')) return say('Summary: the team agrees on the first step; you decide the budget.');
  if (system.startsWith('You are President') && first && text.includes('Close this')) {
    return tool('propose_member_message', { subject: 'Board: new seller week', body: 'Next week is new seller week on MoneyMart — schedule your first show and we will feature it on Home. Thanks for selling with us.', audience: 'sellers', why: 'Agreed at the board meeting' });
  }
  if (system.startsWith('You are President') && !first && text.includes('a message to sellers')) return say('Minutes: the team backs new seller week.\n1. Message to sellers (waiting for your approval).');
  if (system.startsWith('You are Grace Mensah')) {
    return say(JSON.stringify({ kind: 'draft_member_message', title: 'Fees are lower this week', body: 'Sellers keep more of every sale this week. List an item or schedule a show to try it — nothing to switch on. Thanks for selling on MoneyMart.', remember: 'Owner likes short member messages' }));
  }
  if (system.startsWith('You are Ore')) {
    const lastMsg = body.messages[body.messages.length - 1];
    const blocks = Array.isArray(lastMsg.content) ? lastMsg.content : [];
    const images = blocks.filter((b) => b.type === 'image').length;
    const docs = blocks.filter((b) => b.type === 'document').length;
    if (images || docs) return say(`I can see your files (${images} image, ${docs} pdf).`);
    if (first && system.includes('This is a voice call')) return say('Voice answer, short.');
    if (first && text.includes('my bids')) return tool('my_bids', {});
    if (first && text.includes('live show')) return tool('shows', { when: 'both' });
    if (!first && !text.includes('Sent to President')) return say(`Here is what I found: ${text.slice(0, 600)}`);
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

const spoken = [];
const mock = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  if (req.url === '/tts/bytes') {
    spoken.push({ key: req.headers['x-api-key'], body });
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(Buffer.from('ID3-fake-mp3'));
    return;
  }
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
    CARTESIA_API_KEY: 'test-cartesia',
    MM_CARTESIA_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    ELEVENLABS_API_KEY: '',
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


/* ── 9 ── */
section('9. Boardroom: round table chaired by the President');
const wait = async (id, ms = 20_000) => {
  const until = Date.now() + ms;
  for (;;) {
    const m = (await call(`/api/admin/boardroom/${id}`, { headers: as(OWNER) })).json?.meeting;
    if (!m?.speaking || Date.now() > until) return m;
    await new Promise((r) => setTimeout(r, 150));
  }
};
const allClaude = Object.fromEntries(['operations', 'marketing', 'sales'].map((k) => [k, { provider: 'anthropic', model: 'claude-sonnet-5-5' }]));
check((await call('/api/admin/settings', { method: 'PUT', headers: as(OWNER), body: { changes: [{ key: 'ai.seats', value: allClaude }] } })).status === 200, 'the owner moves seats between AI providers');
check((await call('/api/admin/boardroom', { method: 'POST', headers: as(MEMBER), body: { topic: 'x' } })).status === 404, 'members cannot open the boardroom');
const opened = await call('/api/admin/boardroom', { method: 'POST', headers: as(OWNER), body: { topic: 'How do we double sellers next quarter?' } });
check(opened.status === 201 && opened.json.meeting.kind === 'board' && opened.json.meeting.speaking, 'a board meeting opens and the first head starts speaking');
const mid1 = opened.json.meeting.id;
let meeting = await wait(mid1);
const names = meeting.lines.map((l) => l.name);
check(meeting.lines.length === 7 && names[0] === 'Owner' && names.at(-1) === 'President Ore', 'each of the five heads speaks, then the President sums up', names.join(' → '));
check(meeting.lines.slice(1, 6).every((l) => l.text.startsWith(`${l.name} here`)), 'every head speaks in their own voice');
const said = await call(`/api/admin/boardroom/${mid1}/say`, { method: 'POST', headers: as(OWNER), body: { text: 'Focus on food and collectibles.' } });
const busy = await call(`/api/admin/boardroom/${mid1}/say`, { method: 'POST', headers: as(OWNER), body: { text: 'again' } });
check(said.status === 200 && busy.status === 409, 'the owner interjects; the table answers one round at a time');
meeting = await wait(mid1);
check(meeting.lines.length === 14, 'the table answers the owner with another round', `${meeting.lines.length} lines`);
const closed = await call(`/api/admin/boardroom/${mid1}/close`, { method: 'POST', headers: as(OWNER), body: {} });
const afterClose = await office();
const minutes = afterClose.reports.find((r) => r.meta?.folder === 'board');
check(closed.status === 200 && closed.json.meeting.status === 'closed' && minutes && /Minutes/.test(minutes.body), 'closing writes the minutes to Reports');
check(afterClose.approvals.some((p) => p.title === 'Board: new seller week' && p.status === 'pending'), 'proposals from the meeting wait in approvals');
check((await call(`/api/admin/boardroom/${mid1}/say`, { method: 'POST', headers: as(OWNER), body: { text: 'more' } })).status === 409, 'a closed meeting takes no more turns');
const graceId = afterClose.staff.find((x) => x.department === 'Finance').id;
const room = await call('/api/admin/boardroom', { method: 'POST', headers: as(OWNER), body: { topic: 'Where is money leaking?', staffIds: [graceId] } });
const roomDone = await wait(room.json?.meeting?.id);
check(room.json?.meeting?.kind === 'room' && roomDone.lines.length === 2 && roomDone.lines[1].name === 'Grace Mensah', 'a private room with one head');
const list = await call('/api/admin/boardroom', { headers: as(OWNER) });
check(list.json?.meetings?.length === 2, 'past meetings are listed');
const log2 = new Set(((await call('/api/admin/audit', { headers: as(OWNER) })).json?.entries ?? []).map((e) => e.action));
check(log2.has('boardroom_open') && log2.has('boardroom_close'), 'meetings are in the audit log');


/* ── 10 ── */
section('10. Ore is the member’s chief of staff');
const ask = (body, who = MEMBER) => call('/api/ore/chat', { method: 'POST', headers: as(who), body });
const liveLots = (await call('/api/auctions?status=live', { headers: as(MEMBER) })).json?.items ?? [];
const target = liveLots.find((a) => a.sellerId !== MEMBER && !a.streamId);
const placed = target ? await call(`/api/auctions/${target.id}/bids`, { method: 'POST', headers: as(MEMBER), body: { amount: target.currentBid + 1000 } }) : null;
const bidsReply = await ask({ text: 'What is happening with my bids?' });
check(placed?.status === 200 && (bidsReply.json?.reply ?? '').includes(`moneymart://lot/${target.id}`) && (bidsReply.json?.reply ?? '').includes('"winning":true'), 'her bid lookup has the member’s real bid, winning, with a link', target?.id);
const lastOre = seen.filter((x) => String(x.body.system).startsWith('You are Ore')).at(-1);
const sys = String(lastOre?.body.system ?? '');
check(bidsReply.status === 200 && /Here is what I found/.test(bidsReply.json?.reply ?? ''), 'Ore looks up the member’s own bids', (bidsReply.json?.reply ?? '').slice(0, 90));
check(sys.includes('MONEYMART GUIDE') && sys.includes('buyer\'s premium') && sys.includes('Minimum steps'), 'the whole platform guide is embedded in her');
check(/MEMBER \(the person you are helping/.test(sys) && sys.includes('Buyer:') && sys.includes('Seller:'), 'she sees the member’s account as buyer and seller');
const toolNames = new Set((lastOre?.body.tools ?? []).map((t) => t.name));
check(['my_orders', 'my_bids', 'my_listings', 'my_shows', 'my_payouts', 'my_notifications', 'search_marketplace', 'shows', 'report_to_president'].every((n) => toolNames.has(n)), 'she has tools for orders, bids, listings, shows, payouts, notifications and the marketplace');
const showsReply = await ask({ text: 'Find me a live show' });
check(/moneymart:\/\/stream\//.test(showsReply.json?.reply ?? ''), 'shows come back with links that open in the app');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = Buffer.from('%PDF-1.4 receipt').toString('base64');
const files = await ask({ text: 'What is this?', attachments: [{ name: 'item.png', mediaType: 'image/png', data: PNG }, { name: 'receipt.pdf', mediaType: 'application/pdf', data: PDF }] });
check(files.status === 200 && files.json?.reply === 'I can see your files (1 image, 1 pdf).', 'she reads attached photos and PDFs', files.json?.reply);
const fileText = await ask({ text: 'Summarise', attachments: [{ name: 'notes.csv', mediaType: 'text/csv', data: Buffer.from('item,price\nwatch,100').toString('base64') }] });
const csvSent = JSON.stringify(seen.at(-1)?.body.messages ?? '');
check(fileText.status === 200 && csvSent.includes('ATTACHED FILE \\"notes.csv\\"') && csvSent.includes('watch,100'), 'text files are read inline, marked as data');
const exe = await ask({ text: 'run this', attachments: [{ name: 'app.exe', mediaType: 'application/x-msdownload', data: 'TVqQAAMAAAAEAAAA' }] });
check(exe.status === 400 && /photos, PDFs and text files/.test(exe.json?.detail ?? ''), 'other file types are refused with a reason');
const five = await ask({ text: 'x', attachments: Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.png`, mediaType: 'image/png', data: PNG })) });
check(five.status === 400, 'at most four attachments at a time');
const voiceReply = await ask({ text: 'hello', voice: true });
check(voiceReply.json?.reply === 'Voice answer, short.' && String(seen.at(-1)?.body.system).includes('This is a voice call'), 'calls get short spoken answers');
const status = await call('/api/ore/status', { headers: as(MEMBER) });
check(status.json?.voice === true, 'Ore reports that her voice is available');
const audio = await fetch(`${API}/api/ore/speak`, { method: 'POST', headers: { 'content-type': 'application/json', ...as(MEMBER) }, body: JSON.stringify({ text: '**Bid** on it here moneymart://lot/abc now' }) });
const spokenBody = spoken.at(-1)?.body;
check(audio.status === 200 && audio.headers.get('content-type') === 'audio/mpeg' && audio.headers.get('x-ore-voice') === 'cartesia', 'Ore speaks with her Cartesia voice');
check(spokenBody?.transcript === 'Bid on it here now' && spokenBody?.voice?.id && spoken.at(-1)?.key === 'test-cartesia', 'speech is cleaned of markdown and links before it is spoken', spokenBody?.transcript);

const colour = fail ? '\u001b[31m' : '\u001b[32m';
console.log(`\n  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((label) => console.log(`  - ${label}`));
cleanup();
process.exit(fail ? 1 : 0);
