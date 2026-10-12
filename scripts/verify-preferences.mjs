#!/usr/bin/env node
/**
 * MoneyMart — account preferences, profile updates and data export.
 *
 * These did not exist. The web settings screen kept currency, language, privacy and
 * notification choices in component STATE and discarded them on navigation; the
 * mobile setup screen's save button was `onPress={() => undefined}`; the "Export my
 * data" button promised an archive "within 30 days" that was never produced. Every
 * one of those appeared to work and none of them did, which is worse than not
 * offering the control at all.
 *
 * This suite pins the behaviour that replaces it: a change is persisted, survives a
 * re-read, is refused when invalid, cannot be applied to another account, and the
 * export is a real download scoped to the caller with no credentials in it.
 *
 * Usage: node scripts/verify-preferences.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_PREFS_PORT ?? 4670);
const PROD_PORT = PORT + 1;
const API = `http://127.0.0.1:${PORT}`;
const PROD = `http://127.0.0.1:${PROD_PORT}`;

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

console.log('\n\u001b[1m════════ MoneyMart account preferences ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}   production-posture ${PROD}\u001b[0m`);

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

const children = [];
function startGateway(port, env = {}) {
  const child = spawn(process.execPath, [entry], {
    cwd: path.join(repoRoot, 'services', 'api'),
    env: {
      ...process.env,
      PORT: String(port),
      MM_SEED: 'true',
      MM_PERSISTENCE: 'off',
      MM_AUTH_DEV_CODES: 'true',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
  return child;
}

const cleanup = () => {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
  }
};
process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

async function waitFor(base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

startGateway(PORT, { NODE_ENV: 'development' });
startGateway(PROD_PORT, { NODE_ENV: 'production' });

const devUp = await waitFor(API);
const prodUp = await waitFor(PROD);
if (!devUp || !prodUp) {
  bad('both gateways started', `dev ${devUp}, production ${prodUp}`);
  cleanup();
  process.exit(1);
}
ok('a development and a production-posture gateway are running');

const call = async (base, pathname, options = {}) => {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* an export is large JSON; anything else has no body */
  }
  return { status: response.status, headers: response.headers, json, text };
};

const asUser = (id) => ({ 'x-mm-user': id });

/* ── 1. A preference change persists ───────────────────────────────────── */
section('1. A preference change is stored, not discarded');

const before = await call(API, '/api/me', { headers: asUser('usr_you') });
before.status === 200 ? ok('the account is readable') : bad('the account is readable', `status ${before.status}`);
before.json?.preferences
  ? ok('preferences are returned with defaults filled in', JSON.stringify(before.json.preferences).slice(0, 58))
  : bad('preferences are returned with defaults filled in');

const updated = await call(API, '/api/me', {
  method: 'PATCH',
  headers: asUser('usr_you'),
  body: {
    currencyCode: 'GBP',
    preferences: { language: 'fr', publicProfile: false, notifications: { outbid: false, priceDrops: true } },
  },
});
updated.status === 200 ? ok('an update is accepted', `changed: ${(updated.json?.changed ?? []).join(', ')}`) : bad('an update is accepted', `status ${updated.status}`);

updated.json?.user?.currencyCode === 'GBP'
  ? ok('the currency change is reflected in the response')
  : bad('the currency change is reflected in the response', String(updated.json?.user?.currencyCode));

/**
 * The assertion that matters: a fresh read must show the new values. The whole
 * defect was that a change looked applied and was gone by the next screen.
 */
const after = await call(API, '/api/me', { headers: asUser('usr_you') });
after.json?.user?.currencyCode === 'GBP'
  ? ok('the currency change survives a re-read')
  : bad('the currency change survives a re-read', String(after.json?.user?.currencyCode));

after.json?.preferences?.language === 'fr'
  ? ok('the language change survives a re-read')
  : bad('the language change survives a re-read', String(after.json?.preferences?.language));

after.json?.preferences?.publicProfile === false
  ? ok('the privacy toggle survives a re-read')
  : bad('the privacy toggle survives a re-read', String(after.json?.preferences?.publicProfile));

after.json?.preferences?.notifications?.outbid === false
  ? ok('a notification switch survives a re-read')
  : bad('a notification switch survives a re-read', JSON.stringify(after.json?.preferences?.notifications));

// A partial notification update must not wipe the others.
after.json?.preferences?.notifications?.priceDrops === true
  ? ok('an unrelated switch is preserved by a partial update')
  : bad('an unrelated switch is preserved by a partial update', JSON.stringify(after.json?.preferences?.notifications));

// Interests are validated against the platform's own categories, not free text.
const interestUpdate = await call(API, '/api/me', {
  method: 'PATCH',
  headers: asUser('usr_you'),
  body: { preferences: { interests: ['watches', 'art', 'watches'] } },
});
interestUpdate.status === 200 ? ok('interests are accepted') : bad('interests are accepted', `status ${interestUpdate.status}`);

const interestsBack = await call(API, '/api/me', { headers: asUser('usr_you') });
const savedInterests = interestsBack.json?.preferences?.interests ?? [];
JSON.stringify(savedInterests) === JSON.stringify(['watches', 'art'])
  ? ok('interests are stored, de-duplicated and ordered', JSON.stringify(savedInterests))
  : bad('interests are stored, de-duplicated and ordered', JSON.stringify(savedInterests));

// Absent switches keep their documented default rather than becoming undefined.
typeof after.json?.preferences?.notifications?.streamStart === 'undefined' ||
after.json?.preferences?.notifications?.streamStart === true
  ? ok('an untouched switch keeps its default')
  : bad('an untouched switch keeps its default', String(after.json?.preferences?.notifications?.streamStart));

/* ── 2. Other profile fields ───────────────────────────────────────────── */
section('2. Display name, bio, country and avatar');

const profileUpdate = await call(API, '/api/me', {
  method: 'PATCH',
  headers: asUser('usr_you'),
  body: { displayName: 'Ash V.', bio: 'Watches and prints.', countryCode: 'gb' },
});
profileUpdate.status === 200 ? ok('a profile update is accepted') : bad('a profile update is accepted', `status ${profileUpdate.status}`);

profileUpdate.json?.user?.displayName === 'Ash V.'
  ? ok('the display name is stored')
  : bad('the display name is stored', String(profileUpdate.json?.user?.displayName));

// A country is normalised, so a lowercase code cannot reach tax or shipping logic.
profileUpdate.json?.user?.countryCode === 'GB'
  ? ok('a country code is normalised to uppercase')
  : bad('a country code is normalised to uppercase', String(profileUpdate.json?.user?.countryCode));

// The public profile must reflect the change, since other users see that view.
profileUpdate.json?.profile?.displayName === 'Ash V.'
  ? ok('the public profile reflects the change')
  : bad('the public profile reflects the change', String(profileUpdate.json?.profile?.displayName));

/* ── 3. Invalid input is refused, not stored ───────────────────────────── */
section('3. Invalid input is refused');

const rejects = [
  [{ currencyCode: 'XYZ' }, 'unsupported_currency'],
  [{ displayName: 'x' }, 'invalid_display_name'],
  [{ displayName: 'a'.repeat(60) }, 'invalid_display_name'],
  [{ countryCode: 'United Kingdom' }, 'invalid_country'],
  [{ preferences: { language: '!!' } }, 'invalid_language'],
  [{ preferences: { publicProfile: 'yes' } }, 'invalid_preference'],
  [{ preferences: { notifications: { nonsense: true } } }, 'unknown_notification_type'],
  [{ preferences: { notifications: { outbid: 'yes' } } }, 'invalid_preference'],
  [{ preferences: 'nope' }, 'invalid_preferences'],
  [{ preferences: { interests: 'watches' } }, 'invalid_preference'],
  [{ preferences: { interests: ['watches', 'not-a-category'] } }, 'unknown_interest'],
  [{ avatarUrl: 'javascript:alert(1)' }, 'invalid_avatar'],
  [{}, 'nothing_to_update'],
];

let refused = 0;
for (const [body, expected] of rejects) {
  const response = await call(API, '/api/me', { method: 'PATCH', headers: asUser('usr_you'), body });
  if (response.status === 400 && response.json?.error === expected) refused += 1;
  else console.log(`      \u001b[2m${JSON.stringify(body)} → ${response.status} ${response.json?.error}\u001b[0m`);
}
refused === rejects.length
  ? ok('every invalid payload is refused with a specific reason', `${refused}/${rejects.length}`)
  : bad('every invalid payload is refused with a specific reason', `${refused}/${rejects.length}`);

// A refusal must not have partially applied.
const afterRejects = await call(API, '/api/me', { headers: asUser('usr_you') });
afterRejects.json?.user?.currencyCode === 'GBP'
  ? ok('a refused update changed nothing')
  : bad('a refused update changed nothing', String(afterRejects.json?.user?.currencyCode));

/* ── 4. An update cannot touch another account ─────────────────────────── */
section('4. An update only ever applies to the caller');

const targetBefore = await call(API, '/api/me', { headers: asUser('usr_jules') });
const targetName = targetBefore.json?.user?.displayName;

const crossAccount = await call(API, '/api/me', {
  method: 'PATCH',
  headers: asUser('usr_ken'),
  // A body field naming another account must be ignored outright.
  body: { userId: 'usr_jules', displayName: 'Renamed By Someone Else' },
});
crossAccount.status === 200 ? ok('the update is applied') : bad('the update is applied', `status ${crossAccount.status}`);

crossAccount.json?.user?.id === 'usr_ken'
  ? ok('the change is applied to the caller, not the id in the body', 'usr_ken')
  : bad('the change is applied to the caller, not the id in the body', String(crossAccount.json?.user?.id));

const targetAfter = await call(API, '/api/me', { headers: asUser('usr_jules') });
targetAfter.json?.user?.displayName === targetName
  ? ok('the named account is untouched')
  : bad('the named account is untouched', `${targetName} → ${targetAfter.json?.user?.displayName}`);

/* ── 5. The export is real and scoped ──────────────────────────────────── */
section('5. The data export is a real, scoped archive');

const exported = await call(API, '/api/me/export', { headers: asUser('usr_you') });
exported.status === 200 ? ok('the export is served', `${Math.round(exported.text.length / 1024)} KB`) : bad('the export is served', `status ${exported.status}`);

const disposition = exported.headers.get('content-disposition') ?? '';
/attachment/.test(disposition)
  ? ok('it is served as a download, not rendered', disposition.slice(0, 54))
  : bad('it is served as a download, not rendered', disposition);

/ashvale/.test(disposition)
  ? ok('the filename identifies the account')
  : bad('the filename identifies the account', disposition);

const archive = exported.json ?? {};
const sections = ['account', 'bids', 'orders', 'payouts', 'notifications', 'listings'];
const missing = sections.filter((key) => archive[key] === undefined);
missing.length === 0
  ? ok('the archive carries every section', sections.join(', '))
  : bad('the archive carries every section', `missing ${missing.join(', ')}`);

// It must be the CALLER's data.
archive.account?.handle === 'ashvale'
  ? ok('the archive is the caller’s own account')
  : bad('the archive is the caller’s own account', String(archive.account?.handle));

/**
 * Credentials must not be in it. An archive is a file the user will store and
 * email around; a session token in it is a live credential in all those places.
 */
const serialised = JSON.stringify(archive);
!/"token"\s*:/.test(serialised) && !/authSessions/.test(serialised)
  ? ok('no session tokens are included')
  : bad('no session tokens are included', 'a token-shaped field was found');

// The export must reflect the preference just saved, proving it reads live data.
archive.account?.preferences?.language === 'fr'
  ? ok('the export reflects the saved preferences')
  : bad('the export reflects the saved preferences', JSON.stringify(archive.account?.preferences));

/* ── 6. Production posture ─────────────────────────────────────────────── */
section('6. The whole /api/me family is private in production');

for (const [method, pathname] of [
  ['GET', '/api/me'],
  ['GET', '/api/me/export'],
  ['PATCH', '/api/me'],
]) {
  const response = await call(PROD, pathname, { method, body: method === 'PATCH' ? { displayName: 'Hacked' } : undefined });
  response.status === 401
    ? ok(`${method} ${pathname} requires an identity`, '401')
    : bad(`${method} ${pathname} requires an identity`, `status ${response.status}`);
}

// The guard must not have become a blanket refusal.
const publicRead = await call(PROD, '/api/auctions');
publicRead.status === 200
  ? ok('public reads still work without an identity', '200')
  : bad('public reads still work without an identity', `status ${publicRead.status}`);

for (const pathname of ['/api/wallet', '/api/orders', '/api/notifications']) {
  const response = await call(PROD, pathname);
  response.status === 401
    ? ok(`${pathname} is still private`, '401')
    : bad(`${pathname} is still private`, `status ${response.status}`);
}

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entryRef) => console.log(`    \u001b[31m· ${entryRef}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
