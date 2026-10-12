#!/usr/bin/env node
/**
 * MoneyMart — continuous integration gate.
 *
 * Runs the release gate against an API this script starts itself, so CI does not
 * need a pre-running server, a database, or any credentials. That matters for two
 * reasons: the suites must be runnable by anyone who clones the repository, and a
 * gate that only works on one machine is not a gate.
 *
 * Excluded here, and why:
 *   • Browser suites (ui, hls) need a Chromium binary and a dev server.
 *   • The mobile suite bundles both native platforms, which is slow.
 *   • The deployment suite needs the hosted gateway and its certificate.
 * All are runnable on demand via their own scripts and are covered locally.
 *
 * Usage: node scripts/ci.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CI_API_PORT ?? 4317);
const API = `http://127.0.0.1:${PORT}`;
const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');

/** Suites that need nothing but a running API. */
const SUITES = [
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
  'verify-tv.mjs',
  'health.mjs',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('\n\u001b[1m════════ MoneyMart CI gate ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}   ${SUITES.length} suites\u001b[0m`);

if (!existsSync(entry)) {
  console.log(`\n  \u001b[31m✘\u001b[0m the compiled API is missing.\n    Build it first: pnpm --filter @moneymart/api build\n`);
  process.exit(1);
}

/**
 * The gateway is started from its BUILT output, not through tsx.
 *
 * A CI run should exercise the artifact that ships. It also avoids depending on
 * a TypeScript loader being present in the production dependency tree, which is
 * the same reason the container runs the compiled entry.
 */
const api = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: 'development',
    MM_SEED: 'true',
    // Snapshotting would write state between CI runs and make them order-dependent.
    MM_PERSISTENCE: 'off',
    // Codes are returned in the response so the sign-in flow is testable without
    // a mail or SMS provider. Refused in production by the same code path.
    MM_AUTH_DEV_CODES: 'true',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let apiLog = '';
api.stdout.on('data', (chunk) => (apiLog += chunk));
api.stderr.on('data', (chunk) => (apiLog += chunk));

const stopApi = () => {
  try {
    api.kill('SIGKILL');
  } catch {
    /* already dead */
  }
};

// Never leave a server behind, however this exits.
process.on('exit', stopApi);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopApi();
    process.exit(1);
  });
}

async function waitForHealth(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  return false;
}

if (!(await waitForHealth())) {
  console.log('\n  \u001b[31m✘\u001b[0m the API did not become healthy.');
  console.log(apiLog.split('\n').slice(-14).map((line) => `    ${line}`).join('\n'));
  process.exit(1);
}
console.log('  \u001b[32m✔\u001b[0m API is healthy\n');

const results = [];
let totalPassed = 0;
let totalFailed = 0;

for (const suite of SUITES) {
  const label = suite.replace(/^verify-/, '').replace(/\.mjs$/, '');
  process.stdout.write(`  \u001b[2mrunning\u001b[0m ${label} … `);

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', suite)], {
      cwd: repoRoot,
      env: { ...process.env, API_URL: API, FORCE_COLOR: '1' },
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
    // Surface the failing assertions, not the whole transcript.
    const detail = result.output
      .split('\n')
      .filter((line) => /✘|·/.test(line))
      .slice(0, 8)
      .map((line) => `      ${line.replace(/\u001b\[[0-9;]*m/g, '').trim()}`)
      .join('\n');
    if (detail) console.log(detail);
  }

  results.push({ suite, passed, failed, ok: okRun });
}

console.log('\n\u001b[1m───────────────────────────────────\u001b[0m');
const colour = totalFailed === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}TOTAL  ${totalPassed} passed   ${totalFailed} failed\u001b[0m`);
console.log('\u001b[1m═══════════════════════════════════\u001b[0m\n');

stopApi();
process.exit(totalFailed === 0 ? 0 : 1);
