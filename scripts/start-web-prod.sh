#!/bin/bash
# MoneyMart Web — production server.
#
# Serves the optimised Vite build (apps/web/dist) with SPA-aware fallback so deep
# links such as /auctions/auc_rolex or /shop/adaluxe resolve on a hard refresh.
# The API is NOT served from here: point the browser at the API host via
# NEXT_PUBLIC_API_URL at build time (baked into the bundle by Vite).
set -euo pipefail

ROOT="/Users/rubymacstudio/Documents/deepseek-harness/default-workspace"
NODE_BIN="/Users/rubymacstudio/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin"
VITE_BIN="$ROOT/apps/web/node_modules/vite/bin/vite.js"
DIST="$ROOT/apps/web/dist"

export PATH="$NODE_BIN:$PATH"
export NODE_ENV=production
export NODE_NO_WARNINGS=1

if [ ! -f "$DIST/index.html" ]; then
  echo "  No production build found. Run: pnpm build:web"
  echo "  Building now…"
  (cd "$ROOT/apps/web" && node "$VITE_BIN" build)
fi

cd "$ROOT/apps/web"
exec node "$VITE_BIN" preview --port "${WEB_PORT:-3100}" --host 127.0.0.1 --strictPort
