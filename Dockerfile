# ─────────────────────────────────────────────────────────────────────────────
# MoneyMart — API + static host image
#
# Serves, from a single origin (the Railway service domain):
#   /            the built web SPA, with deep-link fallback
#   /tv          the built TV / IPTV bundle
#   /api         the REST gateway
#   /socket.io   the realtime WebSocket upgrade
#
# The web app is also deployed to Vercel; both point at this service for data.
#
# Build from the repository root:
#   docker build -t moneymart-api .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
# Keep the pnpm store inside the build context so layer caching works.
ENV npm_config_store_dir=/repo/.pnpm-store

RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# ── Dependencies ────────────────────────────────────────────────────────────
# Copied first so this layer is reused whenever only application code changes.
FROM base AS deps

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc* ./
COPY packages/tokens/package.json   packages/tokens/
COPY packages/types/package.json    packages/types/
COPY services/api/package.json      services/api/
COPY apps/web/package.json          apps/web/
COPY apps/tv/package.json           apps/tv/
COPY apps/mobile/package.json       apps/mobile/
COPY scripts/ensure-env.sh          scripts/

# --ignore-scripts keeps the mobile/web postinstall hooks from running before
# their sources exist; the environment repair is applied explicitly afterwards.
RUN pnpm install --no-frozen-lockfile --ignore-scripts || pnpm install --no-frozen-lockfile

# ── Build ───────────────────────────────────────────────────────────────────
FROM deps AS build

COPY . .

# The platform's native-addon shims are harmless on Linux, and running the
# repair keeps the local and container builds on one code path.
RUN bash scripts/ensure-env.sh >/dev/null 2>&1 || true

# Clients are built with an EMPTY API URL so they resolve the gateway from the
# page origin at runtime. No VITE_API_URL is baked in.
ENV VITE_API_URL=
RUN pnpm --filter @moneymart/tokens build 2>/dev/null || true \
 && pnpm --filter @moneymart/api build \
 && pnpm --filter @moneymart/web build \
 && pnpm --filter @moneymart/tv build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production
# Railway injects PORT; 4317 matches local development.
ENV PORT=4317
# Serve the built clients from this origin.
ENV MM_WEB_DIR=/repo/apps/web/dist
ENV MM_TV_DIR=/repo/apps/tv/dist
# Boot with the demo auction house populated unless overridden.
ENV MM_SEED=true

COPY --from=build /repo/node_modules          /repo/node_modules
COPY --from=build /repo/package.json          /repo/package.json
COPY --from=build /repo/pnpm-workspace.yaml   /repo/pnpm-workspace.yaml
COPY --from=build /repo/packages              /repo/packages
COPY --from=build /repo/services              /repo/services
COPY --from=build /repo/scripts               /repo/scripts
COPY --from=build /repo/apps/web/dist         /repo/apps/web/dist
COPY --from=build /repo/apps/tv/dist          /repo/apps/tv/dist
COPY --from=build /repo/apps/web/package.json /repo/apps/web/package.json
COPY --from=build /repo/apps/tv/package.json  /repo/apps/tv/package.json

WORKDIR /repo/services/api

# Readiness probe target (Railway also checks this).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4317)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The API is compiled to plain JavaScript at build time, so the runtime needs no
# TypeScript loader and no dev dependencies.
CMD ["node", "/repo/services/api/dist/services/api/src/index.js"]
