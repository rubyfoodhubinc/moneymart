#!/usr/bin/env node
/**
 * MoneyMart — dispute and refund.
 *
 * The path where money goes BACK to a buyer is the highest-consequence branch in
 * the product, and the end-to-end money path deliberately stops before it: that
 * suite proves a clean sale settles, not that a contested one unwinds correctly.
 *
 * Two things can go wrong here that a clean sale can never reveal:
 *
 *   • a refund that pays the seller anyway, so the platform loses the money twice
 *   • a refunded order still counted as money the seller expects to receive, which
 *     inflates their balance with funds that were returned
 *
 * Both are checked against the ledgers rather than against a re-implementation of
 * the arithmetic.
 *
 * Usage: node scripts/verify-dispute.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_DISPUTE_PORT ?? 4630);
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

console.log('\n\u001b[1m════════ MoneyMart dispute and refund ════════\u001b[0m');
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

/**
 * Drive a lot all the way into escrow, then optionally into dispute.
 *
 * Shared so each scenario starts from the same real state rather than from a
 * hand-built fixture that could differ from what the product produces.
 */
async function tradeToEscrow(label, { dispute = false } = {}) {
  const seller = await signIn(`${label}.seller`);
  const buyer = await signIn(`${label}.buyer`);
  if (!seller?.id || !buyer?.id) return null;

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const listing = await call('/api/auctions', {
    method: 'POST',
    headers: seller.auth,
    body: {
      title: `Dispute lot ${label} ${Date.now()}`,
      description: 'Created by the dispute verification suite',
      categoryId: 'watches',
      condition: 'good',
      auctionType: 'timed',
      startingPrice: 100,
      durationDays: 1,
      images: [`data:image/png;base64,${PNG}`],
    },
  });
  const auctionId = listing.json?.auction?.id;
  if (!auctionId) return null;

  await call(`/api/auctions/${auctionId}/bids`, {
    method: 'POST',
    headers: buyer.auth,
    body: { amount: 150 },
  });
  await call('/api/dev/clock', { method: 'POST', body: { auctionId, secondsFromNow: 2, status: 'live' } });
  await new Promise((resolve) => setTimeout(resolve, 4000));

  const orders = await call('/api/orders', { headers: buyer.auth });
  const order = (orders.json?.buying ?? []).find((entry) => entry.auctionId === auctionId);
  if (!order) return null;

  await call(`/api/orders/${order.id}/pay`, { method: 'POST', headers: buyer.auth, body: {} });

  if (dispute) {
    const raised = await call(`/api/orders/${order.id}/dispute`, {
      method: 'POST',
      headers: buyer.auth,
      body: { reason: 'Item not as described' },
    });
    if (raised.status !== 200) {
      /**
       * A dispute that is silently refused poisons every later assertion: the
       * escrow is still `in_escrow`, so resolving it answers 409 and the failure
       * surfaces three steps away from its cause. Reported here instead.
       */
      console.log(`      \u001b[2mdispute refused: ${raised.status} ${JSON.stringify(raised.json).slice(0, 80)}\u001b[0m`);
      return { seller, buyer, order, auctionId, disputeFailed: raised };
    }
  }

  return { seller, buyer, order, auctionId };
}

/* ── 1. A cleaner cannot resolve a dispute ─────────────────────────────── */
section('1. Only an administrator can resolve a dispute');

const case1 = await tradeToEscrow('dispute.authz', { dispute: true });
if (!case1?.order) {
  bad('a disputed order could be set up', JSON.stringify(case1?.disputeFailed ?? {}).slice(0, 120));
  console.log(gatewayLog.split('\n').slice(-8).map((line) => `    ${line}`).join('\n'));
  cleanup();
  process.exit(1);
}
ok('a trade reached a disputed escrow', case1.order.id);

const escrowDisputed = await call(`/api/orders/${case1.order.id}/escrow`, { headers: case1.buyer.auth });
const disputedRecord = escrowDisputed.json?.escrow ?? {};
disputedRecord.state === 'disputed'
  ? ok('the escrow is in the disputed state', 'disputed')
  : bad('the escrow is in the disputed state', String(disputedRecord.state));

const buyerResolve = await call(`/api/orders/${case1.order.id}/resolve`, {
  method: 'POST',
  headers: case1.buyer.auth,
  body: { resolution: 'refund' },
});
buyerResolve.status === 403
  ? ok('the buyer cannot resolve their own dispute', '403 admin_required')
  : bad('the buyer cannot resolve their own dispute', `status ${buyerResolve.status}`);

const sellerResolve = await call(`/api/orders/${case1.order.id}/resolve`, {
  method: 'POST',
  headers: case1.seller.auth,
  body: { resolution: 'release' },
});
sellerResolve.status === 403
  ? ok('the seller cannot resolve the dispute in their own favour', '403 admin_required')
  : bad('the seller cannot resolve the dispute in their own favour', `status ${sellerResolve.status}`);

const anonymousResolve = await call(`/api/orders/${case1.order.id}/resolve`, {
  method: 'POST',
  body: { resolution: 'refund' },
});
anonymousResolve.status >= 400
  ? ok('an unauthenticated caller cannot resolve a dispute', `status ${anonymousResolve.status}`)
  : bad('an unauthenticated caller cannot resolve a dispute', `status ${anonymousResolve.status}`);

const badResolution = await call(`/api/orders/${case1.order.id}/resolve`, {
  method: 'POST',
  headers: { 'x-mm-user': 'usr_ada' },
  body: { resolution: 'keep-it' },
});
// The actor here is a normal user, so either refusal is legitimate; what must not
// happen is a successful resolution with an unknown verdict.
badResolution.status >= 400
  ? ok('an unknown verdict is refused', `status ${badResolution.status}`)
  : bad('an unknown verdict is refused', `status ${badResolution.status}`);

/* ── 2. A refund returns the money and pays the seller nothing ─────────── */
section('2. Resolving for the buyer returns the funds');

/**
 * The seeded administrator.
 *
 * `usr_house` — "MoneyMart House" — is the only account the seed gives the admin
 * role, and `resolve` is the only endpoint that requires it. An earlier version of
 * this suite used an ordinary account and reported "no administrator exists",
 * which was wrong: it named the wrong user.
 */
const adminAuth = { 'x-mm-user': 'usr_house' };
const adminSession = await call('/api/auth/session', { headers: adminAuth });

const walletBefore = await call('/api/wallet', { headers: case1.seller.auth });
const availableBefore = Number(walletBefore.json?.available ?? 0);
const payoutsBefore = (walletBefore.json?.payouts ?? []).length;

const refund = await call(`/api/orders/${case1.order.id}/resolve`, {
  method: 'POST',
  headers: adminAuth,
  body: { resolution: 'refund' },
});

if (refund.status === 403) {
  // Without an administrator the branch cannot be reached, which is itself worth
  // reporting rather than silently skipping.
  bad('an administrator can resolve the dispute', 'no account carries the admin role');
} else {
  refund.status === 200 ? ok('an administrator resolved the dispute', 'refund') : bad('an administrator resolved the dispute', `status ${refund.status}`);

  const finalRecord = refund.json?.escrow ?? {};
  finalRecord.state === 'refunded'
    ? ok('the escrow moved to refunded', 'refunded')
    : bad('the escrow moved to refunded', String(finalRecord.state));

  const held = Number(finalRecord.heldAmount ?? 0);
  const refunded = Number(finalRecord.refundedAmount ?? 0);
  const released = Number(finalRecord.releasedAmount ?? 0);

  /**
   * The audit trail must survive: `heldAmount` records what was COLLECTED and is
   * not zeroed by a refund, or the balance invariant becomes unverifiable.
   */
  held > 0
    ? ok('the collected amount is preserved for the audit trail', money(held))
    : bad('the collected amount is preserved for the audit trail', money(held));

  Math.abs(refunded - held) < 0.02
    ? ok('the full held amount was refunded', money(refunded))
    : bad('the full held amount was refunded', `${money(refunded)} of ${money(held)}`);

  released === 0
    ? ok('nothing was released to the seller', money(released))
    : bad('nothing was released to the seller', money(released));

  refunded + released <= held + 0.02
    ? ok('released plus refunded does not exceed what was held', `${money(refunded + released)} ≤ ${money(held)}`)
    : bad('released plus refunded does not exceed what was held', `${money(refunded + released)} > ${money(held)}`);

  // The order must reflect the outcome.
  const orderAfter = refund.json?.order ?? {};
  orderAfter.paymentStatus === 'refunded'
    ? ok('the order records the payment as refunded')
    : bad('the order records the payment as refunded', String(orderAfter.paymentStatus));

  /* ── 3. The seller must not be paid ──────────────────────────────────── */
  section('3. A refunded sale pays the seller nothing');

  const walletAfter = await call('/api/wallet', { headers: case1.seller.auth });
  const availableAfter = Number(walletAfter.json?.available ?? 0);
  const payoutsAfter = walletAfter.json?.payouts ?? [];

  payoutsAfter.length === payoutsBefore
    ? ok('no payout was created by the refund', `${payoutsAfter.length} payouts`)
    : bad('no payout was created by the refund', `${payoutsBefore} → ${payoutsAfter.length}`);

  Math.abs(availableAfter - availableBefore) < 0.02
    ? ok('the seller’s available balance is unchanged', money(availableAfter))
    : bad('the seller’s available balance is unchanged', `${money(availableBefore)} → ${money(availableAfter)}`);

  /**
   * THE ASSERTION THAT MATTERS: a refunded order must not sit in the seller's
   * pending balance. It is not money they will ever receive, and counting it
   * inflates what the seller believes they are owed.
   */
  const pendingAfter = Number(walletAfter.json?.pending ?? 0);
  const refundedOrderTotal = Number(case1.order.hammerPrice ?? 0);

  pendingAfter < refundedOrderTotal
    ? ok('a refunded order is not counted as pending earnings', `pending ${money(pendingAfter)}`)
    : bad(
        'a refunded order is not counted as pending earnings',
        `pending ${money(pendingAfter)} still includes the ${money(refundedOrderTotal)} refunded sale`,
      );

  const transactions = walletAfter.json?.transactions ?? [];
  const saleEntry = transactions.find((entry) => String(entry.id).startsWith(case1.order.id));
  if (saleEntry) {
    Number(saleEntry.amount) === 0
      ? ok('the refunded sale shows a zero amount in the ledger')
      : bad('the refunded sale shows a zero amount in the ledger', `${money(saleEntry.amount)} (a refunded sale earned nothing)`);
  } else {
    ok('the refunded sale is absent from the transaction list');
  }
  void adminSession;
}

/* ── 4. Resolving for the seller releases on the buyer's behalf ────────── */
section('4. Resolving for the seller releases the funds');

const case2 = await tradeToEscrow('dispute.release', { dispute: true });
if (!case2?.order) {
  bad('a second disputed order could be set up');
} else {
  /**
   * Confirm the escrow really is disputed before resolving.
   *
   * A 409 from `resolve` means "not disputed", and without this the cause is
   * indistinguishable from an authorization problem three steps earlier.
   */
  const preResolve = await call(`/api/orders/${case2.order.id}/escrow`, { headers: case2.buyer.auth });
  const preState = (preResolve.json?.escrow ?? {}).state;
  preState === 'disputed'
    ? ok('the second escrow is disputed before resolution', 'disputed')
    : bad('the second escrow is disputed before resolution', String(preState));

  const releaseResolve = await call(`/api/orders/${case2.order.id}/resolve`, {
    method: 'POST',
    headers: adminAuth,
    body: { resolution: 'release' },
  });

  if (releaseResolve.status === 403) {
    bad('an administrator can resolve for the seller', 'admin_required');
  } else {
    releaseResolve.status === 200
      ? ok('an administrator resolved for the seller', 'release')
      : bad('an administrator resolved for the seller', `status ${releaseResolve.status}`);

    const releasedRecord = releaseResolve.json?.escrow ?? {};
    const held = Number(releasedRecord.heldAmount ?? 0);
    const released = Number(releasedRecord.releasedAmount ?? 0);
    const refunded = Number(releasedRecord.refundedAmount ?? 0);

    released > 0 ? ok('an amount was released to the seller', money(released)) : bad('an amount was released to the seller', money(released));
    refunded === 0 ? ok('nothing was refunded to the buyer', money(refunded)) : bad('nothing was refunded to the buyer', money(refunded));
    released + refunded <= held + 0.02
      ? ok('the released amount is within what was held', `${money(released)} ≤ ${money(held)}`)
      : bad('the released amount is within what was held', `${money(released)} > ${money(held)}`);

    const payout = releaseResolve.json?.payout ?? null;
    const sellerWallet = await call('/api/wallet', { headers: case2.seller.auth });
    const settled = (sellerWallet.json?.payouts ?? []).find((entry) => (entry.orderIds ?? []).includes(case2.order.id));
    settled
      ? ok('a payout was recorded for the released dispute', settled.id)
      : bad('a payout was recorded for the released dispute', payout ? 'returned but not in the ledger' : 'none');

    if (settled) {
      Math.abs(Number(settled.netAmount) - released) < 0.02
        ? ok('the payout net equals the released amount', money(released))
        : bad('the payout net equals the released amount', `${money(settled.netAmount)} vs ${money(released)}`);
      Math.abs(Number(sellerWallet.json?.available ?? 0) - Number(settled.netAmount)) < 0.02
        ? ok('the seller’s available balance reflects the payout', money(Number(settled.netAmount)))
        : bad('the seller’s available balance reflects the payout', money(sellerWallet.json?.available));
    }
  }
}

/* ── 5. Resolution is once-only ────────────────────────────────────────── */
section('5. A dispute cannot be resolved twice');

if (case1?.order) {
  const again = await call(`/api/orders/${case1.order.id}/resolve`, {
    method: 'POST',
    headers: adminAuth,
    body: { resolution: 'release' },
  });
  // Resolving an already-refunded escrow must not also release it.
  again.status >= 400
    ? ok('an already-resolved dispute is refused', `status ${again.status} ${again.json?.error ?? ''}`)
    : bad('an already-resolved dispute is refused', `status ${again.status}`);

  const stillRefunded = await call(`/api/orders/${case1.order.id}/escrow`, { headers: case1.buyer.auth });
  const rec = stillRefunded.json?.escrow ?? {};
  Number(rec.releasedAmount ?? 0) === 0
    ? ok('no funds were released by the second attempt', 'released still 0')
    : bad('no funds were released by the second attempt', money(rec.releasedAmount));
}

/* ── 6. A dispute cannot be raised on an undelivered order ─────────────── */
section('6. Disputes are limited to what can be disputed');

const case3 = await tradeToEscrow('dispute.bounds');
if (!case3?.order) {
  bad('a third order could be set up');
} else {
  // Disputing is available while in escrow; resolving before a dispute is not.
  const resolveUncontested = await call(`/api/orders/${case3.order.id}/resolve`, {
    method: 'POST',
    headers: adminAuth,
    body: { resolution: 'refund' },
  });
  resolveUncontested.status >= 400
    ? ok('an undisputed escrow cannot be resolved', `status ${resolveUncontested.status} ${resolveUncontested.json?.error ?? ''}`)
    : bad('an undisputed escrow cannot be resolved', `status ${resolveUncontested.status}`);

  // And the clean path still works after a refusal.
  const shipped = await call(`/api/orders/${case3.order.id}/status`, {
    method: 'POST',
    headers: case3.seller.auth,
    body: { orderStatus: 'shipped', trackingNumber: 'DISPUTE-0001' },
  });
  const confirmed = await call(`/api/orders/${case3.order.id}/confirm`, { method: 'POST', headers: case3.buyer.auth, body: {} });
  const finalEscrow = await call(`/api/orders/${case3.order.id}/escrow`, { headers: case3.buyer.auth });
  (finalEscrow.json?.escrow ?? {}).state === 'released'
    ? ok('the clean path still settles after a refused resolution', `shipped ${shipped.status}, confirmed ${confirmed.status}`)
    : bad('the clean path still settles after a refused resolution', String((finalEscrow.json?.escrow ?? {}).state));
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
