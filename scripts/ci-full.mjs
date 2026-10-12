#!/usr/bin/env node
/**
 * MoneyMart — full release gate for CI.
 *
 * Starts every service the suites need, runs all of them, then tears everything
 * down. The first version of the CI gate started only the API, so `tv` and
 * `health` failed with `status 0` — connection refused — because those suites
 * check the TV dev server's sources and the web app's routes. The failure was
 * real and worth having: a gate that does not start what it tests reports a
 * false negative, and a gate whose failures are "expected" stops being read.
 *
 * Services and their ports:
 *   api     4317   the gateway, from its compiled entry
 *   web     3000   Vite dev server (health checks real routes and the SPA)
 *   tv      3200   Vite dev server (the TV suite reads /src for its assertions)
 *
 * Excluded, stated so a green check is not mistaken for full coverage:
 *   • mobile bundling — exports both native platforms, which is slow
 *   • the deployment suite — needs the hosted gateway and its certificate
 *   • the HLS and browser-UI suites — need a Chromium binary; the HLS suite is
 *     included when one is present, since it is the difference between "the
 *     player compiles" and "the player decodes".
 *
 * Usage: node scripts/ci-full.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.CI_API_PORT ?? 4317);
const WEB_PORT = Number(process.env.CI_WEB_PORT ?? 3000);
const TV_PORT = Number(process.env.CI_TV_PORT ?? 3200);

const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const TV = `http://127.0.0.1:${TV_PORT}`;

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');

/** Suites that need only the API. */
const API_SUITES = [
  'verify-engine.mjs',
  'verify-realtime.mjs',
  'verify-escrow.mjs',
  'verify-auth.mjs',
  'verify-images.mjs',
  'verify-authorization.mjs',
  'verify-rate-limit.mjs',
  'verify-socket-auth.mjs',
  'verify-persistence.mjs',
  'verify-subscriptions.mjs',
  'verify-lifecycle.mjs',
  'verify-dispute.mjs',
  'verify-restart.mjs',
  'verify-concurrency.mjs',
  'verify-preferences.mjs',
  'verify-mobile-photos.mjs',
];

/**
 * Suites that also need a web surface.
 *
 * The OAuth suite starts its OWN gateway and web server because it must control
 * CORS, the app origin and the provider endpoints together; it is listed here
 * only so it runs as part of the gate.
 */
const FULL_SUITES = ['verify-delivery.mjs', 'verify-oauth.mjs', 'verify-tv.mjs', 'health.mjs'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate) => existsSync(candidate));

/**
 * Is something already listening on a port?
 *
 * The gate must not start a second server on an occupied port: it would either
 * fail to bind or, worse, quietly test the wrong instance. This also means the
 * gate can be pointed at servers a developer already has running, which is the
 * common local case.
 */
async function portInUse(port) {
  try {
    // Any response — even a 404 — proves a listener exists.
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1200) });
    return true;
  } catch {
    // A refused connection means free; a timeout means something is there but slow.
    return false;
  }
}

const children = [];
function start(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  children.push({ label, child, getLog: () => log });
  return child;
}

/**
 * Stop only what this run started.
 *
 * Anything reused belongs to someone else and must survive the gate; killing it
 * would be a side effect a test runner has no business having.
 */
const stopAll = () => {
  for (const { child } of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
};

process.on('exit', stopAll);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll();
    process.exit(1);
  });
}

console.log('\n\u001b[1m════════ MoneyMart full gate ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\n  web ${WEB}\n  tv  ${TV}\u001b[0m`);

if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run `pnpm build:api` first.\n');
  process.exit(1);
}

/* ── Start the services that are not already running ───────────────────── */
const reused = [];
const started = [];

for (const service of [
  {
    label: 'api',
    port: API_PORT,
    launch: () =>
      start('api', process.execPath, [entry], {
        PORT: String(API_PORT),
        NODE_ENV: 'development',
        MM_SEED: 'true',
        MM_PERSISTENCE: 'off',
        MM_AUTH_DEV_CODES: 'true',
      }),
  },
  {
    label: 'web',
    port: WEB_PORT,
    launch: () =>
      start('web', 'bash', [path.join(repoRoot, 'scripts', 'start-web.sh')], {
        WEB_PORT: String(WEB_PORT),
        VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
      }),
  },
  {
    label: 'tv',
    port: TV_PORT,
    launch: () =>
      start('tv', 'bash', [path.join(repoRoot, 'scripts', 'start-tv.sh')], {
        TV_PORT: String(TV_PORT),
        VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
      }),
  },
]) {
  if (await portInUse(service.port)) {
    /**
     * Reuse rather than fight. Starting a second server on a busy port would
     * either fail to bind or test an instance the run did not configure — and
     * killing whatever is already there at teardown would take down a developer's
     * servers, which is worse than failing.
     */
    reused.push(service.label);
  } else {
    service.launch();
    started.push(service.label);
  }
}

if (reused.length) {
  console.log(`  \u001b[2mreusing already-running: ${reused.join(', ')}\u001b[0m`);
}
if (started.length) {
  console.log(`  \u001b[2mstarted: ${started.join(', ')}\u001b[0m`);
}

async function waitFor(url, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      // Any status means the server is listening; a 404 is still "up".
      if (response.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  const child = children.find((entryRef) => entryRef.label === label);
  console.log(`\n  \u001b[31m✘\u001b[0m ${label} did not start.`);
  if (child) console.log(child.getLog().split('\n').slice(-12).map((line) => `    ${line}`).join('\n'));
  return false;
}

const apiUp = await waitFor(`${API}/api/health`, 'api');
const webUp = apiUp ? await waitFor(`${WEB}/`, 'web') : false;
const tvUp = apiUp ? await waitFor(`${TV}/`, 'tv') : false;

if (!apiUp || !webUp || !tvUp) {
  stopAll();
  console.log('');
  process.exit(1);
}
console.log('  \u001b[32m✔\u001b[0m api, web and tv are all serving\n');

/* ── Run the suites ────────────────────────────────────────────────────── */
const suites = [...API_SUITES, ...FULL_SUITES];
if (chromePath) suites.splice(API_SUITES.length, 0, 'verify-hls.mjs');

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  const label = suite.replace(/^verify-/, '').replace(/\.mjs$/, '');
  process.stdout.write(`  \u001b[2mrunning\u001b[0m ${label} … `);

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', suite)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        API_URL: API,
        WEB_URL: WEB,
        TV_URL: TV,
        FORCE_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });

  const passed = Number(result.output.match(/PASSED (\d+)/)?.[1] ?? 0);
  const failed = Number(result.output.match(/FAILED (\d+)/)?.[1] ?? 0);
  totalPassed += passed;
  totalFailed += failed;

  const okRun = result.code === 0;
  console.log(
    okRun
      ? `\u001b[32mPASS\u001b[0m  ${String(passed).padStart(3)} passed`
      : `\u001b[31mFAIL\u001b[0m  ${String(passed).padStart(3)} passed  \u001b[31m${failed} failed\u001b[0m`,
  );

  if (!okRun) {
    const detail = result.output
      .split('\n')
      .filter((line) => /✘|·/.test(line))
      .slice(0, 8)
      .map((line) => `      ${line.replace(/\u001b\[[0-9;]*m/g, '').trim()}`)
      .join('\n');
    if (detail) console.log(detail);
  }
}

console.log('\n\u001b[1m───────────────────────────────────\u001b[0m');
const colour = totalFailed === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}TOTAL  ${totalPassed} passed   ${totalFailed} failed\u001b[0m`);
if (!chromePath) {
  console.log('  \u001b[2mnote: no Chromium found, HLS playback not verified in this run\u001b[0m');
}
console.log('\u001b[1m═══════════════════════════════════\u001b[0m\n');

stopAll();
process.exit(totalFailed === 0 ? 0 : 1);
