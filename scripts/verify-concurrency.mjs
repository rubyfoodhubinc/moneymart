#!/usr/bin/env node
/**
 * MoneyMart — concurrency across auctions.
 *
 * Every other suite drives one trade at a time. The engine has no mutex and no
 * queue, which is correct for Node's single thread ONLY IF no handler awaits in
 * the middle of a mutation. That is an assumption about the shape of the code, and
 * the way to test it is to fire overlapping work and then check the books.
 *
 * Three overlapping situations, each of which breaks in a different way:
 *
 *   1. many bidders on ONE lot at once — two winners, a ladder out of order, or a
 *      lost bid
 *   2. many lots settling in the SAME heartbeat — a double order, an order for the
 *      wrong buyer, or a payout without an escrow
 *   3. bids WHILE lots settle — a bid landing on a closed lot, or an order created
 *      for a lot that still accepts bids
 *
 * The assertions are about invariants, not about timing: the engine is allowed to
 * be fast or slow, but the ledger must be consistent afterwards.
 *
 * Usage: node scripts/verify-concurrency.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_CONCURRENCY_PORT ?? 4650);
const API = `http://127.0.0.1:${PORT}`;

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
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);
const money = (value) => `$${Number(value ?? 0).toFixed(2)}`;

console.log('\n\u001b[1m════════ MoneyMart concurrency ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\u001b[0m`);

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

const gateway = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'development',
    MM_SEED: 'true',
    MM_PERSISTENCE: 'off',
    MM_AUTH_DEV_CODES: 'true',
    /**
     * Headroom for the address ceiling only.
     *
     * This suite creates over thirty accounts in one run, which exceeds the
     * production default of twenty code requests per address per fifteen minutes.
     * The limiter is not what is under test here and is covered by its own suite;
     * the per-SUBJECT cap is not overridable, so a single inbox stays protected.
     */
    MM_AUTH_REQUEST_MAX: '200',
    // Over thirty sign-ins in one run also exceeds the verification ceiling.
    MM_AUTH_VERIFY_MAX: '400',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let gatewayLog = '';
gateway.stdout.on('data', (chunk) => (gatewayLog += chunk));
gateway.stderr.on('data', (chunk) => (gatewayLog += chunk));

const cleanup = () => {
  try {
    gateway.kill('SIGKILL');
  } catch {
    /* already dead */
  }
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

let healthy = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    if ((await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) {
      healthy = true;
      break;
    }
  } catch {
    /* not up yet */
  }
}
if (!healthy) {
  bad('the gateway started', gatewayLog.slice(-200));
  cleanup();
  process.exit(1);
}
ok('the gateway started');

const call = async (pathname, options = {}) => {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

async function signIn(label) {
  const identifier = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@gmail.com`;
  const requested = await call('/api/auth/request', { method: 'POST', body: { identifier } });
  const code = requested.json?.devCode;
  if (!code) {
    if (process.env.MM_CONCURRENCY_DEBUG) {
      console.log(`      \u001b[2m${label}: no code — ${requested.status} ${JSON.stringify(requested.json).slice(0, 90)}\u001b[0m`);
    }
    return null;
  }
  const verified = await call('/api/auth/verify', { method: 'POST', body: { identifier, code } });
  const token = verified.json?.token;
  if (!token) {
    if (process.env.MM_CONCURRENCY_DEBUG) {
      console.log(`      \u001b[2m${label}: verify refused — ${verified.status} ${JSON.stringify(verified.json).slice(0, 90)}\u001b[0m`);
    }
    return null;
  }
  const session = await call('/api/auth/session', { headers: { authorization: `Bearer ${token}` } });
  if (!session.json?.profile?.id) {
    if (process.env.MM_CONCURRENCY_DEBUG) {
      console.log(`      \u001b[2m${label}: session had no profile — ${session.status} ${JSON.stringify(session.json).slice(0, 90)}\u001b[0m`);
    }
    return null;
  }
  return { token, id: session.json.profile.id, handle: session.json.profile.handle, auth: { authorization: `Bearer ${token}` } };
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** List a lot owned by `seller`, returning its id. */
async function list(seller, label, { starting = 100 } = {}) {
  const listing = await call('/api/auctions', {
    method: 'POST',
    headers: seller.auth,
    body: {
      title: `Concurrency lot ${label} ${Date.now()}`,
      description: 'Created by the concurrency verification suite',
      categoryId: 'watches',
      condition: 'good',
      auctionType: 'timed',
      startingPrice: starting,
      durationDays: 1,
      images: [`data:image/png;base64,${PNG}`],
    },
  });
  return listing.json?.auction?.id ?? null;
}

/** One socket, reused for a burst, so the test measures the engine not the dial. */
function openSocket(account) {
  return new Promise((resolve) => {
    const socket = io(API, { path: '/socket.io', transports: ['websocket'], timeout: 8000, auth: { token: account.token } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', () => resolve(null));
    setTimeout(() => resolve(null), 8000);
  });
}

/* ── 1. Many bidders, one lot ──────────────────────────────────────────── */
section('1. Twenty bidders, one lot, at the same instant');

/**
 * Bulk sign-in that survives the ingress limit.
 *
 * The OTP policy allows five codes per identifier per fifteen minutes, and every
 * account here uses a unique address, so the limits that bite are the 20-per-address
 * and 600-per-minute floors. Signing twenty accounts inside a second brushed the
 * address limit and one came back refused — the limiter working, not a fault — so
 * the helper reports a failure rather than the caller dereferencing null.
 */
async function signInMany(prefix, count) {
  /**
   * Clear the ingress limits first.
   *
   * This suite signs in over thirty accounts, and the OTP policy allows twenty
   * requests per address per fifteen minutes. Without a reset the second run in
   * the same window starts already over the limit, and the suite fails for a
   * reason that has nothing to do with concurrency. The endpoint is dev-only and
   * refused in production.
   */
  const accounts = [];
  for (let index = 0; index < count; index += 1) {
    const account = await signIn(`${prefix}${index}`);
    if (account) accounts.push(account);
    else if (process.env.MM_CONCURRENCY_DEBUG) console.log(`      \u001b[2m${prefix}${index} could not sign in\u001b[0m`);
    // Spread the burst so the per-address limiter is not what is under test here.
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return accounts;
}

// Clear the ingress allowance before any account is created.
await call('/api/dev/rate-limit/reset', { method: 'POST', body: {} });

const host = await signIn('conc.host');
const lot = await list(host, 'burst', { starting: 100 });
lot ? ok('a lot was listed for the burst', lot) : bad('a lot was listed for the burst');

/**
 * Twenty distinct accounts bid as close to simultaneously as the runtime allows.
 * The point is not that they are truly parallel — Node cannot run them in
 * parallel — but that every handler is entered before any of them finishes, which
 * is what an await in the wrong place would break.
 */
const bidders = await signInMany('conc.bidder', 20);
bidders.length === 20
  ? ok('twenty bidders signed in', `${bidders.length} accounts`)
  : bad('twenty bidders signed in', `${bidders.length} of 20 accounts (rate limit?)`);

/**
 * Bids go over HTTP, all in flight at once.
 *
 * A socket was used first, which conflated two things: whether the ENGINE is
 * consistent under overlapping writes, and whether twenty sockets each receive a
 * broadcast. Only the first is under test here, and the transport is already
 * covered by the realtime suites.
 *
 * Amounts ascend so the intended winner is unambiguous.
 */
const amounts = bidders.map((_, index) => 200 + index * 10);

const bidResults = await Promise.all(
  bidders.map((account, index) =>
    call(`/api/auctions/${lot}/bids`, { method: 'POST', headers: account.auth, body: { amount: amounts[index] } }),
  ),
);
const accepted = bidResults.filter((result) => result.status === 200 || result.status === 201).length;

/**
 * A burst of ASCENDING bids cannot all be accepted, and should not be.
 *
 * Once a higher bid lands the price moves, so a lower bid arriving afterwards is
 * legitimately refused as below the minimum increment. Expecting most of the burst
 * to succeed was a misunderstanding of the auction rules — measured, EVERY refusal
 * was `below_minimum_increment`, and none was `rate_limited` or a 500.
 *
 * What matters is that at least one bid is accepted, that every refusal is a
 * legitimate auction rule, and that the ladder is consistent — which the
 * assertions below then check.
 */
const refusalReasons = bidResults
  .filter((result) => result.status !== 200 && result.status !== 201)
  .map((result) => result.json?.reason ?? result.json?.error ?? `http_${result.status}`);

accepted > 0 ? ok('the burst produced accepted bids', `${accepted} of ${bidders.length}`) : bad('the burst produced accepted bids', 'none');

const legitimateRefusals = new Set([
  'below_minimum_increment',
  'already_winning',
  'rate_limited',
  'auction_ended',
  'auction_not_live',
]);
const illegitimate = refusalReasons.filter((reason) => !legitimateRefusals.has(reason));
illegitimate.length === 0
  ? ok('every refusal was a legitimate auction rule', refusalReasons.length ? [...new Set(refusalReasons)].join(', ') : 'none refused')
  : bad('every refusal was a legitimate auction rule', illegitimate.slice(0, 3).join(', '));

// A single bid per bidder cannot have tripped the per-bidder throttle.
!refusalReasons.includes('rate_limited')
  ? ok('no bid was refused for exceeding the bid throttle', 'one bid per bidder')
  : bad('no bid was refused for exceeding the bid throttle', 'rate_limited appeared');

/**
 * Report WHY the rest were refused.
 *
 * "8 of 19 accepted" is meaningless without the cause: an engine that refuses for
 * a legitimate reason (a lower bid arriving after a higher one) is working, while
 * one that refuses with `rate_limited` is applying a per-bidder throttle that a
 * single bid cannot have tripped.
 */
const reasons = {};
for (const result of bidResults) {
  if (result.status === 200 || result.status === 201) continue;
  const key = `${result.status}:${result.json?.error ?? result.json?.reason ?? 'unknown'}`;
  reasons[key] = (reasons[key] ?? 0) + 1;
}
console.log(`      \u001b[2mrefusal reasons: ${JSON.stringify(reasons)}\u001b[0m`);

await new Promise((resolve) => setTimeout(resolve, 1500));

const afterBurst = await call(`/api/auctions/${lot}`);
const auction = afterBurst.json?.auction ?? {};
const ladder = (afterBurst.json?.bids ?? []).slice();

ladder.length > 0 ? ok('bids were recorded', `${ladder.length} on the ladder`) : bad('bids were recorded', 'none');

/**
 * The ladder must descend from the current price with no repeats.
 *
 * A concurrent write that lost an increment would show as a duplicate amount or a
 * gap; a lost update would show as the current price not equalling the top of the
 * ladder.
 */
const ordered = ladder.every((bid, index) => index === 0 || Number(ladder[index - 1].amount) >= Number(bid.amount));
ordered ? ok('the ladder is ordered by amount') : bad('the ladder is ordered by amount');

const amountsOnLadder = ladder.map((bid) => Number(bid.amount));
new Set(amountsOnLadder).size === amountsOnLadder.length
  ? ok('no amount was recorded twice')
  : bad('no amount was recorded twice', `${amountsOnLadder.length - new Set(amountsOnLadder).size} duplicate(s)`);

Math.abs(Number(auction.currentBid) - amountsOnLadder[0]) < 0.02
  ? ok('the current price equals the top of the ladder', money(auction.currentBid))
  : bad('the current price equals the top of the ladder', `${money(auction.currentBid)} vs ${money(amountsOnLadder[0])}`);

Number(auction.bidCount) === ladder.length
  ? ok('the bid count matches the ladder', `${ladder.length}`)
  : bad('the bid count matches the ladder', `count ${auction.bidCount}, ladder ${ladder.length}`);

/**
 * The leader must be the highest amount that was ACCEPTED.
 *
 * Some bids legitimately lose: a bid below the current price after a bigger one
 * lands is refused, which is the ladder working. Comparing against the highest
 * amount SENT assumed every bid succeeded and reported a correct ladder as wrong.
 */
const acceptedAmounts = bidResults
  .map((result, index) => ({ status: result.status, amount: amounts[index], bidder: bidders[index] }))
  .filter((entryRef) => entryRef.status === 200 || entryRef.status === 201)
  .map((entryRef) => entryRef.amount);
const highestAccepted = acceptedAmounts.length ? Math.max(...acceptedAmounts) : 0;
const expectedLeader = bidResults
  .map((result, index) => ({ status: result.status, amount: amounts[index], bidder: bidders[index] }))
  .filter((entryRef) => (entryRef.status === 200 || entryRef.status === 201) && entryRef.amount === highestAccepted)
  .map((entryRef) => entryRef.bidder.id)[0];
auction.currentBidderId === expectedLeader
  ? ok('the highest bidder leads', expectedLeader)
  : bad('the highest bidder leads', `${auction.currentBidderId} vs ${expectedLeader}`);

/* ── 2. Many lots settling in one heartbeat ────────────────────────────── */
section('2. Five lots settle in the same heartbeat');

const sellers = await signInMany('conc.seller', 5);
const buyers = await signInMany('conc.buyer', 5);
if (sellers.length < 5 || buyers.length < 5) {
  bad('five sellers and five buyers signed in', `${sellers.length} sellers, ${buyers.length} buyers`);
  cleanup();
  process.exit(1);
}

const lots = [];
for (let index = 0; index < 5; index += 1) {
  const id = await list(sellers[index], `settle${index}`, { starting: 100 + index * 10 });
  if (id) lots.push({ id, seller: sellers[index], buyer: buyers[index], amount: 300 + index * 25 });
}
lots.length === 5 ? ok('five lots were listed', `${lots.length}`) : bad('five lots were listed', `${lots.length}`);

// One bid each, then end every lot at the same moment.
await Promise.all(
  lots.map((entryRef) =>
    call(`/api/auctions/${entryRef.id}/bids`, { method: 'POST', headers: entryRef.buyer.auth, body: { amount: entryRef.amount } }),
  ),
);
await Promise.all(
  lots.map((entryRef) =>
    call('/api/dev/clock', { method: 'POST', body: { auctionId: entryRef.id, secondsFromNow: 1, status: 'live' } }),
  ),
);

/**
 * Make them DUE, not ended.
 *
 * The settlement heartbeat selects lots that are still `live` whose end time has
 * passed. Passing `status: 'ended'` therefore pre-empts settlement rather than
 * triggering it: the lot is no longer eligible, no order is created, and the
 * failure looks like a lost settlement when it is a misused test control.
 * Exhausting the clock together makes all five due in the same pass.
 */
await Promise.all(
  lots.map((entryRef) =>
    call('/api/dev/clock', { method: 'POST', body: { auctionId: entryRef.id, secondsFromNow: 0, status: 'live' } }),
  ),
);
await new Promise((resolve) => setTimeout(resolve, 5000));

const settlements = [];
for (const entryRef of lots) {
  const orders = await call('/api/orders', { headers: entryRef.buyer.auth });
  const found = (orders.json?.buying ?? []).filter((order) => order.auctionId === entryRef.id);
  settlements.push({ entry: entryRef, orders: found });
}

const oneEach = settlements.filter((settlement) => settlement.orders.length === 1).length;
oneEach === lots.length
  ? ok('each settled lot produced exactly one order', `${oneEach}/${lots.length}`)
  : bad('each settled lot produced exactly one order', `${oneEach}/${lots.length}`);

const rightBuyer = settlements.filter((settlement) => settlement.orders[0]?.buyerId === settlement.entry.buyer.id).length;
rightBuyer === lots.length
  ? ok('every order names the buyer who won it', `${rightBuyer}/${lots.length}`)
  : bad('every order names the buyer who won it', `${rightBuyer}/${lots.length}`);

const rightAmount = settlements.filter(
  (settlement) => Math.abs(Number(settlement.orders[0]?.hammerPrice ?? 0) - settlement.entry.amount) < 0.02,
).length;
rightAmount === lots.length
  ? ok('every order records its own hammer price', `${rightAmount}/${lots.length}`)
  : bad(
      'every order records its own hammer price',
      settlements.map((s) => `${money(s.orders[0]?.hammerPrice)}≠${money(s.entry.amount)}`).join(' '),
    );

// Cross-contamination: no buyer may hold another lot's order.
const crossContaminated = settlements.filter((settlement) =>
  settlement.orders.some((order) => !lots.some((candidate) => candidate.id === order.auctionId && candidate.buyer.id === settlement.entry.buyer.id)),
).length;
crossContaminated === 0
  ? ok('no lot’s order leaked to another buyer')
  : bad('no lot’s order leaked to another buyer', `${crossContaminated} affected`);

/* ── 3. Paying all five at once ────────────────────────────────────────── */
section('3. Five buyers pay at the same instant');

const payable = settlements.filter((settlement) => settlement.orders.length === 1).map((settlement) => ({
  order: settlement.orders[0],
  buyer: settlement.entry.buyer,
}));

const payments = await Promise.all(
  payable.map((entryRef) => call(`/api/orders/${entryRef.order.id}/pay`, { method: 'POST', headers: entryRef.buyer.auth, body: {} })),
);
payments.filter((payment) => payment.status === 200).length === payable.length
  ? ok('every concurrent payment was accepted', `${payments.length} payments`)
  : bad('every concurrent payment was accepted', `${payments.filter((p) => p.status === 200).length} of ${payable.length}`);

let escrowOk = 0;
for (const entryRef of payable) {
  const record = await call(`/api/orders/${entryRef.order.id}/escrow`, { headers: entryRef.buyer.auth });
  const state = (record.json?.escrow ?? {}).state;
  if (state === 'in_escrow') escrowOk += 1;
}
escrowOk === payable.length
  ? ok('every order reached escrow independently', `${escrowOk}/${payable.length}`)
  : bad('every order reached escrow independently', `${escrowOk}/${payable.length}`);

/* ── 4. Bids while lots settle ─────────────────────────────────────────── */
section('4. Bids arriving while a lot settles');

const raceLot = await list(host, 'race', { starting: 500 });
const racer = await signIn('conc.racer');
const later = await signIn('conc.later');

if (!raceLot || !racer?.id || !later?.id) {
  bad('a lot and two bidders were prepared for the race');
} else {
  await call(`/api/auctions/${raceLot}/bids`, { method: 'POST', headers: racer.auth, body: { amount: 600 } });

  /**
   * Exhaust the clock and immediately bid, with no wait in between. The bid must be
   * refused: a lot whose time has run out cannot take money, and an accepted bid
   * after settlement would create an order at a price nobody agreed to.
   *
   * The status stays `live` so the heartbeat still settles it — ending it directly
   * would skip settlement and produce no order at all.
   */
  await call('/api/dev/clock', { method: 'POST', body: { auctionId: raceLot, secondsFromNow: 0, status: 'live' } });
  const lateBid = await call(`/api/auctions/${raceLot}/bids`, {
    method: 'POST',
    headers: later.auth,
    body: { amount: 9999 },
  });

  lateBid.status >= 400
    ? ok('a bid on a just-closed lot is refused', `${lateBid.status} ${lateBid.json?.error ?? ''}`)
    : bad('a bid on a just-closed lot is refused', `status ${lateBid.status}`);

  await new Promise((resolve) => setTimeout(resolve, 3500));

  const settled = await call(`/api/auctions/${raceLot}`);
  const finalPrice = Number((settled.json?.auction ?? {}).currentBid ?? 0);
  finalPrice < 9999
    ? ok('the late bid did not become the price', money(finalPrice))
    : bad('the late bid did not become the price', money(finalPrice));

  const winnerOrders = await call('/api/orders', { headers: racer.auth });
  const winnerOrder = (winnerOrders.json?.buying ?? []).find((order) => order.auctionId === raceLot);
  winnerOrder
    ? ok('the order went to the bidder who actually won', money(winnerOrder.hammerPrice))
    : bad('the order went to the bidder who actually won');

  const loserOrders = await call('/api/orders', { headers: later.auth });
  const loserOrder = (loserOrders.json?.buying ?? []).find((order) => order.auctionId === raceLot);
  !loserOrder
    ? ok('the bidder whose bid was refused received no order')
    : bad('the bidder whose bid was refused received no order', loserOrder.id);
}

/* ── 5. The books still balance after all of it ────────────────────────── */
section('5. The books balance after the whole burst');

for (const seller of sellers) {
  if (!seller?.id) continue;
  const wallet = await call('/api/wallet', { headers: seller.auth });
  const payouts = wallet.json?.payouts ?? [];
  const available = Number(wallet.json?.available ?? 0);
  const expected = payouts
    .filter((payout) => payout.status === 'processing' || payout.status === 'paid')
    .reduce((sum, payout) => sum + Number(payout.netAmount ?? 0), 0);

  if (payouts.length > 0) {
    Math.abs(available - expected) < 0.02
      ? ok(`a seller’s balance still equals their payouts`, money(available))
      : bad(`a seller’s balance still equals their payouts`, `${money(available)} vs ${money(expected)}`);
    break;
  }
}

// Every escrow must satisfy the same invariant the engine asserts internally.
let invariantHeld = true;
for (const entryRef of payable) {
  const record = await call(`/api/orders/${entryRef.order.id}/escrow`, { headers: entryRef.buyer.auth });
  const escrowRecord = record.json?.escrow ?? {};
  const outflow = Number(escrowRecord.releasedAmount ?? 0) + Number(escrowRecord.refundedAmount ?? 0);
  if (outflow > Number(escrowRecord.heldAmount ?? 0) + 0.01) invariantHeld = false;
}
invariantHeld
  ? ok('no escrow released or refunded more than it held')
  : bad('no escrow released or refunded more than it held');

// Exactly one payout per settled order, across the whole burst.
const hostWallet = await call('/api/wallet', { headers: host.auth });
void hostWallet;
let payoutCounts = [];
for (const seller of sellers) {
  if (!seller?.id) continue;
  const wallet = await call('/api/wallet', { headers: seller.auth });
  payoutCounts = payoutCounts.concat(wallet.json?.payouts ?? []);
}
const duplicateOrderIds = payoutCounts
  .flatMap((payout) => payout.orderIds)
  .filter((id, index, all) => all.indexOf(id) !== index);
duplicateOrderIds.length === 0
  ? ok('no order was paid out twice')
  : bad('no order was paid out twice', duplicateOrderIds.slice(0, 3).join(', '));

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entryRef) => console.log(`    \u001b[31m· ${entryRef}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
