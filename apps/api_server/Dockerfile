# Pinned, not floating: Node 24.19.0+ backported cleanup hooks into node::ObjectWrap
# without the addon cleanup-hook registry (nodejs/node#65446). better-sqlite3 12.x
# then aborts during GC finalization with "Assertion failed: (env) != nullptr" in
# RemoveEnvironmentCleanupHook. The relay container (the only SQLite user of this
# image) crash-looped on node:24 -> 24.21.0 on 2026-09-16; 24.18.1 matches the
# desktop bundle pinned in .github/workflows/desktop_release.yml and is stable.
FROM node:24.18.1-bookworm-slim AS base
WORKDIR /app

# Stage with toolchain for compiling native modules (node-pty, better-sqlite3 fallback).
FROM base AS build-tools
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

FROM build-tools AS deps
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY vendor ./vendor
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production-only deps in their own stage so the runtime image stays slim
# and we only compile native modules once (here).
FROM build-tools AS prod-deps
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY vendor ./vendor
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime
ARG GIT_SHA=dev
ARG BUILD_TIME=
ENV NODE_ENV=production \
    RHYTHM_BUILD_COMMIT=$GIT_SHA \
    RHYTHM_BUILD_TIME=$BUILD_TIME
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /data

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
