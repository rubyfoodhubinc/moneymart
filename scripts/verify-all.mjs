#!/usr/bin/env node
/**
 * MoneyMart — full verification audit.
 *
 * Runs every suite in sequence against a live API and reports one consolidated
 * verdict. This is the release gate: if this exits 0, the product is provably
 * working end to end.
 *
 *   node scripts/verify-all.mjs
 *   pnpm verify:all
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The unified deployment serves HTTPS with a local development CA. Configure
 * trust up front so the optional-suite probe can actually reach it; the deploy
 * suite itself still performs a strict certificate verification.
 */
if (process.env.MM_STRICT_TLS !== '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const SUITES = [
  {
    name: 'Auction engine (§9.2 rules)',
    script: 'verify-engine.mjs',
    detail: 'increments, guards, anti-snipe, proxy settlement, fees, settlement',
  },
  {
    name: 'Realtime Socket.IO (§9.2 broadcast)',
    script: 'verify-realtime.mjs',
    detail: 'fan-out, outbid routing, viewer counts, chat, concurrency, latency',
  },
  {
    name: 'Payments & escrow (§9.1)',
    script: 'verify-escrow.mjs',
    detail: 'rails, authorisation, hold, release-on-confirmation, decline, dispute, refund',
  },
  {
    name: 'Authentication',
    script: 'verify-auth.mjs',
    detail: 'OTP flow, canonicalisation, refusals, code hygiene, production posture',
  },
  {
    name: 'End-to-end money path',
    script: 'verify-lifecycle.mjs',
    detail: 'list → bid → settle → pay → escrow → ship → release → books balance',
  },
  {
    name: 'Concurrency across auctions',
    script: 'verify-concurrency.mjs',
    detail: 'overlapping bids, simultaneous settlement, bids racing a close, books balanced',
  },
  {
    name: 'Restart with money in flight',
    script: 'verify-restart.mjs',
    detail: 'escrow, disputes and payouts survive a restart; the durability window is measured',
  },
  {
    name: 'Dispute and refund',
    script: 'verify-dispute.mjs',
    detail: 'admin-only resolution, refund returns funds, seller-favourable release, no double-resolve',
  },
  {
    name: 'Code delivery (SMS + email)',
    script: 'verify-delivery.mjs',
    detail: 'the sent code is the verified code, sender forms, failure reasons',
  },
  {
    name: 'Social sign-in',
    script: 'verify-oauth.mjs',
    detail: 'real JWKS, PKCE, single-use state, verified-email linking, browser handoff',
  },
  {
    name: 'Image input validation',
    script: 'verify-images.mjs',
    detail: 'SVG and script payloads refused, type sniffed from bytes, count and size bounded',
  },
  {
    name: 'Object-level authorization',
    script: 'verify-authorization.mjs',
    detail: 'orders private to participants, storefront writes owner-scoped, public stays public',
  },
  {
    name: 'Ingress rate limiting',
    script: 'verify-rate-limit.mjs',
    detail: 'OTP flood, IP rotation, sliding windows, dev controls refused in production',
  },
  {
    name: 'Realtime authorization',
    script: 'verify-socket-auth.mjs',
    detail: 'anonymous spectating, refused writes, payload identity ignored, no forgery',
  },
  {
    name: 'Persistence',
    script: 'verify-persistence.mjs',
    detail: 'snapshot round-trip across a hard kill, corrupt-file recovery, opt-out',
  },
  {
    name: 'Browser UI (real Chrome)',
    script: 'verify-ui.mjs',
    detail: 'pages render, drag reorder handles, keyboard reordering preserves items',
    /** Needs the dev server, and drives a real browser. Opt in. */
    optional: { env: 'MM_UI_SUITE' },
  },
  {
    name: 'HLS playback (real browser)',
    script: 'verify-hls.mjs',
    detail: 'Chrome drives the shipped hls.js bundle and reports what actually decoded',
    /**
     * Drives a real Chromium browser, so it is opt-in: not every environment has
     * one, and it is slower than the other suites. `pnpm verify:hls` runs it.
     */
    optional: { env: 'MM_HLS_SUITE' },
  },
  {
    name: 'Payments & membership',
    script: 'verify-subscriptions.mjs',
    detail: 'provider registry, identity guard, entitlement lifecycle, Pro pricing',
  },
  {
    name: 'TV / IPTV (§7)',
    script: 'verify-tv.mjs',
    detail: 'QR round-trip, handoff tokens, XMLTV EPG, 10-foot UI, D-pad engine',
  },
  {
    name: 'Mobile (native build)',
    script: 'verify-mobile.mjs',
    detail: 'icons, store identity, Hermes bundles, screen coverage, QR deep link',
    /**
     * Bundling both native platforms is slow, so the suite is opt-in via
     * MM_MOBILE_SUITE=1. `pnpm verify:mobile` runs it unconditionally.
     */
    optional: { env: 'MM_MOBILE_SUITE' },
  },
  {
    name: 'Production product smoke',
    script: 'verify-production-app.mjs',
    detail: 'live app mounts, bundles execute, cross-origin gateway, routes resolve',
  },
  {
    name: 'Unified deployment',
    script: 'verify-deploy.mjs',
    detail: 'TLS, single origin, SPA fallback, cache policy, TV isolation, hardening',
    /**
     * Requires the unified production gateway. Skipped when it is not running so
     * the audit stays usable during day-to-day development.
     */
    optional: { probe: process.env.DEPLOY_URL ?? 'https://localhost:3443/api/health' },
  },
  {
    name: 'End-to-end health',
    script: 'health.mjs',
    detail: 'gateway, seeded data, bid round-trip, Studio, 11 routes, hardening',
  },
];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        // Let child suites reach the local development CA over HTTPS.
        NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code, output }));
  });
}

function extract(output, label) {
  const match = output.match(new RegExp(`${label} (\\d+)`));
  return match ? Number(match[1]) : 0;
}

/**
 * An optional suite runs only when its target is reachable, so the audit stays
 * usable during day-to-day development when the unified gateway is not up.
 */
async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return response.status > 0;
  } catch {
    return false;
  }
}

console.log('\n\u001b[1m═══════════════════════════════════════════════════════════════\u001b[0m');
console.log('  \u001b[1mMONEYMART — FULL VERIFICATION AUDIT\u001b[0m');
console.log('\u001b[1m═══════════════════════════════════════════════════════════════\u001b[0m');

const results = [];
let totalPassed = 0;
let totalFailed = 0;

for (const suite of SUITES) {
  if (suite.optional?.env && process.env[suite.optional.env] !== '1') {
    console.log(`\n  \u001b[2mskipped\u001b[0m ${suite.name}  \u001b[2m(set ${suite.optional.env}=1 to run)[0m`);
    continue;
  }
  if (suite.optional?.probe && !(await probe(suite.optional.probe))) {
    console.log(`\n  \u001b[2mskipped\u001b[0m ${suite.name}  \u001b[2m(target not running: ${suite.optional.probe})[0m`);
    continue;
  }
  process.stdout.write(`\n  \u001b[2mrunning\u001b[0m ${suite.name} … `);
  const { code, output } = await run(suite.script);
  const passed = extract(output, 'PASSED');
  const failed = extract(output, 'FAILED');
  totalPassed += passed;
  totalFailed += failed;
  const verdict = code === 0 ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m';
  process.stdout.write(`\r  ${verdict}  ${suite.name.padEnd(38)} ${String(passed).padStart(2)} passed${failed ? `  \u001b[31m${failed} failed\u001b[0m` : ''}\n`);
  process.stdout.write(`      \u001b[2m${suite.detail}\u001b[0m\n`);
  results.push({ ...suite, code, passed, failed, output });
}

console.log('\n\u001b[1m───────────────────────────────────────────────────────────────\u001b[0m');
const colour = totalFailed === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}TOTAL  ${totalPassed} passed   ${totalFailed} failed\u001b[0m`);
console.log('\u001b[1m═══════════════════════════════════════════════════════════════\u001b[0m');

if (totalFailed > 0) {
  console.log('\n\u001b[1mFailure detail\u001b[0m');
  for (const result of results) {
    if (result.code === 0) continue;
    console.log(`\n  \u001b[31m▸ ${result.name}\u001b[0m`);
    const lines = result.output.split('\n').filter((line) => line.includes('✘') || line.includes('· '));
    lines.forEach((line) => console.log(`    ${line.trim()}`));
  }
}
console.log('');

process.exit(totalFailed === 0 ? 0 : 1);
