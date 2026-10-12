#!/bin/bash
# MoneyMart Web launcher — Vite dev server with Fast Refresh (HMR).
#
# Vite compiles with esbuild (pure Go/JS). Its bundler and Tailwind's CSS engine
# are routed to their official WebAssembly builds by scripts/ensure-env.sh,
# because macOS Library Validation blocks the linker-signed native addons on
# this machine. See docs/ENVIRONMENT.md.
set -euo pipefail

ROOT="/Users/rubymacstudio/Documents/deepseek-harness/default-workspace"
NODE_BIN="/Users/rubymacstudio/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin"
VITE_BIN="$ROOT/apps/web/node_modules/vite/bin/vite.js"

export PATH="$NODE_BIN:$PATH"
export npm_config_cache="$ROOT/.npm-cache"
export NODE_ENV="${NODE_ENV:-development}"
# Silence Node's WASI experimental notice (the WASM Tailwind/lightningcss builds use WASI).
export NODE_NO_WARNINGS=1

# Re-apply the WebAssembly routing shims if a reinstall removed them.
bash "$ROOT/scripts/ensure-env.sh" >/dev/null 2>&1 || true

cd "$ROOT/apps/web"
exec node "$VITE_BIN" --port "${WEB_PORT:-3000}" --host 127.0.0.1
