# Dependencies are resolved with npm (package-lock.json): bun 1.3.14's resolver
# segfaults on this dependency graph. Bun is still the runtime.
FROM node:22-slim AS deps
# node-pty (a dependency of @letta-ai/letta-code) ships no linux prebuilds, so
# node-gyp compiles it here. The toolchain stays in this discarded stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# oven/bun:1 is debian based and already ships a non-root `bun` user.
FROM oven/bun:1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

# Application source.
COPY src ./src
COPY tsconfig.json ./tsconfig.json

ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    HEALTH_PORT=8080

# The route to conversation index lives here, so the directory must exist and be
# writable by the unprivileged user.
RUN mkdir -p /app/data && chown -R bun:bun /app

VOLUME /app/data
USER bun

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e 'fetch("http://localhost:8080/healthz").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

CMD ["bun","run","src/index.ts"]