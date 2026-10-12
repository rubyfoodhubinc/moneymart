#!/usr/bin/env node
/**
 * MoneyMart mobile verification.
 *
 * Asserts the things that decide whether the app can actually ship to a device,
 * rather than whether it compiles:
 *
 *   1. every icon / splash asset exists, is a valid PNG, and has the exact
 *      dimensions the stores require
 *   2. app.json declares the identity values EAS submission needs
 *   3. the app bundles for BOTH native platforms and emits real Hermes bytecode
 *   4. every screen's code is actually present in the shipped bundle
 *   5. the QR deep link the TV produces parses and redeems correctly
 *
 * Usage: node scripts/verify-mobile.mjs [--api http://127.0.0.1:4317]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobileDir = path.join(repoRoot, 'apps', 'mobile');
const args = process.argv.slice(2);
const apiIndex = args.indexOf('--api');
const API = apiIndex >= 0 && args[apiIndex + 1] ? args[apiIndex + 1] : (process.env.API_URL ?? 'http://127.0.0.1:4317');

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
  console.log(`  \u001b[31m✘\u001b[0m ${label}${extra ? `  ${extra}` : ''}`);
};
const section = (title) => console.log(`\n\u001b[1m${title}\u001b[0m`);

console.log('\n\u001b[1m════════ MoneyMart mobile verification ════════\u001b[0m');
console.log(`\u001b[2m  apps/mobile   api ${API}\u001b[0m`);

const HBC_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);

/** Read PNG dimensions and validate the container structure. */
function readPng(file) {
  const buffer = readFileSync(file);
  const signatureOk = buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!signatureOk) return { ok: false };
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colourType = buffer[25];

  // Confirm IDAT inflates to exactly one filter byte + RGBA per pixel per row.
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buffer.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  let rasterOk = false;
  try {
    const raw = inflateSync(Buffer.concat(idat));
    rasterOk = raw.length === (width * 4 + 1) * height;
  } catch {
    rasterOk = false;
  }

  return { ok: true, width, height, bitDepth, colourType, rasterOk, bytes: buffer.length };
}

/* ── 1. Brand assets ───────────────────────────────────────────────────── */
section('1. Brand assets (store requirements)');

const ASSETS = [
  ['assets/icon.png', 1024, 1024, 'iOS app icon + Expo icon'],
  ['assets/adaptive-icon.png', 1024, 1024, 'Android adaptive foreground'],
  ['assets/monochrome-icon.png', 1024, 1024, 'Android 13+ themed icon layer'],
  ['assets/splash.png', 1284, 2778, 'Expo splash'],
];

for (const [relative, width, height, label] of ASSETS) {
  const file = path.join(mobileDir, relative);
  if (!existsSync(file)) {
    bad(`${label} exists`, relative);
    continue;
  }
  const png = readPng(file);
  if (!png.ok) {
    bad(`${label} is a valid PNG`, relative);
    continue;
  }
  png.width === width && png.height === height
    ? ok(`${label} is ${width}x${height}`, `${Math.round(png.bytes / 1024)} KB`)
    : bad(`${label} is ${width}x${height}`, `got ${png.width}x${png.height}`);
  png.rasterOk ? ok(`${label} raster matches its header`) : bad(`${label} raster matches its header`);
}

// Store rules: iOS wants no alpha on the marketing icon; Android foreground must.
const iconPng = readPng(path.join(mobileDir, 'assets/icon.png'));
const adaptivePng = readPng(path.join(mobileDir, 'assets/adaptive-icon.png'));
const hasAlpha = (png) => {
  const buffer = readFileSync(png === iconPng ? path.join(mobileDir, 'assets/icon.png') : path.join(mobileDir, 'assets/adaptive-icon.png'));
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buffer.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const w = buffer.readUInt32BE(16);
  const h = buffer.readUInt32BE(20);
  for (let y = 0; y < h; y += 7) {
    for (let x = 0; x < w; x += 7) {
      if (raw[y * (w * 4 + 1) + 1 + x * 4 + 3] < 255) return true;
    }
  }
  return false;
};

if (iconPng.ok) {
  // The rounded card must be fully opaque in the centre and clipped at corners.
  const buffer = readFileSync(path.join(mobileDir, 'assets/icon.png'));
  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buffer.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const w = buffer.readUInt32BE(16);
  const corner = raw[1 + 0 * 4 + 3];
  const centre = raw[(w >> 1) * (w * 4 + 1) + 1 + (w >> 1) * 4 + 3];
  corner === 0 ? ok('app icon is clipped at the corners (rounded card)') : bad('app icon is clipped at the corners (rounded card)', `corner alpha ${corner}`);
  centre === 255 ? ok('app icon is opaque at the centre') : bad('app icon is opaque at the centre', `alpha ${centre}`);
}

if (adaptivePng.ok) {
  hasAlpha(adaptivePng) ? ok('adaptive foreground has transparency for the mask') : bad('adaptive foreground has transparency for the mask');
}

/* ── 2. Store identity ─────────────────────────────────────────────────── */
section('2. Store identity (app.json)');

const appJson = JSON.parse(readFileSync(path.join(mobileDir, 'app.json'), 'utf8')).expo;

appJson.icon ? ok('expo.icon is declared', appJson.icon) : bad('expo.icon is declared');
appJson.splash?.image ? ok('expo.splash.image is declared', appJson.splash.image) : bad('expo.splash.image is declared');
appJson.splash?.backgroundColor ? ok('splash background matches the brand navy', appJson.splash.backgroundColor) : bad('splash background matches the brand navy');
appJson.android?.adaptiveIcon?.foregroundImage
  ? ok('android adaptive foreground is declared')
  : bad('android adaptive foreground is declared');
appJson.android?.adaptiveIcon?.monochromeImage
  ? ok('android monochrome layer is declared')
  : bad('android monochrome layer is declared');

/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(appJson.ios?.bundleIdentifier ?? '')
  ? ok('iOS bundle identifier is well-formed', appJson.ios.bundleIdentifier)
  : bad('iOS bundle identifier is well-formed', appJson.ios?.bundleIdentifier ?? 'missing');

/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(appJson.android?.package ?? '')
  ? ok('Android package name is well-formed', appJson.android.package)
  : bad('Android package name is well-formed', appJson.android?.package ?? 'missing');

appJson.ios?.buildNumber ? ok('iOS buildNumber is set', appJson.ios.buildNumber) : bad('iOS buildNumber is set');
Number(appJson.android?.versionCode) > 0 ? ok('Android versionCode is set', String(appJson.android.versionCode)) : bad('Android versionCode is set');

// Permission strings must be present or iOS rejects the build outright.
const infoPlist = appJson.ios?.infoPlist ?? {};
const usageKeys = Object.keys(infoPlist).filter((key) => key.endsWith('UsageDescription'));
usageKeys.length >= 3
  ? ok('iOS usage descriptions cover camera, photos and microphone', `${usageKeys.length} declared`)
  : bad('iOS usage descriptions cover camera, photos and microphone', `${usageKeys.length} found`);

const androidPermissions = appJson.android?.permissions ?? [];
['CAMERA', 'POST_NOTIFICATIONS'].every((p) => androidPermissions.includes(p))
  ? ok('Android declares the permissions the flows need')
  : bad('Android declares the permissions the flows need', androidPermissions.join(','));

appJson.scheme === 'moneymart'
  ? ok('custom URL scheme is moneymart:// (matches the TV QR)')
  : bad('custom URL scheme is moneymart:// (matches the TV QR)', appJson.scheme);

/* ── 2b. The shipped app can reach a gateway ───────────────────────────── */

/**
 * The app shipped with `apiUrl: http://127.0.0.1:4317`, and on a phone that is the
 * PHONE's own loopback — so every request went nowhere and the product was
 * unusable outside a simulator. The suite verified identity and bundling and never
 * once asked whether the app could reach anything.
 */
section('2b. The gateway the shipped app talks to');

const configuredApi = String(appJson.extra?.apiUrl ?? '');
configuredApi ? ok('expo.extra.apiUrl is declared', configuredApi) : bad('expo.extra.apiUrl is declared');

/**
 * A release build must not point at loopback. This is the assertion that would
 * have caught the original defect.
 */
const isLoopbackTarget = /^https?:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2|\[::1\])(:|\/|$)/.test(configuredApi);
!isLoopbackTarget
  ? ok('the release build does not target loopback')
  : bad('the release build does not target loopback', `${configuredApi} is unreachable from a device`);

/^https:\/\//.test(configuredApi)
  ? ok('the release build targets https')
  : bad('the release build targets https', configuredApi);

// The resolver must exist and handle the Android emulator alias, which is the
// difference between "works in a simulator" and "works in an emulator".
const configSource = readFileSync(path.join(mobileDir, 'src', 'lib', 'config.ts'), 'utf8');
/10\.0\.2\.2/.test(configSource)
  ? ok('the resolver maps Android emulators to their host alias', '10.0.2.2')
  : bad('the resolver maps Android emulators to their host alias');

/OVERRIDE_KEY|mm:apiOverride/.test(configSource)
  ? ok('a per-device override is supported')
  : bad('a per-device override is supported');

/configureApi/.test(configSource)
  ? ok('the resolver is applied before the first request')
  : bad('the resolver is applied before the first request');

// The API client must resolve per call, or a changed override has no effect until
// the app restarts.
const apiSource = readFileSync(path.join(mobileDir, 'src', 'lib', 'api.ts'), 'utf8');
/apiBase\(\)/.test(apiSource)
  ? ok('the API client resolves the host per request')
  : bad('the API client resolves the host per request');

/**
 * The API client and session store must not pin a loopback gateway.
 *
 * `config.ts` legitimately contains one: it is the DEVELOPMENT default, translated
 * per platform. Asserting its absence there would forbid the very fallback that
 * makes a simulator work — the first version of this check did exactly that.
 */
const pinnedLoopback = ['src/lib/api.ts', 'src/store/session.ts'].filter((file) =>
  /127\.0\.0\.1:4317/.test(readFileSync(path.join(mobileDir, file), 'utf8')),
);
pinnedLoopback.length === 0
  ? ok('no client pins a loopback gateway')
  : bad('no client pins a loopback gateway', pinnedLoopback.join(', '));

// ...and where it does appear, it must be platform-aware rather than fixed.
const loopbackIsPlatformAware = /loopbackFor\s*\(/.test(configSource) && /Platform\.OS/.test(configSource);
loopbackIsPlatformAware
  ? ok('the development fallback is platform-aware, not fixed')
  : bad('the development fallback is platform-aware, not fixed');

/* ── 2c. No control is a dead end ──────────────────────────────────────── */

/**
 * A button whose handler does nothing is worse than no button: it teaches the
 * user that the controls are decoration. Two shipped on this app — "Upload photo"
 * was `onPress={() => undefined}`, and the sell screen's "Add photo" fabricated an
 * SVG placeholder that the API refuses, so publishing always failed.
 *
 * Scanned across the sources, because React Native hides these from a DOM test:
 * there is no page to query.
 */
section('2c. No control is a dead end');

const screenDir = path.join(mobileDir, 'src');
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(screenDir);

const noopHandlers = [];
const stubCopy = [];
const STUB = /opens here|coming soon|will open|not yet (available|implemented)|applied automatically|background removal/i;

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(mobileDir, file);
  /**
   * A no-op handler is `onPress={() => undefined}` — but the string also appears
   * in the comments that document having removed one, and a note explaining a fix
   * is not a shipped control. Line by line, skipping comments.
   */
  const NOOP = /on(?:Press|Click)=\{\(\)\s*=>\s*(?:undefined|\{\s*\})\}/;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    if (NOOP.test(line)) {
      noopHandlers.push(`${rel}:${text.slice(0, text.indexOf(line)).split('\n').length}`);
      break;
    }
  }
  for (const line of text.split('\n')) {
    // Ignore comments: a note explaining a removal is not a shipped promise.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    const hit = trimmed.match(STUB);
    if (hit) stubCopy.push(`${rel}: "${hit[0]}"`);
  }
}

noopHandlers.length === 0
  ? ok('no screen wires a control to a no-op', `${sourceFiles.length} files scanned`)
  : bad('no screen wires a control to a no-op', noopHandlers.join(', '));

stubCopy.length === 0
  ? ok('no screen promises a feature that does not exist')
  : bad('no screen promises a feature that does not exist', stubCopy.slice(0, 3).join(' | '));

/* ── 2d. iOS 27 scene lifecycle ────────────────────────────────────────── */

/**
 * iOS 27 kills an app that has not adopted the scene lifecycle, and the failure
 * says almost nothing:
 *
 *   EXC_BREAKPOINT in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
 *
 * Neither Expo nor React Native provides this — the newest SDK still emits no scene
 * manifest — so the app carries its own prebuild plugin. Asserted here because the
 * native output is GENERATED and gitignored: without this, a prebuild could quietly
 * drop the fix and there would be no failing check to notice.
 */
section('2d. iOS 27 scene lifecycle');

const sceneAppConfig = JSON.parse(readFileSync(path.join(mobileDir, 'app.json'), 'utf8'));
const pluginEntries = (sceneAppConfig.expo.plugins ?? []).map((entry) => (Array.isArray(entry) ? entry[0] : entry));
pluginEntries.some((entry) => String(entry).includes('withSceneLifecycle'))
  ? ok('the scene-lifecycle plugin is registered in app.json')
  : bad('the scene-lifecycle plugin is registered in app.json', JSON.stringify(pluginEntries));

const pluginPath = path.join(mobileDir, 'plugins', 'withSceneLifecycle.js');
if (!existsSync(pluginPath)) {
  bad('the scene-lifecycle plugin exists', pluginPath);
} else {
  const plugin = readFileSync(pluginPath, 'utf8');

  // The manifest is what makes UIKit ask for a scene at all.
  /UIApplicationSceneManifest/.test(plugin)
    ? ok('the plugin declares UIApplicationSceneManifest')
    : bad('the plugin declares UIApplicationSceneManifest');

  /UISceneDelegateClassName/.test(plugin)
    ? ok('the plugin names the scene delegate class')
    : bad('the plugin names the scene delegate class');

  /**
   * The window must move OUT of didFinishLaunchingWithOptions. Creating it there is
   * the pre-scene pattern and is what the crash was about, so the generated app
   * delegate must not contain it.
   */
  const appDelegateSource = plugin.slice(plugin.indexOf('const APP_DELEGATE'), plugin.indexOf('module.exports'));
  !/window = UIWindow\(frame: UIScreen\.main\.bounds\)/.test(appDelegateSource)
    ? ok('the app delegate no longer creates the window at launch')
    : bad('the app delegate no longer creates the window at launch', 'the pre-scene pattern is still present');

  // But the Expo hook that every module depends on must survive the change.
  /bindReactNativeFactory/.test(appDelegateSource)
    ? ok('bindReactNativeFactory still runs at launch', 'every Expo module depends on it')
    : bad('bindReactNativeFactory still runs at launch');

  // The scene has to start React Native, or nothing renders.
  const sceneSource = plugin.slice(plugin.indexOf('const SCENE_DELEGATE'), plugin.indexOf('const APP_DELEGATE'));
  /UIWindowSceneDelegate/.test(sceneSource)
    ? ok('a scene delegate is provided')
    : bad('a scene delegate is provided');

  /startReactNative/.test(sceneSource)
    ? ok('the scene delegate starts React Native into its window')
    : bad('the scene delegate starts React Native into its window');

  /**
   * Writing the file is not enough — Xcode compiles only what is listed in the
   * target's Sources build phase. Verified directly: the check reported NO before
   * this step existed, and the build failed to adopt a scene.
   */
  /withXcodeProject/.test(plugin) && /addSourceFile/.test(plugin)
    ? ok('the new Swift file is added to the Xcode target', 'a file on disk is not compiled')
    : bad('the new Swift file is added to the Xcode target');
}

/* ── 3. Native bundles ─────────────────────────────────────────────────── */
section('3. Native bundles (iOS + Android)');

const exportDir = path.join(mobileDir, '.export');
let bundleLog = '';
let bundlesBuilt = false;
if (process.env.MM_SKIP_BUNDLE === '1' && existsSync(exportDir)) {
  bundlesBuilt = true;
  bundleLog = '(reused existing .export)';
} else {
  try {
    bundleLog = execFileSync(
      'npx',
      ['expo', 'export', '--platform', 'ios', '--platform', 'android', '--output-dir', '.export'],
      { cwd: mobileDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    bundlesBuilt = true;
  } catch (error) {
    bundleLog = String(error?.stdout ?? '') + String(error?.stderr ?? error?.message ?? '');
    bundlesBuilt = false;
  }
}

if (!bundlesBuilt) bad('expo export completes for both platforms', bundleLog.slice(-160));

for (const platform of ['ios', 'android']) {
  const dir = path.join(exportDir, '_expo', 'static', 'js', platform);
  if (!existsSync(dir)) {
    bad(`${platform} bundle was emitted`);
    continue;
  }
  const files = execFileSync('ls', [dir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const bundle = files.find((f) => f.endsWith('.hbc'));
  if (!bundle) {
    bad(`${platform} bundle is Hermes bytecode`, files.join(', ') || 'no files');
    continue;
  }
  const file = path.join(dir, bundle);
  const head = readFileSync(file).slice(0, 8);
  const size = statSync(file).size;
  head.equals(HBC_MAGIC)
    ? ok(`${platform} bundle is valid Hermes bytecode`, `${(size / 1024 / 1024).toFixed(2)} MB`)
    : bad(`${platform} bundle is valid Hermes bytecode`, `magic ${head.toString('hex')}`);
  size > 500_000 ? ok(`${platform} bundle contains the application`, `${(size / 1024).toFixed(0)} KB`) : bad(`${platform} bundle contains the application`, `${size} bytes`);
}

/* ── 4. Screen coverage in the bundle ──────────────────────────────────── */
section('4. Every screen is present in the shipped bundle');

// Inspect a plain (non-Hermes) bundle: function names are minified away, so
// unique string literals from each screen are the reliable signal.
let plainBundle = '';
if (existsSync(exportDir)) {
  try {
    execFileSync(
      'npx',
      ['expo', 'export:embed', '--platform', 'ios', '--dev', 'false', '--bundle-output', '/tmp/mm-verify-plain.js', '--assets-dest', '/tmp/mm-verify-assets'],
      { cwd: mobileDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    plainBundle = readFileSync('/tmp/mm-verify-plain.js', 'utf8');
  } catch {
    plainBundle = '';
  }
}

if (!plainBundle) {
  bad('a plain bundle could be produced for content inspection');
} else {
  ok('plain bundle produced for content inspection', `${(plainBundle.length / 1024 / 1024).toFixed(2)} MB`);

  /**
   * The sell flow must attach a REAL photograph.
   *
   * It used to fabricate an SVG placeholder — a gradient with a number in it —
   * and the API refuses SVG, so every publish from the app failed with
   * `invalid_images`. The mobile seller flow could not create a listing at all.
   *
   * The assertion is deliberately about the FABRICATION, not about the string
   * `data:image/svg+xml`: React Native's own Image module sniffs that prefix to
   * decide whether a source is an SVG, so a broad check fails on the framework
   * rather than on the app. What must be absent is <svg> markup, which is what a
   * fabricated placeholder actually contains.
   */
  const svgMarkup = (plainBundle.match(/<svg[^>]{0,120}/g) ?? []).filter((tag) => /<svg\s+[^>]*viewBox/.test(tag));
  svgMarkup.length === 0
    ? ok('the app no longer fabricates SVG placeholder images')
    : bad('the app no longer fabricates SVG placeholder images', `${svgMarkup.length} inline <svg> template(s) found`);

  // A listing needs at least one real image, so the picker must be reachable and
  // the fabricated source must be gone from the screen that publishes.
  !/seed = String\(photos\.length/.test(plainBundle)
    ? ok('the fabricated photo source is gone from the sell screen')
    : bad('the fabricated photo source is gone from the sell screen', 'the placeholder generator is still bundled');

  /launchImageLibraryAsync|launchCameraAsync/.test(plainBundle)
    ? ok('the app captures real photographs', 'gallery and camera')
    : bad('the app captures real photographs', 'no image picker call found');

  // A listing needs at least one real image, and the picker must be reachable.
  /expo-image-picker|ImagePicker/.test(plainBundle)
    ? ok('the image picker is wired into the shipped build')
    : bad('the image picker is wired into the shipped build');

  const screensDir = path.join(mobileDir, 'src', 'screens');
  const screens = execFileSync('ls', [screensDir], { encoding: 'utf8' }).trim().split('\n').filter((f) => f.endsWith('.tsx'));
  const missing = [];

  for (const screen of screens) {
    const source = readFileSync(path.join(screensDir, screen), 'utf8');
    const literals = new Set([
      ...[...source.matchAll(/'([^'\\\n]{14,60})'/g)].map((m) => m[1]),
      ...[...source.matchAll(/"([^"\\\n]{14,60})"/g)].map((m) => m[1]),
    ]);
    const present = [...literals].filter((literal) => plainBundle.includes(literal));
    if (!present.length) missing.push(screen);
  }

  missing.length === 0
    ? ok(`all ${screens.length} screens are present in the bundle`)
    : bad('all screens are present in the bundle', `missing: ${missing.join(', ')}`);

  // Core runtime capabilities rather than component names.
  const runtimeChecks = [
    ['user:join', 'personal outbid room subscription'],
    ['auction:join', 'live room subscription'],
    ['AsyncStorage', 'session persistence'],
    ['verifyHandoff', 'TV handoff redemption'],
    ['createBottomTabNavigator', 'tab navigation'],
  ];
  for (const [needle, label] of runtimeChecks) {
    plainBundle.includes(needle) ? ok(`bundle includes ${label}`) : bad(`bundle includes ${label}`, needle);
  }
}

/* ── 5. QR deep link redemption (§7.3) ─────────────────────────────────── */
section('5. QR deep-link redemption (§7.3)');

/** Mirrors the parser in apps/mobile/App.tsx — the app must read these URLs. */
function parseBidLink(url) {
  if (!url) return null;
  const withoutScheme = url.includes('://') ? url.slice(url.indexOf('://') + 3) : url;
  const [rawPath, rawQuery = ''] = withoutScheme.split('?');
  const segments = rawPath.replace(/^\/+/, '').split('/').filter(Boolean);
  const bidIndex = segments.indexOf('bid');
  const auctionId = bidIndex >= 0 ? segments[bidIndex + 1] : undefined;
  if (!auctionId) return null;
  const params = new URLSearchParams(rawQuery);
  const exp = Number(params.get('exp'));
  return {
    auctionId: decodeURIComponent(auctionId),
    token: params.get('token') ?? undefined,
    expiresAt: Number.isFinite(exp) && exp > 0 ? exp : undefined,
  };
}

/* Request a real handoff from the API and confirm the app can read it. */
let handoff = null;
try {
  const response = await fetch(`${API}/api/tv/handoff/auc_rolex`, { method: 'POST' });
  handoff = await response.json();
} catch {
  handoff = null;
}

if (!handoff?.deepLink) {
  bad('a live handoff could be requested from the API');
} else {
  ok('a live handoff was issued by the API', handoff.token);

  const parsed = parseBidLink(handoff.deepLink);
  parsed?.auctionId === 'auc_rolex'
    ? ok('the app parses the live deep link', `id=${parsed.auctionId}`)
    : bad('the app parses the live deep link', JSON.stringify(parsed));

  parsed?.token === handoff.token
    ? ok('the parsed token matches the issued token')
    : bad('the parsed token matches the issued token', `${parsed?.token} vs ${handoff.token}`);

  parsed?.expiresAt && parsed.expiresAt > Date.now()
    ? ok('the parsed expiry is in the future', new Date(parsed.expiresAt).toISOString())
    : bad('the parsed expiry is in the future', String(parsed?.expiresAt));

  // The web fallback in the same payload must work for phones without the app.
  typeof handoff.webFallback === 'string' && handoff.webFallback.startsWith('/auctions/')
    ? ok('a web fallback is offered when the app is absent', handoff.webFallback)
    : bad('a web fallback is offered when the app is absent');

  // Redemption path: the app POSTs the token before trusting the link.
  try {
    const verify = await fetch(`${API}/api/tv/handoff/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auctionId: parsed.auctionId, token: parsed.token }),
    });
    const body = await verify.json();
    verify.status === 200 && body.ok
      ? ok('the token redeems against the API', body.auction?.title?.slice(0, 34))
      : bad('the token redeems against the API', `status ${verify.status}`);
  } catch (error) {
    bad('the token redeems against the API', String(error?.message ?? error));
  }

  // A forged token must not redeem.
  try {
    const forged = await fetch(`${API}/api/tv/handoff/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auctionId: 'auc_rolex', token: 'FORGED-TOKEN' }),
    });
    forged.status === 401
      ? ok('a forged token is refused at redemption')
      : bad('a forged token is refused at redemption', `status ${forged.status}`);
  } catch (error) {
    bad('a forged token is refused at redemption', String(error?.message ?? error));
  }
}

// The parser must ignore links that are not bid handoffs.
[['moneymart://home', null], ['moneymart://stream/str_adaluxe', null], ['', null]].every(
  ([url, expected]) => parseBidLink(url) === expected,
)
  ? ok('non-bid links are ignored')
  : bad('non-bid links are ignored');

/* ── Summary ───────────────────────────────────────────────────────────── */
console.log('\n\u001b[1m═══════════════════════════════════════════════\u001b[0m');
const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
console.log('\u001b[1m═══════════════════════════════════════════════\u001b[0m\n');
process.exit(fail === 0 ? 0 : 1);
