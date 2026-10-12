#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MoneyMart — environment repair
#
# This machine's macOS Library Validation refuses to map linker-signed native
# addons into the Node process:
#     code signature ... not valid for use in process:
#     mapping process and mapped file (non-platform) have different Team IDs
#
# That breaks every tool shipping a prebuilt Rust/C++ binary: Next.js's SWC,
# Rollup's native binding, Lightning CSS, and Tailwind's Oxide scanner. The fix
# is to route each one to its *official WebAssembly build*, which is the same
# code compiled to WASM and needs no signature.
#
# This script is idempotent and safe to re-run after any `pnpm install`.
# See docs/ENVIRONMENT.md for the full investigation.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNPM_STORE="$ROOT/node_modules/.pnpm"
WEB="$ROOT/apps/web"

say() { printf '  %s\n' "$1"; }

echo
echo "MoneyMart environment repair"
echo "────────────────────────────"

# ── 1. Rollup: native binding → WebAssembly ─────────────────────────────────
ROLLUP_DIR="$(ls -d "$PNPM_STORE"/rollup@*/node_modules/rollup 2>/dev/null | head -1 || true)"
# Rollup may sit in the pnpm store (isolated layout) or directly in the root
# node_modules (hoisted). Looking only in the store silently does nothing under a
# hoisted layout, and Vite then dies with ERR_DLOPEN_FAILED on
# @rollup/rollup-darwin-arm64 — found only after the node linker was switched so
# React Native's CocoaPods podspecs could resolve their header paths.
if [ -z "${ROLLUP_DIR:-}" ] && [ -d "$ROOT/node_modules/rollup/dist" ]; then
  ROLLUP_DIR="$ROOT/node_modules/rollup"
fi
if [ -n "${ROLLUP_DIR:-}" ] && [ -d "$ROLLUP_DIR/dist" ]; then
  DIST="$ROLLUP_DIR/dist"
  if [ ! -f "$DIST/native.native-backup.js" ] && [ -f "$DIST/native.js" ] && ! grep -q "MoneyMart environment patch" "$DIST/native.js" 2>/dev/null; then
    cp "$DIST/native.js" "$DIST/native.native-backup.js"
    say "backed up rollup/dist/native.js"
  fi

  cat > "$DIST/native.js" <<'JS'
/**
 * MoneyMart environment patch for rollup's native binding loader.
 * Loads Rollup's official WebAssembly binding (@rollup/wasm-node) instead of the
 * linker-signed Mach-O addon that macOS Library Validation blocks here.
 * Original loader preserved as native.native-backup.js. See docs/ENVIRONMENT.md.
 */
const fs = require('node:fs');
const path = require('node:path');

function load() {
  const candidates = [
    path.resolve(__dirname, '../../../../../apps/web/node_modules/@rollup/wasm-node/dist/native.js'),
    path.join(process.cwd(), 'node_modules/@rollup/wasm-node/dist/native.js'),
    path.join(process.cwd(), 'apps/web/node_modules/@rollup/wasm-node/dist/native.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  return require('@rollup/wasm-node/dist/native.js');
}

module.exports = load();
JS

  cat > "$DIST/native.mjs" <<'JS'
/** MoneyMart environment patch — ESM entry. See docs/ENVIRONMENT.md. */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

function load() {
  const candidates = [
    path.resolve(here, '../../../../apps/web/node_modules/@rollup/wasm-node/dist/native.js'),
    path.join(process.cwd(), 'node_modules/@rollup/wasm-node/dist/native.js'),
    path.join(process.cwd(), 'apps/web/node_modules/@rollup/wasm-node/dist/native.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return require(candidate);
  }
  return require('@rollup/wasm-node/dist/native.js');
}

const bindings = load();
export const parse = bindings.parse;
export const parseAsync = bindings.parseAsync;
export const xxhashBase64Url = bindings.xxhashBase64Url;
export const xxhashBase36 = bindings.xxhashBase36;
export const xxhashBase16 = bindings.xxhashBase16;
export default bindings;
JS

  # The ESM build imports the shared binding by relative path.
  for shared in "$DIST/es/shared/parseAst.js" "$DIST/es/shared/node-entry.js"; do
    if [ -f "$shared" ]; then
      sed -i '' "s#from '\.\./\.\./native\.js'#from '../../native.mjs'#" "$shared" 2>/dev/null || \
      sed -i "s#from '\.\./\.\./native\.js'#from '../../native.mjs'#" "$shared"
    fi
  done
  say "rollup → @rollup/wasm-node"
else
  say "rollup not installed yet — skipping (re-run after pnpm install)"
fi

# ── 2. Lightning CSS: native addon → WebAssembly ────────────────────────────
LC_DIR="$(ls -d "$PNPM_STORE"/lightningcss@[0-9]*/node_modules/lightningcss 2>/dev/null | head -1 || true)"
# Same two layouts as rollup: the store under an isolated linker, the root
# node_modules under a hoisted one. A store-only lookup silently skips the patch
# and Tailwind then fails with
#   Loading PostCSS Plugin failed: Cannot find module '../lightningcss.darwin-arm64.node'
if [ -z "${LC_DIR:-}" ] && [ -d "$ROOT/node_modules/lightningcss" ]; then
  LC_DIR="$ROOT/node_modules/lightningcss"
fi
if [ -n "${LC_DIR:-}" ] && [ -d "$LC_DIR/node" ]; then
  if [ ! -f "$LC_DIR/node/index.native-backup.js" ] && [ -f "$LC_DIR/node/index.js" ] && ! grep -q "MoneyMart environment shim" "$LC_DIR/node/index.js" 2>/dev/null; then
    cp "$LC_DIR/node/index.js" "$LC_DIR/node/index.native-backup.js"
  fi
  cat > "$LC_DIR/node/index.js" <<'JS'
/** MoneyMart environment shim — see docs/ENVIRONMENT.md. */
module.exports = require('lightningcss-wasm');
JS
  cat > "$LC_DIR/node/index.mjs" <<'JS'
/** MoneyMart environment shim (ESM) — see docs/ENVIRONMENT.md. */
import * as wasm from 'lightningcss-wasm';
export * from 'lightningcss-wasm';
export default wasm.default ?? wasm;
JS
  say "lightningcss → lightningcss-wasm"
else
  say "lightningcss not installed yet — skipping"
fi

# ── 3. Tailwind Rust scanner: ensure the WASI fallback is present ───────────
if [ -d "$ROOT/node_modules/.pnpm" ]; then
  # Either layout: a store entry under the isolated linker, a root package under
  # the hoisted one.
  if ! ls -d "$PNPM_STORE"/@tailwindcss+oxide-wasm32-wasi@* >/dev/null 2>&1 \
     && [ ! -d "$ROOT/node_modules/@tailwindcss/oxide-wasm32-wasi" ]; then
    say "NOTE: @tailwindcss/oxide-wasm32-wasi missing."
    say "      Run: pnpm --filter @moneymart/web add -D @tailwindcss/oxide-wasm32-wasi lightningcss-wasm @rollup/wasm-node"
  else
    say "tailwind oxide → WASI fallback present"
  fi
fi

echo "────────────────────────────"
echo "  environment ready"
echo
