#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MoneyMart — shared launcher preamble.
#
# The launchers previously hardcoded two absolute paths:
#
#   ROOT=/Users/rubymacstudio/Documents/deepseek-harness/default-workspace
#   NODE_BIN=/Users/rubymacstudio/.dsh/dsh-runtimes/.../node/bin
#
# That made every one of them unrunnable anywhere else — CI, another machine, or
# a fresh clone — and the failure was a bare "no such file" rather than anything
# explaining that the path was baked in. Both are now derived:
#
#   ROOT  from this file's own location, so a clone works wherever it lives
#   NODE  from the DSH runtime when present, otherwise whatever `node` resolves
#         to on PATH, which is what CI provides
#
# Source it, do not execute it:  . "$(dirname "$0")/lib/runtime.sh"
# ─────────────────────────────────────────────────────────────────────────────

# Absolute path of the repository root, derived from this script's location.
MM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export MM_ROOT

# Prefer the DSH-bundled runtime when it exists, because it is the version this
# project was developed and verified against; fall back to PATH for CI.
MM_DSH_NODE_BIN="${DSH_NODE_BIN:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin}"
if [ -x "$MM_DSH_NODE_BIN/node" ]; then
  export PATH="$MM_DSH_NODE_BIN:$PATH"
  MM_NODE_SOURCE="dsh-runtime"
elif command -v node >/dev/null 2>&1; then
  MM_NODE_SOURCE="path"
else
  echo "  MoneyMart: no Node.js found. Install Node 20+ or set DSH_NODE_BIN." >&2
  exit 1
fi
export MM_NODE_SOURCE

# Keep pnpm's cache inside the repo so a sandboxed or shared machine does not
# depend on a writable home directory.
export npm_config_cache="${npm_config_cache:-$MM_ROOT/.npm-cache}"
export NODE_NO_WARNINGS="${NODE_NO_WARNINGS:-1}"

# The workspace's own scripts, resolved from the root rather than hardcoded.
MM_WEB_VITE="$MM_ROOT/apps/web/node_modules/vite/bin/vite.js"
MM_TV_VITE="$MM_ROOT/apps/tv/node_modules/vite/bin/vite.js"
MM_API_ENTRY="$MM_ROOT/services/api/dist/services/api/src/index.js"
export MM_WEB_VITE MM_TV_VITE MM_API_ENTRY

# Repair the native-addon shims if the environment needs them. Harmless where it
# does not, and it is what makes the toolchain work on macOS with Library
# Validation enabled.
if [ -f "$MM_ROOT/scripts/ensure-env.sh" ]; then
  bash "$MM_ROOT/scripts/ensure-env.sh" >/dev/null 2>&1 || true
fi

mm_say() {
  printf '  %s\n' "$1"
}
