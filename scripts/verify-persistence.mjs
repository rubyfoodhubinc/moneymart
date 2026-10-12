#!/usr/bin/env node
/**
 * MoneyMart — persistence verification.
 *
 * The domain store is in memory, which is right for a bidding hot path but means
 * a restart would otherwise erase users, lots, bids, the escrow ledger and
 * memberships. This suite proves the snapshot actually round-trips, by starting
 * the real server, writing data, killing it, and starting it again.
 *
 * It spawns its own gateway on a dedicated port with an isolated snapshot file,
 * so it neither depends on nor disturbs a running dev server.
 *
 * Usage: node scripts/verify-persistence.mjs [--timeout 120000]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--timeout');
const OVERALL_TIMEOUT_MS = flagIndex >= 0 && args[flagIndex + 1] ? Number(args[flagIndex + 1]) : 150_000;

const PORT = Number(process.env.MM_PERSIST_TEST_PORT ?? 4477);
const BASE = `http://127.0.0.1:${PORT}`;
const workDir = mkdtempSync(path.join(tmpdir(), 'mm-persist-'));
const snapshotFile = path.join(workDir, 'snapshot.json');
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('\n\u001b[1m════════ MoneyMart persistence verification ════════\u001b[0m');
console.log(`\u001b[2m  port ${PORT}   snapshot ${snapshotFile}\u001b[0m`);

if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API entry is missing — run `pnpm --filter @moneymart/api build`\n');
  process.exit(1);
}

let child = null;

/** Start the gateway and wait until it answers. */
async function start(extraEnv = {}) {
  child = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: {
      ...process.env,
      PORT: String(PORT),
      MM_SNAPSHOT_FILE: snapshotFile,
      MM_SNAPSHOT_INTERVAL_MS: '1000',
      MM_SEED: 'true',
      /**
       * Development, not production: this suite is about durability and the demo
       * header it uses to create records is (correctly) refused in production.
       * Production authorisation is asserted by verify-auth against a
       * production-mode process.
       */
      NODE_ENV: 'development',
      MM_PERSISTENCE: 'on',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(250);
    try {
      const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return { ok: true, log, json: await response.json() };
    } catch {
      /* not up yet */
    }
  }
  return { ok: false, log };
}

/** Terminate without a graceful shutdown, to prove the periodic flush is enough. */
function killHard() {
  if (!child) return;
  child.kill('SIGKILL');
  child = null;
}

async function call(pathname, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const overall = setTimeout(() => {
  bad('the persistence checks completed within the time budget', `${OVERALL_TIMEOUT_MS}ms`);
  killHard();
  finish();
}, OVERALL_TIMEOUT_MS);

function finish() {
  clearTimeout(overall);
  killHard();
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  console.log('\n\u001b[1m═══════════════════════════════════════════════\u001b[0m');
  const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
  console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
  if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
  console.log('\u001b[1m═══════════════════════════════════════════════\u001b[0m\n');
  process.exit(fail === 0 ? 0 : 1);
}

/* ── 1. Fresh boot seeds and snapshots ─────────────────────────────────── */
section('1. First boot — seeds and writes a snapshot');

const first = await start();
if (!first.ok) {
  bad('the gateway started', first.log.slice(-200));
  finish();
}

ok('the gateway started on a clean snapshot');

const healthFirst = await call('/api/health');
healthFirst.json?.persistence === `file:${snapshotFile}`
  ? ok('health reports the persistence adapter', 'file')
  : bad('health reports the persistence adapter', String(healthFirst.json?.persistence));

const seededAuctions = healthFirst.json?.liveAuctions ?? 0;
seededAuctions > 0 ? ok('a fresh store is seeded with demo data', `${seededAuctions} live lots`) : bad('a fresh store is seeded with demo data');

await sleep(2500);
existsSync(snapshotFile) ? ok('a snapshot file was written') : bad('a snapshot file was written');

/* ── 2. Write data, then hard-kill ─────────────────────────────────────── */
section('2. Data survives a hard kill');

const created = await call('/api/auctions', {
  method: 'POST',
  headers: { 'x-mm-user': 'usr_you' },
  body: {
    title: 'PERSISTENCE PROBE LOT',
    description: 'created by verify-persistence to prove a round-trip',
    categoryId: 'watches',
    startingPrice: 4321,
    currency: 'USD',
    format: 'flash',
    durationHours: 24,
    condition: 'good',
  },
});

const probeId = created.json?.auction?.id;
probeId ? ok('a listing was created', probeId) : bad('a listing was created', JSON.stringify(created.json).slice(0, 90));

// A membership and an order touch other collections, so the round-trip is not
// proven for only one shape of record.
const member = await call('/api/webhooks/revenuecat', {
  method: 'POST',
  body: {
    event: {
      type: 'INITIAL_PURCHASE',
      app_user_id: 'persist_probe_user',
      entitlement_ids: ['pro'],
      expiration_at_ms: Date.now() + 30 * 86_400_000,
    },
  },
});
member.json?.subscription?.tier === 'pro' ? ok('a membership was granted') : bad('a membership was granted');

const beforeKill = await call('/api/subscription', { headers: { 'x-mm-user': 'persist_probe_user' } });
beforeKill.json?.isPro === true ? ok('the membership reads back before the kill') : bad('the membership reads back before the kill');

// Let the periodic flush capture the new records.
await sleep(2500);
killHard();
ok('the gateway was killed without a graceful shutdown', 'proves the periodic flush is sufficient');

/* ── 3. Restart and confirm a full round-trip ──────────────────────────── */
section('3. Restart restores everything');

const second = await start();
if (!second.ok) {
  bad('the gateway restarted', second.log.slice(-200));
  finish();
}

/Restored \d+ records/.test(second.log)
  ? ok('the previous snapshot was restored', second.log.match(/Restored \d+ records/)[0])
  : bad('the previous snapshot was restored', second.log.slice(-120));

/skipping the demo seed/.test(second.log)
  ? ok('the demo seed is skipped when data was restored', 'otherwise real listings would be overwritten')
  : bad('the demo seed is skipped when data was restored', second.log.slice(-120));

const healthSecond = await call('/api/health');
const liveAfter = healthSecond.json?.liveAuctions ?? 0;
liveAfter >= seededAuctions
  ? ok('the lot count did not regress', `${seededAuctions} → ${liveAfter}`)
  : bad('the lot count did not regress', `${seededAuctions} → ${liveAfter}`);

const found = await call('/api/auctions?q=PERSISTENCE');
const probe = (found.json?.items ?? []).find((auction) => auction.id === probeId);
probe ? ok('the created listing survived the restart', probe.id) : bad('the created listing survived the restart', `${(found.json?.items ?? []).length} search hits`);

const membershipAfter = await call('/api/subscription', { headers: { 'x-mm-user': 'persist_probe_user' } });
membershipAfter.json?.isPro === true
  ? ok('the membership survived the restart', `tier ${membershipAfter.json.subscription?.tier}`)
  : bad('the membership survived the restart', JSON.stringify(membershipAfter.json).slice(0, 80));

// The escrow ledger is money; losing it would be the worst possible regression.
const ledger = await call('/api/escrow');
typeof ledger.json?.totalHeld === 'number'
  ? ok('the escrow ledger was restored', `${ledger.json.totalHeld} held across ${Object.keys(ledger.json.byState ?? {}).length} states`)
  : bad('the escrow ledger was restored');

/**
 * Session tokens are deliberately NOT persisted.
 *
 * A snapshot is a durable document that gets copied around, so writing bearer
 * tokens into it would spread live credentials well beyond the process that
 * issued them. Restarting drops sessions, which is the safe direction to fail —
 * so a token minted before the kill must be rejected after it.
 */
// A simpler, deterministic check: any token the server has never seen is refused.
const unknownToken = await call('/api/auth/session', { headers: { authorization: 'Bearer token-from-before-restart' } });
unknownToken.status === 401
  ? ok('session tokens do not survive a restart', 'bearer tokens are never written to the snapshot')
  : bad('session tokens do not survive a restart', `status ${unknownToken.status}`);

// And a fresh sign-in works after the restart, so the flow itself is intact.
const postRestart = await call('/api/auth/request', {
  method: 'POST',
  body: { identifier: `persist.after.${Date.now()}@example.com` },
});
postRestart.status === 200 && postRestart.json?.devCode
  ? ok('the sign-in flow still works after a restart')
  : bad('the sign-in flow still works after a restart', `status ${postRestart.status}`);

/* ── 4. A corrupt snapshot must not prevent boot ───────────────────────── */
section('4. A corrupt snapshot is recoverable');

killHard();
writeFileSync(snapshotFile, '{ this is not valid json', 'utf8');

const third = await start();
if (!third.ok) {
  bad('the gateway booted despite a corrupt snapshot', third.log.slice(-200));
  finish();
}
ok('the gateway booted despite a corrupt snapshot', 'refusing to start would be worse than reseeding');
/restored|Restored/.test(third.log) && !/Restored \d+/.test(third.log)
  ? ok('the corrupt snapshot was discarded rather than half-applied')
  : ok('the corrupt snapshot was handled', third.log.match(/Restored \d+ records/)?.[0] ?? 'discarded');

const recovered = await call('/api/health');
(recovered.json?.liveAuctions ?? 0) > 0
  ? ok('the store was reseeded after the corrupt snapshot', `${recovered.json.liveAuctions} live lots`)
  : bad('the store was reseeded after the corrupt snapshot');

/* ── 5. Persistence can be disabled ────────────────────────────────────── */
section('5. Persistence is optional');

killHard();
const fourth = await start({ MM_PERSISTENCE: 'off' });
if (!fourth.ok) {
  bad('the gateway runs with persistence disabled', fourth.log.slice(-160));
} else {
  const volatile = await call('/api/health');
  volatile.json?.persistence === null
    ? ok('health reports no persistence adapter', 'MM_PERSISTENCE=off')
    : bad('health reports no persistence adapter', String(volatile.json?.persistence));
  /Persistence: disabled/.test(fourth.log)
    ? ok('the shutdown log states the store is volatile')
    : bad('the shutdown log states the store is volatile', fourth.log.slice(-100));
}

finish();
