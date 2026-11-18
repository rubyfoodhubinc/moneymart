#!/usr/bin/env node
/**
 * MoneyMart — buyer readiness, shipping per show, Buy It Now stock, follows, blocks, reports and moderation.
 *
 * Starts its own API (development mode, demo identities) and checks: the shipping-address gate before the first
 * bid or buy, addresses, quotes, shipping from the seller's return address and combined once per show with the
 * show's cap, multi-unit Buy It Now, real follows (counts, Following filter, go-live alerts for followers), blocks
 * (no bids, no chat, follows removed), reports to the Owner console, host/moderator tools (pin, remove, timeout),
 * and real seller earnings.
 *
 * Usage: node scripts/verify-community.mjs   (needs the compiled API)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_COMMUNITY_PORT ?? 4770);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n\u001b[1m════════ MoneyMart buyers, shipping, follows & safety ════════\u001b[0m');
const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}
const child = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', MM_SEED: 'true', MM_PERSISTENCE: 'off', MM_AUTH_DEV_CODES: 'true', MM_OWNER_EMAILS: '', RESEND_API_KEY: '', APNS_KEY_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });
process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
for (let i = 0; i < 120; i += 1) {
  try { if ((await fetch(`${API}/api/health`)).ok) break; } catch { /* starting */ }
  await sleep(250);
}

const call = async (pathname, { method = 'GET', user, body } = {}) => {
  const response = await fetch(`${API}${pathname}`, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-mm-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await response.json(); } catch { /* none */ }
  return { status: response.status, json };
};
const RUN = Date.now().toString(36);
const signUp = async (name) => {
  const identifier = `${name}.${RUN}@example.com`;
  const code = (await call('/api/auth/request', { method: 'POST', body: { identifier } })).json?.devCode;
  return (await call('/api/auth/verify', { method: 'POST', body: { identifier, code } })).json?.user;
};
const OWNER = 'usr_house';
const inbox = async (user) => (await call('/api/notifications', { user })).json?.items ?? [];
const address = (over = {}) => ({ fullName: 'Test Buyer', line1: '5 Main St', city: 'Austin', region: 'TX', postalCode: '78701', countryCode: 'US', ...over });

/* ── 1 ── */
section('1. A new buyer adds a shipping address before the first bid');
const buyer = await signUp('buyer');
const liveLot = (await call('/api/auctions?status=live&limit=50')).json?.items?.find((a) => a.auctionType !== 'live_stream' && a.seller.id !== buyer.id && !a.buyItNowPrice);
const minimum = (await call(`/api/auctions/${liveLot.id}`)).json?.minimumBid;
const gated = await call(`/api/auctions/${liveLot.id}/bids`, { method: 'POST', user: buyer.id, body: { amount: minimum } });
check(gated.status >= 400 && JSON.stringify(gated.json).includes('shipping_info_required'), 'a bid without an address is held back with “add your shipping info”', `${gated.status}`);
check((await call('/api/me/addresses', { user: buyer.id })).json?.ready === false, 'the account is not ready yet');
check((await call('/api/me/addresses', { method: 'POST', user: buyer.id, body: address({ countryCode: '' }) })).status === 400, 'an address without a country is refused');
const added = await call('/api/me/addresses', { method: 'POST', user: buyer.id, body: address() });
check(added.status === 200 && added.json?.address?.isDefault === true, 'the first address becomes the default');
const second = await call('/api/me/addresses', { method: 'POST', user: buyer.id, body: address({ line1: '9 Elm St', city: 'Dallas', isDefault: true }) });
const list = second.json?.items ?? [];
check(list.length === 2 && list.filter((a) => a.isDefault).length === 1 && list.find((a) => a.isDefault)?.city === 'Dallas', 'choosing a new default leaves exactly one default');
await call(`/api/me/addresses/${second.json.address.id}`, { method: 'DELETE', user: buyer.id });
check((await call('/api/me/addresses', { user: buyer.id })).json?.items?.[0]?.isDefault === true, 'deleting the default promotes another address');
check((await call('/api/me/addresses', { user: 'usr_ken' })).json?.items?.every((a) => !a.line1.includes('5 Main')), 'addresses are private to their owner');
const okBid = await call(`/api/auctions/${liveLot.id}/bids`, { method: 'POST', user: buyer.id, body: { amount: minimum } });
check(okBid.status === 200, 'with an address the bid goes through', String(okBid.status));
const quote = await call(`/api/auctions/${liveLot.id}/quote?price=40`, { user: buyer.id });
check(quote.status === 200 && quote.json.shipping > 0 && quote.json.total > 40 && quote.json.ready === true, 'the price sheet shows item, shipping, tax and total', `ship ${quote.json?.shipping}, total ${quote.json?.total}`);

/* ── 2 ── */
section('2. Shipping comes from the seller and is paid once per show');
const seller = await signUp('seller');
await call('/api/me/seller-profile', { method: 'PUT', user: seller.id, body: { entity: 'individual', mainCategory: 'food', subcategories: ['food.snacks'], channels: ['social'], socials: { instagram: '@s' }, monthlyRevenue: 'lt_1k', inventorySize: '10_100', teamSize: '1', weeklyLiveHours: '3_10', returnAddress: { fullName: 'Seller', line1: '1 Market St', city: 'Houston', region: 'TX', postalCode: '77002', countryCode: 'us' } } });
const show = (await call('/api/streams', { method: 'POST', user: seller.id, body: { title: 'Snack night', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 3_600_000).toISOString(), format: 'mixed', shipping: { freePickup: false, shippingCap: 15 } } })).json?.stream;
const lot = async (title, extra = {}) => (await call('/api/auctions', { method: 'POST', user: seller.id, body: { title, description: 'x', categoryId: 'food', condition: 'new', auctionType: 'live_stream', startingPrice: 5, durationDays: 7, ...extra } })).json?.auction?.id;
const sellLive = async (id, who, price) => {
  await call(`/api/streams/${show.id}/items`, { method: 'POST', user: seller.id, body: { auctionId: id } });
  await call(`/api/streams/${show.id}/items/${id}/activate`, { method: 'POST', user: seller.id, body: { seconds: 30, startingPrice: price } });
  const detail = (await call(`/api/auctions/${id}`)).json;
  await call(`/api/auctions/${id}/bids`, { method: 'POST', user: who, body: { amount: detail.minimumBid } });
  await call('/api/dev/clock', { method: 'POST', body: { auctionId: id, secondsFromNow: 0 } });
  await sleep(1500);
  return (await call('/api/orders', { user: who })).json?.buying?.find((o) => o.auctionId === id);
};
const first = await sellLive(await lot('Chips'), buyer.id, 10);
const quoteBase = (await call(`/api/auctions/${liveLot.id}/quote?price=10`, { user: buyer.id })).json;
check(Boolean(first) && first.streamId === show.id && first.shipToName === 'Test Buyer' && first.shippingAddress?.city === 'Austin', 'the order carries the show and the buyer’s address', `${first?.shipToName}, ${first?.shippingAddress?.city}`);
check(first && first.shipping > 0 && first.shipping <= 15, 'the first item pays shipping (same state, within the cap)', `$${first?.shipping}`);
check(first && first.shipping < quoteBase.shipping + 0.001, 'same-state shipping is not more than a general quote', `$${first?.shipping} vs $${quoteBase.shipping}`);
const secondOrder = await sellLive(await lot('Candy'), buyer.id, 10);
check(secondOrder && secondOrder.shipping === 0 && /Combined/.test(secondOrder.shippingNote ?? ''), 'the next item in the same show ships free (combined)', `$${secondOrder?.shipping} — ${secondOrder?.shippingNote}`);
const freeShow = (await call('/api/streams', { method: 'POST', user: seller.id, body: { title: 'Free ship night', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 7_200_000).toISOString(), format: 'auction', shipping: { freePickup: false, shippingCap: 0 } } })).json?.stream;
const freeLot = await lot('Tea');
await call(`/api/streams/${freeShow.id}/items`, { method: 'POST', user: seller.id, body: { auctionId: freeLot } });
await call(`/api/streams/${freeShow.id}/items/${freeLot}/activate`, { method: 'POST', user: seller.id, body: { seconds: 30 } });
const fd = (await call(`/api/auctions/${freeLot}`)).json;
await call(`/api/auctions/${freeLot}/bids`, { method: 'POST', user: buyer.id, body: { amount: fd.minimumBid } });
await call('/api/dev/clock', { method: 'POST', body: { auctionId: freeLot, secondsFromNow: 0 } });
await sleep(1500);
const freeOrder = (await call('/api/orders', { user: buyer.id })).json?.buying?.find((o) => o.auctionId === freeLot);
check(freeOrder && freeOrder.shipping === 0 && /Free shipping/.test(freeOrder.shippingNote ?? ''), 'a show with a $0 cap ships free', freeOrder?.shippingNote);

/* ── 3 ── */
section('3. Buy It Now with stock');
const stock = (await call('/api/auctions', { method: 'POST', user: seller.id, body: { title: 'Hot sauce', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 8, buyItNowPrice: 8, quantity: 2, durationDays: 7 } })).json?.auction;
check(stock?.quantity === 2 && stock.quantitySold === 0, 'a listing can offer several units', `qty ${stock?.quantity}`);
check((await call('/api/auctions', { method: 'POST', user: seller.id, body: { title: 'Bad', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 8, buyItNowPrice: 8, quantity: 0, durationDays: 7 } })).status === 400, 'a quantity of 0 is refused');
const b1 = await call(`/api/auctions/${stock.id}/buy-now`, { method: 'POST', user: buyer.id, body: {} });
const afterOne = (await call(`/api/auctions/${stock.id}`)).json?.auction;
check(b1.status === 200 && afterOne.quantitySold === 1 && afterOne.status === 'live', 'one unit sells and the listing stays open', `${afterOne?.quantitySold} sold, ${afterOne?.status}`);
const b2 = await call(`/api/auctions/${stock.id}/buy-now`, { method: 'POST', user: 'usr_ken', body: {} });
const afterTwo = (await call(`/api/auctions/${stock.id}`)).json?.auction;
check(b2.status === 200 && afterTwo.status === 'sold' && afterTwo.quantitySold === 2, 'the last unit closes the listing', afterTwo?.status);
check((await call(`/api/auctions/${stock.id}/buy-now`, { method: 'POST', user: 'usr_sofia', body: {} })).status === 409, 'a sold-out listing cannot be bought');
const buyerOrders = (await call('/api/orders', { user: buyer.id })).json?.buying?.filter((o) => o.auctionId === stock.id) ?? [];
check(buyerOrders.length === 1 && buyerOrders[0].hammerPrice === 8, 'each buyer gets their own order');

/* ── 4 ── */
section('4. Follows');
const fan = await signUp('fan');
const before = (await call(`/api/users/${seller.id}/relationship`, { user: fan.id })).json;
const f = await call(`/api/users/${seller.id}/follow`, { method: 'POST', user: fan.id });
check(f.status === 200 && f.json.following === true && f.json.followersCount === (before.followersCount ?? 0) + 1, 'following adds one to the seller’s followers');
await call(`/api/users/${seller.id}/follow`, { method: 'POST', user: fan.id });
check((await call(`/api/users/${seller.id}/relationship`, { user: fan.id })).json?.followersCount === (before.followersCount ?? 0) + 1, 'following twice counts once');
check((await call(`/api/users/${fan.id}/follow`, { method: 'POST', user: fan.id })).status === 400, 'you cannot follow yourself');
check((await call('/api/me/following', { user: fan.id })).json?.ids?.includes(seller.id), 'your following list includes them');
const followingShows = (await call('/api/streams?following=1', { user: fan.id })).json?.items ?? [];
check(followingShows.length >= 1 && followingShows.every((s) => s.creatorId === seller.id), 'the Following filter shows only their shows', `${followingShows.length} shows`);
check((await call('/api/me/earnings', { user: seller.id })).json?.newFollowers === 1, 'the seller’s earnings page counts real new followers');
const earnings = (await call('/api/me/earnings', { user: seller.id })).json;
check(earnings.itemsSold >= 4 && earnings.gmv > 0 && earnings.series.reduce((s, p) => s + p.value, 0) === earnings.gmv, 'earnings are real sales only (series adds up to the total)', `${earnings.itemsSold} sold, $${earnings.gmv}`);
const emptyEarnings = (await call('/api/me/earnings', { user: fan.id })).json;
check(emptyEarnings.gmv === 0 && emptyEarnings.itemsSold === 0, 'a member with no sales sees zero, not sample numbers');

/* ── 5 ── */
section('5. Blocks and reports');
const troll = await signUp('troll');
await call('/api/me/addresses', { method: 'POST', user: troll.id, body: address() });
await call(`/api/users/${seller.id}/follow`, { method: 'POST', user: troll.id });
const blocked = await call(`/api/users/${troll.id}/block`, { method: 'POST', user: seller.id });
check(blocked.status === 200 && (await call('/api/me/blocks', { user: seller.id })).json?.ids?.includes(troll.id), 'the seller blocks a member');
check((await call(`/api/users/${seller.id}/relationship`, { user: troll.id })).json?.following === false, 'the block removed their follow');
const blockedLot = await lot('Cookies');
await call(`/api/streams/${show.id}/items`, { method: 'POST', user: seller.id, body: { auctionId: blockedLot } });
await call(`/api/streams/${show.id}/items/${blockedLot}/activate`, { method: 'POST', user: seller.id, body: { seconds: 30 } });
const bd = (await call(`/api/auctions/${blockedLot}`)).json;
const blockedBid = await call(`/api/auctions/${blockedLot}/bids`, { method: 'POST', user: troll.id, body: { amount: bd.minimumBid } });
check(blockedBid.status >= 400 && JSON.stringify(blockedBid.json).includes('blocked'), 'a blocked member cannot bid in the seller’s show');
check((await call(`/api/users/${seller.id}/follow`, { method: 'POST', user: troll.id })).status === 403, 'nor follow them again');
await call('/api/dev/clock', { method: 'POST', body: { auctionId: blockedLot, secondsFromNow: 0, status: 'ended' } });
const rep = await call('/api/reports', { method: 'POST', user: fan.id, body: { kind: 'user', targetId: troll.id, reason: 'harassment', note: 'Rude in chat' } });
check(rep.status === 200 && rep.json?.id, 'a member reports another member');
check((await call('/api/reports', { method: 'POST', user: fan.id, body: { kind: 'nonsense', targetId: 'x', reason: 'y' } })).status === 400, 'a malformed report is refused');
const queue = await call('/api/admin/reports', { user: OWNER });
const item = queue.json?.items?.find((r) => r.id === rep.json.id);
check(queue.status === 200 && item && item.status === 'open' && item.target.includes(troll.handle), 'the Owner console lists it with who and what');
check((await call('/api/admin/reports', { user: fan.id })).status === 404, 'members cannot see reports');
check((await call(`/api/admin/reports/${rep.json.id}`, { method: 'POST', user: OWNER, body: { status: 'actioned', resolution: 'Warned' } })).status === 200, 'the Owner closes it');
check(JSON.stringify((await call('/api/admin/audit', { user: OWNER })).json).includes('report.resolve'), 'the decision is in the audit log');

/* ── 6 ── */
section('6. Host and moderators run the chat');
const mod = await signUp('mod');
check((await call(`/api/streams/${show.id}/moderators`, { method: 'PUT', user: fan.id, body: { moderators: [fan.handle] } })).status === 404, 'only the host can name moderators');
const named = await call(`/api/streams/${show.id}/moderators`, { method: 'PUT', user: seller.id, body: { moderators: [mod.handle] } });
if (named.status !== 200) console.log('   moderator patch:', named.status, JSON.stringify(named.json).slice(0, 200));
const room = (await call(`/api/streams/${show.id}`)).json;
check(room.stream.moderators?.some((m) => m.id === mod.id), 'the host names a moderator', room.stream.moderators?.map((m) => m.handle).join(','));
// A chat message is needed; post one through the dev socket-free path: write via host pin test on an existing seeded show instead.
const seededShow = (await call('/api/streams?status=live')).json?.items?.[0];
const seededMsg = (await call(`/api/streams/${seededShow.id}`)).json?.chat?.at(-1);
check((await call(`/api/streams/${seededShow.id}/pin`, { method: 'POST', user: fan.id, body: { messageId: seededMsg.id } })).status === 404, 'a viewer cannot pin');
const pinned = await call(`/api/streams/${seededShow.id}/pin`, { method: 'POST', user: seededShow.creatorId, body: { messageId: seededMsg.id } });
check(pinned.status === 200 && (await call(`/api/streams/${seededShow.id}`)).json?.chat?.find((m) => m.id === seededMsg.id)?.isPinned === true, 'the host pins a message');
const removed = await call(`/api/streams/${seededShow.id}/chat/${seededMsg.id}/remove`, { method: 'POST', user: seededShow.creatorId });
check(removed.json?.removed === true && !(await call(`/api/streams/${seededShow.id}`)).json?.chat?.some((m) => m.id === seededMsg.id), 'the host removes a message');
const timeout = await call(`/api/streams/${show.id}/timeout`, { method: 'POST', user: mod.id, body: { userId: troll.id, minutes: 10 } });
check(timeout.status === 200 && timeout.json?.until, 'a moderator times a member out of chat', timeout.json?.until);
check((await call(`/api/streams/${show.id}/timeout`, { method: 'POST', user: fan.id, body: { userId: troll.id, minutes: 10 } })).status === 404, 'a viewer cannot');
check((await call(`/api/streams/${show.id}/timeout`, { method: 'POST', user: mod.id, body: { userId: seller.id, minutes: 10 } })).status === 400, 'nobody can time out the host');

/* ── 7 ── */
section('7. Followers hear when the seller goes live');
const nextShow = (await call('/api/streams', { method: 'POST', user: seller.id, body: { title: 'Second night', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 9_000_000).toISOString(), format: 'auction' } })).json?.stream;
const firstItem = await lot('Pretzels');
await call(`/api/streams/${nextShow.id}/items`, { method: 'POST', user: seller.id, body: { auctionId: firstItem } });
await call(`/api/streams/${nextShow.id}/items/${firstItem}/activate`, { method: 'POST', user: seller.id, body: { seconds: 30 } });
await sleep(400);
const liveNote = (await inbox(fan.id)).find((n) => n.category === 'streams' && n.href === `/stream/${nextShow.id}`);
check(Boolean(liveNote), 'a follower is told the show is live', liveNote?.title);
check(!(await inbox(troll.id)).some((n) => n.href === `/stream/${nextShow.id}`), 'a blocked member (whose follow was removed) is not');

/* ── 8 ── */
section('8. Countries, currencies and the Owner’s country gates');
const markets = (await call('/api/markets')).json;
check(markets.countries.length >= 13 && markets.countries.every((c) => c.buy && c.sell), 'every MoneyMart country is open by default', `${markets.countries.length} countries`);
check(markets.usdPerUnit.NGN > 0 && markets.usdPerUnit.NGN < 0.01 && markets.usdPerUnit.EUR > 0.5, 'rates are published for conversion', `NGN ${markets.usdPerUnit.NGN}`);
const ngnLot = (await call('/api/auctions?status=live&limit=100')).json?.items?.find((a) => a.currency === 'NGN' && a.seller.id !== buyer.id);
if (ngnLot) {
  const ngnQuote = (await call(`/api/auctions/${ngnLot.id}/quote?price=500000`, { user: buyer.id })).json;
  check(ngnQuote.currency === 'NGN' && ngnQuote.shipping > 5000, 'shipping on a naira listing is in naira, not dollar figures', `NGN ${ngnQuote.shipping}`);
  check(ngnQuote.viewerCurrency === 'USD' && ngnQuote.viewerTotal > 0 && ngnQuote.viewerTotal < ngnQuote.total, 'a US buyer also sees the total in dollars', `$${ngnQuote.viewerTotal} for NGN ${ngnQuote.total}`);
}
check((await call('/api/admin/markets', { method: 'PUT', user: fan.id, body: { countries: { US: { buy: false } } } })).status === 404, 'members cannot change countries');
check((await call('/api/admin/markets', { method: 'PUT', user: OWNER, body: { countries: { XX: { buy: false } } } })).status === 400, 'an unknown country is refused');
const closed = await call('/api/admin/markets', { method: 'PUT', user: OWNER, body: { countries: { US: { buy: false } } } });
check(closed.status === 200 && closed.json.countries.find((c) => c.code === 'US').buy === false, 'the Owner closes the US for buying');
const usBid = await call(`/api/auctions/${liveLot.id}/bids`, { method: 'POST', user: buyer.id, body: { amount: (await call(`/api/auctions/${liveLot.id}`)).json.minimumBid } });
check(usBid.status >= 400 && JSON.stringify(usBid.json).includes('country_closed'), 'a US buyer can no longer bid', `${usBid.status}`);
check((await call('/api/me/addresses', { method: 'POST', user: fan.id, body: address() })).status === 400, 'and new US addresses are refused');
await call('/api/admin/markets', { method: 'PUT', user: OWNER, body: { countries: { US: { buy: true, sell: false } } } });
const usListing = await call('/api/auctions', { method: 'POST', user: seller.id, body: { title: 'Closed', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 5, buyItNowPrice: 5, durationDays: 7 } });
check(usListing.status === 403 && usListing.json?.error === 'country_closed', 'with US selling closed, a US seller cannot list');
check((await call('/api/streams', { method: 'POST', user: seller.id, body: { title: 'Closed show', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 9_900_000).toISOString(), format: 'auction' } })).status === 403, 'nor schedule a show');
const reopened = await call(`/api/auctions/${liveLot.id}/bids`, { method: 'POST', user: buyer.id, body: { amount: (await call(`/api/auctions/${liveLot.id}`)).json.minimumBid } });
check(!JSON.stringify(reopened.json).includes('country_closed'), 'US buyers can buy again once reopened', JSON.stringify(reopened.json).slice(0, 60));
await call('/api/admin/markets', { method: 'PUT', user: OWNER, body: { countries: { US: { buy: true, sell: true } } } });
check(JSON.stringify((await call('/api/admin/audit', { user: OWNER })).json).includes('markets.update'), 'country changes are audited');

console.log(`\n  ${fail ? '\u001b[31m' : '\u001b[32m'}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) {
  console.log(`\n  Failed:\n${failures.map((f) => `   - ${f}`).join('\n')}`);
  console.log(serverLog.split('\n').filter((l) => /error/i.test(l)).slice(-8).join('\n'));
}
child.kill('SIGKILL');
process.exit(fail ? 1 : 0);
