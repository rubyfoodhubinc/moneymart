#!/usr/bin/env node
/**
 * MoneyMart — object-level authorization (IDOR) verification.
 *
 * Authentication asks "who are you". This asks the question that authentication
 * does not answer: **may this caller touch this particular object**. Both defects
 * found here were of that shape — the caller was genuinely signed in, and the
 * endpoint simply never checked whether the object was theirs.
 *
 * An id is not a secret: order ids appear in URLs, notifications and support
 * conversations, and a creator's handle is public by design. So an endpoint that
 * treats knowing an id as authorization is open to anyone.
 *
 * Usage: node scripts/verify-authorization.mjs [--api http://127.0.0.1:4317]
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
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}\u001b[0m` : ''}`);
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
      /* not json */
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: String(error?.message ?? error) };
  }
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** Mint a real session through the passwordless flow. */
async function mintToken(label) {
  const identifier = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  const requested = await call('/api/auth/request', { method: 'POST', body: { identifier } });
  if (!requested.json?.devCode) return null;
  const verified = await call('/api/auth/verify', {
    method: 'POST',
    body: { identifier, code: requested.json.devCode },
  });
  return verified.json?.token ?? null;
}

console.log('\n\u001b[1m════════ MoneyMart object-level authorization ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\u001b[0m`);

// Clear ingress limits: this suite signs in several times.
await call('/api/dev/rate-limit/reset', { method: 'POST' }).catch(() => null);

const outsider = await mintToken('outsider');
outsider ? ok('an unrelated account can be created', 'used as the attacker throughout') : bad('an unrelated account can be created');

if (!outsider) {
  console.log('\n  \u001b[31m✘\u001b[0m cannot continue without a second account\n');
  process.exit(1);
}

/* ── 1. Orders are visible only to their participants ──────────────────── */
section('1. Orders are private to buyer and seller');

// Find an order that belongs to somebody else, via the seeded demo identity.
const victimOrders = await call('/api/orders', { headers: { 'x-mm-user': 'usr_you' } });
const victimOrder = (victimOrders.json?.buying ?? [])[0] ?? (victimOrders.json?.selling ?? [])[0];

if (!victimOrder) {
  bad('a seeded order exists to test against', 'run with the demo seed enabled');
} else {
  ok('a seeded order exists to test against', victimOrder.id);

  const read = await call(`/api/orders/${victimOrder.id}`, { headers: bearer(outsider) });
  // 404 rather than 403: a 403 would confirm the id exists.
  read.status === 404
    ? ok('an unrelated account cannot read the order', '404')
    : bad('an unrelated account cannot read the order', `status ${read.status}`);

  const leaked = JSON.stringify(read.json ?? {});
  !/buyerId|sellerId|trackingNumber|shippingAddress/.test(leaked)
    ? ok('the refusal leaks no order fields')
    : bad('the refusal leaks no order fields', leaked.slice(0, 80));

  const escrowView = await call(`/api/orders/${victimOrder.id}/escrow`, { headers: bearer(outsider) });
  escrowView.status === 404
    ? ok('an unrelated account cannot read the escrow ledger')
    : bad('an unrelated account cannot read the escrow ledger', `status ${escrowView.status}`);

  const statusChange = await call(`/api/orders/${victimOrder.id}/status`, {
    method: 'POST',
    headers: bearer(outsider),
    body: { orderStatus: 'shipped', trackingNumber: 'FORGED-0001' },
  });
  statusChange.status === 404
    ? ok('an unrelated account cannot change fulfilment')
    : bad('an unrelated account cannot change fulfilment', `status ${statusChange.status}`);

  // Confirm nothing was actually written.
  const after = await call(`/api/orders/${victimOrder.id}`, { headers: { 'x-mm-user': 'usr_you' } });
  after.json?.order?.trackingNumber !== 'FORGED-0001'
    ? ok('no forged tracking number was recorded')
    : bad('no forged tracking number was recorded', String(after.json?.order?.trackingNumber));

  // The real participants must still have full access.
  const buyerRead = await call(`/api/orders/${victimOrder.id}`, { headers: { 'x-mm-user': 'usr_you' } });
  buyerRead.status === 200 ? ok('the buyer retains access') : bad('the buyer retains access', `status ${buyerRead.status}`);

  const sellerRead = await call(`/api/orders/${victimOrder.id}`, { headers: { 'x-mm-user': victimOrder.sellerId } });
  sellerRead.status === 200 ? ok('the seller retains access', victimOrder.sellerId) : bad('the seller retains access', `status ${sellerRead.status}`);
}

/* ── 2. Escrow actions stay with the right party ───────────────────────── */
section('2. Escrow actions are party-specific');

if (victimOrder) {
  const outsiderPay = await call(`/api/orders/${victimOrder.id}/pay`, { method: 'POST', headers: bearer(outsider), body: {} });
  outsiderPay.status !== 200
    ? ok('an unrelated account cannot pay for an order', `status ${outsiderPay.status}`)
    : bad('an unrelated account cannot pay for an order', 'the payment was accepted');

  const outsiderConfirm = await call(`/api/orders/${victimOrder.id}/confirm`, { method: 'POST', headers: bearer(outsider), body: {} });
  outsiderConfirm.status !== 200
    ? ok('an unrelated account cannot release funds', `status ${outsiderConfirm.status}`)
    : bad('an unrelated account cannot release funds', 'release succeeded for a non-party');

  /**
   * The seller must not be able to release their own funds either — that is the
   * core escrow guarantee, and a seller-only check would quietly break it.
   */
  const sellerConfirm = await call(`/api/orders/${victimOrder.id}/confirm`, {
    method: 'POST',
    headers: { 'x-mm-user': victimOrder.sellerId },
    body: {},
  });
  sellerConfirm.status !== 200
    ? ok('the seller cannot release their own funds', `status ${sellerConfirm.status}`)
    : bad('the seller cannot release their own funds', 'the seller released escrow');

  const outsiderDispute = await call(`/api/orders/${victimOrder.id}/dispute`, {
    method: 'POST',
    headers: bearer(outsider),
    body: { reason: 'not my order' },
  });
  outsiderDispute.status !== 200
    ? ok('an unrelated account cannot open a dispute', `status ${outsiderDispute.status}`)
    : bad('an unrelated account cannot open a dispute', 'dispute opened by a non-party');
}

/* ── 3. Storefront writes belong to the owner ──────────────────────────── */
section('3. A storefront can only be written by its owner');

const victimHandle = 'adaluxe';
const beforeWrite = await call(`/api/storefronts/${victimHandle}`);
const originalName = beforeWrite.json?.storefront?.name ?? beforeWrite.json?.name;
originalName ? ok('the victim storefront exists', String(originalName).slice(0, 24)) : bad('the victim storefront exists');

const hijack = await call('/api/storefronts', {
  method: 'PUT',
  headers: bearer(outsider),
  body: { handle: victimHandle, storefront: { name: 'HIJACKED', tagline: 'not yours' } },
});
hijack.status === 403
  ? ok('writing another creator’s storefront is refused', `403 ${hijack.json?.error ?? ''}`)
  : bad('writing another creator’s storefront is refused', `status ${hijack.status}`);

const afterWrite = await call(`/api/storefronts/${victimHandle}`);
const nameNow = afterWrite.json?.storefront?.name ?? afterWrite.json?.name;
nameNow === originalName
  ? ok('the victim storefront is unchanged')
  : bad('the victim storefront is unchanged', `${originalName} → ${nameNow}`);

// The caller must still be able to write its own shop.
const ownWrite = await call('/api/storefronts', {
  method: 'PUT',
  headers: bearer(outsider),
  body: { storefront: { name: 'My own shop', tagline: 'scoped correctly' } },
});
ownWrite.status === 200
  ? ok('a creator can still write their own storefront', '200')
  : bad('a creator can still write their own storefront', `status ${ownWrite.status}`);

// The handle is derived from the session, so the saved document belongs to them.
const ownSession = await call('/api/auth/session', { headers: bearer(outsider) });
const ownHandle = ownSession.json?.profile?.handle;
if (ownHandle) {
  const ownRead = await call(`/api/storefronts/${ownHandle}`);
  const ownName = ownRead.json?.storefront?.name ?? ownRead.json?.name;
  ownName === 'My own shop'
    ? ok('the saved storefront is the caller’s own', `@${ownHandle}`)
    : bad('the saved storefront is the caller’s own', `found ${ownName}`);
}

/* ── 4. Public data stays public ───────────────────────────────────────── */
section('4. Public resources remain accessible');

for (const [pathname, label] of [
  ['/api/auctions', 'the auction list'],
  ['/api/streams', 'the stream list'],
  ['/api/users', 'the creator directory'],
  ['/api/config', 'platform configuration'],
]) {
  const response = await call(pathname);
  response.status === 200 ? ok(`${label} is readable without identity`) : bad(`${label} is readable without identity`, `status ${response.status}`);
}

const publicAuction = await call('/api/auctions/auc_rolex');
publicAuction.status === 200 ? ok('an individual lot remains public') : bad('an individual lot remains public', `status ${publicAuction.status}`);

/* ── 5. An id in the URL is not authorization ──────────────────────────── */
section('5. Guessing an id confers nothing');

// A plausible but non-existent id must not be distinguishable from a real one
// belonging to someone else.
const missing = await call('/api/orders/ord_does_not_exist', { headers: bearer(outsider) });
const someoneElses = victimOrder
  ? await call(`/api/orders/${victimOrder.id}`, { headers: bearer(outsider) })
  : { status: 0 };

missing.status === someoneElses.status
  ? ok('unknown and others’ ids are indistinguishable', `both ${missing.status}`)
  : bad('unknown and others’ ids are indistinguishable', `${missing.status} vs ${someoneElses.status}`);

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
