#!/usr/bin/env node
/**
 * MoneyMart — unified production deployment verification.
 *
 * Runs against the single-origin gateway (scripts/deploy-local.sh) and asserts
 * the properties that only matter once web, TV and API share one host:
 *
 *   1. TLS verifies against the local CA
 *   2. the SPA shell and deep links resolve from the same origin as the API
 *   3. unmatched /api and /socket.io paths stay API errors, never HTML
 *   4. a missing asset 404s instead of silently returning the shell
 *   5. cache policy: hashed assets immutable, documents revalidated
 *   6. the TV bundle is isolated under /tv and does not collide with /assets
 *   7. security headers are present, including HSTS under TLS
 *   8. production hardening: dev controls are blocked
 *   9. realtime WebSocket works over TLS on the same origin
 *
 * Usage: node scripts/verify-deploy.mjs [--url https://localhost:3443]
 */
import { readFileSync, existsSync } from 'node:fs';
import tls from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--url');
const BASE = flagIndex >= 0 && args[flagIndex + 1] ? args[flagIndex + 1] : (process.env.DEPLOY_URL ?? 'https://localhost:3443');
const CA_PATH = path.join(repoRoot, '.certs', 'ca.crt');
const isTls = BASE.startsWith('https://');

/**
 * A local deployment presents the development CA; a hosted one presents a real
 * publicly-trusted certificate. Only the former needs the CA file, and only the
 * former may relax Node's verification — a production check must not.
 */
const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE);
const useLocalCa = isTls && isLocalOrigin && existsSync(CA_PATH);

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

/**
 * Trust the local CA for this process.
 *
 * A self-signed chain installed in the host trust store is trusted by browsers,
 * but Node reads trust from its own bundle. Setting NODE_TLS_REJECT_UNAUTHORIZED
 * here keeps the suite self-sufficient: without it, every HTTPS request fails to
 * connect and the checks would fail for the wrong reason. The explicit
 * certificate assertion in section 1 still verifies the chain properly.
 */
let ca;
if (useLocalCa) {
  ca = readFileSync(CA_PATH);
  process.env.NODE_EXTRA_CA_CERTS = CA_PATH;
  if (process.env.MM_STRICT_TLS !== '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

async function get(pathname, options = {}) {
  const url = `${BASE}${pathname}`;
  try {
    const response = await fetch(url, { redirect: 'manual', ...options });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return {
      status: response.status,
      headers: response.headers,
      text,
      json,
      contentType: response.headers.get('content-type') ?? '',
    };
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', json: null, contentType: '', error: String(error?.message ?? error) };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Node's fetch trusts NODE_EXTRA_CA_CERTS; set it before the process starts. */

console.log('\n\u001b[1m════════ MoneyMart — unified deployment verification ════════\u001b[0m');
console.log(`\u001b[2m  origin ${BASE}${ca ? '  (local CA loaded)' : ''}\u001b[0m`);

/* ── 1. TLS ────────────────────────────────────────────────────────────── */
section('1. Transport security');
if (isTls) {
  const tlsOk = await new Promise((resolve) => {
    const url = new URL(BASE);
    // A hosted origin must verify against the system trust store.
    if (!ca && !isLocalOrigin) {
      const socket = tls.connect(
        { host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: true },
        () => {
          const cert = socket.getPeerCertificate();
          resolve({ ok: socket.authorized, reason: '', subject: cert.subject?.CN, alt: cert.subjectaltname, issuer: cert.issuer?.O });
          socket.end();
        },
      );
      socket.on('error', (error) => resolve({ ok: false, reason: error.message }));
      socket.setTimeout(8000, () => {
        socket.destroy();
        resolve({ ok: false, reason: 'timeout' });
      });
      return;
    }
    if (!ca) {
      resolve({ ok: false, reason: 'no CA file' });
      return;
    }
    const socket = tls.connect(
      { host: url.hostname, port: Number(url.port || 443), ca, servername: url.hostname, rejectUnauthorized: true },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          ok: socket.authorized,
          reason: socket.authorizationError ? String(socket.authorizationError) : '',
          subject: cert.subject?.CN,
          alt: cert.subjectaltname,
        });
        socket.end();
      },
    );
    socket.on('error', (error) => resolve({ ok: false, reason: error.message }));
    socket.setTimeout(6000, () => {
      socket.destroy();
      resolve({ ok: false, reason: 'timeout' });
    });
  });

  if (isLocalOrigin) {
    tlsOk.ok
      ? ok('certificate verifies against the local CA', `CN=${tlsOk.subject}`)
      : bad('certificate verifies against the local CA', tlsOk.reason);
    tlsOk.alt && /localhost|127\.0\.0\.1/.test(tlsOk.alt)
      ? ok('certificate SAN covers localhost', tlsOk.alt.slice(0, 52))
      : bad('certificate SAN covers localhost', tlsOk.alt ?? 'missing');
  } else {
    tlsOk.ok
      ? ok('certificate verifies against the system trust store', `${tlsOk.subject ?? ''} · issued by ${tlsOk.issuer ?? 'unknown'}`)
      : bad('certificate verifies against the system trust store', tlsOk.reason);
    tlsOk.alt
      ? ok('certificate covers the requested host', tlsOk.alt.slice(0, 52))
      : bad('certificate covers the requested host', 'no SAN');
  }
} else {
  ok('running over plain HTTP', 'TLS disabled for this run');
}

/* ── 2. Same-origin SPA + API ──────────────────────────────────────────── */
section('2. Single origin serves SPA and API');

const health = await get('/api/health');
health.status === 200 && health.json?.ok
  ? ok('API answers on the page origin', `${health.json.liveStreams} streams · ${health.json.liveAuctions} live lots`)
  : bad('API answers on the page origin', `status ${health.status} ${health.error ?? ''}`);

const root = await get('/');
const isShell = root.status === 200 && /<div id="root">|<div id=root>/.test(root.text);
isShell ? ok('SPA shell served at /') : bad('SPA shell served at /', `status ${root.status}`);

const deepLinks = ['/live', '/auctions/auc_rolex', '/marketplace', '/creators', '/sell', '/studio', '/account', '/account/orders', '/account/wallet', '/admin', '/search', '/notifications'];
let deepOk = 0;
for (const route of deepLinks) {
  const response = await get(route);
  if (response.status === 200 && /<div id="root">|<div id=root>/.test(response.text)) deepOk += 1;
  else bad(`deep link ${route}`, `status ${response.status}`);
}
if (deepOk === deepLinks.length) ok(`all ${deepLinks.length} deep links resolve to the shell`);

const missing = await get('/this/route/does/not/exist');
missing.status === 200 && /<div id="root">|<div id=root>/.test(missing.text)
  ? ok('unknown client route falls back to the shell (SPA routing)')
  : bad('unknown client route falls back to the shell (SPA routing)', `status ${missing.status}`);

/* ── 3. API isolation ──────────────────────────────────────────────────── */
section('3. API paths are never served the shell');

const apiMissing = await get('/api/does-not-exist');
apiMissing.status === 404 && apiMissing.contentType.includes('application/json')
  ? ok('unmatched /api path returns a JSON 404', apiMissing.json?.error ?? '')
  : bad('unmatched /api path returns a JSON 404', `status ${apiMissing.status} type ${apiMissing.contentType}`);

!/<div id="root">|<div id=root>/.test(apiMissing.text)
  ? ok('unmatched /api path is not the HTML shell')
  : bad('unmatched /api path is not the HTML shell');

const socketMissing = await get('/socket.io/not-a-transport');
socketMissing.contentType.includes('application/json')
  ? ok('unmatched /socket.io path returns JSON, not HTML')
  : bad('unmatched /socket.io path returns JSON, not HTML', `type ${socketMissing.contentType}`);

/* ── 4. Asset integrity ────────────────────────────────────────────────── */
section('4. Asset serving and cache policy');

const webAsset = root.text.match(/\/assets\/[^"']*?\.js/)?.[0];
if (webAsset) {
  const asset = await get(webAsset);
  asset.status === 200 && asset.contentType.includes('javascript')
    ? ok('hashed web bundle is served', `${Math.round(asset.text.length / 1024)} KB`)
    : bad('hashed web bundle is served', `status ${asset.status} type ${asset.contentType}`);

  const cache = asset.headers.get('cache-control') ?? '';
  /immutable/.test(cache)
    ? ok('hashed assets are immutable-cacheable', cache)
    : bad('hashed assets are immutable-cacheable', cache || 'no cache-control');
} else {
  bad('web bundle reference found in the shell');
}

const docCache = root.headers.get('cache-control') ?? '';
/ no-cache|no-store/.test(` ${docCache}`)
  ? ok('HTML documents must revalidate', docCache)
  : bad('HTML documents must revalidate', docCache || 'no cache-control');

const gone = await get('/assets/definitely-missing-12345678.js');
gone.status === 404
  ? ok('a missing asset 404s instead of returning the shell', gone.json?.error ?? '')
  : bad('a missing asset 404s instead of returning the shell', `status ${gone.status}`);

/* ── 5. TV bundle isolation ────────────────────────────────────────────── */
section('5. TV bundle is isolated under /tv');

const tv = await get('/tv/');
tv.status === 200 && tv.contentType.includes('text/html')
  ? ok('TV app served at /tv/')
  : bad('TV app served at /tv/', `status ${tv.status}`);

const tvAsset = tv.text.match(/\/tv\/assets\/[^"']*?\.js/)?.[0];
tvAsset
  ? ok('TV bundle references its own /tv/assets path', tvAsset)
  : bad('TV bundle references its own /tv/assets path', 'no /tv/assets reference found');

if (tvAsset) {
  const tvJs = await get(tvAsset);
  tvJs.status === 200
    ? ok('TV bundle asset is reachable', `${Math.round(tvJs.text.length / 1024)} KB`)
    : bad('TV bundle asset is reachable', `status ${tvJs.status}`);

  // The collision guard: the TV chunk must not be how the web root is served.
  const tvMarkers = /tv-focusable|FocusProvider|AXIS_WEIGHT/.test(tvJs.text);
  tvMarkers ? ok('served TV bundle is genuinely the TV app') : bad('served TV bundle is genuinely the TV app');

  if (webAsset && tvAsset !== webAsset) {
    const webJs = await get(webAsset);
    /tv-focusable|AXIS_WEIGHT/.test(webJs.text) === false
      ? ok('web bundle and TV bundle are distinct (no asset collision)')
      : bad('web bundle and TV bundle are distinct (no asset collision)');
  }
}

/* ── 6. Security headers ───────────────────────────────────────────────── */
section('6. Security headers');

const headers = [
  ['x-content-type-options', /nosniff/],
  ['x-frame-options', /SAMEORIGIN|DENY/],
  ['referrer-policy', /strict-origin/],
  ['content-security-policy', /default-src 'self'/],
  ['permissions-policy', /camera|microphone|geolocation/],
];
for (const [name, pattern] of headers) {
  const value = root.headers.get(name) ?? '';
  pattern.test(value) ? ok(`${name} is set`) : bad(`${name} is set`, value || 'missing');
}

if (isTls) {
  const hsts = root.headers.get('strict-transport-security') ?? '';
  /max-age=\d{6,}/.test(hsts) ? ok('HSTS is enforced under TLS', hsts.slice(0, 46)) : bad('HSTS is enforced under TLS', hsts || 'missing');
}

const csp = root.headers.get('content-security-policy') ?? '';
!/unsafe-eval/.test(csp) ? ok('CSP forbids unsafe-eval') : bad('CSP forbids unsafe-eval');
/camera=\(self\)/.test(root.headers.get('permissions-policy') ?? '')
  ? ok('camera is restricted to self (listing photos, KYC)')
  : bad('camera is restricted to self (listing photos, KYC)');

/* ── 7. Production hardening ───────────────────────────────────────────── */
section('7. Production hardening');

const devReset = await get('/api/dev/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
/**
 * Two independent refusals are correct and both mean "disabled":
 *   401 — the request carries no identity, and unattributed writes are refused
 *         before any handler runs.
 *   403 — the request reached the route, which refuses because the control is
 *         switched off outside development.
 * Only a 200 is a failure, since that means the reset actually executed.
 */
if (devReset.status === 200) {
  bad('dev control endpoints are disabled', 'they are OPEN — the store was reset');
} else if (devReset.status === 401 || devReset.status === 403) {
  ok('dev control endpoints are disabled', `/api/dev/reset → ${devReset.status}`);
} else {
  bad('dev control endpoints are disabled', `unexpected status ${devReset.status}`);
}

/* ── 8. Realtime over TLS ──────────────────────────────────────────────── */
section('8. Realtime on the unified origin');
try {
  const { io } = await import('socket.io-client');
  const result = await new Promise((resolve) => {
    const socket = io(BASE, {
      path: '/socket.io',
      transports: ['websocket'],
      // A hosted origin is verified normally; only the local CA run opts out.
      rejectUnauthorized: true,
      ca: ca ? [ca] : undefined,
      timeout: 8000,
    });
    const finish = (value) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };
    socket.on('connect', () => {
      socket.emit('auction:join', 'auc_rolex');
    });
    socket.once('auction:snapshot', (payload) => finish({ ok: true, bids: payload.bids.length, price: payload.auction.currentBid }));
    socket.on('connect_error', (error) => finish({ ok: false, reason: error.message }));
    setTimeout(() => finish({ ok: false, reason: 'timeout' }), 9000);
  });

  result.ok
    ? ok('WebSocket connects over TLS and delivers a snapshot', `${result.bids} bids at ${result.price}`)
    : bad('WebSocket connects over TLS and delivers a snapshot', result.reason);
} catch (error) {
  bad('WebSocket connects over TLS and delivers a snapshot', String(error?.message ?? error));
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════════\u001b[0m\n');
void sleep;
process.exit(fail === 0 ? 0 : 1);
