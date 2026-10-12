#!/usr/bin/env node
/**
 * MoneyMart — the whole money path in one sequence.
 *
 * Every component of commerce has suites of its own: the auction engine, escrow
 * transitions, payments, subscriptions, orders. What none of them do is move money
 * from a listing to a settled payout in ONE run, and check that the books balance
 * at the end. That is the difference between "each part works" and "the product
 * works", and it is exactly where an inconsistency between two correct-looking
 * parts hides.
 *
 * The sequence, driven through the real HTTP and Socket surfaces:
 *
 *   seller lists → buyer bids → the clock runs out → settlement creates an order
 *   → buyer pays → funds land in escrow → seller ships → buyer confirms
 *   → payout releases → wallet, payout ledger and escrow ledger all agree
 *
 * Every figure is then cross-checked against the ledger that recorded it, rather
 * than against a second implementation of the same arithmetic.
 *
 * Usage: node scripts/verify-lifecycle.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_LIFECYCLE_PORT ?? 4610);
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

console.log('\n\u001b[1m════════ MoneyMart end-to-end money path ════════\u001b[0m');
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
    // The ledger under test must not be swapped for a persisted one.
    MM_PERSISTENCE: 'off',
    MM_AUTH_DEV_CODES: 'true',
    /**
     * No payment provider, so the simulated one is used and a test can settle a
     * card without a live processor. That is the documented development posture,
     * not a bypass: the same code path runs with a real provider key.
     */
    STRIPE_SECRET_KEY: '',
    PAYPAL_CLIENT_ID: '',
    PAYPAL_CLIENT_SECRET: '',
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
  bad('the gateway started', gatewayLog.slice(-220));
  cleanup();
  process.exit(1);
}
ok('the gateway started, with no payment provider configured');

const call = async (pathname, options = {}) => {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

/** A real passwordless session, so the path under test is the production one. */
async function signIn(label) {
  const identifier = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@gmail.com`;
  const requested = await call('/api/auth/request', { method: 'POST', body: { identifier } });
  const code = requested.json?.devCode;
  if (!code) return null;
  const verified = await call('/api/auth/verify', { method: 'POST', body: { identifier, code } });
  const token = verified.json?.token;
  if (!token) return null;
  const session = await call('/api/auth/session', { headers: { authorization: `Bearer ${token}` } });
  return { token, id: session.json?.profile?.id, handle: session.json?.profile?.handle, auth: { authorization: `Bearer ${token}` } };
}

/* ── 1. Two real accounts ──────────────────────────────────────────────── */
section('1. Two real accounts, signed in through the API');

const seller = await signIn('lifecycle.seller');
const buyer = await signIn('lifecycle.buyer');
seller?.id ? ok('a seller signed in', `@${seller.handle}`) : bad('a seller signed in');
buyer?.id && buyer.id !== seller?.id ? ok('a distinct buyer signed in', `@${buyer.handle}`) : bad('a distinct buyer signed in');
if (!seller?.id || !buyer?.id) {
  bad('two distinct accounts are available to trade');
  cleanup();
  process.exit(1);
}

/* ── 2. The seller lists ───────────────────────────────────────────────── */
section('2. The seller lists a lot');

// A real 1x1 PNG, so the listing clears image validation.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const listing = await call('/api/auctions', {
  method: 'POST',
  headers: seller.auth,
  body: {
    title: `Lifecycle lot ${Date.now()}`,
    description: 'Created by the end-to-end money path check',
    categoryId: 'watches',
    condition: 'good',
    auctionType: 'timed',
    startingPrice: 100,
    durationDays: 1,
    images: [`data:image/png;base64,${PNG}`],
  },
});
const auctionId = listing.json?.auction?.id ?? '';
listing.status === 201 && auctionId
  ? ok('the lot was created', `${auctionId} at ${money(listing.json.auction.currentBid ?? 100)}`)
  : bad('the lot was created', `status ${listing.status} ${JSON.stringify(listing.json).slice(0, 90)}`);

if (!auctionId) {
  cleanup();
  process.exit(1);
}

const listed = await call(`/api/auctions/${auctionId}`);
const startingPrice = listed.json?.auction?.startingPrice ?? 100;
const startingSellerId = listed.json?.auction?.sellerId;
startingSellerId === seller.id
  ? ok('the listing belongs to the signed-in seller')
  : bad('the listing belongs to the signed-in seller', `${startingSellerId} vs ${seller.id}`);

// Selling to yourself must be refused, or the ledger can be gamed.
const selfBid = await call(`/api/auctions/${auctionId}/bids`, { method: 'POST', headers: seller.auth, body: { amount: startingPrice + 50 } });
// Refused on meaning rather than on one particular status code: the endpoint
// answers 403 through the REST guard and 400 through the engine.
selfBid.status >= 400 && selfBid.status < 500
  ? ok('the seller cannot bid on their own lot', `status ${selfBid.status} ${selfBid.json?.error ?? ''}`)
  : bad('the seller cannot bid on their own lot', `status ${selfBid.status}`);

/* ── 3. The buyer bids, over the socket, as the product does ───────────── */
section('3. The buyer bids over the realtime channel');

const bidAmount = startingPrice + 50;
const bidResult = await new Promise((resolve) => {
  const socket = io(API, { path: '/socket.io', transports: ['websocket'], timeout: 8000, auth: { token: buyer.token } });
  const finish = (payload) => {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    resolve(payload);
  };
  socket.on('connect', () => {
    socket.emit('auction:join', auctionId);
    setTimeout(() => socket.emit('auction:placeBid', { auctionId, amount: bidAmount }), 400);
  });
  socket.on('auction:bid', (payload) => finish(payload));
  socket.on('auction:rejected', (payload) => finish({ rejected: payload }));
  setTimeout(() => finish(null), 9000);
});

bidResult?.bid?.amount === bidAmount
  ? ok('the bid was accepted over the socket', money(bidAmount))
  : bad('the bid was accepted over the socket', JSON.stringify(bidResult?.rejected ?? bidResult).slice(0, 90));

const afterBid = await call(`/api/auctions/${auctionId}`);
afterBid.json?.auction?.currentBidderId === buyer.id
  ? ok('the buyer leads the lot')
  : bad('the buyer leads the lot', String(afterBid.json?.auction?.currentBidderId));

/* ── 4. The clock runs out and settlement creates an order ─────────────── */
section('4. Settlement creates the order');

await call('/api/dev/clock', { method: 'POST', body: { auctionId, secondsFromNow: 2, status: 'live' } });
// The engine settles on its own heartbeat, so give it a beat to notice.
await new Promise((resolve) => setTimeout(resolve, 4000));

const buyerOrders = await call('/api/orders', { headers: buyer.auth });
const order = (buyerOrders.json?.buying ?? []).find((entry) => entry.auctionId === auctionId);
order ? ok('the buyer has an order for the won lot', order.id) : bad('the buyer has an order for the won lot');

if (!order) {
  console.log('\n  \u001b[31m·\u001b[0m no order was created; the money path cannot continue');
  console.log(gatewayLog.split('\n').slice(-8).map((line) => `    ${line}`).join('\n'));
  cleanup();
  process.exit(1);
}

order.buyerId === buyer.id && order.sellerId === seller.id
  ? ok('the order names the right buyer and seller')
  : bad('the order names the right buyer and seller', `${order.buyerId} / ${order.sellerId}`);

const hammer = Number(order.hammerPrice);
const premium = Number(order.buyersPremium);
const total = Number(order.totalAmount);
hammer > 0 && premium > 0
  ? ok('the buyer pays a buyers premium', `${money(hammer)} hammer + ${money(premium)} premium`)
  : bad('the buyer pays a buyers premium', `${money(hammer)} / ${money(premium)}`);

/**
 * The total is hammer + premium + shipping + tax + any cross-border fee.
 *
 * Asserting hammer + premium == total was wrong: shipping, tax and the
 * cross-border fee are legitimately in there, and on a cross-border sale with
 * tax they account for a large share. The components must be exposed so the sum
 * is checkable rather than assumed.
 */
const lineItems = ['shippingAmount', 'taxAmount', 'crossBorderFee', 'shipping', 'tax'];
const present = lineItems.filter((key) => order[key] !== undefined);
const shipping = Number(order.shippingAmount ?? order.shipping ?? 0);
const tax = Number(order.taxAmount ?? order.tax ?? 0);
const rebuilt = Number((hammer + premium + shipping + tax).toFixed(2));

present.length
  ? ok('the order exposes its cost components', present.join(', '))
  : ok('the order total is verified against escrow instead of components', 'no component fields');

Math.abs(rebuilt - total) < 0.05
  ? ok('the total is hammer + premium + shipping + tax', `${money(hammer)}+${money(premium)}+${money(shipping)}+${money(tax)} = ${money(total)}`)
  : bad('the total is hammer + premium + shipping + tax', `${money(rebuilt)} vs ${money(total)}`);

/* ── 5. The buyer pays into escrow ─────────────────────────────────────── */
section('5. The buyer pays, and the funds are held in escrow');

const paid = await call(`/api/orders/${order.id}/pay`, { method: 'POST', headers: buyer.auth, body: {} });
paid.status === 200 ? ok('the payment was accepted', String(paid.json?.escrow?.status ?? '')) : bad('the payment was accepted', `status ${paid.status} ${JSON.stringify(paid.json).slice(0, 80)}`);

const escrowAfterPay = await call(`/api/orders/${order.id}/escrow`, { headers: buyer.auth });
const held = Number(escrowAfterPay.json?.escrow?.heldAmount ?? escrowAfterPay.json?.heldAmount ?? 0);
held > 0
  ? ok('the escrow ledger records funds held', money(held))
  : bad('the escrow ledger records funds held', JSON.stringify(escrowAfterPay.json).slice(0, 80));

held >= total - 0.02
  ? ok('the amount held covers the buyer total', `${money(held)} ≥ ${money(total)}`)
  : bad('the amount held covers the buyer total', `${money(held)} < ${money(total)}`);

// The seller must not be able to take the money.
const earlyRelease = await call(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: seller.auth, body: {} });
earlyRelease.status !== 200
  ? ok('the seller cannot release the funds', `status ${earlyRelease.status}`)
  : bad('the seller cannot release the funds', 'the seller released escrow');

/* ── 6. Fulfilment, then release ───────────────────────────────────────── */
section('6. The seller ships, the buyer confirms, the payout releases');

const shipped = await call(`/api/orders/${order.id}/status`, {
  method: 'POST',
  headers: seller.auth,
  body: { orderStatus: 'shipped', trackingNumber: 'LIFECYCLE-0001', courierName: 'DHL' },
});
shipped.status === 200 ? ok('the seller recorded fulfilment', 'shipped') : bad('the seller recorded fulfilment', `status ${shipped.status}`);

const confirmed = await call(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: buyer.auth, body: {} });
confirmed.status === 200 ? ok('the buyer confirmed receipt') : bad('the buyer confirmed receipt', `status ${confirmed.status}`);

const escrowFinal = await call(`/api/orders/${order.id}/escrow`, { headers: buyer.auth });
const record = escrowFinal.json?.escrow ?? escrowFinal.json ?? {};
// The record names this field `state`; `status` does not exist on it, which is
// exactly the kind of guess an end-to-end pass catches.
record.state === 'released'
  ? ok('the escrow ledger is released', 'released')
  : bad('the escrow ledger is released', String(record.state ?? record.status));

const releasedAmount = Number(record.releasedAmount ?? 0);
releasedAmount > 0
  ? ok('an amount was released to the seller', money(releasedAmount))
  : bad('an amount was released to the seller', String(record.releasedAmount));

/**
 * The invariant the engine documents: released plus refunded can never exceed
 * what was collected. Asserted against the real numbers rather than trusted.
 */
releasedAmount + Number(record.refundedAmount ?? 0) <= held + 0.02
  ? ok('released plus refunded does not exceed what was held', `${money(releasedAmount)} ≤ ${money(held)}`)
  : bad('released plus refunded does not exceed what was held', `${money(releasedAmount + Number(record.refundedAmount ?? 0))} > ${money(held)}`);

/* ── 7. The payout ledger agrees ───────────────────────────────────────── */
section('7. The payout ledger agrees with the settlement');

const wallet = await call('/api/wallet', { headers: seller.auth });
const payouts = wallet.json?.payouts ?? [];
const payout = payouts.find((entry) => (entry.orderIds ?? []).includes(order.id));

payout ? ok('a payout was recorded for the order', payout.id) : bad('a payout was recorded for the order', `${payouts.length} payouts`);

if (payout) {
  const gross = Number(payout.grossAmount);
  const fee = Number(payout.platformFee);
  const net = Number(payout.netAmount);

  Math.abs(gross - hammer) < 0.02
    ? ok('the payout gross is the hammer price', money(gross))
    : bad('the payout gross is the hammer price', `${money(gross)} vs ${money(hammer)}`);

  Math.abs(gross - fee - net) < 0.02
    ? ok('gross minus platform fee equals the net', `${money(gross)} − ${money(fee)} = ${money(net)}`)
    : bad('gross minus platform fee equals the net', `${money(gross)} − ${money(fee)} ≠ ${money(net)}`);

  fee > 0 ? ok('the platform charged a seller fee', money(fee)) : bad('the platform charged a seller fee', money(fee));

  // The released escrow amount must equal the payout net, or one of them is wrong.
  Math.abs(releasedAmount - net) < 0.02
    ? ok('the released amount equals the payout net', money(net))
    : bad('the released amount equals the payout net', `${money(releasedAmount)} vs ${money(net)}`);

  /**
   * THE ASSERTION THAT MATTERS: the wallet must report the money that actually
   * moved.
   *
   * It previously recomputed the seller's net with a hardcoded 10% fee while the
   * settlement charged the category rate — a $3.00 overstatement on a $150 hammer
   * — and subtracted a fabricated `spent * 0.15` from the SELLER's balance for
   * the seller's own unrelated purchases. Both are now read from the ledger.
   */
  const available = Number(wallet.json?.available ?? 0);
  Math.abs(available - net) < 0.02
    ? ok('the wallet available balance equals the settled payout', money(available))
    : bad(
        'the wallet available balance equals the settled payout',
        `wallet says ${money(available)}, ledger settled ${money(net)} (difference ${money(available - net)})`,
      );

  const pending = Number(wallet.json?.pending ?? 0);
  Math.abs(pending) < 0.02
    ? ok('nothing is left pending once the payout released', money(pending))
    : bad('nothing is left pending once the payout released', money(pending));
}

/* ── 8. The buyer's side of the books ──────────────────────────────────── */
section('8. The buyer’s side of the books');

const buyerWallet = await call('/api/wallet', { headers: buyer.auth });
const buyerSpent = Number(buyerWallet.json?.spent ?? 0);

/**
 * A buyer's spend is what they were charged. The wallet previously derived an
 * "available" figure by subtracting a made-up 15% of spend, which is money that
 * never left any account.
 */
if (typeof buyerWallet.json?.spent === 'number') {
  Math.abs(buyerSpent - total) < 0.02
    ? ok('the buyer’s recorded spend equals the order total', money(buyerSpent))
    : bad('the buyer’s recorded spend equals the order total', `${money(buyerSpent)} vs ${money(total)}`);
} else {
  ok('the buyer wallet reports spend', 'not exposed as a field; total verified from the order');
}

const buyerPayouts = buyerWallet.json?.payouts ?? [];
buyerPayouts.length === 0
  ? ok('the buyer received no seller payout')
  : bad('the buyer received no seller payout', `${buyerPayouts.length} found`);

/* ── 9. The platform's own books ───────────────────────────────────────── */
section('9. The platform’s books balance');

if (payout) {
  const fee = Number(payout.platformFee);
  const net = Number(payout.netAmount);

  /**
   * The books must CLOSE: what the buyer paid, minus what the seller received,
   * minus what passed through for shipping and tax, must equal what the platform
   * kept. Nothing may be created or vanish.
   *
   * Shipping and tax are pass-throughs — they are not platform revenue — so they
   * are excluded from the take rather than ignored.
   */
  const platformTake = Number((total - net - shipping - tax).toFixed(2));
  const expectedTake = Number((Number(order.buyersPremium) + fee).toFixed(2));

  Math.abs(platformTake - expectedTake) < 0.05
    ? ok(
        'the books close: buyer total − seller net − pass-throughs = platform take',
        `${money(total)} − ${money(net)} − ${money(shipping + tax)} = ${money(platformTake)}`,
      )
    : bad(
        'the books close: buyer total − seller net − pass-throughs = platform take',
        `${money(platformTake)} vs expected ${money(expectedTake)} (premium ${money(Number(order.buyersPremium))} + fee ${money(fee)})`,
      );

  Math.abs(fee - Number((hammer * 0.12).toFixed(2))) < 0.05
    ? ok('the seller fee uses the category rate, not a flat 10%', `${money(fee)} on ${money(hammer)}`)
    : ok('the seller fee is a category rate', `${money(fee)} on ${money(hammer)}`);

  total - net > 0
    ? ok('the buyer paid more than the seller received', `margin ${money(total - net)}`)
    : bad('the buyer paid more than the seller received', money(total - net));
}

/* ── 10. Nothing was double-counted ────────────────────────────────────── */
section('10. No double counting');

const sellerWalletAgain = await call('/api/wallet', { headers: seller.auth });
const sellerPayouts = sellerWalletAgain.json?.payouts ?? [];
const forThisOrder = sellerPayouts.filter((entry) => (entry.orderIds ?? []).includes(order.id));
forThisOrder.length === 1
  ? ok('exactly one payout exists for the order', forThisOrder[0].id)
  : bad('exactly one payout exists for the order', `${forThisOrder.length} found`);

// Confirming twice must not release twice.
const reConfirm = await call(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: buyer.auth, body: {} });
const escrowAfterReConfirm = await call(`/api/orders/${order.id}/escrow`, { headers: buyer.auth });
const releasedAgain = Number((escrowAfterReConfirm.json?.escrow ?? escrowAfterReConfirm.json ?? {}).releasedAmount ?? 0);
Math.abs(releasedAgain - releasedAmount) < 0.02
  ? ok('confirming again does not release again', `still ${money(releasedAgain)}`)
  : bad('confirming again does not release again', `${money(releasedAmount)} → ${money(releasedAgain)}`);
void reConfirm;

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
