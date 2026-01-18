# Shadow Atlas Production Readiness

**Status**: 95% Complete (Infrastructure Gap)
**Last Updated**: 2026-01-14

---

## Executive Summary

Shadow Atlas is **functionally production-ready**. The code, tests, API, and crypto integration are complete. The remaining gap is deployment infrastructure (containerization and platform configuration).

| Category | Status | Notes |
|----------|--------|-------|
| Core Functionality | ✅ Complete | District lookup, Merkle proofs, TIGER extraction |
| API Server | ✅ Production-ready | Rate limiting, CORS, security headers, Zod validation |
| Crypto Integration | ✅ Complete | ZK proving via @voter-protocol/crypto |
| SDK Client | ✅ Complete | TypeScript SDK with retry, caching, proof verification |
| Test Suite | ✅ 2757 passing | Unit, integration, e2e coverage |
| Deployment | ⚠️ Missing | No Dockerfile, no fly.toml |

---

## What's Production-Ready

### 1. API Server (`src/serving/api.ts`)

**Endpoints**:
- `GET /v1/lookup?lat={lat}&lng={lng}` - District lookup with Merkle proof
- `GET /v1/districts/:id` - Direct district proof by ID
- `GET /v1/health` - Health metrics (latency percentiles, cache stats)
- `GET /v1/metrics` - Prometheus-format metrics
- `GET /v1/snapshot` - Current snapshot metadata
- `GET /v1/snapshots` - List all snapshots

**Production Features**:
- Zod request validation (strict input sanitization)
- Sliding window rate limiter (60 req/min default)
- Security headers (CSP, CORS, X-Frame-Options, etc.)
- Request ID tracking (distributed tracing ready)
- API versioning with deprecation headers
- BigInt-safe JSON serialization

### 2. Crypto Integration (`src/serving/proof-generator.ts`)

**ZK Proof Generation**:
- Imports `@voter-protocol/crypto/district-prover`
- Supports circuit depths: 14 (municipal), 20 (state), 22 (federal)
- Browser-native WASM proving (no server dependency)
- Poseidon2 hashing (BN254-compatible)

**Proof Flow**:
```
1. ProofService.generateProof(districtId)     → Merkle inclusion proof
2. ProofService.mapToCircuitInputs(...)       → Convert to circuit witness
3. ZKProofService.generateProof(witness)      → UltraHonk proof (~10s)
4. ZKProofService.verify(proof, publicInputs) → Local verification
```

**Nullifier Security**: Hash chain `hash_4(userSecret, campaignId, authorityHash, epochId)` prevents double-actions.

### 3. TypeScript SDK (`src/distribution/api/shadow-atlas-client.ts`)

**Client Features**:
- Automatic retry with exponential backoff
- Response caching (TTL-based)
- Rate limit tracking (remaining/reset headers)
- Merkle proof verification (client-side Poseidon)

**Usage**:
```typescript
import { ShadowAtlasClient } from '@voter-protocol/shadow-atlas-client';

const client = new ShadowAtlasClient({
  baseUrl: 'https://api.shadow-atlas.org/v1',
});

const result = await client.lookup(39.7392, -104.9903);
const isValid = client.verifyProof(result.district.id, result.merkleProof);
```

### 4. Noir Circuits (`@voter-protocol/crypto`)

**Compiled Circuits**:
- `district_membership_14.json` - Municipal (16K leaves)
- `district_membership_20.json` - State (1M leaves)
- `district_membership_22.json` - Federal (4M leaves)

**DistrictProver**:
- Singleton pattern (backend initialized once)
- UltraHonk prover (Barretenberg WASM)
- ~10s proving time on mid-range mobile
- ~2KB proof size

### 5. Data Pipeline

**TIGER Extraction**:
- All 50 states extracted
- 124K VTD precincts (canonical reference)
- Places + school districts
- Quarterly update capability

**Canonical GEOID Data** (`src/data/canonical/`):
- `vtd-expected-counts.json` - State-level VTD counts
- `place-geoids.json` - 31K+ places
- `school-geoids.json` - 13K+ school districts

---

## Blocking: Deployment Infrastructure

### Missing Files

| File | Purpose | Priority |
|------|---------|----------|
| `Dockerfile` | Container image | P0 |
| `fly.toml` | Fly.io configuration | P0 |
| `.env.example` | Environment documentation | P1 |
| `docker-compose.yml` | Local development | P2 |

### Required Environment Variables

```bash
# Server Configuration
PORT=3000
HOST=0.0.0.0

# Database
DB_PATH=/data/shadow-atlas.db

# IPFS (Storacha gateway)
IPFS_GATEWAY=https://w3s.link

# RDH API (Redistricting Data Hub)
RDH_USERNAME=  # Get from vault
RDH_PASSWORD=  # Get from vault

# Optional
CORS_ORIGINS=*
RATE_LIMIT_PER_MINUTE=60
API_KEY_REQUIRED=false
```

### Dockerfile Specification

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Data volume for SQLite + snapshots
VOLUME ["/data"]

ENV PORT=3000
ENV DB_PATH=/data/shadow-atlas.db

EXPOSE 3000
CMD ["node", "dist/cli/atlas.js", "serve"]
```

### fly.toml Specification

```toml
app = "shadow-atlas"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "3000"
  DB_PATH = "/data/shadow-atlas.db"
  IPFS_GATEWAY = "https://w3s.link"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[mounts]]
  source = "shadow_atlas_data"
  destination = "/data"
```

---

## Non-Blocking: Communique Integration

### Integration Points

1. **Server Load Function** (SvelteKit):
   ```typescript
   // +page.server.ts
   import { ShadowAtlasClient } from '@voter-protocol/shadow-atlas-client';

   const atlas = new ShadowAtlasClient({ baseUrl: env.SHADOW_ATLAS_URL });

   export async function load({ params }) {
     const { lat, lng } = params;
     return atlas.lookup(parseFloat(lat), parseFloat(lng));
   }
   ```

2. **ProofService Integration**:
   ```typescript
   // Communique uses @voter-protocol/crypto directly
   import { DistrictProver } from '@voter-protocol/crypto/district-prover';

   const prover = await DistrictProver.getInstance(20);
   const proof = await prover.generateProof(witness);
   ```

3. **On-Chain Verification**:
   - Scroll L2 verifier contract accepts UltraHonk proofs
   - Public inputs: merkle_root, nullifier, authority_hash, epoch_id, campaign_id
   - Nullifier prevents double-voting per (user, campaign, authority, epoch)

### Caching Strategy

Communique can cache Shadow Atlas responses in Prisma:
```prisma
model DistrictCache {
  id          String   @id @default(cuid())
  lat         Float
  lng         Float
  districtId  String
  merkleRoot  String
  proof       Json
  cachedAt    DateTime @default(now())
  expiresAt   DateTime

  @@index([lat, lng])
}
```

---

## Launch Checklist

### P0 (Blocking)

- [ ] Create Dockerfile
- [ ] Create fly.toml
- [ ] Create .env.example
- [ ] Deploy to staging (fly.io)
- [ ] Verify /v1/lookup endpoint
- [ ] Verify /v1/health endpoint

### P1 (Pre-Launch)

- [ ] Publish @voter-protocol/shadow-atlas to npm
- [ ] Create Communique integration example
- [ ] Load test (1000 req/s target)
- [ ] Set up monitoring (Prometheus + Grafana)

### P2 (Post-Launch)

- [ ] Add API key authentication (premium tier)
- [ ] Batch lookup endpoint (POST /v1/batch)
- [ ] WebSocket subscription (real-time updates)
- [ ] CDN caching (Cloudflare)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              COMMUNIQUE (SvelteKit)                          │
│                                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │  Frontend   │───▶│  Server     │───▶│  Prisma     │                    │
│   │  (Browser)  │    │  (+page.ts) │    │  (Cache)    │                    │
│   └─────────────┘    └──────┬──────┘    └─────────────┘                    │
│                             │                                               │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SHADOW ATLAS (API Server)                         │
│                                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │  /v1/lookup │───▶│  District   │───▶│  Proof      │                    │
│   │  (REST API) │    │  Service    │    │  Service    │                    │
│   └─────────────┘    └──────┬──────┘    └──────┬──────┘                    │
│                             │                   │                           │
│   ┌─────────────┐    ┌──────▼──────┐    ┌──────▼──────┐                    │
│   │  SQLite DB  │◀───│  PIP Engine │    │  Merkle     │                    │
│   │  (Spatial)  │    │  (Turf.js)  │    │  Tree       │                    │
│   └─────────────┘    └─────────────┘    └─────────────┘                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        @voter-protocol/crypto                               │
│                                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │  District   │───▶│  Noir       │───▶│  Barretenberg                    │
│   │  Prover     │    │  Circuits   │    │  (WASM)     │                    │
│   └─────────────┘    └─────────────┘    └─────────────┘                    │
│                                                                             │
│   Circuit Depths: 14 (municipal) │ 20 (state) │ 22 (federal)              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SCROLL L2 (On-Chain)                              │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────┐          │
│   │  DistrictVerifier.sol                                        │          │
│   │  - verifyProof(proof, publicInputs)                         │          │
│   │  - checkNullifier(nullifier) → prevents double-action       │          │
│   │  - checkMerkleRoot(root) → matches published root           │          │
│   └─────────────────────────────────────────────────────────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Estimate

| Task | Effort |
|------|--------|
| Create Dockerfile + fly.toml | 1-2 hours |
| Deploy to staging | 30 minutes |
| Verify endpoints | 30 minutes |
| npm publish | 30 minutes |
| Communique integration guide | 2-3 hours |
| Load testing | 2-3 hours |
| **Total** | **1-2 days** |

The codebase is production-ready. Only containerization remains.
