# Shadow Atlas - Production Docker Image
#
# Multi-stage build for optimized production container
# - Minimal attack surface (distroless base)
# - No build tools in production image
# - Security scanning compatible
#
# Build: docker build -t shadow-atlas:latest -f deploy/Dockerfile .
# Run: docker run -p 3000:3000 shadow-atlas:latest

# ============================================================================
# Stage 1: Build
# ============================================================================
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /build

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite

# Copy package files
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:20-alpine AS production

# Metadata
LABEL org.opencontainers.image.title="Shadow Atlas"
LABEL org.opencontainers.image.description="Global electoral boundary database with ZK proof infrastructure"
LABEL org.opencontainers.image.vendor="VOTER Protocol"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
RUN addgroup -g 1001 -S shadowatlas && \
    adduser -S shadowatlas -u 1001 -G shadowatlas

# Set working directory
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    sqlite \
    ca-certificates \
    tini

# Copy production dependencies from builder
COPY --from=builder --chown=shadowatlas:shadowatlas /build/node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=shadowatlas:shadowatlas /build/dist ./dist
COPY --from=builder --chown=shadowatlas:shadowatlas /build/package.json ./

# Copy service directory (for runtime scripts)
COPY --chown=shadowatlas:shadowatlas services/shadow-atlas ./services/shadow-atlas

# Create data directory
RUN mkdir -p /app/data && chown shadowatlas:shadowatlas /app/data

# Switch to non-root user
USER shadowatlas

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Expose port
EXPOSE 3000

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start application
CMD ["node", "dist/index.js"]
