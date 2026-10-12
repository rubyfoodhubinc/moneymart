#!/bin/bash
# MoneyMart API launcher — resolves the bundled Node runtime and starts the
# Auction Engine with hot reload (tsx watch) so every edit lands live.
set -euo pipefail

ROOT="/Users/rubymacstudio/Documents/deepseek-harness/default-workspace"
NODE_BIN="/Users/rubymacstudio/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin"
TSX="$ROOT/services/api/node_modules/tsx/dist/cli.mjs"

export PATH="$NODE_BIN:$PATH"
export npm_config_cache="$ROOT/.npm-cache"
export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-4317}"
export MM_SEED="${MM_SEED:-true}"

cd "$ROOT/services/api"
exec node "$TSX" watch --clear-screen=false src/index.ts
