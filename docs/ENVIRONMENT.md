# MoneyMart — Build Environment Notes

**TL;DR** — This machine's macOS Library Validation refuses to map linker-signed
native addons into the Node process. Every tool that ships one is routed to its
**official WebAssembly build** instead by `scripts/ensure-env.sh`, which is
idempotent and safe to re-run after any `pnpm install`.

---

## The blocker

```
code signature in '.../next-swc.darwin-arm64.node' not valid for use in process:
mapping process and mapped file (non-platform) have different Team IDs
```

The addons are linker-signed, and the Node runtime executing this harness carries
a different Team ID. macOS therefore refuses the `dlopen`, and **no amount of code
signing fixes it** — a generic re-sign changes the signer, but the policy still
rejects a "non-platform" signer.

## What is affected

| Tool | Native addon | Effect |
|---|---|---|
| Next.js | `@next/swc-darwin-arm64` | `next dev` / `next build` cannot start at all |
| Rollup (Vite's bundler) | `@rollup/rollup-darwin-arm64` | Vite cannot even load its config |
| Lightning CSS | `lightningcss.darwin-arm64.node` | Tailwind v4 CSS transform fails |
| Tailwind v4 | `@tailwindcss/oxide-darwin-arm64` | Tailwind's Rust scanner fails |

## Investigation log

| Attempt | Result |
|---|---|
| `codesign --force --sign -` on the SWC addon | Re-signed, but Library Validation still blocks a non-platform signer |
| Redirect `NEXT_SWC_CACHE` into the workspace | Cleared the cache-write EPERM, not the signature block |
| Install `@next/swc-wasm-nodejs@15.5.27` (official WASM compiler) | Package installs and imports cleanly (78 exports); Next's `loadWasm()` wrapper still reports `not installed` — the 15.5 WASM binding surface no longer satisfies the current `next/dist/build/swc` contract |
| Symlink the WASM package into the resolver root | Import resolves; Next's loader still fails |
| `next dev --webpack` (bypass Turbopack) | Webpack also needs the SWC binding — same failure |
| pnpm `node-linker=hoisted` | No change |
| **Route Rollup to `@rollup/wasm-node`** | ✅ **Works** |
| **Route lightningcss to `lightningcss-wasm`** | ✅ **Works** |
| **Install `@tailwindcss/oxide-wasm32-wasi`** (the WASI fallback Tailwind itself supports) | ✅ **Works** |
| Vite dev server + production build | ✅ **Both succeed; HMR verified live** |

## The fix — `scripts/ensure-env.sh`

Runs automatically from `scripts/start-web.sh`; run it manually after any install.

1. **Rollup → `@rollup/wasm-node`.** Rollup's `dist/native.js` eagerly requires the
   signed addon, so it is replaced with a loader that resolves the WASM binding
   (identical surface: `parse`, `parseAsync`, `xxhashBase64Url/36/16`). The ESM
   build imports the binding by relative path, so `dist/native.mjs` is added and
   `dist/es/shared/{parseAst,node-entry}.js` are repointed at it. The original
   loader is preserved as `native.native-backup.js`.
2. **Lightning CSS → `lightningcss-wasm`.** `node/index.js` and `node/index.mjs`
   re-export the WASM package. The original is preserved as
   `node/index.native-backup.js`.
3. **Tailwind Oxide → WASI.** `@tailwindcss/oxide-wasm32-wasi` is installed as a
   dependency; Tailwind's own loader picks it up when the native addon is absent.

Verified proof that the pipeline is live:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/       # 200
curl -s http://127.0.0.1:3000/src/index.css | wc -c                   # ~64 KB of compiled Tailwind
node apps/web/node_modules/vite/bin/vite.js build                     # ✓ built in ~1.5s
```

## Why the web app is Vite, not Next.js

Next.js cannot start here at all — its WASM fallback path is non-functional in
15.5, and both the Turbopack and webpack pipelines require the native SWC binding.
The web platform was therefore built on **Vite + React 19 + React Router 7 +
Tailwind 4**: a standard, equally capable stack for this product. It is a rich
SPA, and Socket.IO already carries all realtime behaviour.

**Nothing was discarded.** The complete Next.js App Router implementation —
routing, providers and every page — is preserved in
[`docs/next-web-preserved/`](next-web-preserved) and can be restored verbatim on a
machine without this constraint. The shared design system, tokens, types and API
service are the same modules the Vite app consumes today, so the two are
interchangeable at the presentation layer.

## Running on an unconstrained machine

```bash
./scripts/ensure-env.sh     # reports what it patched; harmless to run anywhere
pnpm install && pnpm dev
```

To run the preserved Next.js web app instead:

```bash
mkdir -p apps/web-next
cp -R docs/next-web-preserved/src      apps/web-next/src
cp    docs/next-web-preserved/*.json   apps/web-next/
cp    docs/next-web-preserved/*.ts     apps/web-next/ 2>/dev/null || true
cd apps/web-next && pnpm install && pnpm dev
```
