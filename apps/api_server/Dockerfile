# Keep the relay runtime aligned with the qualified desktop pin. better-sqlite3 13
# uses N-API prebuilds and is not exposed to the 12.x ObjectWrap cleanup crash;
# the startup guard still protects anyone who runs an older lockfile.
FROM node:24.18.1-bookworm-slim AS base
WORKDIR /app

# Stage with the toolchain still required to compile node-pty.
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
