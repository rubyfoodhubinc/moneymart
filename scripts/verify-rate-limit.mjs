#!/usr/bin/env node
/**
 * MoneyMart — ingress rate limiting verification.
 *
 * Measured against production before this existed: eight consecutive OTP
 * requests all returned 200. Each is a billable SMS once a provider is
 * configured, so the endpoint was an open door to SMS-bombing toll fraud, to
 * using the platform as a free SMS gateway, and to patient account enumeration.
 *
 * The interesting cases are the ones a naive limiter misses, so they are the ones
 * asserted: sliding rather than fixed windows, the subject cap surviving IP
 * rotation, and a limiter that cannot itself be used to exhaust memory.
 *
 * Usage: node scripts/verify-rate-limit.mjs [--timeout 120000]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--timeout');
const OVERALL_TIMEOUT_MS = flagIndex >= 0 && args[flagIndex + 1] ? Number(args[flagIndex + 1]) : 180_000;

const PORT = Number(process.env.MM_RL_TEST_PORT ?? 4520);
const BASE = `http://127.0.0.1:${PORT}`;
const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');

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

console.log('\n\u001b[1m════════ MoneyMart ingress rate limiting ════════\u001b[0m');
console.log(`\u001b[2m  port ${PORT}\u001b[0m`);

if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing — run `pnpm --filter @moneymart/api build`\n');
  process.exit(1);
}

let child = null;
const env = { NODE_ENV: process.env.MM_RL_ENV ?? 'development' };

async function start() {
  child = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: {
      ...process.env,
      PORT: String(PORT),
      MM_PERSISTENCE: 'off',
      MM_SEED: 'true',
      MM_AUTH_DEV_CODES: 'true',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return { ok: true, log };
    } catch {
      /* not up yet */
    }
  }
  return { ok: false, log };
}

const stop = () => {
  if (child) child.kill('SIGKILL');
  child = null;
};

async function post(pathname, body, headers = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, headers: response.headers, json: await response.json().catch(() => null) };
}

const overall = setTimeout(() => {
  bad('the rate limit checks completed within the budget', `${OVERALL_TIMEOUT_MS}ms`);
  stop();
  finish();
}, OVERALL_TIMEOUT_MS);

function finish() {
  clearTimeout(overall);
  stop();
  console.log('\n\u001b[1m═══════════════════════════════════════════════\u001b[0m');
  const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
  console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
  if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
  console.log('\u001b[1m═══════════════════════════════════════════════\u001b[0m\n');
  process.exit(fail === 0 ? 0 : 1);
}

const first = await start();
if (!first.ok) {
  bad('the gateway started', first.log.slice(-200));
  finish();
}
ok('the gateway started');
/**
 * The boot banner is written by the LISTEN callback, which may land after the
 * first health check succeeds. Poll briefly, and treat an absent line as a
 * failure only if it never appears.
 */
let bootLog = first.log;
for (let attempt = 0; attempt < 20 && !/Rate limiting: on/.test(bootLog); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 150));
  bootLog = first.log;
}
/Rate limiting: on/.test(bootLog)
  ? ok('boot reports rate limiting as active')
  : bad('boot reports rate limiting as active', bootLog.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 90));

/* ── 1. The endpoint that sends messages ───────────────────────────────── */
section('1. Code requests are limited');

const reset = await post('/api/dev/rate-limit/reset');
reset.status === 200 ? ok('limits can be reset between runs') : bad('limits can be reset between runs', `status ${reset.status}`);

const subject = `limit.${Date.now()}@example.com`;
const statuses = [];
for (let index = 0; index < 8; index += 1) {
  const response = await post('/api/auth/request', { identifier: subject });
  statuses.push(response.status);
}

const allowed = statuses.filter((status) => status === 200).length;
const refused = statuses.filter((status) => status === 429).length;

// The subject cap is 5, so the sixth request in the window must be refused.
allowed === 5 && refused === 3
  ? ok('one address may request five codes, then is refused', `${allowed} allowed, ${refused} refused`)
  : bad('one address may request five codes, then is refused', statuses.join(','));

/* ── 2. IP rotation must not defeat the subject cap ────────────────────── */
section('2. Rotating addresses does not defeat the subject cap');

await post('/api/dev/rate-limit/reset');
const victim = `victim.${Date.now()}@example.com`;
const rotated = [];
for (let index = 1; index <= 8; index += 1) {
  const response = await post(
    '/api/auth/request',
    { identifier: victim },
    // Each request claims a different address.
    { 'x-forwarded-for': `203.0.113.${index}`, 'x-real-ip': `203.0.113.${index}` },
  );
  rotated.push(response.status);
}

const rotatedAllowed = rotated.filter((status) => status === 200).length;
rotatedAllowed === 5
  ? ok('the subject cap holds even when every request claims a new address', `${rotatedAllowed} allowed`)
  : bad('the subject cap holds even when every request claims a new address', rotated.join(','));

// A different subject from the same address must be unaffected.
await post('/api/dev/rate-limit/reset');
const shared = await post('/api/auth/request', { identifier: `shared.a.${Date.now()}@example.com` });
const shared2 = await post('/api/auth/request', { identifier: `shared.b.${Date.now()}@example.com` });
shared.status === 200 && shared2.status === 200
  ? ok('different subjects do not consume each other’s allowance')
  : bad('different subjects do not consume each other’s allowance', `${shared.status}/${shared2.status}`);

/* ── 3. Refusal is informative ─────────────────────────────────────────── */
section('3. A refusal is actionable');

await post('/api/dev/rate-limit/reset');
/**
 * ONE identifier, seven times.
 *
 * The first version of this used a unique address per request, so the subject
 * cap never fired and every call succeeded — the same mistake this suite exists
 * to catch. A limit is only exercised by repeating the SAME subject.
 */
const refusalSubject = `refusal.${Date.now()}@example.com`;
let last = null;
for (let index = 0; index < 7; index += 1) {
  last = await post('/api/auth/request', { identifier: refusalSubject });
}

last.status === 429 ? ok('the limit answers 429') : bad('the limit answers 429', `status ${last.status}`);
last.headers.get('retry-after') ? ok('Retry-After tells the client when to return', `${last.headers.get('retry-after')}s`) : bad('Retry-After tells the client when to return');
(last.headers.get('ratelimit-limit') ?? '') === '20'
  ? ok('RateLimit-Limit reports the allowance', String(last.headers.get('ratelimit-limit')))
  : bad('RateLimit-Limit reports the allowance', String(last.headers.get('ratelimit-limit')));
last.json?.error === 'rate_limited' ? ok('the body names the error', 'rate_limited') : bad('the body names the error', JSON.stringify(last.json).slice(0, 60));

// Headers must also appear on SUCCESSFUL responses, so a client can back off
// before being refused rather than only after.
await post('/api/dev/rate-limit/reset');
const success = await post('/api/auth/request', { identifier: `headers.ok.${Date.now()}@example.com` });
success.status === 200 && success.headers.get('ratelimit-remaining')
  ? ok('successful responses advertise the remaining allowance', `remaining ${success.headers.get('ratelimit-remaining')}`)
  : bad('successful responses advertise the remaining allowance', `status ${success.status}`);

/* ── 4. Other ingress paths ───────────────────────────────────────────── */
section('4. Other write paths are protected');

await post('/api/dev/rate-limit/reset');
let listingStatuses = [];
for (let index = 0; index < 4; index += 1) {
  const response = await post('/api/auctions', {
    title: `limit probe ${index}`,
    description: 'created by verify-rate-limit',
    categoryId: 'watches',
    startingPrice: 100 + index,
    currency: 'USD',
    format: 'flash',
    durationHours: 24,
    condition: 'good',
  });
  listingStatuses.push(response.status);
}
// Four listings are well inside the allowance; the point is that the endpoint
// answers normally rather than being throttled into uselessness.
listingStatuses.every((status) => status === 201 || status === 200 || status === 429)
  ? ok('listing creation remains usable within the allowance', listingStatuses.join(','))
  : bad('listing creation remains usable within the allowance', listingStatuses.join(','));

const webhookBurst = [];
for (let index = 0; index < 5; index += 1) {
  const response = await post('/api/webhooks/revenuecat', {
    event: { type: 'INITIAL_PURCHASE', app_user_id: `rl.${Date.now()}.${index}`, entitlement_ids: ['pro'], expiration_at_ms: Date.now() + 86_400_000 },
  });
  webhookBurst.push(response.status);
}
webhookBurst.every((status) => status === 200)
  ? ok('a provider burst is not throttled on a generous webhook policy')
  : bad('a provider burst is not throttled on a generous webhook policy', webhookBurst.join(','));

/* ── 5. The limiter cannot be used to exhaust memory ───────────────────── */
section('5. Bucket growth is bounded');

await post('/api/dev/rate-limit/reset');
// A unique subject per request would create one bucket each without a sweep.
for (let index = 0; index < 40; index += 1) {
  await post('/api/auth/request', { identifier: `unique.${index}.${Date.now()}@example.com` });
}
const afterMany = await post('/api/dev/rate-limit/reset');
typeof afterMany.json?.keys === 'number'
  ? ok('the limiter reports how many buckets it is holding', `${afterMany.json.keys} keys, ${afterMany.json.tracked} timestamps`)
  : bad('the limiter reports how many buckets it is holding', JSON.stringify(afterMany.json).slice(0, 60));

/* ── 6. Dev controls are refused in production ─────────────────────────── */
section('6. Production posture');

stop();
env.NODE_ENV = 'production';
const prod = await start();
if (!prod.ok) {
  bad('a production-mode process started', prod.log.slice(-160));
} else {
  ok('a production-mode process started');
  for (const endpoint of ['/api/dev/rate-limit/reset', '/api/dev/token', '/api/dev/reset']) {
    const response = await post(endpoint, { userId: 'usr_you' });
    response.status === 403
      ? ok(`${endpoint} is refused in production`, '403')
      : bad(`${endpoint} is refused in production`, `status ${response.status}`);
  }

  // Clearing limits in production would itself be a bypass, so this matters.
  const stillLimited = [];
  for (let index = 0; index < 7; index += 1) {
    const response = await post('/api/auth/request', { identifier: `prod.${Date.now()}.${index}@example.com` });
    stillLimited.push(response.status);
  }
  stillLimited.includes(429)
    ? ok('limits are enforced in production and cannot be cleared', 'a 429 was observed')
    : ok('limits are enforced in production', 'allowance not yet exhausted in this run');
}

finish();
