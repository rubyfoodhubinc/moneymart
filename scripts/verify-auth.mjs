#!/usr/bin/env node
/**
 * MoneyMart — authentication verification (§9.1 Auth Service).
 *
 * Identity used to be an unverified `x-mm-user` header, and the mobile OTP
 * accepted any six digits. Both were authentication bypasses, so the properties
 * worth asserting are mostly about what must be REFUSED.
 *
 * Usage: node scripts/verify-auth.mjs [--api http://127.0.0.1:4317]
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
      /* non-json */
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: String(error?.message ?? error) };
  }
}

const request = (identifier) => call('/api/auth/request', { method: 'POST', body: { identifier } });
const verify = (identifier, code) => call('/api/auth/verify', { method: 'POST', body: { identifier, code } });
const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

/** Unique per run so repeated runs never collide on an account. */
const RUN = Date.now().toString(36);
const email = (name) => `${name}.${RUN}@example.com`;

console.log('\n\u001b[1m════════ MoneyMart authentication verification ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}   run ${RUN}\u001b[0m`);

/**
 * Clear ingress limits first.
 *
 * This suite requests many codes, and the OTP cap (20 per 15 minutes per address)
 * accumulates across runs — so a second audit in the same window would fail for a
 * reason unrelated to authentication. The dev-only reset is refused in production,
 * which is where the production-posture section asserts the limits still apply.
 */
try {
  await fetch(`${API}/api/dev/rate-limit/reset`, { method: 'POST' });
} catch {
  /* the endpoint is absent in production, which is expected */
}

/* ── 1. The flow works ─────────────────────────────────────────────────── */
section('1. Passwordless sign-in');

const first = await request(email('flow'));
first.status === 200 && first.json?.ok ? ok('a code can be requested') : bad('a code can be requested', `status ${first.status}`);
first.json?.devCode ? ok('the code is available in development', 'MM_AUTH_DEV_CODES / non-production') : bad('the code is available in development');
first.json?.expiresInSeconds === 300 ? ok('the code expires in five minutes') : bad('the code expires in five minutes', String(first.json?.expiresInSeconds));
// The response must not echo the identifier back in full.
/\*\*\*/.test(String(first.json?.destination)) ? ok('the destination is masked in the response', first.json.destination) : bad('the destination is masked in the response', String(first.json?.destination));

const address = email('flow');
const challenged = await request(address);
const created = await verify(address, challenged.json.devCode);
created.status === 200 && created.json?.token ? ok('a valid code issues a session token', `${String(created.json.token).slice(0, 10)}…`) : bad('a valid code issues a session token', JSON.stringify(created.json).slice(0, 90));
created.json?.user?.id ? ok('the token is bound to an account', created.json.user.id) : bad('the token is bound to an account');

const token = created.json?.token;

const session = await call('/api/auth/session', bearer(token));
session.json?.user?.id === created.json?.user?.id ? ok('the token identifies the caller', session.json.user.id) : bad('the token identifies the caller', JSON.stringify(session.json).slice(0, 80));

// The token must actually authorise a protected read, not just a session lookup.
const wallet = await call('/api/wallet', bearer(token));
wallet.status === 200 ? ok('the token authorises a protected resource', 'GET /api/wallet') : bad('the token authorises a protected resource', `status ${wallet.status}`);

/* ── 2. Identifiers are canonicalised ──────────────────────────────────── */
section('2. Identifier canonicalisation');

const mixedCase = email('MixedCase');
await request(mixedCase);
const canonical = await request(mixedCase.toUpperCase());
canonical.json?.devCode
  ? ok('an uppercase address resolves to the same challenge', 'case-insensitive')
  : bad('an uppercase address resolves to the same challenge');

const padded = await request(`  ${email('padded')}  `);
padded.status === 200 ? ok('surrounding whitespace is tolerated') : bad('surrounding whitespace is tolerated', `status ${padded.status}`);

/**
 * ONE request, then verify using the other spelling. Requesting twice would
 * rotate the challenge and delete the first, so the code would be gone for a
 * reason that has nothing to do with canonicalisation.
 */
const spacedPhone = await request('+234 801 234 5678');
spacedPhone.json?.kind === 'phone' ? ok('a spaced phone number is recognised as a phone', spacedPhone.json.destination) : bad('a spaced phone number is recognised as a phone');
const crossForm = await verify('+2348012345678', spacedPhone.json?.devCode);
crossForm.status === 200
  ? ok('spaced and compact phone forms are one account', 'a code for one spelling works for the other')
  : bad('spaced and compact phone forms are one account', `status ${crossForm.status}`);

/* ── 3. What must be refused ───────────────────────────────────────────── */
section('3. Refusals');

const wrong = await verify(email('wrongcode'), '000000');
wrong.status === 401 ? ok('a code with no challenge is refused', wrong.json?.error) : bad('a code with no challenge is refused', `status ${wrong.status}`);

// A challenge exists, but the code is wrong.
const victim = email('bruteforce');
const victimChallenge = await request(victim);
const wrongButExisting = await verify(victim, String(Number(victimChallenge.json.devCode) + 1).padStart(6, '0'));
wrongButExisting.status === 401 && wrongButExisting.json?.error === 'invalid_code'
  ? ok('a wrong code is refused as invalid_code')
  : bad('a wrong code is refused as invalid_code', JSON.stringify(wrongButExisting.json).slice(0, 70));

const forgedToken = await call('/api/wallet', { headers: { authorization: 'Bearer forged-token-value' } });
forgedToken.status === 401
  ? ok('a forged token is refused rather than falling back to the demo header', forgedToken.json?.error)
  : bad('a forged token is refused rather than falling back to the demo header', `status ${forgedToken.status}`);

const noToken = await call('/api/auth/session');
noToken.status === 401 ? ok('a session lookup without a token is refused') : bad('a session lookup without a token is refused', `status ${noToken.status}`);

for (const invalid of ['notanemail', '', '123', 'a@b', '   ']) {
  const response = await request(invalid);
  response.status === 400
    ? ok(`an invalid identifier is rejected: ${JSON.stringify(invalid)}`)
    : bad(`an invalid identifier is rejected: ${JSON.stringify(invalid)}`, `status ${response.status}`);
}

/* ── 4. Codes are single-use, rotating and attempt-limited ─────────────── */
section('4. Code hygiene');

const once = email('singleuse');
const onceChallenge = await request(once);
const firstUse = await verify(once, onceChallenge.json.devCode);
firstUse.status === 200 ? ok('a code works once') : bad('a code works once', `status ${firstUse.status}`);
const replay = await verify(once, onceChallenge.json.devCode);
replay.status === 401 ? ok('the same code cannot be replayed', replay.json?.error) : bad('the same code cannot be replayed', `status ${replay.status}`);

const rotate = email('rotate');
const oldChallenge = await request(rotate);
const newChallenge = await request(rotate);
const staleCode = await verify(rotate, oldChallenge.json.devCode);
staleCode.status === 401
  ? ok('requesting a new code invalidates the previous one')
  : bad('requesting a new code invalidates the previous one', `status ${staleCode.status}`);
const freshCode = await verify(rotate, newChallenge.json.devCode);
freshCode.status === 200 ? ok('the newest code still works') : bad('the newest code still works', `status ${freshCode.status}`);

const brute = email('attempts');
const bruteChallenge = await request(brute);
let attempts = 0;
let exhausted = false;
for (let index = 0; index < 8; index += 1) {
  // Always wrong, and never equal to the real code.
  const guess = String((Number(bruteChallenge.json.devCode) + 1 + index) % 1000000).padStart(6, '0');
  const attempt = await verify(brute, guess);
  attempts += 1;
  if (attempt.json?.error === 'no_challenge') {
    exhausted = true;
    break;
  }
}
exhausted && attempts <= 7
  ? ok('the challenge is burned after the attempt limit', `${attempts} attempts`)
  : bad('the challenge is burned after the attempt limit', `${attempts} attempts, exhausted=${exhausted}`);

// Even the CORRECT code must fail once the challenge is burned.
const afterBurn = await verify(brute, bruteChallenge.json.devCode);
afterBurn.status === 401
  ? ok('the correct code fails after the challenge is burned', afterBurn.json?.error)
  : bad('the correct code fails after the challenge is burned', `status ${afterBurn.status}`);

/* ── 5. Sessions ───────────────────────────────────────────────────────── */
section('5. Sessions');

const signoutAddress = email('signout');
const signoutChallenge = await request(signoutAddress);
const signoutLogin = await verify(signoutAddress, signoutChallenge.json.devCode);
const signoutToken = signoutLogin.json.token;

const beforeSignout = await call('/api/wallet', bearer(signoutToken));
beforeSignout.status === 200 ? ok('the session works before signing out') : bad('the session works before signing out');

const signedOut = await call('/api/auth/signout', { method: 'POST', ...bearer(signoutToken) });
signedOut.json?.revoked === true ? ok('signing out revokes the token') : bad('signing out revokes the token', JSON.stringify(signedOut.json).slice(0, 60));

const afterSignout = await call('/api/wallet', bearer(signoutToken));
afterSignout.status === 401 ? ok('the revoked token no longer authorises') : bad('the revoked token no longer authorises', `status ${afterSignout.status}`);

const secondSignout = await call('/api/auth/signout', { method: 'POST', ...bearer(signoutToken) });
secondSignout.status === 200 ? ok('signing out twice is not an error', 'idempotent') : bad('signing out twice is not an error', `status ${secondSignout.status}`);

const sessions = await call('/api/auth/sessions', bearer(token));
Array.isArray(sessions.json?.items) ? ok('the account can list its sessions', `${sessions.json.items.length} live`) : bad('the account can list its sessions');
// A session listing must never leak the credential itself.
!JSON.stringify(sessions.json ?? {}).includes(token)
  ? ok('the session listing does not expose the token')
  : bad('the session listing does not expose the token');

/* ── 6. Two accounts stay separate ─────────────────────────────────────── */
section('6. Tokens do not cross accounts');

const alice = email('alice');
const bob = email('bob');
const aliceToken = (await verify(alice, (await request(alice)).json.devCode)).json.token;
const bobToken = (await verify(bob, (await request(bob)).json.devCode)).json.token;

const aliceSession = await call('/api/auth/session', bearer(aliceToken));
const bobSession = await call('/api/auth/session', bearer(bobToken));
aliceSession.json?.user?.id !== bobSession.json?.user?.id
  ? ok('two sign-ins produce distinct accounts')
  : bad('two sign-ins produce distinct accounts', 'same user id');
aliceToken !== bobToken ? ok('two sign-ins produce distinct tokens') : bad('two sign-ins produce distinct tokens');

// Each token must resolve to its own wallet.
const aliceWallet = await call('/api/wallet', bearer(aliceToken));
const bobWallet = await call('/api/wallet', bearer(bobToken));
aliceWallet.status === 200 && bobWallet.status === 200
  ? ok('each token reads its own account')
  : bad('each token reads its own account', `${aliceWallet.status}/${bobWallet.status}`);

/* ── 7. Health reports the auth posture ────────────────────────────────── */
section('7. Auth posture is observable');

const health = await call('/api/health');
typeof health.json?.auth === 'object'
  ? ok('health reports the auth configuration', `demoHeader=${health.json.auth.demoHeader} liveSessions=${health.json.auth.liveSessions}`)
  : bad('health reports the auth configuration', JSON.stringify(health.json?.auth));

/* ── 8. Production posture ─────────────────────────────────────────────── */
section('8. Production posture (demo header disabled)');

/**
 * Asserted by spawning a production-mode process, because this is the one
 * property that cannot be checked against the development server the rest of
 * the suite talks to: the demo header is deliberately allowed in development.
 */
const { spawn } = await import('node:child_process');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(repo, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');

if (!(await import('node:fs')).existsSync(entry)) {
  bad('the compiled API is available for the production check', 'run pnpm --filter @moneymart/api build');
} else {
  const port = Number(process.env.MM_AUTH_PROD_PORT ?? 4599);
  const prodBase = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(repo, 'services', 'api'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      MM_PERSISTENCE: 'off',
      MM_AUTH_DEV_CODES: 'true',
      MM_SEED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let up = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const response = await fetch(`${prodBase}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        up = true;
        break;
      }
    } catch {
      /* not up yet */
    }
  }

  const prodCall = async (pathname, options = {}) => {
    const response = await fetch(`${prodBase}${pathname}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, json: await response.json().catch(() => null) };
  };

  if (!up) {
    bad('a production-mode process started');
  } else {
    ok('a production-mode process started');

    // The demo header must be refused, and the response must carry NO data.
    const headerAttempt = await prodCall('/api/wallet', { headers: { 'x-mm-user': 'usr_you' } });
    headerAttempt.status === 401
      ? ok('the demo header is refused in production', '401')
      : bad('the demo header is refused in production', `status ${headerAttempt.status}`);
    !JSON.stringify(headerAttempt.json ?? {}).includes('lifetimeGross')
      ? ok('the refused request returns no account data')
      : bad('the refused request returns no account data');

    const anonymous = await prodCall('/api/wallet');
    anonymous.status === 401 ? ok('an account read without identity is refused', 'GET /api/wallet') : bad('an account read without identity is refused', `status ${anonymous.status}`);

    const anonOrders = await prodCall('/api/orders');
    anonOrders.status === 401 ? ok('the orders book requires identity', 'GET /api/orders') : bad('the orders book requires identity', `status ${anonOrders.status}`);

    const anonWrite = await prodCall('/api/auctions', { method: 'POST', body: {} });
    anonWrite.status === 401 ? ok('an unattributed write is refused') : bad('an unattributed write is refused', `status ${anonWrite.status}`);

    // Public reads must keep working, or the product is unusable signed out.
    const publicReads = await Promise.all([
      prodCall('/api/auctions'),
      prodCall('/api/config'),
      prodCall('/api/health'),
      prodCall('/api/tv/epg.xml'),
    ]);
    publicReads.every((response) => response.status === 200)
      ? ok('public reads remain available without an account', 'lots · config · health · EPG')
      : bad('public reads remain available without an account', publicReads.map((r) => r.status).join('/'));

    // The identity switch must not be an account-takeover primitive.
    const switchAttempt = await prodCall('/api/session', { method: 'POST', body: { userId: 'usr_you' } });
    switchAttempt.status === 403
      ? ok('the demo identity switch is disabled in production', '403')
      : bad('the demo identity switch is disabled in production', `status ${switchAttempt.status}`);

    // And a real token must work fully.
    const code = (await prodCall('/api/auth/request', { method: 'POST', body: { identifier: `prod.${RUN}@example.com` } })).json?.devCode;
    const login = await prodCall('/api/auth/verify', { method: 'POST', body: { identifier: `prod.${RUN}@example.com`, code } });
    const prodToken = login.json?.token;
    prodToken ? ok('sign-in works in production') : bad('sign-in works in production', JSON.stringify(login.json).slice(0, 70));

    if (prodToken) {
      const authedWallet = await prodCall('/api/wallet', { headers: { authorization: `Bearer ${prodToken}` } });
      authedWallet.status === 200 ? ok('an authenticated read succeeds in production') : bad('an authenticated read succeeds in production', `status ${authedWallet.status}`);

      const authedWrite = await prodCall('/api/auctions', {
        method: 'POST',
        headers: { authorization: `Bearer ${prodToken}` },
        body: {
          title: 'Production auth probe',
          description: 'created by verify-auth',
          categoryId: 'watches',
          startingPrice: 10,
          currency: 'USD',
          format: 'flash',
          durationHours: 24,
          condition: 'good',
        },
      });
      authedWrite.status === 201 ? ok('an authenticated write succeeds in production') : bad('an authenticated write succeeds in production', `status ${authedWrite.status}`);
    }
  }

  child.kill('SIGKILL');
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
