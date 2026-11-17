#!/usr/bin/env node
/**
 * MoneyMart — categories, seller onboarding and seller-owned shows.
 *
 * Before this, a seller could not create a show at all (shows were seed data),
 * any caller could start an item in or end someone else's show, a listing could
 * never be placed in a show, and the ten flat categories left most retail with
 * nowhere to go. This suite pins the replacement:
 *
 *   - the taxonomy is complete and validated on write,
 *   - a seller must finish onboarding (with a real return address) to schedule,
 *   - only the host can edit, fill, run or end their show,
 *   - a listing joins one open show at a time,
 *   - private seller data stays off public profiles.
 *
 * Usage: node scripts/verify-shows.mjs   (needs the compiled API: pnpm build:api)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_SHOWS_PORT ?? 4690);
const PROD_PORT = PORT + 1;
const API = `http://127.0.0.1:${PORT}`;
const PROD = `http://127.0.0.1:${PROD_PORT}`;

let pass = 0;
let fail = 0;
const failures = [];
const ok = (label, extra = '') => {
  pass += 1;
  console.log(`  \u001b[32m✔\u001b[0m ${label}${extra ? `  \u001b[2m${extra}\u001b[0m` : ''}`);
};
const bad = (label, extra = '') => {
  fail += 1;
  failures.push(label);
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}\u001b[0m` : ''}`);
};
const check = (condition, label, extra = '') => (condition ? ok(label, extra) : bad(label, extra));
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);

console.log('\n\u001b[1m════════ MoneyMart categories, sellers & shows ════════\u001b[0m');

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

const children = [];
function startGateway(port, env = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: { ...process.env, PORT: String(port), MM_SEED: 'true', MM_PERSISTENCE: 'off', MM_AUTH_DEV_CODES: 'true', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
}
const cleanup = () => children.forEach((child) => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(1); });

async function waitFor(base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

startGateway(PORT, { NODE_ENV: 'development' });
startGateway(PROD_PORT, { NODE_ENV: 'production' });
if (!(await waitFor(API)) || !(await waitFor(PROD))) {
  bad('gateways started');
  process.exit(1);
}
ok('a development and a production-posture gateway are running');

const call = async (base, pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let json = null;
  try { json = await response.json(); } catch { /* no body */ }
  return { status: response.status, json };
};
const as = (id) => ({ 'x-mm-user': id });

const SELLER = 'usr_you';
const others = (await call(API, '/api/users')).json ?? [];
const OTHER = others.find((u) => u.id !== SELLER)?.id;
check(Boolean(OTHER), 'a second account exists to act as an outsider', OTHER);

const hourAhead = () => new Date(Date.now() + 3600_000).toISOString();
const address = { fullName: 'Ada Seller', line1: '12 Market Street', city: 'Houston', region: 'TX', postalCode: '77002', countryCode: 'us' };

/* ── 1. Taxonomy ───────────────────────────────────────────────────────── */
section('1. The category taxonomy is complete');
const tree = (await call(API, '/api/categories')).json?.items ?? [];
check(tree.length >= 30, 'at least 30 categories are offered', `${tree.length}`);
check(tree.every((c) => c.subcategories?.length >= 3), 'every category has subcategories');
check(tree.some((c) => c.id === 'food') && tree.some((c) => c.id === 'tools'), 'food and tools are now categories');
check(['sneakers', 'watches', 'jewelry', 'art', 'collectibles', 'cards', 'fashion', 'electronics', 'vehicles', 'antiques'].every((id) => tree.some((c) => c.id === id)), 'the original ten ids are kept');
const config = (await call(API, '/api/config')).json;
check((config?.categories ?? []).length === tree.length, 'the config endpoint lists the same categories');

const reqOk = await call(API, '/api/categories/requests', { method: 'POST', headers: as(SELLER), body: { name: 'Fountain Pens', parentId: 'collectibles' } });
check(reqOk.status === 201, 'a seller can request a missing category', `${reqOk.status}`);
const reqBad = await call(API, '/api/categories/requests', { method: 'POST', headers: as(SELLER), body: { name: 'x' } });
check(reqBad.status === 400, 'a one-letter category request is refused', `${reqBad.status}`);
const reqAnon = await call(PROD, '/api/categories/requests', { method: 'POST', body: { name: 'Fountain Pens' } });
check(reqAnon.status === 401, 'an anonymous category request is refused in production', `${reqAnon.status}`);

/* ── 2. Listings use the taxonomy ──────────────────────────────────────── */
section('2. Listings are filed under real categories');
const listing = (body) => call(API, '/api/auctions', { method: 'POST', headers: as(SELLER), body: { title: 'Candy crate', description: 'Mixed candy', condition: 'new', auctionType: 'buy_now', startingPrice: 20, buyItNowPrice: 20, durationDays: 7, ...body } });
const unknownCat = await listing({ categoryId: 'not-a-category' });
check(unknownCat.status === 400 && unknownCat.json?.error === 'unknown_category', 'an unknown category is refused', `${unknownCat.status}`);
const wrongSub = await listing({ categoryId: 'food', subcategoryId: 'tools.power' });
check(wrongSub.status === 400 && wrongSub.json?.error === 'unknown_subcategory', 'a subcategory from another category is refused', `${wrongSub.status}`);
const food = await listing({ categoryId: 'food', subcategoryId: 'food.snacks' });
check(food.status === 201 && food.json?.item?.subcategoryId === 'food.snacks', 'a food listing with a subcategory is created', `${food.status}`);
const foodId = food.json?.auction?.id;
const second = await listing({ title: 'Coffee sampler', categoryId: 'food', subcategoryId: 'food.coffee-tea' });
const secondId = second.json?.auction?.id;
const bySub = (await call(API, '/api/auctions?subcategory=food.snacks')).json?.items ?? [];
check(bySub.some((a) => a.id === foodId), 'listings can be browsed by subcategory');
const mine = (await call(API, '/api/auctions?seller=me', { headers: as(SELLER) })).json?.items ?? [];
check(mine.length > 0 && mine.every((a) => a.sellerId === SELLER), 'seller=me returns only the caller’s listings', `${mine.length}`);

/* ── 3. Seller onboarding ─────────────────────────────────────────────── */
section('3. A show needs a finished seller profile');
const early = await call(API, '/api/streams', { method: 'POST', headers: as(SELLER), body: { title: 'Candy night', categoryId: 'food', scheduledStartTime: hourAhead() } });
check(early.status === 403 && early.json?.error === 'seller_profile_required', 'scheduling before seller setup is refused', `${early.status}`);

const profile = (body) => call(API, '/api/me/seller-profile', { method: 'PUT', headers: as(SELLER), body: { entity: 'individual', mainCategory: 'food', subcategories: ['food.snacks'], channels: ['social'], socials: { instagram: '@ada.sells' }, monthlyRevenue: 'lt_1k', inventorySize: '10_100', teamSize: '1', weeklyLiveHours: '3_10', returnAddress: address, ...body } });
const poBox = await profile({ returnAddress: { ...address, line1: 'PO Box 77' } });
check(poBox.status === 400, 'a PO box return address is refused', poBox.json?.detail);
const badSub = await profile({ subcategories: ['tools.power'] });
check(badSub.status === 400, 'subcategories outside the main category are refused');
const bizNoType = await profile({ entity: 'business' });
check(bizNoType.status === 400, 'a business must say what kind of business it is');
const saved = await profile({});
check(saved.status === 200 && saved.json?.sellerProfile?.returnAddress?.countryCode === 'US', 'a complete seller profile is saved', `${saved.status}`);
check(saved.json?.user?.role !== 'buyer', 'the account becomes a seller', saved.json?.user?.role);
const me = await call(API, '/api/me', { headers: as(SELLER) });
check(me.json?.user?.sellerProfile?.socials?.instagram === 'ada.sells', 'the profile survives a re-read');
const handle = me.json?.user?.handle;
const publicView = JSON.stringify((await call(API, `/api/users/${handle}`)).json ?? {});
check(!publicView.includes('12 Market Street') && !publicView.includes('sellerProfile'), 'the return address is not on the public profile');

/* ── 4. Creating and editing a show ───────────────────────────────────── */
section('4. A seller schedules their own show');
const create = (body, who = SELLER) => call(API, '/api/streams', { method: 'POST', headers: as(who), body: { title: 'Candy night', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: hourAhead(), format: 'auction', ...body } });
check((await create({ categoryId: 'nope' })).status === 400, 'a show with an unknown category is refused');
check((await create({ scheduledStartTime: new Date(Date.now() - 86_400_000).toISOString() })).status === 400, 'a show in the past is refused');
check((await create({ title: 'x'.repeat(151) })).status === 400, 'a title over 150 characters is refused');
const show = await create({});
const showId = show.json?.stream?.id;
check(show.status === 201 && show.json?.stream?.creatorId === SELLER, 'the show is created with the caller as host', `${show.status}`);
check(show.json?.stream?.status === 'scheduled', 'a new show is scheduled, not live');
check(show.json?.stream?.playback?.mode === 'offline', 'a show with no broadcast does not pretend to play', show.json?.stream?.playback?.mode);
const other = await create({ title: 'Coffee hour' });
const otherShowId = other.json?.stream?.id;

const edit = await call(API, `/api/streams/${showId}`, { method: 'PATCH', headers: as(SELLER), body: { title: 'Candy night — $1 starts', subcategoryId: 'food.international' } });
check(edit.status === 200 && edit.json?.stream?.title.includes('$1'), 'the host can edit a scheduled show');
const editOther = await call(API, `/api/streams/${showId}`, { method: 'PATCH', headers: as(OTHER), body: { title: 'Hijacked' } });
check(editOther.status === 404, 'another account cannot edit the show', `${editOther.status}`);

/* ── 5. Filling the show ──────────────────────────────────────────────── */
section('5. Only the host’s own listings go into the show');
const add = (sid, auctionId, who = SELLER) => call(API, `/api/streams/${sid}/items`, { method: 'POST', headers: as(who), body: { auctionId } });
const added = await add(showId, foodId);
check(added.status === 201 && added.json?.stream?.itemQueue?.includes(foodId), 'the host adds a listing to the run order', `${added.status}`);
await add(showId, secondId);
const twice = await add(otherShowId, foodId);
check(twice.status === 409 && twice.json?.error === 'listing_in_other_show', 'the same listing cannot sit in two open shows', `${twice.status}`);
const foreign = (await call(API, '/api/auctions')).json?.items?.find((a) => a.sellerId !== SELLER && a.isLive);
const steal = await add(showId, foreign?.id);
check(steal.status === 404, 'someone else’s listing cannot be added', `${steal.status}`);
const outsiderAdd = await add(showId, foodId, OTHER);
check(outsiderAdd.status === 404, 'an outsider cannot add items to the show', `${outsiderAdd.status}`);
const removed = await call(API, `/api/streams/${showId}/items/${secondId}`, { method: 'DELETE', headers: as(SELLER) });
check(removed.status === 200 && !removed.json?.stream?.itemQueue?.includes(secondId), 'the host can take an item out');

/* ── 6. Running the show ──────────────────────────────────────────────── */
section('6. Only the host can run or end the show');
const hijack = await call(API, `/api/streams/${showId}/items/${foodId}/activate`, { method: 'POST', headers: as(OTHER) });
check(hijack.status === 404, 'an outsider cannot put an item on screen', `${hijack.status}`);
const notQueued = await call(API, `/api/streams/${showId}/items/${secondId}/activate`, { method: 'POST', headers: as(SELLER) });
check(notQueued.status === 404, 'an item outside the run order cannot be put on screen', `${notQueued.status}`);
const run = await call(API, `/api/streams/${showId}/items/${foodId}/activate`, { method: 'POST', headers: as(SELLER) });
check(run.status === 200 && run.json?.stream?.status === 'live', 'the host puts the item on screen and the show goes live', `${run.status}`);
const editLive = await call(API, `/api/streams/${showId}`, { method: 'PATCH', headers: as(SELLER), body: { title: 'Changed' } });
check(editLive.status === 409, 'a live show cannot be edited like a scheduled one', `${editLive.status}`);
const endOther = await call(API, `/api/streams/${showId}/end`, { method: 'POST', headers: as(OTHER) });
check(endOther.status === 404, 'an outsider cannot end the show', `${endOther.status}`);
const ended = await call(API, `/api/streams/${showId}/end`, { method: 'POST', headers: as(SELLER) });
check(ended.status === 200 && ended.json?.stream?.status === 'ended', 'the host ends the show');

/* ── 7. My shows and cancelling ───────────────────────────────────────── */
section('7. The host sees their shows and can cancel one');
const myShows = (await call(API, '/api/me/streams', { headers: as(SELLER) })).json;
check(myShows?.upcoming?.some((s) => s.id === otherShowId) && myShows?.past?.some((s) => s.id === showId), 'upcoming and past shows are listed');
const cancelOther = await call(API, `/api/streams/${otherShowId}`, { method: 'DELETE', headers: as(OTHER) });
check(cancelOther.status === 404, 'an outsider cannot cancel the show');
const cancel = await call(API, `/api/streams/${otherShowId}`, { method: 'DELETE', headers: as(SELLER) });
check(cancel.status === 200 && cancel.json?.stream?.status === 'ended', 'the host cancels a scheduled show');

/* ── 8. Guided scheduling (phase 2) ───────────────────────────────────── */
section('8. A schedule of shows is created in one step');
const day = 86_400_000;
const at = (days, hour = 19) => { const d = new Date(Date.now() + days * day); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const batch = (body, who = SELLER) => call(API, '/api/streams/batch', { method: 'POST', headers: as(who), body });
const template = { title: 'Weekly candy drop', categoryId: 'food', subcategoryId: 'food.snacks', format: 'auction', mutedWords: ['SPAM', 'scam'], moderators: [OTHER], shipping: { freePickup: true, shippingCap: 10 }, explicit: false };
const series = await batch({ show: template, startTimes: [at(2), at(4), at(9), at(11)] });
check(series.status === 201 && series.json?.streams?.length === 4, 'four shows are scheduled at once', `${series.status}`);
check(series.json?.streams?.every((st) => st.seriesId && st.seriesId === series.json.seriesId), 'they share one series id');
const first = series.json?.streams?.[0];
check(first?.mutedWords?.includes('spam'), 'the host sees muted words, normalised to lower case');
check(first?.moderators?.[0]?.id === OTHER, 'moderators are resolved to accounts');
check(first?.shipping?.shippingCap === 10 && first?.shipping?.freePickup === true, 'shipping options are stored');
check(typeof first?.shareUrl === 'string' && first.shareUrl.endsWith(`/stream/${first.id}`), 'each show has a share link', first?.shareUrl);
const tooClose = await batch({ show: template, startTimes: [at(3), new Date(Date.parse(at(3)) + 10 * 60_000).toISOString()] });
check(tooClose.status === 400, 'shows less than 30 minutes apart are refused');
const oneBad = await batch({ show: template, startTimes: [at(5), new Date(Date.now() - day).toISOString()] });
check(oneBad.status === 400, 'one bad time refuses the whole batch');
const afterBad = (await call(API, '/api/me/streams', { headers: as(SELLER) })).json?.upcoming ?? [];
check(!afterBad.some((st) => Date.parse(st.scheduledStartTime) === Date.parse(at(5))), 'nothing from a refused batch was saved');
check((await batch({ show: template, startTimes: [] })).status === 400, 'an empty schedule is refused');
check((await batch({ show: { ...template, moderators: ['nobody_here_123'] }, startTimes: [at(6)] })).status === 400, 'an unknown moderator is refused');

section('9. Private details stay private');
const publicShow = (await call(API, `/api/streams/${first.id}`)).json;
const publicText = JSON.stringify(publicShow ?? {});
check(!publicText.includes('mutedWords') && !publicText.includes('reminderUserIds'), 'viewers never see muted words or who saved the show');
const privateShow = await create({ title: 'Invite-only drop', visibility: 'private' });
const listed = (await call(API, '/api/streams')).json?.items ?? [];
check(!listed.some((st) => st.id === privateShow.json?.stream?.id), 'a private show is not listed publicly');
check((await call(API, `/api/streams/${privateShow.json?.stream?.id}`)).status === 200, 'a private show still opens from its link');

section('10. Viewers save a show and hear when it starts');
const remind = (sid, who, on = true) => call(API, `/api/streams/${sid}/remind`, { method: 'POST', headers: as(who), body: { on } });
const saved1 = await remind(first.id, OTHER);
check(saved1.status === 200 && saved1.json?.reminded === true && saved1.json?.reminderCount === 1, 'a viewer saves the show', `${saved1.status}`);
check((await remind(first.id, OTHER)).json?.reminderCount === 1, 'saving twice does not double count');
check((await call(API, `/api/streams/${first.id}`, { headers: as(OTHER) })).json?.reminded === true, 'the viewer sees it as saved');
check((await remind(first.id, SELLER)).status === 400, 'the host cannot save their own show');
const noteListing = await listing({ title: 'Reminder lot', categoryId: 'food', subcategoryId: 'food.snacks' });
await add(first.id, noteListing.json?.auction?.id);
const before = ((await call(API, '/api/notifications', { headers: as(OTHER) })).json?.items ?? []).length;
await call(API, `/api/streams/${first.id}/items/${noteListing.json?.auction?.id}/activate`, { method: 'POST', headers: as(SELLER) });
const inbox = (await call(API, '/api/notifications', { headers: as(OTHER) })).json?.items ?? [];
check(inbox.length === before + 1 && inbox[0]?.href === `/stream/${first.id}`, 'the saved viewer is notified when it goes live', `${before} → ${inbox.length}`);
check((await remind(first.id, OTHER, false)).status === 409, 'a live show can no longer be saved or unsaved');
const unsave = await remind(series.json.streams[1].id, OTHER);
const unsaved = await remind(series.json.streams[1].id, OTHER, false);
check(unsave.json?.reminderCount === 1 && unsaved.json?.reminderCount === 0 && unsaved.json?.reminded === false, 'a viewer can unsave a show');

section('11. Muted words are held back in chat');
const chatShow = series.json.streams[2];
const tokenFor = async (userId) => (await call(API, '/api/dev/token', { method: 'POST', body: { userId } })).json?.token;
const viewerToken = await tokenFor(OTHER);
const spy = io(API, { transports: ['websocket'], forceNew: true });
const talker = io(API, { transports: ['websocket'], forceNew: true, auth: { token: viewerToken } });
await Promise.all([spy, talker].map((sock) => new Promise((resolve) => sock.on('connect', resolve))));
const heard = [];
spy.on('chat:message', (message) => heard.push(message.body));
spy.emit('stream:join', chatShow.id);
talker.emit('stream:join', chatShow.id);
await new Promise((resolve) => setTimeout(resolve, 300));
talker.emit('chat:send', { streamId: chatShow.id, userId: OTHER, displayName: 'x', body: 'This is a SCAM listing' });
talker.emit('chat:send', { streamId: chatShow.id, userId: OTHER, displayName: 'x', body: 'Love this candy' });
await new Promise((resolve) => setTimeout(resolve, 600));
check(heard.includes('Love this candy'), 'ordinary chat reaches the room', heard.join(' | '));
check(!heard.some((body) => body.toLowerCase().includes('scam')), 'a message with a muted word is not broadcast');
const stored = JSON.stringify((await call(API, `/api/streams/${chatShow.id}`)).json?.chat ?? []);
check(!stored.toLowerCase().includes('scam'), 'and it is not stored');
spy.close();
talker.close();

const colour = fail ? '\u001b[31m' : '\u001b[32m';
console.log(`\n  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) {
  failures.forEach((label) => console.log(`  - ${label}`));
  process.exit(1);
}
process.exit(0);
