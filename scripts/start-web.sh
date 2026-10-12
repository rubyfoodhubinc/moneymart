#!/bin/bash
# MoneyMart Web launcher — Vite dev server with Fast Refresh (HMR).
#
# Vite compiles with esbuild (pure Go/JS). Its bundler and Tailwind's CSS engine
# are routed to their official WebAssembly builds by scripts/ensure-env.sh,
# because macOS Library Validation blocks the linker-signed native addons on
# this machine. See docs/ENVIRONMENT.md.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib/runtime.sh"
ROOT="$MM_ROOT"
VITE_BIN="$MM_WEB_VITE"


export npm_config_cache="$ROOT/.npm-cache"
export NODE_ENV="${NODE_ENV:-development}"
# Silence Node's WASI experimental notice (the WASM Tailwind/lightningcss builds use WASI).
export NODE_NO_WARNINGS=1

# Re-apply the WebAssembly routing shims if a reinstall removed them.
bash "$ROOT/scripts/ensure-env.sh" >/dev/null 2>&1 || true

cd "$ROOT/apps/web"
exec node "$VITE_BIN" --port "${WEB_PORT:-3000}" --host 127.0.0.1
