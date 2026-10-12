#!/usr/bin/env node
/**
 * MoneyMart — HLS playback proof.
 *
 * Asserts that the stream room actually plays, rather than that the code merely
 * compiles. The check drives real Chrome (via the DevTools Protocol) against a
 * page that uses the same hls.js bundle the app ships, and reads back what the
 * media element did: manifest parsed, fragments loaded, bytes buffered, frame
 * dimensions, and whether the clock advanced.
 *
 * Why this exists: an HLS integration can look correct and still be dead — a
 * wrong host (the seeded data previously pointed at a domain that does not
 * resolve), CORS on the manifest, or a codec the browser refuses. None of those
 * show up in a typecheck, and all of them are visible here.
 *
 * Usage: node scripts/verify-hls.mjs [--timeout 45000]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--timeout');
/**
 * Budget for the whole run.
 *
 * Manifests are proved one after another in a single page, so the wall-clock cost
 * grows with the number of sources. A fixed budget meant adding a source could fail
 * the suite for a reason that has nothing to do with playback — which is exactly what
 * happened when the self-hosted loops were added: it passed alone and timed out at
 * 60000ms inside the full audit, where the machine is busier.
 *
 * The per-manifest allowance is deliberately generous because a cold Chrome start and
 * a first manifest fetch dominate the cost.
 */
const PER_MANIFEST_MS = 25_000;
const OVERALL_TIMEOUT_MS = flagIndex >= 0 && args[flagIndex + 1]
  ? Number(args[flagIndex + 1])
  : 30_000 + PER_MANIFEST_MS * 4;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

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

/**
 * Every manifest the resolver can hand a room.
 *
 * They are read from engine/playback.ts rather than duplicated here, so adding a
 * source cannot silently escape verification — a manifest that is reachable but
 * undecodable is exactly the failure this suite exists to catch.
 */
function demoManifests() {
  const source = readFileSync(path.join(repoRoot, 'services', 'api', 'src', 'engine', 'playback.ts'), 'utf8');
  const block = source.slice(source.indexOf('DEMO_MANIFESTS'), source.indexOf(']', source.indexOf('DEMO_MANIFESTS')));
  return [...block.matchAll(/'(https:\/\/[^']+)'/g)].map((match) => match[1]);
}

/**
 * Media is served HERE, over the generated directory, rather than by an external
 * process: the suite then proves the media itself decodes without depending on a
 * gateway being up. The gateway's own route (which adds the CORS and cache headers)
 * is covered by the stream-room checks.
 *
 * `MM_HLS_ORIGIN` overrides this to point at a running deployment.
 */
const HLS_MEDIA_PREFERRED_PORT = Number(process.env.MM_HLS_PORT ?? 4322);

/**
 * Serve services/api/media, mapping /media/hls/<name>/<file> onto
 * media/hls/<name>/<file>.
 *
 * The first attempt at this served the media directory directly, which put the
 * playlists at /hls/... while the resolver builds /media/hls/..., so every request
 * 404'd and the manifest failed to load. Getting this mapping right is the whole
 * job of the server.
 */
function startMediaServer() {
  const mediaRoot = path.join(repoRoot, 'services', 'api', 'media');
  if (!existsSync(mediaRoot)) {
    bad('the generated HLS media exists', 'run `bash scripts/generate-hls.sh`');
    return null;
  }
  const server = createServer((req, res) => {
    const requested = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!requested.startsWith('/media/')) {
      res.writeHead(404).end('not found');
      return;
    }
    const relative = requested.replace(/^\/media\//, '');
    // Containment: a traversal attempt must not escape the media root.
    const target = path.normalize(path.join(mediaRoot, relative));
    if (!target.startsWith(mediaRoot + path.sep)) {
      res.writeHead(400).end('bad path');
      return;
    }
    try {
      const body = readFileSync(target);
      res.writeHead(200, {
        'content-type': target.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  /**
   * A fixed port collides when two runs overlap — which is exactly what happened:
   * this suite passed 53/53 alone but failed inside the full audit with
   * `manifestLoadError`, because the port was already held and the new listener
   * never came up.
   *
   * `listen(0)` asks the OS for a free port. The origin is then derived from the
   * port actually granted, so a retry can never point at a port nobody is serving.
   */
  server.listen(0, '127.0.0.1');
  return server;
}

/**
 * Wait for the listener and report the port it was actually given.
 *
 * `listen()` is asynchronous, so `server.address()` is null immediately after the
 * call. Reading it too early silently fell back to the preferred port, and the
 * manifests then pointed at a port nobody was serving — the browser reported
 * `manifestLoadError` while the very same URL fetched fine by hand.
 */
function mediaOrigin(mediaServer) {
  return new Promise((resolve) => {
    if (!mediaServer) {
      resolve(`http://127.0.0.1:${HLS_MEDIA_PREFERRED_PORT}`);
      return;
    }
    const settle = () => {
      const address = mediaServer.address();
      const port = address && typeof address === 'object' ? address.port : HLS_MEDIA_PREFERRED_PORT;
      resolve(`http://127.0.0.1:${port}`);
    };
    if (mediaServer.listening) settle();
    else mediaServer.once('listening', settle);
  });
}

/**
 * Our OWN generated loops, which the resolver now prefers for a live room.
 *
 * ONE loop is proved, not all three. They are produced by the same generator with
 * different colours, so decoding each is the same work three times over — and it was
 * enough to push the run past its wall-clock budget, which is what made this suite
 * pass alone and fail inside the full audit.
 *
 * The name is still read from the resolver source so a renamed or removed stream
 * cannot silently escape verification.
 */
function selfHostedManifests(origin) {
  const source = readFileSync(path.join(repoRoot, 'services', 'api', 'src', 'engine', 'playback.ts'), 'utf8');
  const start = source.indexOf('SELF_HOSTED_STREAMS');
  const block = source.slice(start, source.indexOf(']', start));
  const names = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  return names.slice(0, 1).map((name) => `${origin}/media/hls/${name}/index.m3u8`);
}

/**
 * The server is started BEFORE the manifests are built, because the port is chosen by
 * the OS and the URLs have to carry it. Building them first meant an undefined origin
 * whenever the preferred port was taken.
 */
const mediaServer = process.env.MM_HLS_ORIGIN ? null : startMediaServer();
const HLS_MEDIA_ORIGIN = process.env.MM_HLS_ORIGIN ?? (await mediaOrigin(mediaServer));

/**
 * Wait until the listener actually accepts a request.
 *
 * `listen()` is asynchronous, and hls.js gives up almost immediately: without this
 * the browser raced the server and every self-hosted manifest failed with
 * `manifestLoadError` while the same URL fetched fine a moment later. A port that is
 * bound but not yet accepting is indistinguishable from a dead one to the player.
 */
async function waitForMedia(origin, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${origin}/media/hls/main/index.m3u8`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return true;
    } catch {
      /* not accepting yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

if (mediaServer && !(await waitForMedia(HLS_MEDIA_ORIGIN))) {
  bad('the media server accepts requests', HLS_MEDIA_ORIGIN);
}

const MANIFESTS = process.env.MM_PROOF_HLS
  ? [process.env.MM_PROOF_HLS]
  : [...selfHostedManifests(HLS_MEDIA_ORIGIN), ...demoManifests()];
const PROOF_DIR = '/tmp/mm-hls-proof';
const CDP_PORT = 9333;
const WEB_PORT = 4599;

console.log('\n\u001b[1m════════ MoneyMart HLS playback proof ════════\u001b[0m');
if (!MANIFESTS.length) {
  console.log('  \u001b[31m✘\u001b[0m no demo manifests found in engine/playback.ts');
  process.exit(1);
}
console.log(`\u001b[2m  ${MANIFESTS.length} manifest(s) to prove\u001b[0m`);
MANIFESTS.forEach((manifest, index) => console.log(`\u001b[2m    ${index + 1}. ${manifest}\u001b[0m`));

/* ── Resolve the shipped hls.js bundle ─────────────────────────────────── */
const assetsDir = path.join(repoRoot, 'apps', 'web', 'dist', 'assets');
if (!existsSync(assetsDir)) {
  bad('a built web bundle exists', 'run `pnpm build:web` first');
  console.log('\n  PASSED 0   FAILED 1\n');
  process.exit(1);
}
const hlsChunk = readdirSync(assetsDir).find((file) => /^hls-.*\.js$/.test(file));
if (!hlsChunk) {
  bad('hls.js was emitted as its own lazily-loaded chunk');
} else {
  ok('hls.js is a separate lazily-loaded chunk', hlsChunk);
}

/* ── Build the proof page from the SHIPPED bundle ──────────────────────── */
mkdirSync(PROOF_DIR, { recursive: true });
if (hlsChunk) {
  writeFileSync(path.join(PROOF_DIR, 'hls.mjs'), (await import('node:fs')).readFileSync(path.join(assetsDir, hlsChunk)));
}

/**
 * The proof page walks every manifest in one document.
 *
 * Earlier this navigated between manifests, but Page.navigate resets the JS
 * execution context and console events stop arriving, so only the first source
 * was ever proven. Running them in sequence inside one page keeps one context
 * and one set of listeners for the whole run.
 */
const proofPage = (manifests) => `<!doctype html><html><head><meta charset="utf-8"><title>hls-proof</title></head>
<body style="margin:0;background:#000">
<video id="v" muted playsinline style="width:640px;height:360px"></video>
<script type="module">
  const report = (obj) => console.log('PROOF:' + JSON.stringify(obj));
  window.addEventListener('error', (e) => report({ kind: 'window-error', message: String(e.message) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const manifests = ${JSON.stringify(manifests)};

  let Hls;
  try {
    ({ default: Hls } = await import('./hls.mjs'));
    report({ kind: 'browser', supported: Hls.isSupported(), version: Hls.version });
  } catch (e) {
    // A return is illegal at module top level; guard with a throw instead.
    report({ kind: 'exception', message: String(e && e.message || e) });
    throw e;
  }

  for (let index = 0; index < manifests.length; index += 1) {
    const manifest = manifests[index];
    const video = document.getElementById('v');
    report({ kind: 'begin', index, manifest });

    await new Promise((resolve) => {
      const hls = new Hls({ lowLatencyMode: true });
      let frags = 0;
      let settled = false;
      const finish = (summary) => {
        if (settled) return;
        settled = true;
        report(Object.assign({ kind: 'summary', index, manifest }, summary));
        try { hls.destroy(); } catch (e) {}
        video.removeAttribute('src');
        try { video.load(); } catch (e) {}
        resolve();
      };

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
        report({ kind: 'manifest-parsed', index, levels: d.levels.length, heights: d.levels.map(l => l.height).filter(Boolean) });
        video.play().catch((err) => report({ kind: 'play-rejected', index, message: String(err && err.name || err) }));
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => report({ kind: 'level-loaded', index, fragments: d.details.fragments.length, live: d.details.live }));
      hls.on(Hls.Events.FRAG_LOADED, () => { frags += 1; });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        report({ kind: 'hls-error', index, fatal: d.fatal, details: d.details });
        if (d.fatal) {
          setTimeout(() => finish({ parsed: false, frags, readyState: video.readyState, videoWidth: 0, videoHeight: 0, currentTime: 0, buffered: 0 }), 1200);
        }
      });

      hls.loadSource(manifest);
      hls.attachMedia(video);

      // Give each source a fixed window to prove itself.
      setTimeout(() => finish({
        parsed: true,
        frags,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentTime: video.currentTime,
        buffered: video.buffered.length ? video.buffered.end(0) : 0,
      }), 14000);
    });

    await sleep(400);
  }
  report({ kind: 'done' });
</script></body></html>`;
writeFileSync(path.join(PROOF_DIR, 'index.html'), proofPage(MANIFESTS));

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  bad('a Chrome or Chromium binary is available');
  console.log('\n  PASSED ' + pass + '   FAILED ' + fail + '\n');
  process.exit(1);
}
ok('a Chromium browser is available', path.basename(chromePath));

/* ── Serve the proof page ──────────────────────────────────────────────── */
let activeManifest = MANIFESTS[0];
const server = createServer((req, res) => {
  const file = path.join(PROOF_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  import('node:fs').then(({ readFile }) => {
    readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, {
        'content-type': ext === '.mjs' || ext === '.js' ? 'text/javascript' : 'text/html',
        'access-control-allow-origin': '*',
      });
      res.end(data);
    });
  });
});
await new Promise((resolve) => server.listen(WEB_PORT, '127.0.0.1', resolve));

/* ── Drive Chrome over the DevTools Protocol ───────────────────────────── */
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    /**
     * Required on CI.
     *
     * This suite passed locally and failed in the release gate with
     * "connected to the browser DevTools endpoint" — the only failure mode that fits
     * is Chrome refusing to start. The Linux runner has no usable sandbox, so the
     * browser dies before it opens the debugging port, and every manifest check then
     * fails for a reason unrelated to playback.
     */
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(PROOF_DIR, 'profile')}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

const events = [];
let ws;
let finished = false;

const cleanup = () => {
  if (finished) return;
  finished = true;
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  try {
    chrome.kill('SIGKILL');
  } catch {
    /* already dead */
  }
  try {
    server.close();
  } catch {
    /* already closed */
  }
};

const overallTimer = setTimeout(() => {
  bad('playback completed within the time budget', `${OVERALL_TIMEOUT_MS}ms`);
  cleanup();
  reportAll();
}, OVERALL_TIMEOUT_MS);

function send(method, params = {}, sessionId) {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ id: Math.floor(Math.random() * 1e6), method, params, sessionId }));
}

/** Discover the debugging endpoint, then attach to a page target. */
async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const version = await response.json();
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      const wsUrl = page?.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl;
      if (!wsUrl) throw new Error('no websocket url');

      ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });

      ws.addEventListener('message', (message) => {
        let payload;
        try {
          payload = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if (payload.method !== 'Runtime.consoleAPICalled') return;

        const text = (payload.params.args ?? [])
          .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? '')))
          .join(' ');
        if (!text.startsWith('PROOF:')) return;
        try {
          events.push(JSON.parse(text.slice('PROOF:'.length)));
        } catch {
          /* ignore malformed line */
        }

        // The page signals completion once every manifest has been proven.
        if (events.some((event) => event.kind === 'done')) {
          clearTimeout(overallTimer);
          cleanup();
          reportAll();
        }
      });

      send('Runtime.enable');
      send('Page.enable');
      send('Page.navigate', { url: `http://127.0.0.1:${WEB_PORT}/` });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
}

/** Assert one manifest's playback evidence. */
function reportOne(manifest, events) {
  const short = manifest.replace(/^https?:\/\//, '').slice(0, 66);
  console.log(`\n\u001b[1m  ${short}\u001b[0m`);

  const parsed = events.find((event) => event.kind === 'manifest-parsed');
  const level = events.find((event) => event.kind === 'level-loaded');
  const summary = events.find((event) => event.kind === 'summary');
  const errors = events.filter((event) => event.kind === 'hls-error' || event.kind === 'exception' || event.kind === 'window-error');
  const fatal = errors.filter((event) => event.fatal !== false);

  parsed
    ? ok(
        'manifest parsed',
        `${parsed.levels} rendition(s)${parsed.heights?.length ? ` · ${parsed.heights.join('/')}p` : ''}`,
      )
    : bad(`${short}: manifest parsed`, errors.find((event) => event.kind === 'hls-error')?.details ?? 'no manifest event');

  level ? ok('media playlist loaded', `${level.fragments} fragment(s)`) : bad(`${short}: media playlist loaded`);

  if (!summary) {
    bad(`${short}: a playback summary was produced`);
    return;
  }

  summary.frags > 0
    ? ok('fragments fetched into the element', `${summary.frags}`)
    : bad(`${short}: fragments fetched into the element`);
  summary.readyState >= 3
    ? ok('element reached HAVE_FUTURE_DATA', `readyState ${summary.readyState}`)
    : bad(`${short}: element reached HAVE_FUTURE_DATA`, `readyState ${summary.readyState}`);
  summary.videoWidth > 0
    ? ok('frames decoded at a real resolution', `${summary.videoWidth}x${summary.videoHeight}`)
    : bad(`${short}: frames decoded at a real resolution`);
  summary.buffered > 0
    ? ok('media buffered', `${summary.buffered.toFixed(1)}s ahead`)
    : bad(`${short}: media buffered`);
  summary.currentTime > 0
    ? ok('playback advanced past the start', `t=${summary.currentTime.toFixed(2)}s`)
    : bad(`${short}: playback advanced past the start`, 'decoded but never played');

  fatal.length === 0
    ? ok('no fatal playback errors')
    : bad(`${short}: no fatal playback errors`, fatal.map((event) => event.details ?? event.message).join('; ').slice(0, 80));
}

function reportAll() {
  /**
   * The capability event is emitted once, before any manifest is walked, so it
   * carries no manifest index and is asserted globally rather than per source.
   */
  const browser = events.find((event) => event.kind === 'browser');
  browser
    ? ok('the shipped hls.js bundle loaded in the browser', `v${browser.version ?? '?'}`)
    : bad('the shipped hls.js bundle loaded in the browser');
  browser && !browser.supported ? bad('Media Source Extensions are supported') : null;
  browser?.supported ? ok('Media Source Extensions are supported') : null;

  MANIFESTS.forEach((manifest, index) => {
    reportOne(
      manifest,
      events.filter((event) => event.index === index),
    );
  });

  const missing = MANIFESTS.filter((_manifest, index) => !events.some((event) => event.index === index && event.kind === 'summary'));
  if (missing.length) {
    missing.forEach((manifest) => bad(`${manifest.slice(0, 60)}: produced playback evidence`));
  } else {
    ok(`all ${MANIFESTS.length} resolver manifests produced playback evidence`);
  }

  console.log('\n\u001b[1m═══════════════════════════════════════════════\u001b[0m');
  const colour = fail === 0 ? '\u001b[32m' : '\u001b[31m';
  console.log(`  ${colour}PASSED ${pass}   FAILED ${fail}\u001b[0m`);
  if (fail) failures.forEach((entry) => console.log(`    \u001b[31m· ${entry}\u001b[0m`));
  console.log('\u001b[1m═══════════════════════════════════════════════\u001b[0m\n');
  process.exit(fail === 0 ? 0 : 1);
}

const connected = await connect();
if (!connected) {
  clearTimeout(overallTimer);
  bad('connected to the browser DevTools endpoint');
  cleanup();
  reportAll();
}
