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
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--timeout');
const OVERALL_TIMEOUT_MS = flagIndex >= 0 && args[flagIndex + 1] ? Number(args[flagIndex + 1]) : 60_000;

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

const MANIFEST = process.env.MM_PROOF_HLS ?? 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const PROOF_DIR = '/tmp/mm-hls-proof';
const CDP_PORT = 9333;
const WEB_PORT = 4599;

console.log('\n\u001b[1m════════ MoneyMart HLS playback proof ════════\u001b[0m');
console.log(`\u001b[2m  manifest ${MANIFEST}\u001b[0m`);

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

const proofPage = `<!doctype html><html><head><meta charset="utf-8"><title>hls-proof</title></head>
<body style="margin:0;background:#000">
<video id="v" muted playsinline style="width:640px;height:360px"></video>
<script type="module">
  const report = (obj) => console.log('PROOF:' + JSON.stringify(obj));
  window.addEventListener('error', (e) => report({ kind: 'window-error', message: String(e.message) }));
  try {
    const { default: Hls } = await import('./hls.mjs');
    report({ kind: 'loaded', supported: Hls.isSupported(), version: Hls.version });
    const video = document.getElementById('v');
    const hls = new Hls({ lowLatencyMode: true });
    let parsed = false, frags = 0, bytes = 0;
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, d) => {
      parsed = true;
      report({ kind: 'manifest-parsed', levels: d.levels.length, heights: d.levels.map(l => l.height).filter(Boolean) });
      video.play().catch((err) => report({ kind: 'play-rejected', message: String(err && err.name || err) }));
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_e, d) => report({ kind: 'level-loaded', fragments: d.details.fragments.length, live: d.details.live }));
    hls.on(Hls.Events.FRAG_LOADED, (_e, d) => { frags += 1; bytes += (d.frag && d.frag.stats && d.frag.stats.total) || 0; });
    hls.on(Hls.Events.ERROR, (_e, d) => report({ kind: 'hls-error', fatal: d.fatal, type: d.type, details: d.details }));
    hls.loadSource(${JSON.stringify(MANIFEST)});
    hls.attachMedia(video);
    setTimeout(() => report({ kind: 'summary', parsed, frags, bytes, readyState: video.readyState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, currentTime: video.currentTime, buffered: video.buffered.length ? video.buffered.end(0) : 0 }), 16000);
  } catch (e) { report({ kind: 'exception', message: String(e && e.message || e) }); }
</script></body></html>`;
writeFileSync(path.join(PROOF_DIR, 'index.html'), proofPage);

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  bad('a Chrome or Chromium binary is available');
  console.log('\n  PASSED ' + pass + '   FAILED ' + fail + '\n');
  process.exit(1);
}
ok('a Chromium browser is available', path.basename(chromePath));

/* ── Serve the proof page ──────────────────────────────────────────────── */
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
  report();
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
        if (payload.method === 'Runtime.consoleAPICalled') {
          const text = (payload.params.args ?? [])
            .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? '')))
            .join(' ');
          if (text.startsWith('PROOF:')) {
            try {
              events.push(JSON.parse(text.slice('PROOF:'.length)));
            } catch {
              /* ignore malformed */
            }
          }
          if (events.some((event) => event.kind === 'summary')) {
            clearTimeout(overallTimer);
            cleanup();
            report();
          }
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

function report() {
  const loaded = events.find((event) => event.kind === 'loaded');
  const parsed = events.find((event) => event.kind === 'manifest-parsed');
  const level = events.find((event) => event.kind === 'level-loaded');
  const summary = events.find((event) => event.kind === 'summary');
  const errors = events.filter((event) => event.kind === 'hls-error' || event.kind === 'exception' || event.kind === 'window-error');
  const fatal = errors.filter((event) => event.fatal !== false);

  console.log();
  if (!loaded) {
    bad('the shipped hls.js bundle loaded in the browser');
  } else {
    ok('the shipped hls.js bundle loaded in the browser', `v${loaded.version ?? '?'}`);
    loaded.supported ? ok('Media Source Extensions are supported') : bad('Media Source Extensions are supported');
  }

  parsed
    ? ok(
        'the HLS manifest parsed',
        `${parsed.levels} rendition(s)${parsed.heights?.length ? ` · ${parsed.heights.join('/')}p` : ''}`,
      )
    : bad('the HLS manifest parsed', errors.find((event) => event.kind === 'hls-error')?.details ?? 'no manifest event');

  level
    ? ok('a media playlist loaded', `${level.fragments} fragment(s) · ${level.live ? 'live' : 'vod'}`)
    : bad('a media playlist loaded');

  if (summary) {
    summary.frags > 0
      ? ok('media fragments were fetched and fed to the element', `${summary.frags} fragment(s)`)
      : bad('media fragments were fetched and fed to the element', '0 fragments');
    summary.readyState >= 3
      ? ok('the element reached HAVE_FUTURE_DATA or better', `readyState ${summary.readyState}`)
      : bad('the element reached HAVE_FUTURE_DATA or better', `readyState ${summary.readyState}`);
    summary.videoWidth > 0 && summary.videoHeight > 0
      ? ok('video frames decoded at a real resolution', `${summary.videoWidth}x${summary.videoHeight}`)
      : bad('video frames decoded at a real resolution', `${summary.videoWidth}x${summary.videoHeight}`);
    summary.buffered > 0
      ? ok('audio/video is buffered', `${summary.buffered.toFixed(1)}s ahead`)
      : bad('audio/video is buffered', '0s');
    summary.currentTime > 0
      ? ok('playback advanced past the start', `t=${summary.currentTime.toFixed(2)}s`)
      : bad('playback advanced past the start', 't=0 — decoded but never played');
  } else {
    bad('a playback summary was produced within the budget');
  }

  // Fatal errors are separate from the recovery the player performs.
  fatal.length === 0
    ? ok('no fatal playback errors occurred')
    : bad('no fatal playback errors occurred', fatal.map((event) => event.details ?? event.message).join('; ').slice(0, 90));

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
  report();
}
