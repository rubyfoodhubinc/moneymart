#!/usr/bin/env node
/**
 * MoneyMart — live video providers (Amazon IVS Real-Time + Cloudflare Stream).
 *
 * Runs the API against local stand-ins for both provider APIs, so the whole
 * path is exercised without real accounts: signed IVS calls, Cloudflare live
 * inputs, the admin provider switch, automatic fallback when the primary fails,
 * the host's "move to backup", room teardown, and that broadcast credentials
 * never reach viewers.
 *
 * Usage: node scripts/verify-live-video.mjs   (needs the compiled API)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_LIVE_PORT ?? 4710);
const ONLY_IVS_PORT = PORT + 1;
const MOCK_PORT = PORT + 2;
const API = `http://127.0.0.1:${PORT}`;
const ONLY_IVS = `http://127.0.0.1:${ONLY_IVS_PORT}`;

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

console.log('\n\u001b[1m════════ MoneyMart live video (IVS + Cloudflare) ════════\u001b[0m');

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

/* ── Provider stand-ins ───────────────────────────────────────────────── */
const calls = [];
const outage = { ivs: false, cloudflare: false };
let seq = 0;
const mock = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : {};
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  if (req.url.startsWith('/ivs/')) {
    const op = req.url.slice(5);
    calls.push({ provider: 'ivs', op, auth: req.headers.authorization ?? '', date: req.headers['x-amz-date'], body: json });
    if (outage.ivs) return send(503, { __type: 'ServiceUnavailableException' });
    if (!String(req.headers.authorization).startsWith('AWS4-HMAC-SHA256 Credential=AKIATEST/')) return send(403, { __type: 'UnrecognizedClientException' });
    if (op === 'CreateStage') return send(200, { stage: { arn: `arn:aws:ivs:us-east-1:111122223333:stage/st${(seq += 1)}` } });
    if (op === 'CreateParticipantToken') {
      return send(200, { participantToken: { token: `ivs-${json.capabilities.join('+')}-${json.userId}`, participantId: `p${(seq += 1)}`, expirationTime: new Date(Date.now() + 3600e3).toISOString() } });
    }
    if (op === 'DeleteStage') return send(200, {});
    return send(400, { __type: 'UnknownOperation' });
  }
  if (req.url.startsWith('/cf/')) {
    calls.push({ provider: 'cloudflare', op: `${req.method} ${req.url.replace(/^\/cf\/accounts\/[^/]+/, '')}`, auth: req.headers.authorization ?? '', body: json });
    if (outage.cloudflare) return send(503, { success: false, errors: [{ code: 10000 }] });
    if (req.headers.authorization !== 'Bearer cf-test-token') return send(403, { success: false, errors: [{ code: 10001 }] });
    if (req.method === 'POST') {
      const uid = `cf${(seq += 1)}`;
      return send(200, { success: true, result: { uid, webRTC: { url: `https://customer.example/${uid}/webRTC/publish` }, webRTCPlayback: { url: `https://customer.example/${uid}/webRTC/play` } } });
    }
    if (req.method === 'DELETE') return send(200, { success: true, result: null });
  }
  send(404, {});
});
await new Promise((resolve) => mock.listen(MOCK_PORT, '127.0.0.1', resolve));

/* ── Gateways ─────────────────────────────────────────────────────────── */
const children = [];
function startGateway(port, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      MM_SEED: 'true',
      MM_PERSISTENCE: 'off',
      MM_AUTH_DEV_CODES: 'true',
      MM_LIVE_VIDEO_MAX: '1000',
      MM_IVS_ACCESS_KEY_ID: 'AKIATEST',
      MM_IVS_SECRET_ACCESS_KEY: 'test-secret',
      MM_IVS_ENDPOINT: `http://127.0.0.1:${MOCK_PORT}/ivs`,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
}
const cleanup = () => {
  children.forEach((child) => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  mock.close();
};
process.on('exit', cleanup);

startGateway(PORT, { MM_CF_ACCOUNT_ID: 'acct123', MM_CF_STREAM_TOKEN: 'cf-test-token', MM_CF_API_BASE: `http://127.0.0.1:${MOCK_PORT}/cf` });
startGateway(ONLY_IVS_PORT, {});

async function waitFor(base) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${base}/api/health`)).ok) return true; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
if (!(await waitFor(API)) || !(await waitFor(ONLY_IVS))) {
  check(false, 'gateways started');
  process.exit(1);
}
check(true, 'gateways and provider stand-ins are running');

const call = async (base, pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* none */ }
  return { status: response.status, json };
};
const as = (id) => ({ 'x-mm-user': id });
const ADMIN = 'usr_house';
const SELLER = 'usr_you';
const VIEWER = 'usr_ada';
const ahead = (h) => new Date(Date.now() + h * 3600e3).toISOString();

await call(API, '/api/me/seller-profile', { method: 'PUT', headers: as(SELLER), body: { entity: 'individual', mainCategory: 'food', returnAddress: { fullName: 'Ash Vale', line1: '1 Main Street', city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US' } } });
const newShow = async (title) => (await call(API, '/api/streams', { method: 'POST', headers: as(SELLER), body: { title, categoryId: 'food', scheduledStartTime: ahead(2) } })).json?.stream?.id;
const goLive = (id, body = {}, who = SELLER) => call(API, `/api/streams/${id}/go-live`, { method: 'POST', headers: as(who), body });
const watch = (id, who = VIEWER) => call(API, `/api/streams/${id}/watch`, { headers: as(who) });
const adminSet = (body, who = ADMIN, base = API) => call(base, '/api/admin/live-video', { method: 'PUT', headers: as(who), body });

/* ── 1. Dashboard ─────────────────────────────────────────────────────── */
section('1. Staff see and control the live video provider');
const status = await call(API, '/api/admin/live-video', { headers: as(ADMIN) });
check(status.status === 200 && status.json?.primary === 'ivs' && status.json?.autoFallback === true, 'IVS is primary with automatic backup by default');
check(status.json?.providers?.every((p) => p.configured), 'both providers report as configured');
check((await call(API, '/api/admin/live-video', { headers: as(SELLER) })).status === 404, 'a seller cannot see the console');
check((await adminSet({ primary: 'cloudflare' }, SELLER)).status === 404, 'a seller cannot switch providers');
check((await adminSet({ primary: 'youtube' })).status === 400, 'an unknown provider is refused');
check((await adminSet({ primary: 'cloudflare' }, ADMIN, ONLY_IVS)).status === 409, 'switching to a provider with no credentials is refused');

/* ── 2. Going live on IVS ─────────────────────────────────────────────── */
section('2. A host goes live on Amazon IVS');
const ivsShow = await newShow('IVS candy night');
check((await goLive(ivsShow, {}, VIEWER)).status === 404, 'only the host can go live');
const before = calls.length;
const live = await goLive(ivsShow);
check(live.status === 200 && live.json?.broadcast?.provider === 'ivs', 'the room opens on IVS', `${live.status}`);
check(live.json?.broadcast?.ivs?.token?.startsWith('ivs-PUBLISH+SUBSCRIBE-'), 'the host gets a publish token');
check(live.json?.stream?.status === 'live', 'the show is live');
const ivsCalls = calls.slice(before).filter((c) => c.provider === 'ivs');
check(ivsCalls.map((c) => c.op).join(',') === 'CreateStage,CreateParticipantToken', 'one stage and one token were requested', ivsCalls.map((c) => c.op).join(','));
check(ivsCalls.every((c) => /Credential=AKIATEST\/\d{8}\/us-east-1\/ivs\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/.test(c.auth) && c.date), 'every IVS call is SigV4-signed for the ivs service');
const again = await goLive(ivsShow);
check(again.status === 200 && calls.slice(before).filter((c) => c.op === 'CreateStage').length === 1, 'going live again reuses the room');
const seen = await watch(ivsShow);
check(seen.status === 200 && seen.json?.viewer?.ivs?.token?.startsWith('ivs-SUBSCRIBE-usr_ada'), 'a viewer gets a watch-only token');
const publicView = JSON.stringify((await call(API, `/api/streams/${ivsShow}`)).json ?? {});
check(publicView.includes('"liveVideoProvider":"ivs"') && !publicView.includes('arn:aws') && !publicView.includes('"video"'), 'viewers see the provider name, never the room');

/* ── 3. Switching ─────────────────────────────────────────────────────── */
section('3. Staff switch new shows to Cloudflare');
const switched = await adminSet({ primary: 'cloudflare' });
check(switched.status === 200 && switched.json?.primary === 'cloudflare', 'the switch is saved');
check((await call(API, '/api/admin/live-video', { headers: as(ADMIN) })).json?.primary === 'cloudflare', 'and survives a re-read');
const cfShow = await newShow('Cloudflare candy night');
const cfLive = await goLive(cfShow);
check(cfLive.json?.broadcast?.provider === 'cloudflare' && cfLive.json?.broadcast?.cloudflare?.whipUrl?.endsWith('/webRTC/publish'), 'the next show broadcasts over Cloudflare WHIP');
check(calls.some((c) => c.provider === 'cloudflare' && c.op === 'POST /stream/live_inputs' && c.auth === 'Bearer cf-test-token'), 'Cloudflare was called with the account token');
const cfWatch = await watch(cfShow);
check(cfWatch.json?.viewer?.cloudflare?.whepUrl?.endsWith('/webRTC/play') && !JSON.stringify(cfWatch.json).includes('publish'), 'viewers get the WHEP address, never the WHIP one');
check((await watch(ivsShow)).json?.viewer?.provider === 'ivs', 'the show already live on IVS stays on IVS');
const cfPublic = JSON.stringify((await call(API, `/api/streams/${cfShow}`)).json ?? {});
check(!cfPublic.includes('webRTC/publish'), 'the broadcast address never appears in the public show');

/* ── 4. Automatic fallback ────────────────────────────────────────────── */
section('4. When the primary fails, the backup takes over');
await adminSet({ primary: 'ivs', autoFallback: true });
outage.ivs = true;
const fbShow = await newShow('Fallback night');
const fb = await goLive(fbShow);
check(fb.status === 200 && fb.json?.broadcast?.provider === 'cloudflare', 'an IVS outage sends the show to Cloudflare', `${fb.status}`);
check(fb.json?.failedOver?.from === 'ivs', 'the response says it failed over');
const after = (await call(API, '/api/admin/live-video', { headers: as(ADMIN) })).json;
check(after?.lastFailover?.from === 'ivs' && after?.lastFailover?.to === 'cloudflare' && after?.lastFailover?.showId === fbShow, 'staff see the last failover on the dashboard');
await adminSet({ autoFallback: false });
const noFb = await goLive(await newShow('No fallback night'));
check(noFb.status === 503 && noFb.json?.error === 'live_video_unavailable' && noFb.json?.provider === 'ivs', 'with fallback off, an outage is reported instead', `${noFb.status}`);
outage.ivs = false;
await adminSet({ autoFallback: true });

/* ── 5. Host moves a running show to the backup ───────────────────────── */
section('5. A host can move a show to the backup');
const moveShow = await newShow('Move me');
await goLive(moveShow);
const moved = await goLive(moveShow, { useBackup: true });
check(moved.status === 200 && moved.json?.broadcast?.provider === 'cloudflare' && moved.json?.failedOver?.reason === 'host_requested', 'the show moves from IVS to Cloudflare');
await new Promise((r) => setTimeout(r, 200));
check(calls.some((c) => c.op === 'DeleteStage'), 'the abandoned IVS stage is closed');
check((await watch(moveShow)).json?.viewer?.provider === 'cloudflare', 'viewers now join on Cloudflare');

/* ── 6. Concurrency ───────────────────────────────────────────────────── */
section('6. A double tap opens one room');
const doubleShow = await newShow('Double tap');
const stagesBefore = calls.filter((c) => c.op === 'CreateStage').length;
const [a, b] = await Promise.all([goLive(doubleShow), goLive(doubleShow)]);
const stagesAfter = calls.filter((c) => c.op === 'CreateStage').length;
check(a.status === 200 && b.status === 200 && stagesAfter - stagesBefore === 1, 'two simultaneous go-lives create one stage', `${stagesAfter - stagesBefore}`);

/* ── 7. Ending ────────────────────────────────────────────────────────── */
section('7. Ending a show closes its room');
const cfDeletes = calls.filter((c) => c.op.startsWith('DELETE')).length;
check((await call(API, `/api/streams/${cfShow}/end`, { method: 'POST', headers: as(VIEWER) })).status === 404, 'a viewer cannot end the show');
const ended = await call(API, `/api/streams/${cfShow}/end`, { method: 'POST', headers: as(SELLER) });
await new Promise((r) => setTimeout(r, 200));
check(ended.status === 200 && calls.filter((c) => c.op.startsWith('DELETE')).length === cfDeletes + 1, 'the host ends it and the Cloudflare input is deleted');
check((await watch(cfShow)).status === 409, 'an ended show has no video to join');
const killed = await call(API, `/api/streams/${ivsShow}/end`, { method: 'POST', headers: as(ADMIN) });
check(killed.status === 200 && killed.json?.stream?.status === 'ended', 'staff can end any show (the kill switch)');
check((await goLive(ivsShow)).status === 409, 'an ended show cannot go live again');

/* ── 8. Running items in a live show ──────────────────────────────────── */
section('8. The host runs items with their own timer, price and rules');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runShow = await newShow('Auction night');
await goLive(runShow);
const lot = async (title, extra = {}) => (await call(API, '/api/auctions', { method: 'POST', headers: as(SELLER), body: { title, description: 'Test lot', categoryId: 'food', condition: 'new', auctionType: 'live_stream', startingPrice: 5, durationDays: 7, ...extra } })).json?.auction?.id;
const lotA = await lot('Lot A');
const lotB = await lot('Lot B');
const lotC = await lot('Lot C', { buyItNowPrice: 50 });
for (const id of [lotA, lotB, lotC]) await call(API, `/api/streams/${runShow}/items`, { method: 'POST', headers: as(SELLER), body: { auctionId: id } });
const run = (id, body, who = SELLER) => call(API, `/api/streams/${runShow}/items/${id}/activate`, { method: 'POST', headers: as(who), body });
const getLot = async (id) => (await call(API, `/api/auctions/${id}`)).json?.auction;
const bid = async (id, who = VIEWER) => {
  const detail = (await call(API, `/api/auctions/${id}`)).json;
  return call(API, `/api/auctions/${id}/bids`, { method: 'POST', headers: as(who), body: { amount: detail.minimumBid } });
};

check((await run(lotA, { seconds: 3 })).status === 400, 'a timer under 5 seconds is refused');
const ranA = await run(lotA, { seconds: 10, startingPrice: 7 });
const a1 = await getLot(lotA);
const left = (Date.parse(a1.endTime) - Date.now()) / 1000;
check(ranA.status === 200 && a1.startingPrice === 7 && left > 8 && left <= 10.5, 'the item runs on the host’s 10-second clock and price', `${left.toFixed(1)}s, $${a1.startingPrice}`);
check((await run(lotB, { seconds: 10 })).status === 409, 'a second item cannot start while one is on screen');
await sleep(6500);
const late = await bid(lotA);
const a2 = await getLot(lotA);
const lateLeft = (Date.parse(a2.endTime) - Date.now()) / 1000;
check(late.status === 200 && lateLeft > 4 && lateLeft <= 5.5, 'a bid in the last seconds resets the clock to 5 seconds, not 30', `${lateLeft.toFixed(1)}s left`);
await sleep(6500);
const a3 = await getLot(lotA);
const showAfter = (await call(API, `/api/streams/${runShow}`)).json?.stream;
check(a3.status === 'sold' && a3.winnerId === VIEWER, 'the item sells to the highest bidder', `${a3.status} → ${a3.winnerId}`);
check(!showAfter?.activeAuctionId, 'the show waits for the host instead of starting the next item');

const ranB = await run(lotB, { seconds: 6, suddenDeath: true });
const b1 = await getLot(lotB);
await sleep(3500);
await bid(lotB);
const b2 = await getLot(lotB);
check(ranB.status === 200 && b2.suddenDeath === true && b2.endTime === b1.endTime, 'sudden death: a late bid does not move the clock');
await sleep(3500);

/* ── 9. Buy It Now ─────────────────────────────────────────────────────── */
section('9. Buy It Now buys the item');
const buy = (id, who = VIEWER) => call(API, `/api/auctions/${id}/buy-now`, { method: 'POST', headers: as(who), body: {} });
await run(lotC, { seconds: 60 });
check((await buy(lotC, SELLER)).status === 409, 'a seller cannot buy their own item');
const bought = await buy(lotC);
const c1 = await getLot(lotC);
check(bought.status === 200 && bought.json?.orderId && c1.status === 'sold' && c1.winnerId === VIEWER && c1.hammerPrice === 50, 'the buyer gets the item at the Buy It Now price, with an order', `${bought.status} ${c1.status} $${c1.hammerPrice}`);
check((await buy(lotC)).status === 409, 'it cannot be bought twice');
check((await buy(lotA)).status === 409, 'an item without a Buy It Now price cannot be bought outright');

const colour = fail ? '\u001b[31m' : '\u001b[32m';
console.log(`\n  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((label) => console.log(`  - ${label}`));
cleanup();
process.exit(fail ? 1 : 0);
