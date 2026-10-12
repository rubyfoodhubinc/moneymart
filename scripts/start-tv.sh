#!/bin/bash
# MoneyMart TV launcher — Vite dev server for the 10-foot UI.
#
# Targets Smart TV browsers and IPTV middleware (Tizen, webOS, HbbTV), all of
# which run a standards-based engine. D-pad navigation is handled in-app.
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib/runtime.sh"
ROOT="$MM_ROOT"
VITE_BIN="$MM_TV_VITE"


export npm_config_cache="$ROOT/.npm-cache"
export NODE_ENV="${NODE_ENV:-development}"
export NODE_NO_WARNINGS=1

bash "$ROOT/scripts/ensure-env.sh" >/dev/null 2>&1 || true

cd "$ROOT/apps/tv"
exec node "$VITE_BIN" --port "${TV_PORT:-3200}" --host 127.0.0.1
