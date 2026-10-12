#!/usr/bin/env node
/**
 * MoneyMart — live engine verification.
 *
 * Exercises the Auction Engine over the real HTTP + WebSocket surface
 * (blueprint §9.2) and asserts each documented guarantee. Zero dependencies:
 * run with `node scripts/verify-engine.mjs` while the API is up.
 */
const API = process.env.API ?? 'http://127.0.0.1:4317';

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, extra = '') {
  pass += 1;
  console.log(`  \u001b[32m✔\u001b[0m ${label}${extra ? `  \u001b[2m${extra}\u001b[0m` : ''}`);
}
function bad(label, extra = '') {
  fail += 1;
  failures.push(label);
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}` : ''}`);
}
function section(title) {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}
function check(label, condition, extra = '') {
  if (condition) ok(label, extra);
  else bad(label, extra);
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

const money = (amount, code) => `${amount.toLocaleString()} ${code}`;

console.log('\n\u001b[1m════════ MoneyMart Auction Engine — live verification ════════\u001b[0m');

/* ── 0. Known-good starting state ───────────────────────────────────────── */
section('0. Reset to a known-good auction house (dev control)');
const reset = await api('/api/dev/reset', { method: 'POST' });
check('seeded world rebuilt', reset.json?.ok === true,
  `${reset.json?.users} users · ${reset.json?.auctions} lots · ${reset.json?.streams} streams`);

/* ── 1. Gateway ─────────────────────────────────────────────────────────── */
section('1. Gateway (§9.1)');
const health = await api('/api/health');
check('health endpoint reports ok', health.json?.ok === true,
  `live streams=${health.json?.liveStreams} live auctions=${health.json?.liveAuctions}`);

/* ── 2. Increment enforcement ───────────────────────────────────────────── */
section('2. Increment check (§9.2 pipeline step 2)');
const hublot = await api('/api/auctions/auc_hublot');
const minHublot = hublot.json.minimumBid;
const curHublot = hublot.json.auction.currentBid;
console.log(`  \u001b[2mcurrent=${curHublot}  minimum next=${minHublot}\u001b[0m`);

const lowball = await api('/api/auctions/auc_hublot/bids', {
  method: 'POST',
  body: { amount: minHublot - 1, bidderId: 'usr_ken' },
});
check('lowball bid rejected as below_minimum_increment',
  lowball.status === 409 && lowball.json?.reason === 'below_minimum_increment',
  `got ${lowball.status} ${lowball.json?.reason ?? ''}`);

/* ── 3. Valid bid accepted ──────────────────────────────────────────────── */
section('3. Valid bid passes the full validation pipeline');
const validBid = await api('/api/auctions/auc_hublot/bids', {
  method: 'POST',
  body: { amount: minHublot, bidderId: 'usr_ken' },
});
check('bid at the minimum increment is accepted', validBid.status === 200 && validBid.json?.ok === true,
  validBid.json?.reason ?? '');
check('current bid advanced to the new amount',
  validBid.json?.auction?.currentBid === minHublot,
  `${curHublot} → ${validBid.json?.auction?.currentBid}`);
check('public bid history records the bid', (validBid.json?.bids?.length ?? 0) > 0,
  `${validBid.json?.bids?.length} bids on the book`);

/* ── 4. Self-bid guard ──────────────────────────────────────────────────── */
section('4. Self-bid guard');
const adire = await api('/api/auctions/auc_adire');
const selfBid = await api('/api/auctions/auc_adire/bids', {
  method: 'POST',
  body: { amount: adire.json.minimumBid, bidderId: 'usr_ada' },
});
check('seller cannot bid on their own lot',
  selfBid.status === 409 && selfBid.json?.reason === 'self_bid',
  selfBid.json?.reason ?? '');

/* ── 5. Already-winning guard ───────────────────────────────────────────── */
section('5. Already-winning guard');
const lebron = await api('/api/auctions/auc_lebron');
const leaderId = lebron.json.auction.currentBidderId;
const again = await api('/api/auctions/auc_lebron/bids', {
  method: 'POST',
  body: { amount: lebron.json.minimumBid, bidderId: leaderId },
});
check('current leader cannot re-bid themselves',
  again.status === 409 && again.json?.reason === 'already_winning',
  again.json?.reason ?? '');

/* ── 6. Anti-snipe extension ────────────────────────────────────────────── */
section('6. Anti-snipe extension (§9.2 step 4 — final 10s → +30s)');
// Move a live lot into its closing window, then bid inside it.
const snipeLot = await api('/api/auctions/auc_kente');
const sniper = snipeLot.json.auction.currentBidderId === 'usr_ken' ? 'usr_sofia' : 'usr_ken';
const armed = await api('/api/dev/clock', {
  method: 'POST',
  body: { auctionId: 'auc_kente', secondsFromNow: 4, status: 'live' },
});
const endBefore = armed.json.auction.endTime;
const closingMin = snipeLot.json.minimumBid;
const snipe = await api('/api/auctions/auc_kente/bids', {
  method: 'POST',
  body: { amount: closingMin, bidderId: sniper },
});
const after = await api('/api/auctions/auc_kente');
const deltaMs = Date.parse(after.json.auction.endTime) - Date.parse(endBefore);
check('bid inside the closing window is accepted', snipe.status === 200, snipe.json?.reason ?? '');
check('anti-snipe extended the clock by ~30 seconds', deltaMs >= 29_000,
  `endTime moved +${(deltaMs / 1000).toFixed(1)}s (window armed at 4s)`);

/* ── 7. Proxy auto-bid war ──────────────────────────────────────────────── */
section('7. Auto-bid proxy resolution (glossary: Auto-Bid)');
// Engineer an unambiguous proxy war. Seed the arena with a modest manual bid,
// then register two proxies with distinct ceilings.
const SOFIA_CEILING = 3200;
const KEN_CEILING = 3400;
const STEP = 25;
await api('/api/dev/clock', {
  method: 'POST',
  body: { auctionId: 'auc_charizard', secondsFromNow: 600, status: 'live' },
});
const arena = await api('/api/auctions/auc_charizard');
const opener = Math.max(arena.json.minimumBid, 1800);
const seedBid = await api('/api/auctions/auc_charizard/bids', {
  method: 'POST',
  body: { amount: opener, bidderId: 'usr_you' },
});
console.log(`  \u001b[2marena opened at ${seedBid.json?.auction?.currentBid ?? '?'} by usr_you\u001b[0m`);

await api('/api/auctions/auc_charizard/auto-bid', {
  method: 'POST',
  body: { maxAmount: SOFIA_CEILING, increment: STEP, bidderId: 'usr_sofia' },
});
const war = await api('/api/auctions/auc_charizard/auto-bid', {
  method: 'POST',
  body: { maxAmount: KEN_CEILING, increment: STEP, bidderId: 'usr_ken' },
});
const settled = await api('/api/auctions/auc_charizard');
const winner = settled.json.auction.currentBidderId;
const price = settled.json.auction.currentBid;

// Mirror of the documented tiered increment schedule (blueprint §9.2 increment check).
function minimumIncrement(current) {
  if (current < 25) return 1;
  if (current < 100) return 5;
  if (current < 250) return 10;
  if (current < 1000) return 25;
  if (current < 2500) return 50;
  if (current < 10_000) return 100;
  if (current < 50_000) return 500;
  return 1000;
}
const tierStep = minimumIncrement(SOFIA_CEILING);
const expected = Math.min(KEN_CEILING, SOFIA_CEILING + tierStep);
console.log(`  \u001b[2mceilings: sofia ${SOFIA_CEILING} / ken ${KEN_CEILING} → leader=${winner} settlement=${price} (rival ceiling + tier step ${tierStep} = ${expected})\u001b[0m`);
check('highest ceiling holds the winning position', winner === 'usr_ken', `leader=${winner}`);
check('settlement equals losing ceiling + one tiered increment',
  Math.abs(price - expected) < 0.01, `${price} vs expected ${expected}`);
check('winner’s true ceiling is never exposed to the room',
  price < KEN_CEILING, `${price} < ceiling ${KEN_CEILING}`);
check('proxy war produced a full auto-generated ladder',
  settled.json.bids.filter((b) => b.isAutoBid).length >= 2,
  `${settled.json.bids.filter((b) => b.isAutoBid).length} auto bids on the book`);
void war;

/* ── 8. Buyer's premium tiers ───────────────────────────────────────────── */
section("8. Buyer’s premium tiers (§10)");

/**
 * The demo buyer (usr_you) holds the Pro entitlement, and Pro pricing applies on
 * top of the disclosed category rate — so the standard 20%/15% disclosure is
 * asserted as a NON-member, which is what a listing must show a bidder. The Pro
 * discount is asserted separately below.
 */
const NON_PRO = 'usr_sofia';
const asNonPro = (path) => api(path, { headers: { 'x-mm-user': NON_PRO } });

const rolex = await asNonPro('/api/auctions/auc_rolex');
const bd = rolex.json.breakdown;
console.log(`  \u001b[2m${rolex.json.auction.title}\u001b[0m`);
console.log(`  \u001b[2mhammer ${money(bd.hammerPrice, bd.currency)} + premium ${money(bd.buyersPremium, bd.currency)} (${(bd.buyersPremiumRate * 100).toFixed(0)}%) + ship ${bd.shipping} + tax ${bd.tax} = ${money(bd.total, bd.currency)}\u001b[0m`);
check('premium math is exact', Math.abs(bd.buyersPremium - bd.hammerPrice * bd.buyersPremiumRate) < 0.02);
check('luxury category (watches) carries the 20% premium', Math.abs(bd.buyersPremiumRate - 0.2) < 0.001,
  `${(bd.buyersPremiumRate * 100).toFixed(0)}%`);
check('total exceeds the hammer price', bd.total > bd.hammerPrice);

const sneaker = await asNonPro('/api/auctions/auc_airmax');
check('standard category (sneakers) carries the 15% premium',
  Math.abs(sneaker.json.breakdown.buyersPremiumRate - 0.15) < 0.001,
  `${(sneaker.json.breakdown.buyersPremiumRate * 100).toFixed(0)}%`);

/**
 * A Pro member must pay the reduced rate on the very same lot: 20% → 15% for
 * luxury, 15% → 10% for standard (§10). Without this the entitlement would be
 * decorative — a member would pay full premium despite the membership.
 */
const proRolex = await api('/api/auctions/auc_rolex', { headers: { 'x-mm-user': 'usr_you' } });
check('Pro member pays the reduced luxury premium (20% → 15%)',
  Math.abs(proRolex.json.breakdown.buyersPremiumRate - 0.15) < 0.001,
  `${(proRolex.json.breakdown.buyersPremiumRate * 100).toFixed(0)}%`);

const proSneaker = await api('/api/auctions/auc_airmax', { headers: { 'x-mm-user': 'usr_you' } });
check('Pro member pays the reduced standard premium (15% → 10%)',
  Math.abs(proSneaker.json.breakdown.buyersPremiumRate - 0.1) < 0.001,
  `${(proSneaker.json.breakdown.buyersPremiumRate * 100).toFixed(0)}%`);

check('the Pro discount actually lowers the total',
  proRolex.json.breakdown.total < rolex.json.breakdown.total,
  `${money(proRolex.json.breakdown.total, bd.currency)} < ${money(rolex.json.breakdown.total, bd.currency)}`);

/* ── 9. Stream item queue ───────────────────────────────────────────────── */
section('9. Stream item queue (§4.1 step 4/6)');
const stream = await api('/api/streams/str_bellvault');
console.log(`  \u001b[2m${stream.json.stream.title} — ${stream.json.queue.length} lots queued, active=${stream.json.stream.activeAuctionId}\u001b[0m`);
stream.json.queue.slice(0, 4).forEach((item) => console.log(`    \u001b[2m· ${item.title.slice(0, 44)} [${item.status}]\u001b[0m`));
check('stream owns an ordered lot queue', stream.json.queue.length >= 3);
check('stream has an active live drop', Boolean(stream.json.stream.activeAuctionId));
check('stream reports a live viewer count', stream.json.stream.viewerCount > 0,
  `${stream.json.stream.viewerCount} viewers`);

/* ── 10. Search service ─────────────────────────────────────────────────── */
section('10. Search service (§9.1 Elasticsearch stand-in)');
const search = await api('/api/auctions?q=rolex');
check('full-text query returns the matching lot', search.json.total >= 1,
  `'rolex' → ${search.json.total} result(s)`);
const facet = await api('/api/auctions?category=watches&sort=price');
check('faceted category filter works', facet.json.items.every((i) => i.item.categoryId === 'watches'),
  `${facet.json.total} watch lots`);
check('sort by price is descending',
  facet.json.items.every((item, index, list) => index === 0 || list[index - 1].currentBid >= item.currentBid));

/* ── 11. Seller listing creation (§5.2 Selling Flow) ────────────────────── */
section('11. Selling Flow — create a listing (§5.2)');
const created = await api('/api/auctions', {
  method: 'POST',
  body: {
    title: 'Verification Lot — 1968 Omega Seamaster',
    description: 'Created by the automated engine verification suite.',
    categoryId: 'watches',
    condition: 'good',
    auctionType: 'traditional',
    startingPrice: 1200,
    reservePrice: 1500,
    durationDays: 7,
    sellerId: 'usr_priya',
  },
});
check('listing created with 201', created.status === 201, `status ${created.status}`);
check('traditional lot starts as scheduled (consignment → catalogue → preview)',
  created.json?.auction?.status === 'scheduled', created.json?.auction?.status ?? '');
check('new lot inherits the luxury premium', Math.abs(created.json?.auction?.buyersPremiumRate - 0.2) < 0.001,
  `${((created.json?.auction?.buyersPremiumRate ?? 0) * 100).toFixed(0)}%`);

/* ── 12. Realtime settlement ────────────────────────────────────────────── */
section('12. Settlement → order → payout notification (§4.1 step 6)');
const ordersBefore = await api('/api/orders?userId=usr_you');
const sellBefore = await api('/api/orders?userId=usr_priya');
check('orders surface returns buying and selling books', Array.isArray(ordersBefore.json.buying) && Array.isArray(sellBefore.json.selling),
  `${ordersBefore.json.buying.length} buying / ${sellBefore.json.selling.length} selling`);
check('wallet exposes available + pending balances',
  typeof (await api('/api/wallet')).json.available === 'number');
check('earnings series has 30 data points',
  (await api('/api/me/earnings')).json.series.length === 30);

/* ── 13. Market data ────────────────────────────────────────────────────── */
section('13. Price history (§4.3 market data)');
const market = await api('/api/market/watches');
check('12 months of completed-sale data', market.json.points?.length === 12,
  `${market.json.points?.length} points`);

/* ── Summary ────────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m══════════════════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((f) => console.log(`    \u001b[31m· ${f}\u001b[0m`));
console.log('\u001b[1m══════════════════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
