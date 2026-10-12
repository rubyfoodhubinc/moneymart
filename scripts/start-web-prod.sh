#!/bin/bash
# MoneyMart Web — production server.
#
# Serves the optimised Vite build (apps/web/dist) with SPA-aware fallback so deep
# links such as /auctions/auc_rolex or /shop/adaluxe resolve on a hard refresh.
# The API is NOT served from here: point the browser at the API host via
# NEXT_PUBLIC_API_URL at build time (baked into the bundle by Vite).
set -euo pipefail

. "$(dirname "${BASH_SOURCE[0]}")/lib/runtime.sh"
ROOT="$MM_ROOT"
VITE_BIN="$MM_WEB_VITE"

DIST="$ROOT/apps/web/dist"

export NODE_ENV=production
export NODE_NO_WARNINGS=1

if [ ! -f "$DIST/index.html" ]; then
  echo "  No production build found. Run: pnpm build:web"
  echo "  Building now…"
  (cd "$ROOT/apps/web" && node "$VITE_BIN" build)
fi

cd "$ROOT/apps/web"
exec node "$VITE_BIN" preview --port "${WEB_PORT:-3100}" --host 127.0.0.1 --strictPort
