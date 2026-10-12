#!/usr/bin/env node
/**
 * MoneyMart — development launcher.
 *
 * Starts every surface in one command and keeps them running as tracked child
 * processes. Each app already recompiles on save (Vite Fast Refresh, Metro Fast
 * Refresh, tsx watch), so a source edit updates every build automatically.
 *
 *   pnpm dev              API + web + mobile
 *   pnpm dev --no-mobile  API + web
 *   pnpm dev --api        API only
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const onlyApi = args.includes('--api');
const skipMobile = args.includes('--no-mobile');

/** colour-coded prefixes so interleaved logs stay readable */
const LABEL = {
  api: '\u001b[38;5;214m[api]\u001b[0m',
  web: '\u001b[38;5;43m[web]\u001b[0m',
  mobile: '\u001b[38;5;111m[mobile]\u001b[0m',
  tv: '\u001b[38;5;177m[tv]\u001b[0m',
};

const children = [];

function start(name, script, extra = []) {
  const full = path.join(root, 'scripts', script);
  if (!existsSync(full)) {
    console.log(`${LABEL[name]} launcher missing: ${script}`);
    return;
  }

  const child = spawn('bash', [full, ...extra], {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const forward = (stream, target) => {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) target.write(`${LABEL[name]} ${line}\n`);
      }
    });
  };

  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${LABEL[name]} exited with code ${code}`);
    }
  });

  children.push(child);
  return child;
}

function shutdown(signal) {
  console.log(`\n  shutting down (${signal})…`);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 400);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

console.log(`
  MoneyMart — Bid. Stream. Win.
  ─────────────────────────────
  api      http://127.0.0.1:4317
  web      http://127.0.0.1:3000
  tv       http://127.0.0.1:3200${skipMobile || onlyApi ? '' : '\n  mobile   http://127.0.0.1:8082'}
`);

start('api', 'start-api.sh');

if (!onlyApi) {
  start('web', 'start-web.sh');
  start('tv', 'start-tv.sh');
  if (!skipMobile) start('mobile', 'start-mobile.sh', ['--web']);
}
