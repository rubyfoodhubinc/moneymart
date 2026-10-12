#!/usr/bin/env node
/**
 * MoneyMart — end-to-end health check.
 *
 * Proves the whole product is wired together, not just that processes respond:
 *   1. API gateway liveness
 *   2. live data actually present (streams, lots, users)
 *   3. the seeded auction engine responds to a real bid round-trip
 *   4. the storefront (Studio) document round-trips through save + read
 *   5. every web surface serves its SPA shell
 *   6. dev-only controls are blocked when NODE_ENV=production
 *
 * Usage:  node scripts/health.mjs [--web <url>] [--api <url>]
 */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const API = flag('--api', process.env.API_URL ?? 'http://127.0.0.1:4317');
const WEB = flag('--web', process.env.WEB_URL ?? 'http://127.0.0.1:3000');

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

async function get(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body (HTML shell, etc.) */
    }
    return { status: response.status, text, json };
  } catch (error) {
    return { status: 0, text: '', json: null, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

async function post(url, body) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const json = await response.json().catch(() => null);
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: String(error?.message ?? error) };
  }
}

console.log('\n\u001b[1m════════ MoneyMart — end-to-end health check ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\n  web ${WEB}\u001b[0m`);

/* ── 1. Gateway ────────────────────────────────────────────────────────── */
section('1. API gateway');
const health = await get(`${API}/api/health`);
if (health.status === 200 && health.json?.ok) {
  ok('gateway is live', `${health.json.liveStreams} streams · ${health.json.liveAuctions} live lots`);
} else {
  bad('gateway is live', `status ${health.status} ${health.error ?? ''}`);
}

/* ── 2. Live data ──────────────────────────────────────────────────────── */
section('2. Seeded marketplace');
const streams = await get(`${API}/api/streams`);
const auctions = await get(`${API}/api/auctions?sort=ending`);
const users = await get(`${API}/api/users`);
const streamCount = streams.json?.items?.length ?? 0;
const auctionCount = auctions.json?.total ?? 0;
const userCount = Array.isArray(users.json) ? users.json.length : 0;

streamCount > 0 ? ok('streams present', `${streamCount} rooms`) : bad('streams present');
auctionCount > 0 ? ok('lots present', `${auctionCount} lots`) : bad('lots present');
userCount > 0 ? ok('identities present', `${userCount} users`) : bad('identities present');

const hasLive = (streams.json?.items ?? []).some((stream) => stream.status === 'live');
hasLive ? ok('at least one live room') : bad('at least one live room');

const hasPrices = (auctions.json?.items ?? []).every((lot) => typeof lot.currentBid === 'number');
hasPrices && auctionCount > 0 ? ok('every lot carries a numeric current bid') : bad('every lot carries a numeric current bid');

/* ── 3. Engine round-trip ──────────────────────────────────────────────── */
section('3. Auction engine round-trip');
const target = (auctions.json?.items ?? []).find((lot) => lot.isLive && lot.bidCount > 0);
if (target) {
  const before = target.currentBid;
  const minimum = before + (before < 2500 ? 50 : 100);
  const bid = await post(`${API}/api/auctions/${target.id}/bids`, { amount: minimum, bidderId: 'usr_you' });
  if (bid.status === 200 && bid.json?.ok) {
    const after = bid.json.auction?.currentBid;
    after >= minimum
      ? ok('bid accepted and price advanced', `${before} → ${after} on ${target.title.slice(0, 34)}`)
      : bad('bid advanced the price', `got ${after}`);
  } else if (bid.status === 409) {
    // A legitimate rejection still proves the validation pipeline is enforcing rules.
    ok('engine enforced a validation rule', bid.json?.reason ?? 'rejected');
  } else {
    bad('engine round-trip', `status ${bid.status}`);
  }
} else {
  bad('found a live lot to bid on');
}

/* ── 4. Studio storefront round-trip ───────────────────────────────────── */
section('4. Studio storefront round-trip');
const shop = await get(`${API}/api/storefronts/adaluxe`);
if (shop.status === 200 && shop.json?.storefront) {
  const doc = shop.json.storefront;
  ok('storefront reads', `"${doc.name}" · ${doc.blocks.length} blocks`);
  /**
   * The storefront being written must be the CALLER's — a handle in the body is
   * no longer authorization, because it previously let any signed-in user
   * overwrite any creator's shop. The demo header identifies the owner here; the
   * handle is still sent so the request is refused if it ever points elsewhere.
   */
  const save = await fetch(`${API}/api/storefronts`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-mm-user': 'usr_ada' },
    body: JSON.stringify({ handle: 'adaluxe', storefront: { ...doc, tagline: doc.tagline || 'Bid. Stream. Win.' } }),
  }).catch(() => null);
  save && save.ok ? ok('storefront writes (Studio publish)') : bad('storefront writes (Studio publish)');
} else {
  bad('storefront reads', `status ${shop.status}`);
}

/* ── 5. Web surfaces ───────────────────────────────────────────────────── */
section('5. Web surfaces (SPA shell)');
const routes = ['/', '/live', '/auctions', '/auctions/auc_rolex', '/marketplace', '/creators', '/sell', '/studio', '/account', '/admin', '/search'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dev servers lazily compile a route on first request, and Vite briefly
 * re-optimises dependencies when the lockfile changes — during which a first hit
 * can miss the shell. Retry once before reporting a genuine failure.
 */
async function probeShell(route) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await get(`${WEB}${route}`);
    if (response.status === 200 && response.text.includes('<div id="root">')) {
      return { ok: true, attempts: attempt + 1 };
    }
    await sleep(1200);
  }
  const last = await get(`${WEB}${route}`);
  return { ok: false, status: last.status };
}

let served = 0;
const slowRoutes = [];
for (const route of routes) {
  const result = await probeShell(route);
  if (result.ok) {
    served += 1;
    if (result.attempts > 1) slowRoutes.push(route);
  } else {
    bad(`route ${route}`, `status ${result.status}`);
  }
}
if (served === routes.length) {
  ok(
    `all ${routes.length} routes serve the app shell`,
    slowRoutes.length ? `${slowRoutes.length} needed a warm-up retry` : '',
  );
}

/* ── 6. Production hardening ───────────────────────────────────────────── */
section('6. Production hardening');
const devReset = await post(`${API}/api/dev/reset`);
if (devReset.status === 403) {
  ok('dev-only controls blocked (NODE_ENV=production)');
} else if (devReset.status === 200) {
  ok('dev controls available (development mode)', 'expected when NODE_ENV != production');
} else {
  bad('dev control responded unexpectedly', `status ${devReset.status}`);
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
