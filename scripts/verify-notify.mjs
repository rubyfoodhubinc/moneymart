#!/usr/bin/env node
/**
 * MoneyMart — seller identity checks (Didit) and notifications (inbox, iPhone push, Owner messages).
 *
 * Runs the API against stand-ins for Didit (HTTPS JSON) and Apple Push (HTTP/2), so the whole path is exercised
 * without real keys: starting and resuming a check, the decision read on return, the signed webhook (bad
 * signatures, stale timestamps, unknown sessions and replays refused), the verified badge, the Owner's "verified
 * sellers only" switch, push registration, a real ES256 provider token, per-kind switches, dead tokens dropped,
 * order shipped/paid alerts, and Owner broadcasts with marketing opt-outs and audit.
 *
 * Usage: node scripts/verify-notify.mjs   (needs the compiled API)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createH2 } from 'node:http2';
import { createHmac, generateKeyPairSync, verify as verifySig } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_NOTIFY_PORT ?? 4760);
const DIDIT_PORT = PORT + 1;
const APNS_PORT = PORT + 2;
const API = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = 'test-didit-webhook-secret';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n\u001b[1m════════ MoneyMart verification & notifications ════════\u001b[0m');

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

/* ── Didit stand-in ── */
const sessions = new Map();
let sessionSeq = 0;
const diditCalls = [];
const didit = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  diditCalls.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body });
  const json = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'POST' && req.url === '/v3/session/') {
    sessionSeq += 1;
    const id = `00000000-0000-4000-8000-${String(sessionSeq).padStart(12, '0')}`;
    sessions.set(id, { status: 'Not Started', vendor: body.vendor_data, workflow: body.workflow_id });
    return json(201, { session_id: id, session_number: sessionSeq, session_token: 'secret-token', url: `https://verify.didit.me/session/${id}`, status: 'Not Started', workflow_id: body.workflow_id, vendor_data: body.vendor_data });
  }
  const m = req.url.match(/^\/v3\/session\/([^/]+)\/decision\/$/);
  if (req.method === 'GET' && m && sessions.has(m[1])) {
    const s = sessions.get(m[1]);
    return json(200, { session_id: m[1], status: s.status, vendor_data: s.vendor, id_verification: { status: s.status, warnings: s.status === 'Declined' ? [{ short_description: 'Document expired' }] : [] } });
  }
  json(404, { detail: 'not found' });
});
await new Promise((r) => didit.listen(DIDIT_PORT, '127.0.0.1', r));

/* ── Apple Push stand-in (HTTP/2 cleartext) ── */
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const pushes = [];
const deadTokens = new Set();
const apns = createH2();
apns.on('stream', (stream, headers) => {
  let raw = '';
  stream.on('data', (c) => { raw += c; });
  stream.on('end', () => {
    const token = String(headers[':path']).split('/').pop();
    const jwt = String(headers.authorization ?? '').replace(/^bearer /, '');
    const [h, c, s] = jwt.split('.');
    const signed = h && c && s && verifySig('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    const claims = c ? JSON.parse(Buffer.from(c, 'base64url').toString()) : {};
    pushes.push({ token, topic: headers['apns-topic'], type: headers['apns-push-type'], signed, claims, header: h ? JSON.parse(Buffer.from(h, 'base64url').toString()) : {}, payload: raw ? JSON.parse(raw) : {} });
    if (deadTokens.has(token)) {
      stream.respond({ ':status': 410 });
      stream.end(JSON.stringify({ reason: 'Unregistered' }));
      return;
    }
    stream.respond({ ':status': signed ? 200 : 403, 'apns-id': 'x' });
    stream.end();
  });
});
await new Promise((r) => apns.listen(APNS_PORT, '127.0.0.1', r));

const child = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'development',
    MM_SEED: 'true',
    MM_PERSISTENCE: 'off',
    MM_AUTH_DEV_CODES: 'true',
    MM_OWNER_EMAILS: '',
    RESEND_API_KEY: '',
    DIDIT_API_KEY: 'test-didit-key',
    DIDIT_KYC_WORKFLOWID_KEY: 'wf-person',
    DIDIT_KYB_WORKFLOWID_KEY: 'wf-business',
    DIDIT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    MM_DIDIT_BASE: `http://127.0.0.1:${DIDIT_PORT}`,
    MM_DIDIT_CALLBACK: 'moneymart://verification',
    APNS_KEY_ID: 'KEY1234567',
    APNS_TEAM_ID: 'TEAM123456',
    APNS_PRIVATE_KEY: pem.replace(/\n/g, '\\n'),
    MM_APNS_BASE: `http://127.0.0.1:${APNS_PORT}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
const cleanup = () => {
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  didit.close();
  apns.close();
};
process.on('exit', cleanup);

const deadline = Date.now() + 30_000;
let up = false;
while (Date.now() < deadline && !up) {
  try { up = (await fetch(`${API}/api/health`)).ok; } catch { /* starting */ }
  if (!up) await sleep(250);
}
if (!up) {
  check(false, 'API started', serverLog.slice(-600));
  process.exit(1);
}

const call = async (pathname, { method = 'GET', user, body, headers = {}, raw } = {}) => {
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-mm-user': user } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try { json = await response.json(); } catch { /* none */ }
  return { status: response.status, json };
};
const OWNER = 'usr_house';
const inbox = async (user) => (await call('/api/notifications', { user })).json?.items ?? [];

/* A brand-new member, so the check starts from unverified. */
const RUN = Date.now().toString(36);
const identifier = `seller.${RUN}@example.com`;
const code = (await call('/api/auth/request', { method: 'POST', body: { identifier } })).json?.devCode;
const login = await call('/api/auth/verify', { method: 'POST', body: { identifier, code } });
const NEW = login.json?.user?.id;
check(Boolean(NEW), 'a new member signs up', NEW);

/* ── 1 ── */
section('1. A seller starts an identity check');
const before = await call('/api/verification', { user: NEW });
check(before.status === 200 && before.json?.status === 'unverified' && before.json.available && before.json.canStart, 'the check is available and not started', JSON.stringify(before.json).slice(0, 90));
const started = await call('/api/verification/start', { method: 'POST', user: NEW, body: {} });
check(started.status === 200 && /^https:\/\/verify\.didit\.me\/session\//.test(started.json?.url ?? ''), 'Didit returns the hosted page to open', started.json?.url);
const created = diditCalls.find((c) => c.method === 'POST');
check(created?.key === 'test-didit-key' && created.body.workflow_id === 'wf-person' && created.body.vendor_data === NEW, 'a person runs the KYC workflow, tagged with the member id');
check(created?.body.callback === 'moneymart://verification', 'Didit sends the member back into the app (when a return link is set)');
check(started.json?.verification?.status === 'pending' && !JSON.stringify(started.json).includes('secret-token'), 'the account is pending and the session token never leaves the server');
const resumed = await call('/api/verification/start', { method: 'POST', user: NEW, body: {} });
check(resumed.json?.url === started.json?.url && diditCalls.filter((c) => c.method === 'POST').length === 1, 'starting again resumes the same session');
const sessionId = started.json.url.split('/').pop();

/* ── 2 ── */
section('2. The decision arrives');
sessions.get(sessionId).status = 'In Review';
const review = await call('/api/verification/refresh', { method: 'POST', user: NEW });
check(review.json?.status === 'pending' && review.json.providerStatus === 'In Review', 'returning to the app reads the decision from Didit (In Review)');
check((await inbox(NEW)).some((n) => n.title === 'Verification in review'), 'the member is told it is in review');

const envelope = (body, ts = Math.floor(Date.now() / 1000)) => {
  const raw = JSON.stringify(body);
  return { raw, headers: { 'x-timestamp': String(ts), 'x-signature': createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex') } };
};
const approved = { event_id: `evt_${RUN}`, webhook_type: 'status.updated', session_id: sessionId, status: 'Approved', vendor_data: NEW, decision: { id_verification: { status: 'Approved' } } };
const forged = envelope(approved);
check((await call('/api/webhooks/didit', { method: 'POST', raw: forged.raw, headers: { ...forged.headers, 'x-signature': 'f'.repeat(64) } })).status === 401, 'a webhook with a bad signature is refused');
const stale = envelope(approved, Math.floor(Date.now() / 1000) - 900);
check((await call('/api/webhooks/didit', { method: 'POST', raw: stale.raw, headers: stale.headers })).status === 401, 'a webhook older than five minutes is refused');
const other = envelope({ ...approved, event_id: `evt_x_${RUN}`, session_id: 'not-ours' });
const otherRes = await call('/api/webhooks/didit', { method: 'POST', raw: other.raw, headers: other.headers });
check(otherRes.json?.applied === false && otherRes.json.reason === 'unknown_session', 'a session this server did not open changes nothing');
const wrongMember = envelope({ ...approved, event_id: `evt_y_${RUN}`, vendor_data: 'usr_ken' });
check((await call('/api/webhooks/didit', { method: 'POST', raw: wrongMember.raw, headers: wrongMember.headers })).json?.applied === false, 'a session cannot be pointed at another member');
check((await call('/api/verification', { user: NEW })).json?.status === 'pending', 'still pending after the refused deliveries');
const good = envelope(approved);
const goodRes = await call('/api/webhooks/didit', { method: 'POST', raw: good.raw, headers: good.headers });
check(goodRes.status === 200 && goodRes.json?.applied === true, 'a correctly signed webhook is applied');
const after = await call('/api/verification', { user: NEW });
check(after.json?.status === 'verified' && after.json.kycLevel === 2 && after.json.canStart === false, 'the member is verified at level 2', `level ${after.json?.kycLevel}`);
check((await call('/api/webhooks/didit', { method: 'POST', raw: good.raw, headers: good.headers })).json?.reason === 'duplicate', 'a replayed event is ignored');
check((await inbox(NEW)).some((n) => n.title === 'You are verified' && n.href === '/verification'), 'the member is told they are verified');
const late = envelope({ ...approved, event_id: `evt_late_${RUN}`, status: 'In Progress' });
await call('/api/webhooks/didit', { method: 'POST', raw: late.raw, headers: late.headers });
check((await call('/api/verification', { user: NEW })).json?.status === 'verified', 'a late, out-of-order event does not undo a pass');
check((await call('/api/verification/start', { method: 'POST', user: NEW, body: {} })).json?.error === 'already_verified', 'a verified member cannot start another check');

/* A declined business check. */
const code2 = (await call('/api/auth/request', { method: 'POST', body: { identifier: `biz.${RUN}@example.com` } })).json?.devCode;
const BIZ = (await call('/api/auth/verify', { method: 'POST', body: { identifier: `biz.${RUN}@example.com`, code: code2 } })).json?.user?.id;
const bizStart = await call('/api/verification/start', { method: 'POST', user: BIZ, body: { kind: 'business' } });
check(diditCalls.filter((c) => c.method === 'POST').pop()?.body.workflow_id === 'wf-business' && bizStart.json?.verification?.kind === 'business', 'a business runs the KYB workflow');
sessions.get(bizStart.json.url.split('/').pop()).status = 'Declined';
const declined = await call('/api/verification/refresh', { method: 'POST', user: BIZ });
check(declined.json?.status === 'rejected' && declined.json.reason === 'Document expired' && declined.json.canStart === true, 'a decline is shown with its reason and can be retried', declined.json?.reason);

/* ── 3 ── */
section('3. The Owner can require verified sellers');
const sellerSetup = (user) => call('/api/me/seller-profile', { method: 'PUT', user, body: { entity: 'individual', mainCategory: 'food', subcategories: ['food.snacks'], channels: ['social'], socials: { instagram: '@test.sells' }, monthlyRevenue: 'lt_1k', inventorySize: '10_100', teamSize: '1', weeklyLiveHours: '3_10', returnAddress: { fullName: 'Test Seller', line1: '1 Main St', city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'us' } } });
const setupBiz = await sellerSetup(BIZ);
const show = (user) => call('/api/streams', { method: 'POST', user, body: { title: 'Test show', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 3_600_000).toISOString(), format: 'auction' } });
const freeShow = await show(BIZ);
check(setupBiz.status === 200 && freeShow.status !== 403, 'by default an unverified seller can schedule a show', `setup ${setupBiz.status}, show ${freeShow.status}`);
const settingsChange = await call('/api/admin/settings', { method: 'PUT', user: OWNER, body: { changes: [{ key: 'sellers.verification_required', value: true }] } });
check(settingsChange.status === 200, 'the Owner switches on “verified sellers only”', String(settingsChange.status));
const blocked = await show(BIZ);
check(blocked.status === 403 && blocked.json?.error === 'verification_required', 'an unverified seller is then asked to verify first');
await sellerSetup(NEW);
const allowed = await show(NEW);
check(allowed.status !== 403, 'a verified seller still can', String(allowed.status));
await call('/api/admin/settings', { method: 'PUT', user: OWNER, body: { changes: [{ key: 'sellers.verification_required', value: false }] } });
const list = await call('/api/admin/verifications', { user: OWNER });
check(list.status === 200 && list.json?.configured?.webhook === true && list.json.rows.some((r) => r.userId === NEW && r.status === 'verified'), 'the console lists each check and its outcome');
check((await call('/api/admin/verifications', { user: NEW })).status === 404, 'a member cannot see the list');

/* ── 4 ── */
section('4. iPhone push');
const TOKEN = 'a'.repeat(64);
const DEAD = 'd'.repeat(64);
check((await call('/api/devices', { method: 'POST', user: NEW, body: { token: 'not-hex' } })).status === 400, 'a malformed device token is refused');
const reg = await call('/api/devices', { method: 'POST', user: NEW, body: { token: TOKEN } });
check(reg.status === 200 && reg.json?.push === true, 'the phone registers for push');
pushes.length = 0;
const toNew = await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Welcome aboard', body: 'Your shop is ready.', audience: `member:${login.json.user.handle}` } });
await sleep(800);
const p1 = pushes.find((p) => p.token === TOKEN);
check(toNew.status === 200 && toNew.json?.broadcast?.recipients === 1, 'the Owner messages one member by handle');
check(p1?.signed === true && p1.header.alg === 'ES256' && p1.header.kid === 'KEY1234567' && p1.claims.iss === 'TEAM123456', 'Apple receives a correctly signed ES256 provider token');
check(p1?.topic === 'com.rubynav.moneymart' && p1.type === 'alert' && p1.payload.aps?.alert?.title === 'Welcome aboard' && p1.payload.href === '/notifications', 'the push carries title, body, app link and the app’s topic');
check(typeof p1?.payload.aps?.badge === 'number' && p1.payload.aps.badge >= 1, 'the badge shows the unread count', String(p1?.payload.aps?.badge));

// Switch off order updates: inbox still fills, the phone stays quiet.
await call('/api/me', { method: 'PATCH', user: NEW, body: { preferences: { notifications: { marketing: false } } } });
pushes.length = 0;
const optedOut = await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Sale', body: 'Fees off.', audience: `member:${login.json.user.handle}`, kind: 'marketing' } });
await sleep(600);
check(optedOut.json?.broadcast?.recipients === 0 && pushes.length === 0, 'a member who switched marketing off gets no offers, in the inbox or on the phone');
await call('/api/me', { method: 'PATCH', user: NEW, body: { preferences: { notifications: { marketing: true } } } });
pushes.length = 0;
const marketing = await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Weekend drop', body: 'Ten percent off fees this weekend.', audience: `member:${login.json.user.handle}`, kind: 'marketing' } });
await sleep(600);
check(marketing.json?.broadcast?.title === 'Offer: Weekend drop' && pushes.length === 1, 'marketing reaches members who allow it');

// Dead tokens are removed after Apple says so.
await call('/api/devices', { method: 'POST', user: BIZ, body: { token: DEAD } });
deadTokens.add(DEAD);
pushes.length = 0;
const bizHandle = (await call('/api/me', { user: BIZ })).json?.user?.handle;
await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Hello', body: 'First message.', audience: `member:${bizHandle}` } });
await sleep(600);
pushes.length = 0;
await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Hello again', body: 'Second message.', audience: `member:${bizHandle}` } });
await sleep(600);
check(pushes.filter((p) => p.token === DEAD).length === 0, 'a token Apple reports as gone is dropped and not used again');
check((await call(`/api/devices/${TOKEN}`, { method: 'DELETE', user: 'usr_ken' })).json?.removed === false, 'another member cannot remove your phone');

/* ── 5 ── */
section('5. Automatic alerts for orders');
await call('/api/dev/reset', { method: 'POST', user: OWNER });
await call('/api/dev/clock', { method: 'POST', user: OWNER, body: { auctionId: 'auc_charizard', secondsFromNow: 1, status: 'live' } });
await sleep(3500);
const ledger = await call('/api/escrow');
const record = (ledger.json?.records ?? []).find((r) => r.state === 'requires_payment');
const order = record ? ((await call('/api/orders?userId=usr_sofia', { user: 'usr_sofia' })).json?.buying ?? []).find((o) => o.id === record.orderId) : null;
check(Boolean(order), 'a lot is sold', order?.id);
if (order) {
  check((await inbox(order.buyerId)).some((n) => n.title === 'You won the lot'), 'the winner is told they won');
  check((await inbox(order.sellerId)).some((n) => n.title === 'Your lot sold'), 'the seller is told it sold');
  await call(`/api/orders/${order.id}/pay`, { method: 'POST', user: order.buyerId, body: {} });
  check((await inbox(order.sellerId)).some((n) => n.title === 'Paid — ready to ship' && n.href === `/orders/${order.id}`), 'once paid, the seller is told to ship');
  await call(`/api/orders/${order.id}/status`, { method: 'POST', user: order.sellerId, body: { orderStatus: 'shipped', trackingNumber: '1Z999', courierName: 'UPS' } });
  const shipped = (await inbox(order.buyerId)).find((n) => n.title === 'Your order shipped');
  check(Boolean(shipped) && shipped.body.includes('UPS tracking 1Z999'), 'the buyer is told it shipped, with tracking', shipped?.body);
  await call(`/api/orders/${order.id}/status`, { method: 'POST', user: order.sellerId, body: { orderStatus: 'shipped' } });
  check((await inbox(order.buyerId)).filter((n) => n.title === 'Your order shipped').length === 1, 'saving the same status again does not repeat the alert');
}

/* ── 6 ── */
section('6. Owner messages to members');
const preview = await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Hi', body: 'Hello sellers', audience: 'sellers', preview: true } });
check(preview.json?.ok === true && preview.json.recipients > 0, 'a preview counts who would receive it', `${preview.json?.recipients} sellers`);
check((await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: '', body: 'x', audience: 'everyone' } })).status === 400, 'an empty title is refused');
check((await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'x', body: 'y', audience: 'everyone', href: 'https://evil.example' } })).status === 400, 'links must stay inside the app');
check((await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'x', body: 'y', audience: 'member:nobody_here' } })).status === 400, 'an unknown member is refused');
check((await call('/api/admin/notify', { method: 'POST', user: 'usr_ken', body: { title: 'x', body: 'y', audience: 'everyone' } })).status === 404, 'a member cannot send messages');
const sent = await call('/api/admin/notify', { method: 'POST', user: OWNER, body: { title: 'Seller week', body: 'Schedule a show this week and we feature it on Home.', audience: 'sellers' } });
check(sent.status === 200 && sent.json?.broadcast?.recipients === preview.json?.recipients, 'the Owner sends to all sellers', `${sent.json?.broadcast?.recipients} members`);
check((await inbox('usr_ada')).some((n) => n.title === 'Seller week'), 'a seller receives it');
const buyerProfile = (await call('/api/me/seller-profile', { user: 'usr_sofia' })).json?.sellerProfile;
check(buyerProfile || !(await inbox('usr_sofia')).some((n) => n.title === 'Seller week'), 'a buyer does not');
const status = await call('/api/admin/notify', { user: OWNER });
check(status.json?.history?.[0]?.title === 'Seller week' && status.json.delivery.push === true && status.json.audiences.length === 5, 'the console shows delivery status, audiences and history');
const auditLog = await call('/api/admin/audit', { user: OWNER });
check(JSON.stringify(auditLog.json).includes('notify.send'), 'every send is in the audit log');

/* ── 7 ── */
section('7. In production, Didit reaches the webhook without a member session');
{
  const PROD_PORT = PORT + 3;
  const prod = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: { ...process.env, PORT: String(PROD_PORT), NODE_ENV: 'production', MM_SEED: 'true', MM_PERSISTENCE: 'off', DIDIT_WEBHOOK_SECRET: WEBHOOK_SECRET, MM_OWNER_EMAILS: '' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${PROD_PORT}`;
  let ready = false;
  for (let i = 0; i < 80 && !ready; i += 1) {
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); }
  }
  const post = async (p, raw, headers = {}) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const unsigned = await post('/api/webhooks/didit', '{"session_id":"x"}');
  check(unsigned.status === 401 && unsigned.json?.error === 'bad_signature', 'an unsigned call is refused by the signature check, not the sign-in gate');
  const signed = envelope({ event_id: `evt_prod_${RUN}`, session_id: 'unknown', status: 'Approved' });
  const through = await post('/api/webhooks/didit', signed.raw, signed.headers);
  check(through.status === 200 && through.json?.reason === 'unknown_session', 'a signed call gets through');
  check((await post('/api/devices', '{}')).json?.error === 'not_authenticated', 'other routes still need a signed-in member');
  prod.kill('SIGKILL');
}

console.log(`\n  ${fail ? '\u001b[31m' : '\u001b[32m'}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) {
  console.log(`\n  Failed:\n${failures.map((f) => `   - ${f}`).join('\n')}`);
  console.log(serverLog.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
}
cleanup();
process.exit(fail ? 1 : 0);
