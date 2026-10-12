#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MoneyMart — unified single-origin deployment.
#
# Serves, from ONE host and (optionally) ONE TLS certificate:
#   /              the built web SPA, with deep-link fallback
#   /tv            the built 10-foot TV bundle
#   /api           the REST gateway
#   /socket.io     the realtime WebSocket upgrade
#
# One origin removes the CORS surface, avoids a second DNS entry and certificate,
# and makes "https://host/auctions/auc_rolex" resolve on a hard refresh against
# the very API it calls.
#
# Usage:
#   scripts/deploy-local.sh              # HTTPS on :3443 using .certs/
#   TLS=off scripts/deploy-local.sh      # plain HTTP on :3443
#   PORT=8080 scripts/deploy-local.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib/runtime.sh"
ROOT="$MM_ROOT"
TSX="$ROOT/services/api/node_modules/tsx/dist/cli.mjs"
VITE="$MM_WEB_VITE"
VITE_TV="$MM_TV_VITE"


export npm_config_cache="$ROOT/.npm-cache"
export NODE_NO_WARNINGS=1

PORT="${PORT:-3443}"
TLS="${TLS:-on}"

echo
echo "  MoneyMart — building production clients"
echo "  ───────────────────────────────────────"

bash "$ROOT/scripts/ensure-env.sh" >/dev/null 2>&1 || true

# Clients are built with an EMPTY API URL so they resolve the gateway from the
# page origin at runtime — the whole point of the single-origin deployment.
(cd "$ROOT/apps/web" && VITE_API_URL= node "$VITE" build >/tmp/mm-build-web.log 2>&1) \
  && echo "  web   → apps/web/dist" \
  || { echo "  web build FAILED (see /tmp/mm-build-web.log)"; exit 1; }

(cd "$ROOT/apps/tv" && VITE_API_URL= node "$VITE_TV" build >/tmp/mm-build-tv.log 2>&1) \
  && echo "  tv    → apps/tv/dist" \
  || { echo "  tv build FAILED (see /tmp/mm-build-tv.log)"; exit 1; }

echo "  ───────────────────────────────────────"
echo "  starting gateway on :$PORT (TLS $TLS)"
echo

export NODE_ENV=production
export PORT
export MM_SEED="${MM_SEED:-true}"
export MM_WEB_DIR="$ROOT/apps/web/dist"
export MM_TV_DIR="$ROOT/apps/tv/dist"

if [ "$TLS" = "on" ]; then
  if [ -f "$ROOT/.certs/server.crt" ] && [ -f "$ROOT/.certs/server.key" ]; then
    export MM_TLS_CERT="$ROOT/.certs/server.crt"
    export MM_TLS_KEY="$ROOT/.certs/server.key"
  else
    echo "  No certificate found in .certs/ — run: node scripts/make-cert.mjs"
    echo "  Falling back to plain HTTP."
    unset MM_TLS_CERT MM_TLS_KEY
  fi
fi

cd "$ROOT/services/api"
exec node "$TSX" src/index.ts
