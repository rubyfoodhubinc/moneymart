#!/usr/bin/env node
/**
 * MoneyMart — mobile photo capture, verified against the real API.
 *
 * The mobile seller flow could not create a listing at all: it fabricated an SVG
 * placeholder and the API refuses SVG, so every publish failed. The fix opens a
 * real picker, but the part that actually breaks is the conversion — and it broke
 * precisely because nothing checked it against the API that consumes the result.
 *
 * So this suite does not mock anything. It builds the exact assets an image picker
 * returns, runs them through the SAME `prepareImage` the two screens use, and posts
 * the outcome to a real gateway to see whether it is accepted. Several of these
 * cases fail against the API for reasons that no amount of reading the picker's
 * documentation would reveal:
 *
 *   • `image/jpg` is not a registered type, and the API's byte sniff returns
 *     `image/jpeg`, so passing it through fails a declared-versus-actual check
 *   • base64 inflates a payload by a third, so a 2.4 MB photograph is under the
 *     3 MB ceiling as a file and over it once encoded
 *   • a picker that returns only a file URI must be forwarded, not fabricated into
 *     a data URI from a path we cannot read
 *
 * The remaining gap is stated rather than hidden: this does not open a real camera
 * or photo library. That needs a device or a simulator with native pods, and it is
 * the one step in this path a test cannot take.
 *
 * Usage: node scripts/verify-mobile-photos.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MM_PHOTOS_PORT ?? 4680);
const API = `http://127.0.0.1:${PORT}`;

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

console.log('\n\u001b[1m════════ MoneyMart mobile photo capture ════════\u001b[0m');
console.log(`\u001b[2m  api ${API}\u001b[0m`);

/** The module under test, imported exactly as the screens import it. */
const { mobileImages } = await import(path.join(repoRoot, 'apps', 'mobile', 'src', 'lib', 'images.ts'));
const { prepareImage, canonicalMime, canAddImage, MAX_IMAGE_BYTES } = mobileImages;

const entry = path.join(repoRoot, 'services', 'api', 'dist', 'services', 'api', 'src', 'index.js');
if (!existsSync(entry)) {
  console.log('\n  \u001b[31m✘\u001b[0m the compiled API is missing. Run pnpm build:api\n');
  process.exit(1);
}

const gateway = spawn(process.execPath, [entry], {
  cwd: path.join(repoRoot, 'services', 'api'),
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development', MM_SEED: 'true', MM_PERSISTENCE: 'off', MM_AUTH_DEV_CODES: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let gatewayLog = '';
gateway.stdout.on('data', (chunk) => (gatewayLog += chunk));
gateway.stderr.on('data', (chunk) => (gatewayLog += chunk));

const cleanup = () => {
  try {
    gateway.kill('SIGKILL');
  } catch {
    /* already dead */
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
for (let attempt = 0; attempt < 100; attempt += 1) {
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
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

/* ── Real image bytes, built here so the sniff has something true to find ── */

/** A valid 1×1 PNG. */
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** A JPEG built from a minimal SOI/APP0/EOI sequence, enough for the magic sniff. */
const jpegBase64 = (() => {
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9];
  return Buffer.from(bytes).toString('base64');
})();

/** Padding that keeps a real PNG header but grows the payload. */
const paddedPng = (targetBytes) => {
  const head = Buffer.from(PNG_1PX, 'base64');
  const padding = Buffer.alloc(Math.max(0, targetBytes - head.length), 0x41);
  return Buffer.concat([head, padding]).toString('base64');
};

const list = (images, title) =>
  call('/api/auctions', {
    method: 'POST',
    headers: { 'x-mm-user': 'usr_ada' },
    body: {
      title: title ?? `Photo probe ${Date.now()}`,
      description: 'Created by the mobile photo verification suite',
      categoryId: 'watches',
      condition: 'good',
      auctionType: 'flash',
      startingPrice: 100,
      durationDays: 1,
      images,
    },
  });

/* ── 1. The picker's own quirks ────────────────────────────────────────── */
section('1. The picker reports a type that must be normalised');

canonicalMime('image/jpg') === 'image/jpeg'
  ? ok('image/jpg is normalised to image/jpeg', 'not a registered type')
  : bad('image/jpg is normalised to image/jpeg', canonicalMime('image/jpg'));

canonicalMime('IMAGE/JPEG') === 'image/jpeg'
  ? ok('a type is matched case-insensitively')
  : bad('a type is matched case-insensitively', canonicalMime('IMAGE/JPEG'));

canonicalMime(undefined) === 'image/jpeg'
  ? ok('an absent type falls back to jpeg')
  : bad('an absent type falls back to jpeg', canonicalMime(undefined));

canonicalMime('image/heic') === 'image/jpeg'
  ? ok('an unsupported type is not passed through', 'HEIC is re-declared, and the byte sniff decides')
  : bad('an unsupported type is not passed through', canonicalMime('image/heic'));

/* ── 2. Preparing a healthy asset ──────────────────────────────────────── */
section('2. A normal photograph is prepared and accepted');

const good = prepareImage({ base64: PNG_1PX, mimeType: 'image/png' });
good.ok ? ok('a PNG asset is prepared', `${good.bytes} bytes`) : bad('a PNG asset is prepared', good.reason);

const accepted = await list([good.ok ? good.value : '']);
accepted.status === 201
  ? ok('the API accepts what the app produces', `lot ${accepted.json?.auction?.id}`)
  : bad('the API accepts what the app produces', `status ${accepted.status} ${accepted.json?.detail ?? ''}`);

/**
 * The mismatch case, which is the one that actually bit: a picker reports JPEG for
 * PNG bytes. The API sniffs the bytes and refuses a disagreement, so the declared
 * type must be derived from what the picker really captured.
 */
const mismatched = prepareImage({ base64: PNG_1PX, mimeType: 'image/jpeg' });
const mismatchResult = await list([mismatched.ok ? mismatched.value : '']);
mismatchResult.status === 400
  ? ok('a declared type that disagrees with the bytes is caught', String(mismatchResult.json?.detail).slice(0, 58))
  : bad('a declared type that disagrees with the bytes is caught', `status ${mismatchResult.status}`);

// And `image/jpg` — the spelling the picker uses for a real JPEG — must survive.
const jpg = prepareImage({ base64: jpegBase64, mimeType: 'image/jpg' });
const jpgResult = await list([jpg.ok ? jpg.value : '']);
jpgResult.status === 201
  ? ok('an image reported as image/jpg is accepted', 'normalised to image/jpeg')
  : bad('an image reported as image/jpg is accepted', `status ${jpgResult.status} ${jpgResult.json?.detail ?? ''}`);

/* ── 3. Size, measured on raw bytes not the encoded string ─────────────── */
section('3. Size is measured the way the API measures it');

/**
 * 2.4 MB of raw bytes is under the 3 MB limit as a FILE and over it once base64 has
 * added its third. The server measures the encoded string, so a client that measures
 * raw bytes accepts this and the server refuses it — which is exactly what happened
 * before this check existed.
 */
const borderline = prepareImage({ base64: paddedPng(2_400_000), mimeType: 'image/png' });
!borderline.ok
  ? ok('a photograph that is over the limit only once encoded is refused locally', borderline.reason.slice(0, 60))
  : bad('a photograph that is over the limit only once encoded is refused locally', `accepted ${(borderline.value.length / 1_000_000).toFixed(2)} MB encoded`);

// And the API agrees, so the client limit is not stricter than the server's.
const shippedBorderline = await list([paddedPng(2_400_000)]);
shippedBorderline.status === 400
  ? ok('the API refuses the same photograph, so the limits agree', String(shippedBorderline.json?.detail).slice(0, 44))
  : bad('the API refuses the same photograph, so the limits agree', `status ${shippedBorderline.status}`);

// A photograph that fits ENCODED must still be accepted by both.
const fits = prepareImage({ base64: paddedPng(1_800_000), mimeType: 'image/png' });
fits.ok
  ? ok('a photograph that fits once encoded is accepted locally', `${(fits.value.length / 1_000_000).toFixed(2)} MB encoded`)
  : bad('a photograph that fits once encoded is accepted locally', fits.reason);

if (fits.ok) {
  const acceptedFits = await list([fits.value]);
  acceptedFits.status === 201
    ? ok('the API accepts it too', 'client and server limits agree in both directions')
    : bad('the API accepts it too', `status ${acceptedFits.status} ${acceptedFits.json?.detail ?? ''}`);
}

// Over the ceiling must be refused locally, with a reason worth showing.
const tooLarge = prepareImage({ base64: paddedPng(3_500_000), mimeType: 'image/png' });
!tooLarge.ok && /limit|MB/i.test(tooLarge.reason)
  ? ok('an oversized photograph is refused with a usable reason', tooLarge.reason.slice(0, 58))
  : bad('an oversized photograph is refused with a usable reason', tooLarge.ok ? 'it was accepted' : tooLarge.reason);

// The API must agree, so the local limit is not arbitrary.
const shipped = await list([paddedPng(3_500_000)]);
shipped.status === 400
  ? ok('the API refuses the same photograph', String(shipped.json?.detail).slice(0, 52))
  : bad('the API refuses the same photograph', `status ${shipped.status}`);

/* ── 4. Degenerate assets ──────────────────────────────────────────────── */
section('4. Broken assets are refused locally, not at the API');

const cases = [
  [null, 'no asset'],
  [{ base64: null, uri: 'file:///tmp/x.jpg' }, 'a file URI with no bytes'],
  [{ base64: '' }, 'an empty payload'],
  [{ base64: '   ' }, 'whitespace only'],
  [{ base64: 'data:image/png;base64,' }, 'a data URI with no payload'],
];

let refusedLocally = 0;
for (const [asset, label] of cases) {
  const result = prepareImage(asset);
  if (!result.ok) refusedLocally += 1;
  else console.log(`      \u001b[2m${label} was accepted\u001b[0m`);
}
refusedLocally === cases.length
  ? ok('every degenerate asset is refused before a request is made', `${refusedLocally}/${cases.length}`)
  : bad('every degenerate asset is refused before a request is made', `${refusedLocally}/${cases.length}`);

// A caller cannot be told to "fix" a photo that never existed.
const missing = prepareImage(null);
!missing.ok && /choose|selected|read/i.test(missing.reason)
  ? ok('the reason is phrased for the person holding the phone', missing.reason)
  : bad('the reason is phrased for the person holding the phone', missing.ok ? 'accepted' : missing.reason);

/* ── 5. A picker that returns only a URI ───────────────────────────────── */
section('5. A URI-only asset is forwarded, not fabricated');

const remote = prepareImage({ base64: null, uri: 'https://cdn.example.com/photo.jpg', mimeType: null });
remote.ok && /^https:\/\//.test(remote.value)
  ? ok('an https asset is forwarded unchanged')
  : bad('an https asset is forwarded unchanged', remote.ok ? remote.value : remote.reason);

/**
 * Forwarding a remote reference is right; inventing a data URI from a local path we
 * cannot read is not. The API accepts an http(s) URL, so that is what is passed on.
 */
const forwarded = await list([remote.ok ? remote.value : '']);
forwarded.status === 201
  ? ok('the API accepts the forwarded reference')
  : bad('the API accepts the forwarded reference', `status ${forwarded.status} ${forwarded.json?.detail ?? ''}`);

/* ── 6. The count is guarded before the API has to refuse ──────────────── */
section('6. The image count is guarded locally');

canAddImage(0) && canAddImage(19)
  ? ok('adding is permitted below the limit')
  : bad('adding is permitted below the limit');

!canAddImage(20)
  ? ok('adding is refused at twenty, which is the API limit')
  : bad('adding is refused at twenty, which is the API limit');

// Twenty-one images must be refused by the API too, so the client guard matches.
const twentyOne = await list(Array.from({ length: 21 }, () => `data:image/png;base64,${PNG_1PX}`));
twentyOne.status === 400 && /at most/i.test(twentyOne.json?.detail ?? '')
  ? ok('the API refuses a twenty-first image', twentyOne.json.detail)
  : bad('the API refuses a twenty-first image', `status ${twentyOne.status} ${twentyOne.json?.detail ?? ''}`);

/* ── 7. The fabricator is gone from the sources ────────────────────────── */
section('7. The fabricated placeholder cannot return');

const sellSource = readFileSync(path.join(repoRoot, 'apps', 'mobile', 'src', 'screens', 'SellScreen.tsx'), 'utf8');
!/const seed = String\(photos\.length/.test(sellSource)
  ? ok('the sell screen no longer fabricates a placeholder image')
  : bad('the sell screen no longer fabricates a placeholder image', 'the generator is still present');

/data:image\/svg\+xml/.test(sellSource)
  ? bad('the sell screen sends no SVG, which the API refuses')
  : ok('the sell screen sends no SVG, which the API refuses');

// Both screens must share one implementation, or they will drift apart again.
const setupSource = readFileSync(path.join(repoRoot, 'apps', 'mobile', 'src', 'screens', 'ProfileSetupScreen.tsx'), 'utf8');
/from '@\/lib\/images'/.test(sellSource) && /from '@\/lib\/images'/.test(setupSource)
  ? ok('both screens share one conversion implementation')
  : bad('both screens share one conversion implementation');

/* ── 8. Stated limits ──────────────────────────────────────────────────── */
section('8. What this suite does not cover');

ok(
  'the camera and photo library are NOT exercised here',
  'opening them needs a device or a simulator with native pods; CocoaPods is not installed in this environment',
);

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entryRef) => console.log(`    \u001b[31m· ${entryRef}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════════\u001b[0m\n');
cleanup();
process.exit(fail === 0 ? 0 : 1);
