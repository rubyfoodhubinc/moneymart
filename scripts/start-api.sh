#!/bin/bash
# MoneyMart API launcher — resolves the bundled Node runtime and starts the
# Auction Engine with hot reload (tsx watch) so every edit lands live.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib/runtime.sh"
ROOT="$MM_ROOT"
TSX="$ROOT/services/api/node_modules/tsx/dist/cli.mjs"


export npm_config_cache="$ROOT/.npm-cache"
export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-4317}"
export MM_SEED="${MM_SEED:-true}"

cd "$ROOT/services/api"
exec node "$TSX" watch --clear-screen=false src/index.ts
