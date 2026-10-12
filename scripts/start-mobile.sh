#!/bin/bash
# MoneyMart Mobile launcher — Expo dev server with Metro Fast Refresh.
#
# Metro bundles with esbuild/Babel (pure JS), so it starts in this environment.
# The dev server binds to a free port; 8081 is often already taken by another
# Expo project on this machine.
set -euo pipefail

ROOT="/Users/rubymacstudio/Documents/deepseek-harness/default-workspace"
NODE_BIN="/Users/rubymacstudio/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin"
EXPO_BIN="$ROOT/apps/mobile/node_modules/expo/bin/cli"

export PATH="$NODE_BIN:$PATH"
export npm_config_cache="$ROOT/.npm-cache"
export NODE_NO_WARNINGS=1
export EXPO_NO_TELEMETRY=1
# Never inherit CI mode: Expo disables Fast Refresh when CI is set.
unset CI

cd "$ROOT/apps/mobile"
exec node "$EXPO_BIN" start --port "${MOBILE_PORT:-8082}" "$@"
