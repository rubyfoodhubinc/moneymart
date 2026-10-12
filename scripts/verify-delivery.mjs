#!/usr/bin/env node
/**
 * MoneyMart — sign-in code delivery (SMS and email).
 *
 * Delivery is the one part of authentication that had never been exercised,
 * because it needs a paid provider. Reading the code was enough to find the bug
 * it contained:
 *
 *   Twilio's **Verify** product GENERATES its own code and ignores any supplied
 *   one. The platform generates a code, stores a hash of it, and sends that code
 *   to Twilio Verify — so the user receives TWILIO's digits while `verify()`
 *   compares against the hash of OURS. Every SMS sign-in would have been rejected
 *   as an invalid code, and only a real text message could have shown it.
 *
 * A mock Twilio and Resend cannot prove the real APIs behave identically, but
 * they do prove the thing that was actually wrong: **the code that is sent is the
 * code that is verified**. That is asserted here end to end, because no amount of
 * reading the vendor's documentation substitutes for checking it.
 *
 * Usage: node scripts/verify-delivery.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.MM_DELIVERY_TEST_API_PORT ?? 4580);
const PROVIDER_PORT = Number(process.env.MM_DELIVERY_TEST_PROVIDER_PORT ?? 4581);
const API = `http://127.0.0.1:${API_PORT}`;

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

console.log('\n\u001b[1m════════ MoneyMart code delivery ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}   mock providers :${PROVIDER_PORT}\u001b[0m`);

/* ── Mock providers ────────────────────────────────────────────────────── */
/** Everything the mock received, so assertions can inspect the real payloads. */
const received = { sms: [], email: [], twilioAuth: null, resendAuth: null };
/** Failure injection, so the error paths are exercised too. */
let twilioFailure = null;
let resendFailure = null;

const provider = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PROVIDER_PORT}`);

    // Twilio Messages API.
    if (url.pathname.endsWith('/Messages.json')) {
      received.twilioAuth = req.headers.authorization ?? null;
      const form = new URLSearchParams(body);
      received.sms.push({ to: form.get('To'), body: form.get('Body'), from: form.get('From'), service: form.get('MessagingServiceSid') });
      if (twilioFailure) {
        res.writeHead(twilioFailure.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: twilioFailure.code, message: twilioFailure.message }));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sid: 'SM_mock', status: 'queued' }));
      return;
    }

    // Resend.
    if (url.pathname === '/emails') {
      received.resendAuth = req.headers.authorization ?? null;
      try {
        received.email.push(JSON.parse(body));
      } catch {
        received.email.push({ raw: body });
      }
      if (resendFailure) {
        res.writeHead(resendFailure.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ name: resendFailure.name, message: resendFailure.message }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'mock-email-id' }));
      return;
    }

    res.writeHead(404).end('not found');
  });
});

await new Promise((resolve) => provider.listen(PROVIDER_PORT, '127.0.0.1', resolve));
ok('mock Twilio and Resend endpoints are serving');

/* ── Gateway with both providers configured ────────────────────────────── */
const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  bad('the compiled API exists (run pnpm build:api)');
  provider.close();
  process.exit(1);
}

let gateway = null;
let gatewayLog = '';

function startGateway(extraEnv = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: 'development',
      MM_SEED: 'true',
      MM_PERSISTENCE: 'off',
      /**
       * Development code exposure is turned OFF for most of this suite, so the
       * only way to learn the code is to read what was actually sent. Leaving it
       * on would let every assertion pass without delivery working at all.
       */
      MM_AUTH_DEV_CODES: 'false',
      MM_TWILIO_API_BASE: `http://127.0.0.1:${PROVIDER_PORT}`,
      MM_RESEND_API_BASE: `http://127.0.0.1:${PROVIDER_PORT}`,
      TWILIO_ACCOUNT_SID: 'ACmockaccountsid000000000000000000',
      TWILIO_AUTH_TOKEN: 'mock-auth-token',
      TWILIO_MESSAGING_SERVICE_SID: 'MGmockservice',
      RESEND_API_KEY: 're_mock_key',
      RESEND_FROM: 'MoneyMart <codes@moneymart.app>',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => (gatewayLog += chunk));
  child.stderr.on('data', (chunk) => (gatewayLog += chunk));
  return child;
}

async function waitForHealth(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

gateway = startGateway();
if (!(await waitForHealth())) {
  bad('the gateway started', gatewayLog.slice(-200));
  provider.close();
  process.exit(1);
}
ok('the gateway started with SMS and email configured');

/**
 * Stop only the gateway.
 *
 * An earlier version used one cleanup for both, so restarting the gateway to test
 * a different configuration also closed the mock providers — every subsequent
 * request failed with `fetch failed` and eleven checks reported a product fault
 * that did not exist. The providers must outlive the gateway restarts.
 */
const stopGateway = () => {
  try {
    gateway?.kill('SIGKILL');
  } catch {
    /* already dead */
  }
  gateway = null;
};

process.on('exit', () => {
  stopGateway();
  try {
    provider.close();
  } catch {
    /* already closed */
  }
});

const call = async (pathname, options = {}) => {
  const response = await fetch(`${API}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

/* ── 1. SMS sends the code that is verified ────────────────────────────── */
section('1. The SMS carries the code that the platform verifies');

received.sms.length = 0;
const phone = '+15550000111';
const requested = await call('/api/auth/request', { method: 'POST', body: { identifier: phone } });

requested.status === 200 ? ok('a code can be requested for a phone number') : bad('a code can be requested for a phone number', `status ${requested.status}`);
requested.json?.delivery?.delivered === true
  ? ok('the SMS is reported as delivered', requested.json.delivery.transport)
  : bad('the SMS is reported as delivered', JSON.stringify(requested.json?.delivery));

// The code must not come back in the response — that would make delivery moot.
!requested.json?.devCode
  ? ok('the code is not returned in the response')
  : bad('the code is not returned in the response', 'devCode was present');

received.sms.length === 1 ? ok('exactly one SMS was sent') : bad('exactly one SMS was sent', `${received.sms.length} sent`);

const sentBody = received.sms[0]?.body ?? '';
const sentTo = received.sms[0]?.to ?? '';
sentTo === phone ? ok('the SMS went to the requested number', sentTo) : bad('the SMS went to the requested number', sentTo);

const sentCode = /(\d{6})/.exec(sentBody)?.[1] ?? '';
sentCode ? ok('the SMS contains a six-digit code', sentCode.replace(/./g, '•')) : bad('the SMS contains a six-digit code', sentBody.slice(0, 40));

/**
 * The assertion that matters. Before the fix this failed, because Twilio's Verify
 * API generated its own code and the body we sent was ignored entirely.
 */
const verified = await call('/api/auth/verify', { method: 'POST', body: { identifier: phone, code: sentCode } });
verified.status === 200 && verified.json?.token
  ? ok('the code that was SENT is the code that VERIFIES', 'sign-in completed from the SMS text alone')
  : bad('the code that was SENT is the code that VERIFIES', `status ${verified.status} ${JSON.stringify(verified.json).slice(0, 60)}`);

// A wrong code must still be refused.
const wrong = await call('/api/auth/verify', { method: 'POST', body: { identifier: phone, code: '000000' } });
wrong.status === 401 ? ok('a wrong code is refused', '401') : bad('a wrong code is refused', `status ${wrong.status}`);

// Twilio expects HTTP basic auth on the Messages API.
(received.twilioAuth ?? '').startsWith('Basic ')
  ? ok('Twilio is called with basic authentication')
  : bad('Twilio is called with basic authentication', String(received.twilioAuth).slice(0, 24));

received.sms[0]?.service === 'MGmockservice'
  ? ok('the messaging service is used as the sender', 'MGmockservice')
  : bad('the messaging service is used as the sender', String(received.sms[0]?.service));

/* ── 2. A plain from-number works too ──────────────────────────────────── */
section('2. A plain from-number is accepted as the sender');

stopGateway();
await new Promise((resolve) => setTimeout(resolve, 600));
gatewayLog = '';
gateway = startGateway({ TWILIO_MESSAGING_SERVICE_SID: '', TWILIO_FROM_NUMBER: '+15550000999' });
if (!(await waitForHealth())) {
  bad('the gateway restarted with a from-number', gatewayLog.slice(-140));
} else {
  received.sms.length = 0;
  const second = await call('/api/auth/request', { method: 'POST', body: { identifier: '+15550000222' } });
  second.status === 200 && received.sms.length === 1
    ? ok('an SMS is sent when only a from-number is configured', `from ${received.sms[0]?.from}`)
    : bad('an SMS is sent when only a from-number is configured', `status ${second.status}, ${received.sms.length} sent`);

  const code2 = /(\d{6})/.exec(received.sms[0]?.body ?? '')?.[1] ?? '';
  const verified2 = await call('/api/auth/verify', { method: 'POST', body: { identifier: '+15550000222', code: code2 } });
  verified2.json?.token ? ok('the from-number path also delivers a working code') : bad('the from-number path also delivers a working code');
}

/* ── 3. Email ──────────────────────────────────────────────────────────── */
section('3. Email carries the same code');

received.email.length = 0;
const emailAddress = `delivery.${Date.now()}@example.com`;
const emailRequest = await call('/api/auth/request', { method: 'POST', body: { identifier: emailAddress } });

emailRequest.json?.delivery?.delivered === true
  ? ok('the email is reported as delivered', emailRequest.json.delivery.transport)
  : bad('the email is reported as delivered', JSON.stringify(emailRequest.json?.delivery));

received.email.length === 1 ? ok('exactly one email was sent') : bad('exactly one email was sent', `${received.email.length} sent`);

const mail = received.email[0] ?? {};
Array.isArray(mail.to) && mail.to[0] === emailAddress
  ? ok('the email went to the requested address', emailAddress)
  : bad('the email went to the requested address', JSON.stringify(mail.to));

// The sender must be the configured one, not a hardcoded address that the
// provider would reject.
String(mail.from ?? '').includes('codes@moneymart.app')
  ? ok('the configured sender is used', String(mail.from))
  : bad('the configured sender is used', String(mail.from));

const emailText = String(mail.text ?? '');
const emailCode = /(\d{6})/.exec(emailText)?.[1] ?? '';
emailCode ? ok('the email body contains a six-digit code') : bad('the email body contains a six-digit code', emailText.slice(0, 40));

// The HTML part must agree with the text part, or one of them is wrong.
const htmlCode = /(\d{6})/.exec(String(mail.html ?? ''))?.[1] ?? '';
htmlCode === emailCode
  ? ok('the HTML and text parts carry the same code')
  : bad('the HTML and text parts carry the same code', `${emailCode} vs ${htmlCode}`);

const emailVerified = await call('/api/auth/verify', { method: 'POST', body: { identifier: emailAddress, code: emailCode } });
emailVerified.json?.token
  ? ok('the emailed code verifies', 'sign-in completed from the email alone')
  : bad('the emailed code verifies', `status ${emailVerified.status}`);

(received.resendAuth ?? '').startsWith('Bearer ')
  ? ok('Resend is called with a bearer token')
  : bad('Resend is called with a bearer token', String(received.resendAuth).slice(0, 20));

// The code must never be logged when delivery is configured, or it leaks into
// whatever collects the platform's logs.
!/\[auth\] code for/.test(gatewayLog)
  ? ok('the code is not written to the log when delivery is configured')
  : bad('the code is not written to the log when delivery is configured');

/* ── 4. Provider failures are reported with their reason ───────────────── */
section('4. Provider failures say what went wrong');

twilioFailure = { status: 400, code: 21608, message: 'The number is unverified. Trial accounts may only send to verified numbers.' };
const smsFailure = await call('/api/auth/request', { method: 'POST', body: { identifier: '+15550000333' } });
smsFailure.json?.delivery?.delivered === false
  ? ok('a refused SMS is reported as not delivered')
  : bad('a refused SMS is reported as not delivered', JSON.stringify(smsFailure.json?.delivery));

// The specific Twilio error code must survive, because it is the actionable part.
String(smsFailure.json?.delivery?.detail ?? '').includes('21608')
  ? ok('the Twilio error code is carried through', String(smsFailure.json.delivery.detail))
  : bad('the Twilio error code is carried through', String(smsFailure.json?.delivery?.detail));
twilioFailure = null;

resendFailure = { status: 403, name: 'validation_error', message: 'The moneymart.app domain is not verified.' };
const emailFailure = await call('/api/auth/request', { method: 'POST', body: { identifier: `fail.${Date.now()}@example.com` } });
String(emailFailure.json?.delivery?.detail ?? '').includes('validation_error')
  ? ok('the Resend failure reason is carried through', String(emailFailure.json.delivery.detail))
  : bad('the Resend failure reason is carried through', String(emailFailure.json?.delivery?.detail));
resendFailure = null;

/* ── 5. With nothing configured, the truth is told ─────────────────────── */
section('5. No provider means an honest answer, not a false one');

stopGateway();
await new Promise((resolve) => setTimeout(resolve, 600));
gatewayLog = '';
gateway = startGateway({
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_MESSAGING_SERVICE_SID: '',
  TWILIO_FROM_NUMBER: '',
  RESEND_API_KEY: '',
});
if (!(await waitForHealth())) {
  bad('the gateway restarted with no providers', gatewayLog.slice(-140));
} else {
  const none = await call('/api/auth/request', { method: 'POST', body: { identifier: 'nobody@example.com' } });
  none.json?.delivery?.delivered === false
    ? ok('delivery is reported as not delivered')
    : bad('delivery is reported as not delivered', JSON.stringify(none.json?.delivery));
  none.json?.delivery?.transport === 'log'
    ? ok('the transport is named as log', 'no provider is pretending to work')
    : bad('the transport is named as log', String(none.json?.delivery?.transport));

  const health = await call('/api/health');
  health.json?.auth?.delivery?.sms === false && health.json?.auth?.delivery?.email === false
    ? ok('health reports the channels as unconfigured', JSON.stringify(health.json.auth.delivery))
    : bad('health reports the channels as unconfigured', JSON.stringify(health.json?.auth?.delivery));

  // With no provider, a development code may still be exposed so local work is
  // possible — that is the documented escape hatch, and it is off by default here.
  none.json?.devCode === undefined
    ? ok('no development code leaks when exposure is disabled')
    : bad('no development code leaks when exposure is disabled', 'devCode was present');

  const smsMissing = await call('/api/auth/request', { method: 'POST', body: { identifier: '+15550000444' } });
  smsMissing.status === 200
    ? ok('a phone request without SMS configured still answers', 'reported as undelivered')
    : bad('a phone request without SMS configured still answers', `status ${smsMissing.status}`);
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entryRef) => console.log(`    \u001b[31m· ${entryRef}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
stopGateway();
try {
  provider.close();
} catch {
  /* already closed */
}
process.exit(fail === 0 ? 0 : 1);
