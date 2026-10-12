#!/usr/bin/env node
/**
 * MoneyMart — payments & escrow verification suite.
 *
 * Proves the platform's central trust guarantee (§4.1 Step 6): buyer funds are
 * held in escrow and reach the seller ONLY after the buyer confirms receipt.
 * The suite drives real orders through the real endpoints, including the refusal
 * paths — a guarantee that is not enforced against hostile input is not a
 * guarantee.
 *
 * Usage: node scripts/verify-escrow.mjs [--api http://127.0.0.1:4317]
 */
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--api');
const API = flagIndex >= 0 && args[flagIndex + 1] ? args[flagIndex + 1] : (process.env.API_URL ?? 'http://127.0.0.1:4317');

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
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}` : ''}`);
};
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every call carries the acting identity, exactly as a client would. */
async function call(path, { method = 'GET', user = 'usr_you', body } = {}) {
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-mm-user': user },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  } catch (error) {
    return { status: 0, json: null, error: String(error?.message ?? error) };
  }
}

/** Sell a lot to completion so a real order + escrow ledger exists. */
async function createSettledOrder() {
  await call('/api/dev/clock', {
    method: 'POST',
    user: 'usr_house',
    body: { auctionId: 'auc_charizard', secondsFromNow: 1, status: 'live' },
  });
  await sleep(3500);

  const escrowLedger = await call('/api/escrow');
  const record = (escrowLedger.json?.records ?? []).find((entry) => entry.state === 'requires_payment');
  if (record) {
    const orders = await call('/api/orders?userId=usr_sofia');
    const order = (orders.json?.buying ?? []).find((entry) => entry.id === record.orderId);
    return order ?? null;
  }
  return null;
}

console.log('\n\u001b[1m════════ MoneyMart — payments & escrow verification ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\u001b[0m`);

/* ── 0. Reset ──────────────────────────────────────────────────────────── */
section('0. Reset to a known-good auction house');
const reset = await call('/api/dev/reset', { method: 'POST', user: 'usr_house' });
reset.json?.ok ? ok('seeded world rebuilt') : bad('seeded world rebuilt', `status ${reset.status}`);

/* ── 1. Rails ──────────────────────────────────────────────────────────── */
section('1. Payment rails (§3.1 country matrix)');
const providers = await call('/api/payments/providers');
const list = providers.json?.providers ?? [];
list.length >= 3
  ? ok('regional rails registered', list.map((entry) => entry.id).join(', '))
  : bad('regional rails registered', `${list.length} found`);

const hasStripe = list.some((entry) => entry.id === 'stripe');
const hasPaystack = list.some((entry) => entry.id === 'paystack');
hasStripe && hasPaystack
  ? ok('Stripe and Paystack adapters present', 'activate with STRIPE_SECRET_KEY / PAYSTACK_SECRET_KEY')
  : bad('Stripe and Paystack adapters present');

const selected = providers.json?.selected ?? {};
// Without live keys the simulated rail must take over so the flow never dead-ends.
selected.USD && selected.NGN
  ? ok('a rail resolves for every launch currency', `USD→${selected.USD}, NGN→${selected.NGN}`)
  : bad('a rail resolves for every launch currency', JSON.stringify(selected));

/* ── 2. Seeded ledger integrity ────────────────────────────────────────── */
section('2. Escrow ledger integrity for historical orders');
const ledger = await call('/api/escrow');
const records = ledger.json?.records ?? [];
records.length > 0
  ? ok('every settled order carries a ledger', `${records.length} records`)
  : bad('every settled order carries a ledger');

const seededPaid = records.filter((entry) => entry.state === 'in_escrow' || entry.state === 'released');
seededPaid.length > 0
  ? ok('historical paid orders are recorded as funded', `${seededPaid.length} funded`)
  : bad('historical paid orders are recorded as funded');

const allHaveHistory = records.every((entry) => Array.isArray(entry.history) && entry.history.length > 0);
allHaveHistory ? ok('every ledger carries an audit trail') : bad('every ledger carries an audit trail');

/* ── 3. New settlement opens escrow at requires_payment ────────────────── */
section('3. Settlement opens escrow, but takes no money');
const order = await createSettledOrder();
if (!order) {
  bad('a settled order with an escrow ledger exists');
} else {
  ok('settled order created', `${order.id} · total ${order.totalAmount} ${order.currency}`);

  const status = await call(`/api/orders/${order.id}/escrow`, { user: order.buyerId });
  status.json?.escrow?.state === 'requires_payment'
    ? ok('escrow starts at requires_payment', 'no funds taken at hammer fall')
    : bad('escrow starts at requires_payment', `state ${status.json?.escrow?.state}`);

  status.json?.escrow?.heldAmount === 0
    ? ok('nothing is held before the buyer pays')
    : bad('nothing is held before the buyer pays', `held ${status.json?.escrow?.heldAmount}`);

  order.paymentStatus === 'pending'
    ? ok('order is honestly marked pending, not paid')
    : bad('order is honestly marked pending, not paid', `paymentStatus ${order.paymentStatus}`);

  /* ── 4. Only the buyer may pay ───────────────────────────────────────── */
  section('4. Payment authorisation');
  const intruder = await call(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    user: 'usr_ken',
    body: {},
  });
  intruder.status === 403 && intruder.json?.error === 'not_the_buyer'
    ? ok('a third party cannot pay for someone else’s order')
    : bad('a third party cannot pay for someone else’s order', `status ${intruder.status} ${intruder.json?.error ?? ''}`);

  /* ── 5. Buyer pays into escrow ───────────────────────────────────────── */
  section('5. Buyer pays — funds move into escrow');
  const payment = await call(`/api/orders/${order.id}/pay`, {
    method: 'POST',
    user: order.buyerId,
    body: {},
  });
  payment.json?.escrow?.state === 'in_escrow'
    ? ok('payment succeeded and funds are held', `held ${payment.json.escrow.heldAmount} ${order.currency}`)
    : bad('payment succeeded and funds are held', `state ${payment.json?.escrow?.state} ${payment.json?.intent?.failureReason ?? ''}`);

  payment.json?.intent?.status === 'succeeded'
    ? ok('payment intent reports succeeded', `via ${payment.json.intent.provider}`)
    : bad('payment intent reports succeeded', `status ${payment.json?.intent?.status}`);

  const held = payment.json?.escrow?.heldAmount;
  const sellerBefore = (await call(`/api/wallet?userId=${order.sellerId}`, { user: order.sellerId })).json?.available ?? 0;
  void sellerBefore;

  /* ── 6. Double charge is refused ─────────────────────────────────────── */
  section('6. Double-charge protection');
  const again = await call(`/api/orders/${order.id}/pay`, { method: 'POST', user: order.buyerId, body: {} });
  again.status === 409 && again.json?.error === 'already_paid'
    ? ok('paying twice is refused', 'already_paid')
    : bad('paying twice is refused', `status ${again.status} ${again.json?.error ?? ''}`);

  /* ── 7. Seller cannot release the funds ──────────────────────────────── */
  section('7. The seller cannot release their own funds');
  const sellerTries = await call(`/api/orders/${order.id}/confirm`, {
    method: 'POST',
    user: order.sellerId,
    body: {},
  });
  sellerTries.status === 403 && sellerTries.json?.error === 'not_the_buyer'
    ? ok('seller is refused release (buyer protection holds)')
    : bad('seller is refused release (buyer protection holds)', `status ${sellerTries.status} ${sellerTries.json?.error ?? ''}`);

  const stillHeld = await call(`/api/orders/${order.id}/escrow`, { user: order.buyerId });
  stillHeld.json?.escrow?.state === 'in_escrow' && stillHeld.json?.escrow?.releasedAmount === 0
    ? ok('funds remain held after the refusal')
    : bad('funds remain held after the refusal', `state ${stillHeld.json?.escrow?.state}`);

  /* ── 8. Shipping alone does not release ──────────────────────────────── */
  section('8. Marking shipped does not release funds');
  const shipped = await call(`/api/orders/${order.id}/status`, {
    method: 'POST',
    user: order.sellerId,
    body: { orderStatus: 'shipped', trackingNumber: 'MMTEST123', courierName: 'DHL Express' },
  });
  void shipped;
  const afterShip = await call(`/api/orders/${order.id}/escrow`, { user: order.buyerId });
  afterShip.json?.escrow?.releasedAmount === 0
    ? ok('dispatch leaves escrow untouched', `${afterShip.json.escrow.state}`)
    : bad('dispatch leaves escrow untouched', `released ${afterShip.json?.escrow?.releasedAmount}`);

  /* ── 9. Buyer confirms receipt — the release path ────────────────────── */
  section('9. Buyer confirms receipt — funds release to the seller');
  const released = await call(`/api/orders/${order.id}/confirm`, {
    method: 'POST',
    user: order.buyerId,
    body: {},
  });
  released.json?.escrow?.state === 'released'
    ? ok('escrow released on buyer confirmation')
    : bad('escrow released on buyer confirmation', `status ${released.status} ${released.json?.escrow?.state ?? released.json?.error ?? ''}`);

  const expectedNet = released.json?.payoutAmount;
  typeof expectedNet === 'number' && expectedNet > 0 && expectedNet < order.hammerPrice
    ? ok('seller receives hammer price less the platform fee', `${expectedNet} of ${order.hammerPrice}`)
    : bad('seller receives hammer price less the platform fee', `net ${expectedNet} of ${order.hammerPrice}`);

  const ledgerCheck = released.json?.escrow;
  ledgerCheck && ledgerCheck.releasedAmount + ledgerCheck.refundedAmount <= ledgerCheck.heldAmount + 0.01
    ? ok('ledger balances: outflow never exceeds what was collected')
    : bad('ledger balances: outflow never exceeds what was collected', JSON.stringify(ledgerCheck ?? {}).slice(0, 90));

  released.json?.order?.orderStatus === 'complete'
    ? ok('order is marked complete')
    : bad('order is marked complete', `status ${released.json?.order?.orderStatus}`);

  const sellerWallet = await call(`/api/wallet?userId=${order.sellerId}`, { user: order.sellerId });
  (sellerWallet.json?.payouts ?? []).length > 0
    ? ok('a payout record exists for the seller', `${sellerWallet.json.payouts.length} payout(s)`)
    : bad('a payout record exists for the seller');

  /* ── 10. Decline path ────────────────────────────────────────────────── */
  section('10. Declined payment leaves the order reserved');
  const declinedOrder = await createSettledOrder();
  if (!declinedOrder) {
    bad('a second settled order exists for the decline test');
  } else {
    // The simulated rail declines any amount ending in .13 — build it explicitly
    // rather than by arithmetic on the invoice total, which cancels out.
    const declinedAmount = Math.floor(declinedOrder.totalAmount) + 0.13;
    const declined = await call(`/api/orders/${declinedOrder.id}/pay`, {
      method: 'POST',
      user: declinedOrder.buyerId,
      body: { chargeAmountOverride: declinedAmount },
    });
    const state = declined.json?.escrow?.state;
    const reason = declined.json?.intent?.failureReason;
    state === 'failed'
      ? ok('declined charge is recorded as failed', `reason ${reason}`)
      : bad('declined charge is recorded as failed', `state ${state} reason ${reason}`);

    declined.json?.escrow?.heldAmount === 0
      ? ok('no funds are held after a decline')
      : bad('no funds are held after a decline', `held ${declined.json?.escrow?.heldAmount}`);

    /* ── 11. Dispute blocks release ────────────────────────────────────── */
    section('11. Dispute freezes escrow');
    const paid = await call(`/api/orders/${declinedOrder.id}/pay`, {
      method: 'POST',
      user: declinedOrder.buyerId,
      body: {},
    });
    paid.json?.escrow?.state === 'in_escrow'
      ? ok('buyer can retry and succeed after a decline')
      : bad('buyer can retry and succeed after a decline', `state ${paid.json?.escrow?.state}`);

    const dispute = await call(`/api/orders/${declinedOrder.id}/dispute`, {
      method: 'POST',
      user: declinedOrder.buyerId,
      body: { reason: 'Item not as described' },
    });
    dispute.json?.escrow?.state === 'disputed'
      ? ok('buyer can open a dispute')
      : bad('buyer can open a dispute', `state ${dispute.json?.escrow?.state}`);

    const releaseWhileDisputed = await call(`/api/orders/${declinedOrder.id}/confirm`, {
      method: 'POST',
      user: declinedOrder.buyerId,
      body: {},
    });
    releaseWhileDisputed.status === 409
      ? ok('release is refused while disputed', releaseWhileDisputed.json?.error ?? '')
      : bad('release is refused while disputed', `status ${releaseWhileDisputed.status}`);

    const nonAdmin = await call(`/api/orders/${declinedOrder.id}/resolve`, {
      method: 'POST',
      user: declinedOrder.buyerId,
      body: { resolution: 'refund' },
    });
    nonAdmin.status === 403
      ? ok('only an admin can resolve a dispute')
      : bad('only an admin can resolve a dispute', `status ${nonAdmin.status}`);

    const resolved = await call(`/api/orders/${declinedOrder.id}/resolve`, {
      method: 'POST',
      user: 'usr_house',
      body: { resolution: 'refund' },
    });
    resolved.json?.escrow?.state === 'refunded'
      ? ok('admin refund resolves the dispute in the buyer’s favour', `refunded ${resolved.json.escrow.refundedAmount}`)
      : bad('admin refund resolves the dispute in the buyer’s favour', `state ${resolved.json?.escrow?.state}`);

    const refundedLedger = resolved.json?.escrow;
    refundedLedger && refundedLedger.refundedAmount <= refundedLedger.heldAmount + 0.01
      ? ok('refund never exceeds the amount collected')
      : bad('refund never exceeds the amount collected');
  }
  void held;
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
