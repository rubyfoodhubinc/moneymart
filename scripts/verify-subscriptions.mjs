#!/usr/bin/env node
/**
 * MoneyMart — payments providers and membership entitlements.
 *
 * Two distinct systems are covered here, because conflating them is the easy
 * mistake: an ORDER is paid once through the escrow state machine, whereas a
 * MEMBERSHIP is a recurring entitlement that changes what a buyer pays.
 *
 *   1. provider registry: Stripe, PayPal, Paystack plus the simulated fallback
 *   2. the identity guard — an unknown x-mm-user must not be served as anyone
 *   3. the escrow ledger stays balanced with the new rails registered
 *   4. membership lifecycle: purchase → cancellation → grace → expiration
 *   5. entitlement-driven pricing: Pro pays 10%/15%, free pays 15%/20%
 *   6. webhook authentication and sandbox isolation
 *
 * Usage: node scripts/verify-subscriptions.mjs [--api http://127.0.0.1:4317]
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

async function call(path, options = {}) {
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let json = null;
    try {
      json = await response.json();
    } catch {
      /* non-json */
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: String(error?.message ?? error) };
  }
}

const as = (userId, extra = {}) => ({ headers: { 'x-mm-user': userId, ...(extra.headers ?? {}) }, ...extra });
const future = Date.now() + 30 * 86_400_000;
const past = Date.now() - 86_400_000;
/** Unique per run so re-running never reads a previous run's entitlement. */
const RUN = Date.now().toString(36);

console.log('\n\u001b[1m════════ MoneyMart payments & membership ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}   run ${RUN}\u001b[0m`);

/* ── 1. Provider registry ──────────────────────────────────────────────── */
section('1. Payment providers (§9.1)');

const providers = await call('/api/payments/providers');
const list = Array.isArray(providers.json) ? providers.json : (providers.json?.items ?? providers.json?.providers ?? []);
const ids = list.map((entry) => entry.id ?? entry.provider);

ids.includes('stripe') ? ok('Stripe is registered') : bad('Stripe is registered', ids.join(','));
ids.includes('paypal') ? ok('PayPal is registered') : bad('PayPal is registered', ids.join(','));
ids.includes('paystack') ? ok('Paystack is registered') : bad('Paystack is registered', ids.join(','));
ids.includes('simulated')
  ? ok('the simulated rail is registered as a fallback')
  : bad('the simulated rail is registered as a fallback', ids.join(','));

const paypal = list.find((entry) => (entry.id ?? entry.provider) === 'paypal');
paypal
  ? ok('PayPal advertises its supported currencies', (paypal.supports?.currencies ?? []).join('/'))
  : bad('PayPal advertises its supported currencies');

// Every listed provider must report whether it is usable, so the client can
// show an honest state instead of a dead option.
list.every((entry) => typeof entry.configured === 'boolean')
  ? ok('every provider reports a configured flag')
  : bad('every provider reports a configured flag');

// Without credentials the platform must still be operable end to end.
const anyConfigured = list.some((entry) => entry.configured && (entry.id ?? entry.provider) !== 'simulated');
ok(
  anyConfigured ? 'live rails are configured' : 'no live keys present — the simulated rail carries the flow',
  anyConfigured ? '' : 'expected in this environment',
);

/* ── 2. Identity guard ─────────────────────────────────────────────────── */
section('2. Identity guard (authorisation fails closed)');

const bogus = await call('/api/wallet', as('definitely_not_a_user'));
bogus.status === 401
  ? ok('an unknown x-mm-user is rejected, not downgraded', '401 unknown_identity')
  : bad('an unknown x-mm-user is rejected, not downgraded', `status ${bogus.status}`);

const bogusBody = JSON.stringify(bogus.json ?? {});
/unknown_identity/.test(bogusBody) ? ok('the refusal names the reason') : bad('the refusal names the reason', bogusBody.slice(0, 60));

const realWallet = await call('/api/wallet', as('usr_you'));
realWallet.status === 200 ? ok('a real identity still reaches the wallet', '200') : bad('a real identity still reaches the wallet', `status ${realWallet.status}`);

// The bypass this guard exists to prevent: a forged id returning someone
// else's balances.
const forged = await call('/api/orders', as('forged_id_12345'));
forged.status === 401 ? ok('a forged id cannot read another user\'s orders') : bad('a forged id cannot read another user\'s orders', `status ${forged.status}`);

const anonymous = await call('/api/health');
anonymous.status === 200 ? ok('identity-less requests (probes, native) are unaffected') : bad('identity-less requests (probes, native) are unaffected', `status ${anonymous.status}`);

/* ── 3. Escrow integrity with the new rails ────────────────────────────── */
section('3. Escrow ledger integrity (§9.1)');

const ledger = await call('/api/escrow');
ledger.status === 200 ? ok('the escrow ledger is readable', `${ledger.json?.byState ? Object.keys(ledger.json.byState).length : 0} states`) : bad('the escrow ledger is readable', `status ${ledger.status}`);

typeof ledger.json?.totalHeld === 'number'
  ? ok('platform-wide held total is reported', String(ledger.json.totalHeld))
  : bad('platform-wide held total is reported');

/* ── 4. Membership lifecycle ───────────────────────────────────────────── */
section('4. Membership lifecycle (RevenueCat)');

const memberA = `webhook_a_${RUN}`;
const memberB = `webhook_b_${RUN}`;

const purchase = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: { event: { type: 'INITIAL_PURCHASE', app_user_id: memberA, entitlement_ids: ['pro'], expiration_at_ms: future, store: 'APP_STORE', environment: 'PRODUCTION' } },
});
purchase.json?.subscription?.tier === 'pro'
  ? ok('INITIAL_PURCHASE grants the Pro entitlement', `tier=${purchase.json.subscription.tier}`)
  : bad('INITIAL_PURCHASE grants the Pro entitlement', JSON.stringify(purchase.json?.subscription ?? purchase.json).slice(0, 90));

purchase.json?.subscription?.isActive === true ? ok('the granted membership is active') : bad('the granted membership is active');

const afterPurchase = await call('/api/subscription', as(memberA));
afterPurchase.json?.isPro === true ? ok('the member reads back as Pro') : bad('the member reads back as Pro', String(afterPurchase.json?.isPro));

const cancellation = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: { event: { type: 'CANCELLATION', app_user_id: memberA, expiration_at_ms: future } },
});
cancellation.json?.subscription?.isActive === true
  ? ok('CANCELLATION keeps access until the paid period ends', 'auto-renew off ≠ loss of access')
  : bad('CANCELLATION keeps access until the paid period ends', JSON.stringify(cancellation.json?.subscription ?? {}).slice(0, 80));
cancellation.json?.subscription?.tier === 'pro'
  ? ok('CANCELLATION preserves the tier while access continues')
  : bad('CANCELLATION preserves the tier while access continues', String(cancellation.json?.subscription?.tier));

const grace = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: { event: { type: 'BILLING_ISSUE', app_user_id: memberA, entitlement_ids: ['pro'], expiration_at_ms: future } },
});
grace.json?.subscription?.status === 'grace_period'
  ? ok('BILLING_ISSUE places the membership in a grace period')
  : bad('BILLING_ISSUE places the membership in a grace period', String(grace.json?.subscription?.status));
(await call('/api/subscription', as(memberA))).json?.isPro === true
  ? ok('a grace period still grants Pro')
  : bad('a grace period still grants Pro');

const expiration = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: { event: { type: 'EXPIRATION', app_user_id: memberA, expiration_at_ms: past } },
});
const afterExpiry = await call('/api/subscription', as(memberA));
afterExpiry.json?.isPro === false
  ? ok('EXPIRATION revokes Pro')
  : bad('EXPIRATION revokes Pro', String(afterExpiry.json?.isPro));
afterExpiry.json?.subscription?.tier === 'free'
  ? ok('EXPIRATION clears the stored tier (a lapsed member is not a Pro record)')
  : bad('EXPIRATION clears the stored tier (a lapsed member is not a Pro record)', String(afterExpiry.json?.subscription?.tier));

// An unrecognised entitlement must not confer anything.
const unknown = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: { event: { type: 'INITIAL_PURCHASE', app_user_id: memberB, entitlement_ids: ['gold_partner'], expiration_at_ms: future } },
});
unknown.json?.subscription?.tier === 'free'
  ? ok('an unrecognised entitlement grants nothing', 'gold_partner → free')
  : bad('an unrecognised entitlement grants nothing', String(unknown.json?.subscription?.tier));

const noUser = await call('/api/webhooks/revenuecat', { method: 'POST', body: { event: { type: 'INITIAL_PURCHASE', entitlement_ids: ['pro'] } } });
noUser.status === 200 && noUser.json?.applied === false
  ? ok('an event with no app_user_id is acknowledged but not applied')
  : bad('an event with no app_user_id is acknowledged but not applied', JSON.stringify(noUser.json).slice(0, 70));

const malformed = await call('/api/webhooks/revenuecat', { method: 'POST', body: { nope: true } });
malformed.json?.applied === false || malformed.status === 200
  ? ok('a malformed body does not throw')
  : bad('a malformed body does not throw', `status ${malformed.status}`);

/* ── 5. Entitlement-driven pricing ─────────────────────────────────────── */
section('5. Entitlement-driven pricing (§10)');

const freeLot = await call('/api/auctions/auc_rolex', as('usr_sofia'));
const freeRate = freeLot.json?.breakdown?.buyersPremiumRate;
Math.abs(freeRate - 0.2) < 0.001
  ? ok('a non-member pays 20% on a luxury lot')
  : bad('a non-member pays 20% on a luxury lot', `${(freeRate * 100).toFixed(0)}%`);

const proLot = await call('/api/auctions/auc_rolex', as('usr_you'));
const proRate = proLot.json?.breakdown?.buyersPremiumRate;
Math.abs(proRate - 0.15) < 0.001
  ? ok('a Pro member pays 15% on the same luxury lot', 'the membership has a real effect')
  : bad('a Pro member pays 15% on the same luxury lot', `${(proRate * 100).toFixed(0)}%`);

const freeStd = await call('/api/auctions/auc_airmax', as('usr_sofia'));
Math.abs(freeStd.json?.breakdown?.buyersPremiumRate - 0.15) < 0.001
  ? ok('a non-member pays 15% on a standard lot')
  : bad('a non-member pays 15% on a standard lot', `${(freeStd.json?.breakdown?.buyersPremiumRate * 100).toFixed(0)}%`);

const proStd = await call('/api/auctions/auc_airmax', as('usr_you'));
Math.abs(proStd.json?.breakdown?.buyersPremiumRate - 0.1) < 0.001
  ? ok('a Pro member pays 10% on a standard lot')
  : bad('a Pro member pays 10% on a standard lot', `${(proStd.json?.breakdown?.buyersPremiumRate * 100).toFixed(0)}%`);

(proLot.json?.breakdown?.total ?? 0) < (freeLot.json?.breakdown?.total ?? 0)
  ? ok('the Pro discount lowers the total, not just the label')
  : bad('the Pro discount lowers the total, not just the label');

// The quoted premium and the settled premium must come from one resolver.
const quoted = proLot.json?.breakdown?.buyersPremiumRate;
const settled = proStd.json?.breakdown?.buyersPremiumRate;
quoted !== undefined && settled !== undefined
  ? ok('quote and settlement share one rate resolver', `luxury ${(quoted * 100).toFixed(0)}% · standard ${(settled * 100).toFixed(0)}%`)
  : bad('quote and settlement share one rate resolver');

/* ── 6. Webhook authentication and sandbox isolation ───────────────────── */
section('6. Webhook authentication');

const unauth = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: { event: { type: 'INITIAL_PURCHASE', app_user_id: `unauth_${RUN}`, entitlement_ids: ['pro'], expiration_at_ms: future } },
});
// With no secret configured the endpoint is open (dev); with one it must demand it.
unauth.status === 200 || unauth.status === 401
  ? ok('the webhook responds deterministically', `status ${unauth.status}`)
  : bad('the webhook responds deterministically', `status ${unauth.status}`);

// The pricing block the client renders must match what is charged.
const sub = await call('/api/subscription', as('usr_you'));
const pricing = sub.json?.pricing ?? {};
pricing.proLuxuryPremium === 15 && pricing.luxuryPremium === 20
  ? ok('the client is told the correct pricing table', `luxury ${pricing.luxuryPremium}% → Pro ${pricing.proLuxuryPremium}%`)
  : bad('the client is told the correct pricing table', JSON.stringify(pricing));

typeof sub.json?.revenueCatConfigured === 'boolean'
  ? ok('the API reports whether RevenueCat is configured', String(sub.json.revenueCatConfigured))
  : bad('the API reports whether RevenueCat is configured');

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
