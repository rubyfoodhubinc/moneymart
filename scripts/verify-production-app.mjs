#!/usr/bin/env node
/**
 * MoneyMart — production product smoke test.
 *
 * Every other suite checks the API, local builds, or the dev servers. This one
 * loads the LIVE deployment in a real browser and asserts the product actually
 * renders: the shell paints, the bundles execute, the client reaches its gateway,
 * and no route throws.
 *
 * It exists because "the API passes 28 checks" and "the app works for a customer"
 * are different claims. The deployment suite checks status codes and security
 * headers; none of that proves React mounted, the router resolved, or the data
 * arrived over the wire from a different origin.
 *
 * Read-only by design: it never bids, buys, signs in or writes. Safe to run
 * against production at any time.
 *
 * Usage: node scripts/verify-production-app.mjs [--url https://moneymart.app]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const URL_BASE = flag('--url', process.env.PROD_URL ?? 'https://moneymart-production.up.railway.app').replace(/\/$/, '');
const CDP_PORT = Number(process.env.PROD_CDP_PORT ?? 9355);

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('\n\u001b[1m════════ MoneyMart production product smoke ════════\u001b[0m');
console.log(`\u001b[2m  ${URL_BASE}\u001b[0m`);

if (!chromePath) {
  console.log('\n  \u001b[33m·\u001b[0m no Chromium binary found — skipping (this suite needs a real browser)\n');
  process.exit(0);
}

/* ── Drive Chrome over the DevTools protocol ───────────────────────────── */
const profileDir = mkdtempSync(path.join(tmpdir(), 'mm-prod-smoke-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    // A predictable window so responsive branches behave the same every run.
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let ws = null;
let messageId = 0;
const pending = new Map();

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function connect() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
        ws.addEventListener('message', (event) => {
          const data = JSON.parse(String(event.data));
          if (data.id && pending.has(data.id)) {
            const { resolve: done, reject: fail } = pending.get(data.id);
            pending.delete(data.id);
            data.error ? fail(new Error(data.error.message)) : done(data.result);
            return;
          }
          // Collect console noise and failed requests for the assertions below.
          if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') {
            consoleErrors.push(
              (data.params.args ?? [])
                .map((arg) => arg.value ?? arg.description ?? arg.type ?? '')
                .join(' ')
                .slice(0, 220),
            );
          }
          if (data.method === 'Runtime.exceptionThrown') {
            pageErrors.push(String(data.params.exceptionDetails?.exception?.description ?? '').slice(0, 220));
          }
          if (data.method === 'Network.loadingFailed') {
            failedRequests.push(`${data.params.type ?? '?'} ${data.params.errorText ?? 'failed'}`);
          }
        });
        await send('Runtime.enable');
        await send('Page.enable');
        await send('Network.enable');
        return true;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  return false;
}

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed');
  return result.result?.value;
};

/** Navigate and let the SPA settle, collecting anything it throws. */
async function visit(pathname, settleMs = 2600) {
  consoleErrors.length = 0;
  pageErrors.length = 0;
  failedRequests.length = 0;
  await send('Page.navigate', { url: `${URL_BASE}${pathname}` });
  await sleep(settleMs);
  return {
    title: await evaluate('document.title'),
    text: await evaluate('(document.body && document.body.innerText) || ""'),
    html: await evaluate('(document.body && document.body.innerHTML) || ""'),
    rootChildren: await evaluate('(document.getElementById("root") || {}).childElementCount ?? -1'),
    consoleErrors: [...consoleErrors],
    pageErrors: [...pageErrors],
    failedRequests: [...failedRequests],
  };
}

const cleanup = () => {
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  try {
    chrome.kill('SIGKILL');
  } catch {
    /* already dead */
  }
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

if (!(await connect())) {
  bad('a headless browser attached to the page');
  cleanup();
  console.log('');
  process.exit(1);
}

/* ── 1. The shell and its bundles ──────────────────────────────────────── */
section('1. The deployed shell loads and its bundles execute');

const home = await visit('/');
home.title ? ok('the document has a title', home.title.slice(0, 46)) : bad('the document has a title');

// If the bundle failed to load, #root stays empty — the classic blank-deploy.
home.rootChildren > 0
  ? ok('the app mounted into #root', `${home.rootChildren} child element(s)`)
  : bad('the app mounted into #root', `childElementCount ${home.rootChildren}`);

home.html.length > 2000
  ? ok('the rendered markup is substantive', `${home.html.length} chars`)
  : bad('the rendered markup is substantive', `${home.html.length} chars`);

home.consoleErrors.length === 0
  ? ok('the home route logged no console errors')
  : bad('the home route logged no console errors', home.consoleErrors.slice(0, 2).join(' | '));

home.pageErrors.length === 0
  ? ok('the home route threw no exceptions')
  : bad('the home route threw no exceptions', home.pageErrors.slice(0, 2).join(' | '));

// A failed JS/CSS asset is the difference between a page and a blank screen.
const assetFailures = home.failedRequests.filter((entry) => /Script|Stylesheet|Font|Fetch|XHR/i.test(entry));
assetFailures.length === 0
  ? ok('every script, stylesheet and data request succeeded')
  : bad('every script, stylesheet and data request succeeded', assetFailures.slice(0, 3).join(' | '));

/* ── 2. The client reaches its gateway across origins ──────────────────── */
section('2. The app talks to its gateway');

// The runtime config is fetched before the first API call; if it 404s the app
// silently falls back to same-origin and calls the wrong host.
const config = await fetch(`${URL_BASE}/mm-config.json`, { signal: AbortSignal.timeout(15_000) })
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);
config ? ok('the runtime config is served') : bad('the runtime config is served');

const apiUrl = config?.apiUrl ?? '';
apiUrl ? ok('the configured gateway is named', apiUrl.slice(0, 44)) : bad('the configured gateway is named');

// Prove the client can actually reach that gateway from a browser context —
// CORS is the usual failure and no API-side test can observe it.
const gatewayReachable = await evaluate(`
  (async () => {
    try {
      const response = await fetch(${JSON.stringify(`${apiUrl}/api/health`)}, { credentials: 'omit' });
      const body = await response.json();
      return JSON.stringify({ ok: response.ok, status: response.status, live: body.liveStreams, lots: body.liveAuctions });
    } catch (error) {
      return JSON.stringify({ ok: false, error: String(error && error.message) });
    }
  })()
`);
const gateway = JSON.parse(gatewayReachable || '{}');
gateway.ok
  ? ok('the browser can fetch the gateway across origins', `${gateway.lots} lots · ${gateway.live} streams`)
  : bad('the browser can fetch the gateway across origins', gateway.error ?? `status ${gateway.status}`);

// The home page should show real data fetched from that gateway, not a skeleton.
const showsData = /auc_|Rolex|Audi|⌛|\$|bid/i.test(home.text);
showsData
  ? ok('the home route renders live data, not an empty state')
  : bad('the home route renders live data, not an empty state', home.text.slice(0, 70).replace(/\n/g, ' '));

/* ── 3. Real product routes resolve ────────────────────────────────────── */
section('3. Product routes resolve in the SPA');

const routes = [
  ['/live', /live|stream|viewer/i],
  ['/auctions', /auction|lot|bid/i],
  ['/marketplace', /market|listing|shop/i],
  ['/creators', /creator|seller|shop/i],
];

for (const [pathname, pattern] of routes) {
  const view = await visit(pathname);
  const renders = view.rootChildren > 0 && pattern.test(view.text);
  renders
    ? ok(`${pathname} renders`, `${view.text.replace(/\n/g, ' ').slice(0, 34)}`)
    : bad(`${pathname} renders`, `root=${view.rootChildren} text="${view.text.slice(0, 44).replace(/\n/g, ' ')}"`);

  if (view.pageErrors.length) {
    bad(`${pathname} threw no exceptions`, view.pageErrors[0]);
  }
}

// A deep link to a real lot must survive a hard load, not just client routing.
const lot = await visit('/auctions/auc_rolex');
/rolex/i.test(lot.text)
  ? ok('a deep-linked lot renders its own content', 'matched "Rolex"')
  : bad('a deep-linked lot renders its own content', lot.text.slice(0, 60).replace(/\n/g, ' '));

/* ── 4. The TV surface ─────────────────────────────────────────────────── */
section('4. The TV surface is a separate, working app');

const tv = await fetch(`${URL_BASE}/tv/`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
const tvHtml = tv ? await tv.text() : '';
tv?.ok ? ok('the TV shell is served') : bad('the TV shell is served', `status ${tv?.status}`);
// Its bundle must be under /tv/, or the web app's assets shadow it.
/\/tv\/assets\//.test(tvHtml)
  ? ok('the TV bundle is namespaced under /tv/')
  : bad('the TV bundle is namespaced under /tv/', (tvHtml.match(/\/assets\/[^"]+/) ?? ['none'])[0]);

const tvView = await visit('/tv/', 3000);
tvView.rootChildren > 0
  ? ok('the TV app mounts', `${tvView.rootChildren} child element(s)`)
  : bad('the TV app mounts', `childElementCount ${tvView.rootChildren}`);

/* ── 5. Security posture in the served response ────────────────────────── */
section('5. The served product is not obviously misconfigured');

const homeResponse = await fetch(`${URL_BASE}/`, { signal: AbortSignal.timeout(15_000) });
const headers = homeResponse.headers;
headers.get('strict-transport-security')
  ? ok('HSTS is sent on the app shell')
  : bad('HSTS is sent on the app shell');
(headers.get('x-content-type-options') ?? '').toLowerCase() === 'nosniff'
  ? ok('X-Content-Type-Options is nosniff')
  : bad('X-Content-Type-Options is nosniff', String(headers.get('x-content-type-options')));

// Dev controls must never be reachable on the deployed product.
const devProbe = await fetch(`${URL_BASE}/api/dev/rate-limit/reset`, { method: 'POST', signal: AbortSignal.timeout(15_000) })
  .then((response) => response.status)
  .catch(() => 0);
devProbe === 403 || devProbe === 404
  ? ok('dev controls are refused on the deployment', `status ${devProbe}`)
  : bad('dev controls are refused on the deployment', `status ${devProbe}`);

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
