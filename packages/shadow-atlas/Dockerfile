# ============================================================================
# Shadow Atlas Dockerfile
# ============================================================================
# Minimal, production-ready container for self-hosted deployment
#
# Usage:
#   docker build -t shadow-atlas .
#   docker run -p 3000:3000 -v $(pwd)/data:/data shadow-atlas
#
# Features:
# - Multi-stage build for minimal image size
# - Non-root user for security
# - Volume mount for SQLite persistence
# - Node.js 22 slim base
# ============================================================================

# ============================================================================
# Stage 1: Dependencies
# ============================================================================
FROM node:22-slim AS deps

WORKDIR /app

# Copy workspace root package files
COPY package*.json ./
COPY packages/shadow-atlas/package*.json ./packages/shadow-atlas/

# Install dependencies (including devDependencies for build)
RUN npm ci

# ============================================================================
# Stage 2: Builder
# ============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shadow-atlas/node_modules ./packages/shadow-atlas/node_modules

# Copy source code
COPY packages/shadow-atlas ./packages/shadow-atlas
COPY tsconfig.base.json ./

# Build TypeScript
WORKDIR /app/packages/shadow-atlas
RUN npm run build

# ============================================================================
# Stage 3: Runtime
# ============================================================================
FROM node:22-slim AS runtime

# Install production dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r shadow-atlas && useradd -r -g shadow-atlas shadow-atlas

WORKDIR /app

# Copy built application
COPY --from=builder /app/packages/shadow-atlas/dist ./dist
COPY --from=builder /app/packages/shadow-atlas/package*.json ./

# Copy data files (registries, schemas, provenance)
COPY --from=builder /app/packages/shadow-atlas/data ./data
COPY --from=builder /app/packages/shadow-atlas/schemas ./schemas
COPY --from=builder /app/packages/shadow-atlas/provenance ./provenance

# Install production dependencies only
RUN npm ci --omit=dev

# Create data directory with proper permissions
RUN mkdir -p /data && chown -R shadow-atlas:shadow-atlas /data /app

# Switch to non-root user
USER shadow-atlas

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DB_PATH=/data/shadow-atlas.db

# Volume for database persistence
VOLUME ["/data"]

# Expose API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/v1/health').then(r => process.exit(r.ok ? 0 : 1))" || exit 1

# Entry point: shadow-atlas serve
CMD ["node", "dist/bin/shadow-atlas.js", "serve"]
