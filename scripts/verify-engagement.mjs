#!/usr/bin/env node
/**
 * MoneyMart — Waves B and C: Prize Drops, tips, reactions, Seller Studio, category feed, saved watchlist,
 * coins/challenges/rewards/credit, clubs, referrals, offers, clips, leaderboards, messages, buyer protection,
 * gated categories, promotions, vacation mode and tiered commission.
 *
 * Usage: node scripts/verify-engagement.mjs   (needs the compiled API)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_ENGAGEMENT_PORT ?? 4771);
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

console.log('\n\u001b[1m════════ MoneyMart engagement, seller tools & growth ════════\u001b[0m');
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


const setup = async (user) => call('/api/me/addresses', { method: 'POST', user, body: address() });
const sellerProfile = { entity: 'individual', mainCategory: 'food', subcategories: ['food.snacks'], channels: ['social'], socials: { instagram: '@s' }, monthlyRevenue: 'lt_1k', inventorySize: '10_100', teamSize: '1', weeklyLiveHours: '3_10', returnAddress: { fullName: 'Seller', line1: '1 Market St', city: 'Houston', region: 'TX', postalCode: '77002', countryCode: 'us' } };
const pay = (id, user) => call(`/api/orders/${id}/pay`, { method: 'POST', user, body: {} });

const host = await signUp('host');
await call('/api/me/seller-profile', { method: 'PUT', user: host.id, body: sellerProfile });
const fan = await signUp('fan');
const fan2 = await signUp('fan2');
const nobody = await signUp('noaddr');
await setup(fan.id);
await setup(fan2.id);
const show = (await call('/api/streams', { method: 'POST', user: host.id, body: { title: 'Drop night', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 3_600_000).toISOString(), format: 'mixed' } })).json?.stream;
check(Boolean(show?.id), 'the host schedules a show');
const live = (await call('/api/streams?status=live')).json?.items?.[0];

/* ── 1 ── */
section('1. Prize Drops');
check((await call(`/api/streams/${show.id}/giveaways`, { method: 'POST', user: fan.id, body: { title: 'Free bag' } })).status === 403, 'a viewer cannot start a Prize Drop');
const gw = (await call(`/api/streams/${show.id}/giveaways`, { method: 'POST', user: host.id, body: { title: 'Free snack bag', followersOnly: true } })).json?.giveaway;
check(gw?.status === 'open' && gw.followersOnly, 'the host starts a followers-only Prize Drop');
check((await call(`/api/streams/${show.id}/giveaways`, { method: 'POST', user: host.id, body: { title: 'Second' } })).status === 409, 'only one Prize Drop is open at a time');
const notFollowing = await call(`/api/giveaways/${gw.id}/enter`, { method: 'POST', user: fan.id });
check(notFollowing.status === 409 && notFollowing.json?.error === 'follow_required', 'entering needs a follow', notFollowing.json?.error);
await call(`/api/users/${host.id}/follow`, { method: 'POST', user: fan.id });
await call(`/api/users/${host.id}/follow`, { method: 'POST', user: nobody.id });
check((await call(`/api/giveaways/${gw.id}/enter`, { method: 'POST', user: nobody.id })).json?.error === 'shipping_info_required', 'entering needs a shipping address');
const entered = await call(`/api/giveaways/${gw.id}/enter`, { method: 'POST', user: fan.id });
check(entered.status === 200 && entered.json?.giveaway?.entered && entered.json.giveaway.entrantCount === 1, 'a follower with an address enters');
check((await call(`/api/giveaways/${gw.id}/enter`, { method: 'POST', user: fan.id })).json?.giveaway?.entrantCount === 1, 'entering twice counts once');
check((await call(`/api/giveaways/${gw.id}/enter`, { method: 'POST', user: host.id })).status === 409, 'the host cannot enter');
const drawn = await call(`/api/giveaways/${gw.id}/draw`, { method: 'POST', user: host.id });
check(drawn.status === 200 && drawn.json?.giveaway?.winnerHandle === fan.handle, 'the draw picks the entrant', drawn.json?.giveaway?.winnerHandle);
const prize = (await call(`/api/orders/${drawn.json?.orderId}`, { user: fan.id })).json?.order;
check(prize && prize.totalAmount === 0 && prize.paymentStatus === 'paid' && prize.source === 'prize_drop' && prize.title === 'Free snack bag', 'the winner gets a free, already-settled order', JSON.stringify({ t: prize?.totalAmount, p: prize?.paymentStatus }));
check((await inbox(fan.id)).some((n) => /Prize Drop/.test(n.title)), 'the winner is told');
check((await call(`/api/giveaways/${gw.id}/draw`, { method: 'POST', user: host.id })).status === 409, 'a drawn Prize Drop cannot be drawn again');
const shipped = await call(`/api/orders/${prize.id}/status`, { method: 'POST', user: host.id, body: { orderStatus: 'shipped', trackingNumber: 'TRK1234' } });
check(shipped.status === 200, 'the host ships the prize like any order');
check((await call(`/api/orders/${prize.id}/confirm`, { method: 'POST', user: fan.id })).status === 200, 'the winner confirms it arrived');

/* ── 2 ── */
section('2. Tips, reactions, join lines');
const tip = await call(`/api/streams/${show.id}/tips`, { method: 'POST', user: fan.id, body: { amount: 5, note: 'Love this' } });
check(tip.status === 201 && tip.json?.tip?.currency === 'USD', 'a viewer tips the host in the host’s currency');
check((await call(`/api/streams/${show.id}/tips`, { method: 'POST', user: host.id, body: { amount: 5 } })).status === 409, 'a host cannot tip themselves');
check((await call(`/api/streams/${show.id}/tips`, { method: 'POST', user: fan.id, body: { amount: 5000 } })).status === 400, 'tips are capped');
check((await call('/api/me/tips', { user: host.id })).json?.receivedTotal === 5, 'the host sees tips received');
check((await call(`/api/streams/${show.id}/react`, { method: 'POST', user: fan.id, body: { emoji: '🔥' } })).status === 200, 'a reaction is accepted');
check((await call(`/api/streams/${show.id}/react`, { method: 'POST', user: fan.id, body: { emoji: '🍕' } })).status === 400, 'unknown reactions are refused');

/* ── 3 ── */
section('3. Offers on Buy It Now');
const bin = (await call('/api/auctions', { method: 'POST', user: host.id, body: { title: 'Hot sauce set', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 40, buyItNowPrice: 40, durationDays: 7 } })).json?.auction;
check(Boolean(bin?.id), 'the host lists a Buy It Now item');
check((await call(`/api/auctions/${bin.id}/offers`, { method: 'POST', user: fan.id, body: { amount: 10 } })).json?.error === 'offer_too_low', 'offers under half the price are refused');
check((await call(`/api/auctions/${bin.id}/offers`, { method: 'POST', user: fan.id, body: { amount: 40 } })).json?.error === 'offer_at_price', 'an offer at the price is refused');
const offer = (await call(`/api/auctions/${bin.id}/offers`, { method: 'POST', user: fan.id, body: { amount: 25, message: 'Would you take 25?' } })).json?.offer;
check(offer?.status === 'pending', 'a buyer makes an offer');
check((await call(`/api/auctions/${bin.id}/offers`, { method: 'POST', user: fan.id, body: { amount: 26 } })).json?.error === 'offer_open', 'one open offer per listing');
check((await call(`/api/offers/${offer.id}/accept`, { method: 'POST', user: fan.id })).status === 409, 'the buyer cannot accept their own offer');
const countered = await call(`/api/offers/${offer.id}/counter`, { method: 'POST', user: host.id, body: { amount: 32 } });
check(countered.json?.offer?.status === 'countered' && countered.json.offer.counterAmount === 32, 'the seller counters');
check((await inbox(fan.id)).some((n) => n.title === 'Counter-offer'), 'the buyer hears about the counter');
const accepted = await call(`/api/offers/${offer.id}/accept`, { method: 'POST', user: fan.id });
check(accepted.status === 200 && accepted.json?.offer?.status === 'accepted' && accepted.json.orderId, 'the buyer accepts the counter');
const offerOrder = (await call(`/api/orders/${accepted.json?.orderId}`, { user: fan.id })).json?.order;
check(offerOrder?.hammerPrice === 32 && offerOrder.source === 'offer', 'the order is at the agreed price', `${offerOrder?.hammerPrice}`);
check((await call(`/api/auctions/${bin.id}`)).json?.auction?.status === 'sold' || (await call(`/api/auctions/${bin.id}`)).json?.status === 'sold', 'the last unit sold closes the listing');
check(((await call('/api/me/offers', { user: host.id })).json?.received ?? []).length === 1, 'the seller sees offers received');

/* ── 4 ── */
section('4. Credit, coins, challenges, referrals');
const wallet0 = (await call('/api/me/wallet', { user: fan2.id })).json;
check(wallet0?.coins === 0 && wallet0.challenges.length >= 5 && wallet0.rewards.length >= 3, 'a new member has a wallet with challenges and rewards');
const code = (await call('/api/me/referral', { user: fan.id })).json?.code;
check(Boolean(code), 'every member has an invite code', code);
check((await call('/api/referrals/claim', { method: 'POST', user: fan.id, body: { code } })).status === 404, 'you cannot use your own code');
check((await call('/api/referrals/claim', { method: 'POST', user: fan2.id, body: { code } })).status === 201, 'a new member uses a friend’s code');
check((await call('/api/referrals/claim', { method: 'POST', user: fan2.id, body: { code } })).status === 409, 'only once');
const bin2 = (await call('/api/auctions', { method: 'POST', user: host.id, body: { title: 'Snack box', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 20, buyItNowPrice: 20, durationDays: 7 } })).json?.auction;
await call(`/api/auctions/${bin2.id}/buy-now`, { method: 'POST', user: fan2.id, body: {} });
const fan2Order = (await call('/api/orders', { user: fan2.id })).json?.buying?.find((o) => o.auctionId === bin2.id);
check(Boolean(fan2Order), 'the invited member buys');
check((await call(`/api/orders/${fan2Order.id}/apply-credit`, { method: 'POST', user: fan2.id })).json?.error === 'no_credit', 'there is no credit before the first payment');
check((await pay(fan2Order.id, fan2.id)).status === 200, 'and pays');
check((await call('/api/me/wallet', { user: fan2.id })).json?.creditUSD === 5 && (await call('/api/me/wallet', { user: fan.id })).json?.creditUSD === 5, 'both members get $5 credit after the first payment');
const fanW = (await call('/api/me/wallet', { user: fan.id })).json;
check(fanW.challenges.find((c) => c.id === 'invite_friend')?.done, 'the invite challenge is done');
const claim = await call('/api/me/challenges/invite_friend/claim', { method: 'POST', user: fan.id });
check(claim.status === 200 && claim.json.coins === 300, 'claiming pays the coins', `${claim.json?.coins}`);
check((await call('/api/me/challenges/invite_friend/claim', { method: 'POST', user: fan.id })).status === 409, 'a challenge is claimed once');
check((await call('/api/me/challenges/watch_30/claim', { method: 'POST', user: fan2.id })).status === 409, 'an unfinished challenge cannot be claimed');
check((await call('/api/me/rewards/credit_5/redeem', { method: 'POST', user: fan.id })).json?.error === 'not_enough_coins', 'rewards need enough coins');
if (live) {
  const t1 = await call(`/api/streams/${live.id}/watch-tick`, { method: 'POST', user: fan2.id });
  const t2 = await call(`/api/streams/${live.id}/watch-tick`, { method: 'POST', user: fan2.id });
  check(t1.json?.earned === 1 && t2.json?.earned === 0, 'Watch & Earn pays a coin a minute, no faster');
}
const bin3 = (await call('/api/auctions', { method: 'POST', user: host.id, body: { title: 'Jerky', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 30, buyItNowPrice: 30, durationDays: 7 } })).json?.auction;
await call(`/api/auctions/${bin3.id}/buy-now`, { method: 'POST', user: fan.id, body: {} });
const fanOrder = (await call('/api/orders', { user: fan.id })).json?.buying?.find((o) => o.auctionId === bin3.id);
const credited = await call(`/api/orders/${fanOrder.id}/apply-credit`, { method: 'POST', user: fan.id });
check(credited.status === 200 && credited.json?.order?.creditApplied === 5 && Math.abs(credited.json.order.totalAmount - (fanOrder.totalAmount - 5)) < 0.01, 'credit comes off an unpaid order', `${fanOrder.totalAmount} → ${credited.json?.order?.totalAmount}`);
check((await call(`/api/orders/${fanOrder.id}/apply-credit`, { method: 'POST', user: fan.id })).status === 409, 'credit is used once per order');
check((await pay(fanOrder.id, fan.id)).status === 200, 'the reduced total is paid');

/* ── 5 ── */
section('5. Seller Studio, clubs, leaderboards, commission');
const studio = (await call('/api/seller/studio', { user: host.id })).json;
check(studio?.toShip?.some((o) => o.id === fanOrder.id) && studio.toShip.some((o) => o.id === fan2Order.id), 'orders to ship list the paid orders', `${studio?.toShip?.length}`);
check(studio?.health?.metrics?.length === 4 && studio.health.metrics.every((m) => m.value >= 0 && m.value <= 100), 'account health shows four measures');
check(studio?.commission?.tier?.id === 'starter' && studio.commission.tier.rate === 0.1 && studio.commission.tiers.at(-1).rate === 0.08, 'commission starts at 10% and goes down to 8%');
check(studio?.commission?.byCategory?.find((c) => c.id === 'watches')?.rate === 0.12, 'luxury categories cost two points more');
check(studio?.payouts?.tips === 5 && studio.payouts.held > 0, 'payouts show money held and tips');
const club = (await call(`/api/users/${host.id}/club`, { user: fan.id })).json;
check(club?.you?.tier?.id === 'bronze' && club.tiers.length === 3, 'a buyer who paid is in the seller’s Bronze club', club?.you?.tier?.id);
const board = (await call('/api/leaderboards?category=food')).json;
check(board?.items?.some((r) => r.seller?.id === host.id), 'the seller appears on the category leaderboard');
check((await call(`/api/users/${host.id}/ranks`)).json?.items?.some((r) => r.categoryId === 'food' && r.rank >= 1), 'and has a “#N in Food” rank');

/* ── 6 ── */
section('6. Category feed and watchlist');
const feed = (await call('/api/categories/food/feed?sort=new')).json;
check(feed?.category?.id === 'food' && Array.isArray(feed.live) && Array.isArray(feed.listings), 'a category page has live shows and listings');
check((await call('/api/categories/food/feed?sort=bin')).json?.listings?.every((a) => a.buyItNowPrice > 0), 'Buy It Now sort shows only Buy It Now');
check((await call('/api/categories/nope/feed')).status === 404, 'unknown categories are 404');
const someLot = (await call('/api/auctions?status=live&limit=5')).json?.items?.[0];
await call(`/api/me/watchlist/${someLot.id}`, { method: 'PUT', user: fan.id });
check((await call('/api/me/watchlist', { user: fan.id })).json?.ids?.includes(someLot.id), 'a saved listing stays on the account');
await call(`/api/me/watchlist/${someLot.id}`, { method: 'DELETE', user: fan.id });
check(!(await call('/api/me/watchlist', { user: fan.id })).json?.ids?.includes(someLot.id), 'and can be removed');

/* ── 7 ── */
section('7. Messages');
check((await call(`/api/threads/${fan2.id}`, { method: 'POST', user: nobody.id, body: { body: 'hi' } })).status === 403, 'strangers cannot message each other');
check((await call(`/api/threads/${host.id}`, { method: 'POST', user: nobody.id, body: { body: 'Do you ship to Canada?' } })).status === 201, 'anyone can ask a seller a question');
const reply = await call(`/api/threads/${nobody.id}`, { method: 'POST', user: host.id, body: { body: 'Yes!' } });
check(reply.status === 201, 'the seller answers');
const threads = (await call('/api/me/threads', { user: nobody.id })).json;
check(threads?.items?.[0]?.unread === 1 && threads.unread === 1, 'the thread shows one unread reply');
check((await call(`/api/threads/${host.id}`, { user: nobody.id })).json?.messages?.length === 2 && (await call('/api/me/threads', { user: nobody.id })).json?.unread === 0, 'opening it marks it read');
await call(`/api/users/${fan.id}/follow`, { method: 'POST', user: fan2.id });
await call(`/api/users/${fan2.id}/follow`, { method: 'POST', user: fan.id });
check((await call('/api/me/friends', { user: fan.id })).json?.items?.some((u) => u.id === fan2.id), 'mutual follows are friends');
check((await call(`/api/threads/${fan2.id}`, { method: 'POST', user: fan.id, body: { body: 'Saw your win!' } })).status === 201, 'friends can message');
await call(`/api/users/${fan.id}/block`, { method: 'POST', user: fan2.id });
check((await call(`/api/threads/${fan2.id}`, { method: 'POST', user: fan.id, body: { body: 'hello?' } })).status === 403, 'a block stops messages');
check(studio && (await call('/api/seller/studio', { user: host.id })).json?.health?.metrics?.find((m) => m.id === 'response_rate')?.value === 100, 'answering counts toward the response rate');

/* ── 8 ── */
section('8. Clips, promotions, buyer protection');
const clip = await call(`/api/streams/${show.id}/clips`, { method: 'POST', user: fan.id, body: { title: 'The big reveal', startSec: 10, endSec: 40 } });
check(clip.status === 201 && clip.json?.clip?.shareUrl?.includes('/clips/'), 'a member saves a clip with a share link');
check((await call(`/api/streams/${show.id}/clips`, { method: 'POST', user: fan.id, body: { title: 'Too long', startSec: 0, endSec: 120 } })).status === 400, 'clips are up to 60 seconds');
check((await call(`/api/clips?creator=${host.id}`)).json?.items?.length === 1, 'clips list by seller');
check((await call('/api/promos', { method: 'POST', user: fan.id, body: { kind: 'stream', targetId: show.id, hours: 1 } })).status === 403, 'only the owner promotes a show');
const promo = await call('/api/promos', { method: 'POST', user: host.id, body: { kind: 'stream', targetId: show.id, hours: 3 } });
check(promo.status === 201 && promo.json?.promo?.amount === 12, 'the host promotes the show for 3 hours', `${promo.json?.promo?.amount}`);
const scheduled = (await call('/api/streams?status=scheduled')).json?.items ?? [];
check(scheduled[0]?.id === show.id, 'promoted shows come first');
const policy = (await call('/api/policies/buyer-protection')).json;
check(policy?.windows?.find((w) => w.categoryId === 'watches')?.days === 30 && policy.covered.length === 4, 'buyer protection lists claim windows by category');

/* ── 9 ── */
section('9. Gated categories and vacation mode');
const gating = await call('/api/admin/settings', { method: 'PUT', user: OWNER, body: { changes: [{ key: 'categories.gated', value: ['watches'] }] } });
check(gating.status === 200, 'the Owner gates Watches', String(gating.status));
const gatedTry = await call('/api/auctions', { method: 'POST', user: host.id, body: { title: 'Rolex', description: 'x', categoryId: 'watches', condition: 'good', auctionType: 'buy_now', startingPrice: 900, buyItNowPrice: 900, durationDays: 7 } });
check(gatedTry.status === 403 && gatedTry.json?.error === 'category_gated', 'an unverified seller cannot list in a gated category', `${gatedTry.status} ${gatedTry.json?.error}`);
const vac = await call('/api/me/vacation', { method: 'PUT', user: host.id, body: { on: true, message: 'Back Monday' } });
check(vac.json?.vacation?.on === true, 'the seller turns on vacation mode');
check((await call('/api/auctions', { method: 'POST', user: host.id, body: { title: 'More sauce', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 9, buyItNowPrice: 9, durationDays: 7 } })).json?.error === 'on_vacation', 'no new listings on vacation');
check((await call('/api/streams', { method: 'POST', user: host.id, body: { title: 'x', categoryId: 'food', subcategoryId: 'food.snacks', scheduledStartTime: new Date(Date.now() + 9_000_000).toISOString(), format: 'auction' } })).json?.error === 'on_vacation', 'no new shows on vacation');
check((await call(`/api/users/${host.id}/ranks`)).json?.vacation?.message === 'Back Monday', 'the profile says the seller is away');
await call('/api/me/vacation', { method: 'PUT', user: host.id, body: { on: false } });
check((await call('/api/auctions', { method: 'POST', user: host.id, body: { title: 'Back sauce', description: 'x', categoryId: 'food', condition: 'new', auctionType: 'buy_now', startingPrice: 9, buyItNowPrice: 9, durationDays: 7 } })).status < 300, 'listing works again after vacation');

console.log(`\n  ${fail ? '\u001b[31m' : '\u001b[32m'}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) {
  console.log(`\n  Failed:\n${failures.map((f) => `   - ${f}`).join('\n')}`);
  console.log(serverLog.split('\n').filter((l) => /error/i.test(l)).slice(-8).join('\n'));
}
child.kill('SIGKILL');
process.exit(fail ? 1 : 0);
