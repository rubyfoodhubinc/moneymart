#!/usr/bin/env node
/**
 * MoneyMart — social sign-in verification (Google and Apple).
 *
 * These flows fail silently in ways a "does the button render" test never
 * catches: a signature that is never checked, PKCE that is generated and then
 * ignored, a state that can be replayed, or an unverified email that links to
 * somebody else's account. So this suite stands up a REAL OpenID Connect
 * provider on localhost — serving a JWKS and a token endpoint, signing genuine
 * ID tokens — and drives the actual authorization-code exchange through it.
 *
 * That means the production code path is exercised end to end:
 *
 *   • the ID token's signature is verified against the published JWKS
 *   • a token signed by the WRONG key is refused
 *   • `alg: none` and an unexpected issuer/audience are refused
 *   • an expired token is refused
 *   • the PKCE verifier sent to the token endpoint actually matches the challenge
 *   • state is single-use, so a replay cannot mint a second session
 *   • an unverified email does NOT link to an existing account
 *   • a verified email DOES, and the provider subject is durable
 *
 * Usage: node scripts/verify-oauth.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.MM_OAUTH_TEST_API_PORT ?? 4570);
const IDP_PORT = Number(process.env.MM_OAUTH_TEST_IDP_PORT ?? 4571);
const API = `http://127.0.0.1:${API_PORT}`;
const IDP = `http://127.0.0.1:${IDP_PORT}`;
const CLIENT_ID = 'moneymart-test-client';
const ISSUER = `${IDP}`;

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
const base64url = (value) => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

console.log('\n\u001b[1m════════ MoneyMart social sign-in ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}   mock idp ${IDP}\u001b[0m`);

/* ── A real signing key and a decoy ────────────────────────────────────── */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: decoyKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' };

const signToken = (claims, key = privateKey, header = { alg: 'RS256', kid: 'test-key-1', typ: 'JWT' }) => {
  const head = base64url(JSON.stringify(header));
  const body = base64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${base64url(signer.sign(key))}`;
};

const idTokenFor = (overrides = {}, key = privateKey, header) => {
  const now = Math.floor(Date.now() / 1000);
  return signToken(
    {
      iss: ISSUER,
      aud: CLIENT_ID,
      sub: 'subject-1',
      email: 'social.user@example.com',
      email_verified: true,
      name: 'Social User',
      picture: 'https://cdn.example.com/avatar.png',
      iat: now,
      exp: now + 600,
      ...overrides,
    },
    key,
    header,
  );
};

/* ── The mock identity provider ────────────────────────────────────────── */
let nextTokenClaims = null;
let lastTokenRequest = '';
let tokenEndpointCalls = 0;

const idp = createServer((req, res) => {
  const url = new URL(req.url ?? '/', IDP);

  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }

  if (url.pathname === '/token') {
    tokenEndpointCalls += 1;
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      lastTokenRequest = body;
      const idToken = nextTokenClaims ? nextTokenClaims() : idTokenFor();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'mock-access', id_token: idToken, token_type: 'Bearer' }));
    });
    return;
  }

  res.writeHead(404).end('not found');
});

await new Promise((resolve) => idp.listen(IDP_PORT, '127.0.0.1', resolve));
console.log('  \u001b[32m✔\u001b[0m mock identity provider is serving');

/* ── Start the gateway against it ──────────────────────────────────────── */
const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  bad('the compiled API exists (run pnpm build:api)');
  idp.close();
  process.exit(1);
}

/**
 * The browser runs on its own origin, so three things must agree or the handoff
 * fails for a reason unrelated to the handoff:
 *   • CORS must allow that origin, or every API call is refused (observed as 403)
 *   • the OAuth redirect must target it, or the token goes to a host with no app
 *   • the dev server must be built against THIS gateway
 */
const WEB_PORT = Number(process.env.MM_OAUTH_TEST_WEB_PORT ?? 3011);
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

const gateway = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: {
    ...process.env,
    PORT: String(API_PORT),
    NODE_ENV: 'development',
    MM_SEED: 'true',
    MM_PERSISTENCE: 'off',
    MM_AUTH_DEV_CODES: 'true',
    MM_PUBLIC_API_URL: API,
    /**
     * The browser is on the web dev server while the gateway is here, so the
     * handoff must land on the web origin. Without this the token would be handed
     * to the API origin, which serves no app.
     */
    MM_OAUTH_APP_ORIGIN: WEB_ORIGIN,
    MM_ALLOWED_ORIGINS: `${WEB_ORIGIN},http://127.0.0.1:3000,http://localhost:3000`,
    // Google, pointed at the mock.
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'test-secret',
    MM_OAUTH_GOOGLE_AUTH_URL: `${IDP}/authorize`,
    MM_OAUTH_GOOGLE_TOKEN_URL: `${IDP}/token`,
    MM_OAUTH_GOOGLE_JWKS_URL: `${IDP}/jwks`,
    MM_OAUTH_GOOGLE_ISSUER: ISSUER,
    // Apple deliberately left unconfigured, to prove the refusal path.
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let gatewayLog = '';
gateway.stdout.on('data', (chunk) => (gatewayLog += chunk));
gateway.stderr.on('data', (chunk) => (gatewayLog += chunk));

let webServerRef = null;
let prodGatewayRef = null;
const cleanup = () => {
  try {
    prodGatewayRef?.kill('SIGKILL');
  } catch {
    /* already dead */
  }
  try {
    gateway.kill('SIGKILL');
  } catch {
    /* already dead */
  }
  try {
    webServerRef?.kill('SIGKILL');
  } catch {
    /* already dead */
  }
  try {
    idp.close();
  } catch {
    /* already closed */
  }
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

let healthy = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    if ((await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) {
      healthy = true;
      break;
    }
  } catch {
    /* not up yet */
  }
}
if (!healthy) {
  bad('the gateway started', gatewayLog.slice(-200));
  cleanup();
  process.exit(1);
}
ok('the gateway started');

const call = async (pathname, options = {}) => {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* a redirect has an empty body */
  }
  return { status: response.status, headers: response.headers, json, text };
};

/** Run the full flow: begin, then call the callback with a code. */
async function signIn(options = {}) {
  const start = await call('/api/auth/oauth/google/start', {
    method: 'POST',
    body: { redirect: options.redirect ?? '/settings' },
  });
  if (!start.json?.url) return { start, callback: null, location: '' };

  const authorize = new URL(start.json.url);
  const state = authorize.searchParams.get('state');
  const callback = await call(
    `/api/auth/oauth/google/callback?code=mock-code&state=${encodeURIComponent(state)}`,
    { method: 'GET' },
  );
  return {
    start,
    authorize,
    state,
    callback,
    location: callback.headers.get('location') ?? '',
    /** The challenge, captured with THIS flow so comparisons cannot drift. */
    challenge: authorize.searchParams.get('code_challenge') ?? '',
  };
}

const tokenFrom = (location) => {
  const match = /#token=([^&]+)/.exec(location);
  return match ? decodeURIComponent(match[1]) : null;
};

/* ── 1. Provider availability ──────────────────────────────────────────── */
section('1. Only configured providers are offered');

const providers = await call('/api/auth/oauth/providers');
const list = providers.json?.providers ?? [];
const google = list.find((entryRef) => entryRef.id === 'google');
const apple = list.find((entryRef) => entryRef.id === 'apple');
google?.configured ? ok('Google is reported as configured') : bad('Google is reported as configured', JSON.stringify(google));
apple && apple.configured === false
  ? ok('Apple is reported as unconfigured, not hidden')
  : bad('Apple is reported as unconfigured, not hidden', JSON.stringify(apple));

const unconfigured = await call('/api/auth/oauth/apple/start', { method: 'POST', body: {} });
unconfigured.status === 503
  ? ok('starting an unconfigured provider is refused', `503 ${unconfigured.json?.error}`)
  : bad('starting an unconfigured provider is refused', `status ${unconfigured.status}`);

const unknown = await call('/api/auth/oauth/myspace/start', { method: 'POST', body: {} });
unknown.status === 404 ? ok('an unknown provider is refused', '404') : bad('an unknown provider is refused', `status ${unknown.status}`);

/* ── 2. The authorization request ──────────────────────────────────────── */
section('2. The authorization request is correct');

const { start, authorize } = await signIn();
authorize ? ok('a flow can begin', `state ${String(authorize.searchParams.get('state')).slice(0, 8)}…`) : bad('a flow can begin');

(String(authorize?.searchParams.get('redirect_uri') ?? '')).includes('/api/auth/oauth/google/callback')
  ? ok('the redirect URI points at our callback')
  : bad('the redirect URI points at our callback', String(authorize?.searchParams.get('redirect_uri')));

(authorize?.searchParams.get('scope') ?? '').includes('openid')
  ? ok('openid is requested', String(authorize?.searchParams.get('scope')))
  : bad('openid is requested', String(authorize?.searchParams.get('scope')));

(authorize?.searchParams.get('code_challenge_method') ?? '') === 'S256'
  ? ok('PKCE uses S256')
  : bad('PKCE uses S256', String(authorize?.searchParams.get('code_challenge_method')));

/* ── 3. A genuine sign-in ──────────────────────────────────────────────── */
section('3. A verified identity signs in');

nextTokenClaims = null;
const happy = await signIn();
const happyToken = tokenFrom(happy.location);
happyToken ? ok('the callback returns a session token') : bad('the callback returns a session token', happy.location.slice(0, 70));

// The token must not be in the query string, where servers log it.
happy.location.includes('?token=') || /[?&]token=/.test(happy.location)
  ? bad('the token is handed back in the fragment, not the query')
  : ok('the token is handed back in the fragment, not the query');

/\/settings#token=/.test(happy.location)
  ? ok('the requested in-app destination is honoured', '/settings')
  : bad('the requested in-app destination is honoured', happy.location.slice(0, 60));

if (happyToken) {
  const session = await call('/api/auth/session', { headers: { authorization: `Bearer ${happyToken}` } });
  session.status === 200 && session.json?.profile
    ? ok('the issued token authenticates', session.json.profile.handle)
    : bad('the issued token authenticates', `status ${session.status}`);

  session.json?.profile?.displayName === 'Social User'
    ? ok('the provider display name is applied')
    : bad('the provider display name is applied', String(session.json?.profile?.displayName));

  session.json?.profile?.avatarUrl
    ? ok('the provider avatar is applied')
    : bad('the provider avatar is applied');

  // The session must record HOW it was established, and the assertion must be a
  // real one — an earlier version passed on `undefined` by falling back.
  session.json?.session?.method === 'oauth'
    ? ok('the session records the oauth method', 'oauth')
    : bad('the session records the oauth method', String(session.json?.session?.method));
}

/* ── 4. PKCE is actually sent ──────────────────────────────────────────── */
section('4. PKCE is enforced, not decorative');

// The challenge went to the provider; the VERIFIER must reach the token endpoint.
lastTokenRequest.includes('code_verifier=')
  ? ok('the PKCE verifier is sent on exchange')
  : bad('the PKCE verifier is sent on exchange', lastTokenRequest.slice(0, 60));

if (lastTokenRequest.includes('code_verifier=')) {
  const verifier = decodeURIComponent(/code_verifier=([^&]*)/.exec(lastTokenRequest)?.[1] ?? '');
  /**
   * Compare against the challenge from the SAME flow that produced this verifier.
   * The earlier version read a shared variable that later sign-ins overwrote, so
   * it compared two different flows and failed for the wrong reason.
   */
  const challenge = happy.challenge;
  const derived = base64url(createHash('sha256').update(verifier).digest());
  derived === challenge
    ? ok('the verifier matches the challenge sent to the provider', 'S256 verified')
    : bad('the verifier matches the challenge sent to the provider');
}

/* ── 5. Signature and claim verification ───────────────────────────────── */
section('5. A forged or invalid token is refused');

const forged = await (async () => {
  nextTokenClaims = () => idTokenFor({}, decoyKey);
  const result = await signIn();
  nextTokenClaims = null;
  return result;
})();
tokenFrom(forged.location)
  ? bad('a token signed by the wrong key is refused', 'a session was issued')
  : ok('a token signed by the wrong key is refused', String(new URLSearchParams(forged.location.split('?')[1] ?? '').get('auth_error')));

const algNone = await (async () => {
  const now = Math.floor(Date.now() / 1000);
  nextTokenClaims = () => {
    const head = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const body = base64url(JSON.stringify({ iss: ISSUER, aud: CLIENT_ID, sub: 'x', email: 'a@b.c', email_verified: true, iat: now, exp: now + 600 }));
    return `${head}.${body}.`;
  };
  const result = await signIn();
  nextTokenClaims = null;
  return result;
})();
tokenFrom(algNone.location) ? bad('alg: none is refused', 'a session was issued') : ok('alg: none is refused');

const expired = await (async () => {
  const now = Math.floor(Date.now() / 1000);
  nextTokenClaims = () => idTokenFor({ iat: now - 7200, exp: now - 3600 });
  const result = await signIn();
  nextTokenClaims = null;
  return result;
})();
tokenFrom(expired.location) ? bad('an expired token is refused', 'a session was issued') : ok('an expired token is refused');

const wrongIssuer = await (async () => {
  nextTokenClaims = () => idTokenFor({ iss: 'https://evil.example' });
  const result = await signIn();
  nextTokenClaims = null;
  return result;
})();
tokenFrom(wrongIssuer.location) ? bad('a wrong issuer is refused', 'a session was issued') : ok('a wrong issuer is refused');

const wrongAudience = await (async () => {
  nextTokenClaims = () => idTokenFor({ aud: 'someone-elses-client-id' });
  const result = await signIn();
  nextTokenClaims = null;
  return result;
})();
tokenFrom(wrongAudience.location) ? bad('a wrong audience is refused', 'a session was issued') : ok('a wrong audience is refused');

// A token naming a key the provider does not publish must not fall back to another.
const unknownKid = await (async () => {
  nextTokenClaims = () => idTokenFor({}, privateKey, { alg: 'RS256', kid: 'not-published', typ: 'JWT' });
  const result = await signIn();
  nextTokenClaims = null;
  return result;
})();
tokenFrom(unknownKid.location)
  ? bad('an unpublished key id is refused', 'a session was issued')
  : ok('an unpublished key id is refused', 'no fallback to another key');

/* ── 6. State cannot be replayed or forged ─────────────────────────────── */
section('6. State is single-use');

const replay = await signIn();
const replayToken = tokenFrom(replay.location);
if (replay.state && replayToken) {
  const again = await call(`/api/auth/oauth/google/callback?code=mock-code&state=${encodeURIComponent(replay.state)}`, { method: 'GET' });
  const againToken = tokenFrom(again.headers.get('location') ?? '');
  !againToken ? ok('a replayed state is refused', 'no second session') : bad('a replayed state is refused', 'a second session was issued');
} else {
  bad('a replayed state is refused', 'could not establish a flow to replay');
}

const forgedState = await call('/api/auth/oauth/google/callback?code=mock-code&state=not-a-real-state', { method: 'GET' });
!tokenFrom(forgedState.headers.get('location') ?? '')
  ? ok('an invented state is refused')
  : bad('an invented state is refused', 'a session was issued');

const noCode = await call(`/api/auth/oauth/google/callback?state=whatever`, { method: 'GET' });
!tokenFrom(noCode.headers.get('location') ?? '') ? ok('a callback with no code is refused') : bad('a callback with no code is refused');

const providerRefusal = await call('/api/auth/oauth/google/callback?error=access_denied&state=x', { method: 'GET' });
/provider_access_denied/.test(providerRefusal.headers.get('location') ?? '')
  ? ok('a provider refusal is reported to the app', 'provider_access_denied')
  : bad('a provider refusal is reported to the app', String(providerRefusal.headers.get('location')));

/* ── 7. Identity linking rules ─────────────────────────────────────────── */
section('7. Linking requires a verified address');

// An UNVERIFIED address must not adopt an existing account.
/**
 * Fetch the seeded account's email.
 *
 * `/api/users/:handle` returns a PUBLIC profile, which intentionally omits the
 * address — asserting on an absent field was the test's mistake, not a leak.
 * The dev-only email lookup is the right source for a verification suite.
 */
const adaLookup = await call('/api/dev/user-email?userId=usr_ada');
const adaEmail = adaLookup.json?.email ?? '';
const existing = { json: { profile: { id: 'usr_ada' } } };
if (adaEmail) {
  nextTokenClaims = () => idTokenFor({ email: adaEmail, email_verified: false, sub: 'attacker-subject' });
  const hijack = await signIn();
  nextTokenClaims = null;
  const hijackToken = tokenFrom(hijack.location);

  if (hijackToken) {
    const who = await call('/api/auth/session', { headers: { authorization: `Bearer ${hijackToken}` } });
    who.json?.profile?.id !== 'usr_ada'
      ? ok('an unverified email does not link to an existing account', 'separate account created')
      : bad('an unverified email does not link to an existing account', 'the existing account was adopted');
  } else {
    bad('an unverified email does not link to an existing account', 'no session issued at all');
  }

  // A VERIFIED address SHOULD link, or a returning user gets a duplicate account.
  nextTokenClaims = () => idTokenFor({ email: adaEmail, email_verified: true, sub: `link-${randomUUID()}` });
  const linked = await signIn();
  nextTokenClaims = null;
  const linkedToken = tokenFrom(linked.location);
  if (linkedToken) {
    const who = await call('/api/auth/session', { headers: { authorization: `Bearer ${linkedToken}` } });
    who.json?.profile?.id === 'usr_ada'
      ? ok('a verified email links to the existing account', adaEmail)
      : bad('a verified email links to the existing account', `got ${who.json?.profile?.id}`);
  } else {
    bad('a verified email links to the existing account', 'no session issued');
  }
} else {
  bad('a seeded account with an email was found');
}

// The same provider subject must resolve to the same account across sign-ins.
nextTokenClaims = () => idTokenFor({ sub: 'stable-subject', email: 'stable@example.com', email_verified: true });
const firstPass = await signIn();
nextTokenClaims = () => idTokenFor({ sub: 'stable-subject', email: 'stable@example.com', email_verified: true });
const secondPass = await signIn();
nextTokenClaims = null;

const firstToken = tokenFrom(firstPass.location);
const secondToken = tokenFrom(secondPass.location);
if (firstToken && secondToken) {
  const one = await call('/api/auth/session', { headers: { authorization: `Bearer ${firstToken}` } });
  const two = await call('/api/auth/session', { headers: { authorization: `Bearer ${secondToken}` } });
  one.json?.profile?.id === two.json?.profile?.id
    ? ok('the same subject resolves to the same account', one.json.profile.id)
    : bad('the same subject resolves to the same account', `${one.json?.profile?.id} vs ${two.json?.profile?.id}`);
} else {
  bad('the same subject resolves to the same account', 'sessions were not issued');
}

/* ── 8. Open-redirect protection ───────────────────────────────────────── */
section('8. The return path cannot be turned into an open redirect');

for (const hostile of ['https://evil.example/steal', '//evil.example', 'javascript:alert(1)']) {
  const attempt = await call('/api/auth/oauth/google/start', { method: 'POST', body: { redirect: hostile } });
  const flow = await call(
    `/api/auth/oauth/google/callback?code=mock-code&state=${encodeURIComponent(
      new URL(attempt.json?.url ?? 'http://x').searchParams.get('state') ?? '',
    )}`,
    { method: 'GET' },
  );
  const location = flow.headers.get('location') ?? '';
  !location.includes('evil.example') && !location.includes('javascript:')
    ? ok(`a hostile return path is ignored`, hostile.slice(0, 34))
    : bad(`a hostile return path is ignored`, location.slice(0, 60));
}

/* ── 8b. Reachable without an identity ─────────────────────────────────── */
section('8b. Sign-in is reachable when signed out');

/**
 * The whole point of a sign-in endpoint is that the caller has no identity yet.
 *
 * The production identity guard intercepted these, so social sign-in was
 * unreachable on the deployment while every local test passed — because the
 * development branch of the guard behaves differently. Asserted here in the
 * production posture, which is the only configuration that showed the fault.
 */
const prodGateway = (prodGatewayRef = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: {
    ...process.env,
    PORT: String(API_PORT + 2),
    NODE_ENV: 'production',
    MM_SEED: 'true',
    MM_PERSISTENCE: 'off',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
}));
let prodLog = '';
prodGateway.stdout.on('data', (chunk) => (prodLog += chunk));
prodGateway.stderr.on('data', (chunk) => (prodLog += chunk));
const PROD = `http://127.0.0.1:${API_PORT + 2}`;

let prodUp = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    if ((await fetch(`${PROD}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) {
      prodUp = true;
      break;
    }
  } catch {
    /* not up yet */
  }
}

if (!prodUp) {
  bad('a production-mode gateway started', prodLog.slice(-140));
} else {
  const providerList = await fetch(`${PROD}/api/auth/oauth/providers`).catch(() => null);
  providerList?.status === 200
    ? ok('the provider list is readable while signed out', '200')
    : bad('the provider list is readable while signed out', `status ${providerList?.status}`);

  const startProd = await fetch(`${PROD}/api/auth/oauth/google/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  /**
   * 503 (not configured) and 200 (configured) are both correct. 401 is the fault:
   * it means the caller was asked for an identity before being allowed to sign in.
   */
  startProd && startProd.status !== 401
    ? ok('starting a sign-in does not require an existing identity', `status ${startProd.status}`)
    : bad('starting a sign-in does not require an existing identity', `status ${startProd?.status}`);

  const callbackProd = await fetch(`${PROD}/api/auth/oauth/google/callback`, { redirect: 'manual' }).catch(() => null);
  callbackProd && callbackProd.status !== 401
    ? ok('the provider callback is reachable', `status ${callbackProd.status}`)
    : bad('the provider callback is reachable', `status ${callbackProd?.status}`);

  // Authentication must still actually protect account data.
  for (const pathname of ['/api/wallet', '/api/orders', '/api/notifications']) {
    const guarded = await fetch(`${PROD}${pathname}`).catch(() => null);
    guarded?.status === 401
      ? ok(`${pathname} still requires an identity`, '401')
      : bad(`${pathname} still requires an identity`, `status ${guarded?.status}`);
  }
}

try {
  prodGateway.kill('SIGKILL');
} catch {
  /* already dead */
}

/* ── 9. The client consumes the handoff correctly ──────────────────────── */
section('9. The browser adopts the fragment handoff');

/**
 * The redirect lands on the app with `#token=...`. Two things must hold in a real
 * browser, and neither is observable server-side: the token must be erased from
 * the address bar (a fragment is not sent to a server, but it does persist in
 * history), and the app must not throw while adopting it.
 */
/**
 * A web dev server wired to THIS test's gateway.
 *
 * Pointing the browser at an already-running dev server would exercise the
 * handoff against whatever API that server was built with — almost certainly not
 * this one — so the app would correctly reject the token and the assertion would
 * fail while claiming the handoff is broken. That exact false negative was
 * observed. Starting a dedicated instance removes the ambiguity.
 */
const webUrl = WEB_ORIGIN;
const webServer = (webServerRef = spawn('bash', [path.join(repoRoot, 'scripts', 'start-web.sh')], {
  cwd: repoRoot,
  env: { ...process.env, WEB_PORT: String(WEB_PORT), VITE_API_URL: API },
  stdio: ['ignore', 'pipe', 'pipe'],
}));
let webLog = '';
webServer.stdout.on('data', (chunk) => (webLog += chunk));
webServer.stderr.on('data', (chunk) => (webLog += chunk));

let webUp = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  webUp = await fetch(`${webUrl}/`, { signal: AbortSignal.timeout(1500) })
    .then((response) => response.ok)
    .catch(() => false);
  if (webUp) break;
}

if (!webUp) {
  bad('the web dev server started for the handoff check', webLog.slice(-160));
} else {
  ok('a web dev server started, wired to this gateway');
  const { spawn: spawnChrome } = await import('node:child_process');
  const chromePath = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate) => existsSync(candidate));

  if (!chromePath) {
    console.log('  \u001b[2m· no browser available — skipping\u001b[0m');
  } else {
    const cdpPort = Number(process.env.MM_OAUTH_TEST_CDP ?? 9361);
    const chrome = spawnChrome(
      chromePath,
      ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${cdpPort}`,
       `--user-data-dir=${tmpdir()}/mm-oauth-${Date.now()}`, 'about:blank'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let wsRef = null;
    let seq = 0;
    const waiting = new Map();
    const sendCmd = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject });
        wsRef.send(JSON.stringify({ id, method, params }));
      });

    let attached = false;
    for (let attempt = 0; attempt < 60 && !attached; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
        const page = targets.find((target) => target.type === 'page');
        if (page?.webSocketDebuggerUrl) {
          wsRef = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((resolve) => wsRef.addEventListener('open', resolve, { once: true }));
          wsRef.addEventListener('message', (event) => {
            const data = JSON.parse(String(event.data));
            if (data.id && waiting.has(data.id)) {
              const { resolve: done, reject: failed } = waiting.get(data.id);
              waiting.delete(data.id);
              data.error ? failed(new Error(data.error.message)) : done(data.result);
            }
          });
          await sendCmd('Runtime.enable');
          await sendCmd('Page.enable');
          attached = true;
        }
      } catch {
        /* not listening yet */
      }
    }

    const evaluate = async (expression) => {
      const result = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result.result?.value;
    };

    if (!attached) {
      bad('a browser attached for the handoff check');
    } else {
      /**
       * A REAL session token, obtained through the mock provider.
       *
       * A fake token would be signed in with and then correctly rejected — the app
       * clears it — so asserting persistence against one tests the rejection path
       * while claiming to test the handoff. That mistake was made and caught here.
       */
      nextTokenClaims = () => idTokenFor({ sub: `handoff-${randomUUID()}`, email: 'handoff@example.com', email_verified: true });
      const handoff = await signIn({ redirect: '/settings' });
      nextTokenClaims = null;
      const probeToken = tokenFrom(handoff.location) ?? '';
      await sendCmd('Page.navigate', { url: `${webUrl}/settings#token=${encodeURIComponent(probeToken)}` });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      probeToken ? ok('a real session token was minted for the handoff') : bad('a real session token was minted for the handoff');

      const location = await evaluate('window.location.href');
      !location.includes(probeToken)
        ? ok('the token is erased from the address bar after adoption')
        : bad('the token is erased from the address bar after adoption', String(location).slice(0, 70));

      const stored = await evaluate(
        `(() => { try { return JSON.stringify(window.localStorage); } catch { return '{}'; } })()`,
      );
      /**
       * A REAL token must survive, and must match what the server issued. If the
       * stored value is empty the adoption was rejected rather than applied.
       */
      String(stored).includes(probeToken)
        ? ok('the adopted token is persisted for later requests', 'stored verbatim')
        : bad('the adopted token is persisted for later requests', String(stored).slice(0, 60));

      const rendered = await evaluate('(document.body && document.body.innerText || "").length');
      rendered > 200
        ? ok('the app still renders after adopting a handoff', `${rendered} chars`)
        : bad('the app still renders after adopting a handoff', `${rendered} chars`);

      /**
       * An error handoff must be reported rather than swallowed.
       *
       * The navigation is a FULL reload, not a fragment change: a provider
       * redirect is a real navigation that re-executes the entry module, whereas
       * navigating from `#token=...` to `#auth_error=...` on the same path only
       * fires `hashchange`, so the adoption code never runs and the fragment
       * legitimately remains. Comparing the two would fail for the wrong reason.
       */
      await sendCmd('Page.navigate', { url: `${webUrl}/settings#auth_error=invalid_or_expired_state` });
      await sendCmd('Page.reload', { ignoreCache: true });
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const errorLocation = await evaluate('window.location.href');
      !errorLocation.includes('auth_error')
        ? ok('an error handoff is also erased from the address bar')
        : bad('an error handoff is also erased from the address bar', String(errorLocation).slice(0, 70));

      /**
       * The reason reaches the store's error channel, which is as far as this
       * suite can verify. Whether a user SEES it depends on the sign-in panel
       * being mounted, and on a page where it is not (Settings, reached directly)
       * the reason is stored and not rendered. The app now asks the shell to open
       * the panel, but that presentation is NOT asserted here because it could not
       * be confirmed reliably in headless Chrome — recording it rather than
       * claiming a green check for it.
       */
      const errorState = await evaluate(
        `(async () => { try { const m = await import('/src/store/session.ts'); const s = m.useSession.getState(); return JSON.stringify({ error: s.error, requested: s.signInRequested }); } catch (e) { return 'ERR'; } })()`,
      );
      typeof errorState === 'string' && errorState !== 'ERR'
        ? ok('the failure is handled without throwing', String(errorState).slice(0, 52))
        : bad('the failure is handled without throwing', String(errorState).slice(0, 52));
    }

    try {
      chrome.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
}

try {
  webServer.kill('SIGKILL');
} catch {
  /* already dead */
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
