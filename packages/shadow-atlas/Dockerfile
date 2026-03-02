# ============================================================================
# Shadow Atlas Dockerfile
# ============================================================================
# Build context: monorepo root (../../)
# Runs TypeScript source directly via tsx — no build step needed.
# tsx handles ESM quirks (extensionless imports, JSON assert, etc.)
#
# Usage (from packages/shadow-atlas/):
#   docker compose up shadow-atlas
# ============================================================================

FROM node:22-slim AS build

# Build tools for native addons (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace files for npm ci
COPY package.json package-lock.json ./
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/shadow-atlas/package.json ./packages/shadow-atlas/

# Install all dependencies — native addons (better-sqlite3) need build tools
RUN npm ci

# Copy crypto source (workspace dependency) and build it
COPY packages/crypto ./packages/crypto
RUN cd packages/crypto && npx tsc -p tsconfig.json || true
RUN test -f packages/crypto/dist/index.js && test -f packages/crypto/dist/poseidon2.js
# tsc doesn't rewrite relative paths — dist/poseidon2.js uses fs.readFileSync
# with __dirname-relative paths, so the noir dir must be accessible from dist/
RUN ln -s ../noir packages/crypto/dist/noir

# ---- Runtime stage (slim, no build tools) ----
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r shadow-atlas && useradd -r -g shadow-atlas shadow-atlas

WORKDIR /app

# Copy installed node_modules (with compiled native addons) from build stage
# Root node_modules has hoisted deps; per-package node_modules has version-specific deps
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shadow-atlas/node_modules ./packages/shadow-atlas/node_modules
COPY --from=build /app/packages/crypto ./packages/crypto

# Copy shadow-atlas source + config
COPY packages/shadow-atlas/tsconfig.build.json ./packages/shadow-atlas/
COPY packages/shadow-atlas/src ./packages/shadow-atlas/src
COPY packages/shadow-atlas/bin ./packages/shadow-atlas/bin

# Copy static data
COPY packages/shadow-atlas/data ./packages/shadow-atlas/data
COPY packages/shadow-atlas/schemas ./packages/shadow-atlas/schemas
COPY packages/shadow-atlas/provenance ./packages/shadow-atlas/provenance

# Copy root tsconfig (referenced by tsconfig.build.json extends)
COPY tsconfig.base.json ./
# Copy shadow-atlas package.json (needed for module resolution)
COPY packages/shadow-atlas/package.json ./packages/shadow-atlas/

# Persistent data volume
RUN mkdir -p /data && chown -R shadow-atlas:shadow-atlas /data /app

USER shadow-atlas

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/data/shadow-atlas.db

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3000/v1/health || exit 1

WORKDIR /app/packages/shadow-atlas
CMD ["npx", "tsx", "bin/shadow-atlas.ts", "serve"]
