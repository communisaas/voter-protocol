# Shadow Atlas Public API Architecture Specification

**Version**: 1.0
**Status**: Architecture Design
**Authors**: Distinguished Engineering Team
**Date**: 2025-12-18

---

## Executive Summary

Shadow Atlas Public API disrupts paid incumbent district lookup services (Cicero, Google Civic API) with free, cryptographically verifiable boundary resolution. Two-tier storage architecture separates cryptographic verification (Storacha/IPFS) from API serving (Cloudflare R2 + Workers), enabling free tier sustainability while maintaining zero-trust verification guarantees.

**Core Value Proposition**:
- Free district lookups (1000/day per IP, no API key required)
- Cryptographic verification via Merkle proofs
- <50ms p95 latency (Cloudflare global CDN)
- Zero platform lock-in (quarterly IPFS snapshots)

**Economic Model**:
- Free tier: 100M lookups/month → $50/month infrastructure cost
- Break-even: 500 premium API keys @ $10/month
- Competition: Undercuts Cicero ($1500/month), Google Civic ($0.005/lookup)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Two-Tier Storage Design](#two-tier-storage-design)
3. [API Specification](#api-specification)
4. [Data Flow](#data-flow)
5. [Quarterly Update Workflow](#quarterly-update-workflow)
6. [Cost Analysis](#cost-analysis)
7. [Deployment Architecture](#deployment-architecture)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Architecture Overview

### System Components

```
┌────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser/App)                        │
│  1. Lookup district by address/coordinates                         │
│  2. Receive district + Merkle proof                                │
│  3. Verify proof against published IPFS CID                        │
│  4. Generate ZK proof in browser (optional, for on-chain use)      │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼ HTTPS
┌────────────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE WORKERS (Edge Compute)                  │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  API Handlers                                              │   │
│  │  • GET /v1/districts (address geocoding + PIP)             │   │
│  │  • GET /v1/districts/:id (direct lookup)                   │   │
│  │  • GET /v1/health (status check)                           │   │
│  │  • GET /v1/snapshot (current Merkle root + IPFS CID)       │   │
│  └────────────────────────────────────────────────────────────┘   │
│                          ▲              ▲                           │
│                          │              │                           │
│       Geocoding (Cloudflare Workers)    │                           │
│       - Pelias (OSM, free tier)         │                           │
│       - Fallback: Mapbox (paid)         │                           │
│                                         │                           │
│                              ┌──────────┴──────────┐                │
│                              │  Rate Limiter       │                │
│                              │  • 1000 req/day/IP  │                │
│                              │  • KV Storage       │                │
│                              └─────────────────────┘                │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE R2 (Object Storage)                  │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  District GeoJSON Files                                    │   │
│  │  • Format: districts/{countryCode}/{stateCode}.geojson     │   │
│  │  • Size: ~500KB per state (compressed)                     │   │
│  │  • Total: ~50MB (50 US states)                             │   │
│  │  • Update: Quarterly (in-place, no migrations)             │   │
│  └────────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Metadata Cache                                            │   │
│  │  • Format: metadata/snapshot-current.json                  │   │
│  │  • Contains: Merkle root, IPFS CID, district count         │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                 STORACHA/IPFS (Cryptographic Verification)          │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Merkle Tree Snapshots (Quarterly)                         │   │
│  │  • Format: shadow-atlas-2025-Q1.json                       │   │
│  │  • Contains: Full Merkle tree + all district boundaries    │   │
│  │  • Size: ~500MB compressed                                 │   │
│  │  • Pinned: Permanently (Filecoin backing)                  │   │
│  │  • CID: Published on-chain (Scroll L2, quarterly)          │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                   EXTRACTION PIPELINE (Quarterly)                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  GitHub Actions Workflow                                   │   │
│  │  1. Extract state boundaries (StateBatchExtractor)         │   │
│  │  2. Validate (DeterministicValidationPipeline)             │   │
│  │  3. Build Merkle tree (MerkleTreeBuilder)                  │   │
│  │  4. Upload to Storacha (get CID)                           │   │
│  │  5. Sync GeoJSON to R2                                     │   │
│  │  6. Update metadata (current snapshot)                     │   │
│  │  7. (Optional) Update on-chain registry                    │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Design Principles

**1. Separation of Concerns**:
- **R2 (serving)**: Fast API responses, frequent access, mutable
- **Storacha (verification)**: Permanent archive, cryptographic proofs, immutable

**2. Zero-Trust Verification**:
- Clients verify Merkle proofs against IPFS CID (not server response)
- Platform cannot forge proofs (cryptographic enforcement)
- Complete audit trail via IPFS provenance

**3. Cost Optimization**:
- Cloudflare Workers: Free tier covers 100M requests/month
- R2 Storage: $0.015/GB = $0.75/month for 50GB
- Storacha: $5/month for permanent IPFS pinning

**4. Global Distribution**:
- Cloudflare CDN: 300+ global edge locations
- R2 replication: Automatic multi-region distribution
- Latency: <50ms p95 worldwide

---

## Two-Tier Storage Design

### Storage Tier Comparison

| Property | Cloudflare R2 | Storacha/IPFS |
|----------|---------------|---------------|
| **Purpose** | API serving | Cryptographic verification |
| **Access Pattern** | High frequency (1M/day) | Low frequency (quarterly) |
| **Latency** | <10ms (CDN) | 100-500ms (IPFS gateway) |
| **Mutability** | Mutable (quarterly updates) | Immutable (permanent archive) |
| **Cost** | $0.015/GB + $0.36/million reads | $5/month (unlimited reads) |
| **Content** | District GeoJSON only | Full Merkle tree + proofs |
| **Size** | ~50MB | ~500MB |
| **Distribution** | Cloudflare global | IPFS/Filecoin network |

### R2 Storage Schema

```typescript
/**
 * Cloudflare R2 bucket structure
 *
 * Root: shadow-atlas/
 *   ├── districts/
 *   │   ├── US/
 *   │   │   ├── AL.geojson
 *   │   │   ├── AK.geojson
 *   │   │   └── ... (50 states)
 *   │   ├── CA/
 *   │   │   ├── AB.geojson
 *   │   │   └── ... (provinces)
 *   │   └── GB/
 *   │       └── constituencies.geojson
 *   └── metadata/
 *       ├── snapshot-current.json (latest snapshot metadata)
 *       └── snapshots-history.json (quarterly archive)
 */

/**
 * R2 Object: districts/US/WI.geojson
 * GeoJSON FeatureCollection with minimal properties for fast serving
 */
interface R2DistrictFile {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;                // e.g., "5501" (GEOID)
    properties: {
      id: string;              // Duplicate of feature.id for convenience
      name: string;            // "Congressional District 1"
      districtType: string;    // "congressional" | "state_senate" | etc.
      jurisdiction: string;    // "USA/WI/Congressional District 1"
    };
    geometry: {
      type: 'Polygon' | 'MultiPolygon';
      coordinates: number[][][];  // WGS84 (EPSG:4326)
    };
  }>;
  metadata: {
    state: string;             // "WI"
    country: string;           // "US"
    lastUpdated: string;       // ISO 8601 timestamp
    districtCount: number;
    merkleRoot: string;        // Hex string (links to Storacha snapshot)
  };
}

/**
 * R2 Object: metadata/snapshot-current.json
 * Current snapshot metadata for fast client verification
 */
interface R2SnapshotMetadata {
  snapshotId: string;          // "shadow-atlas-2025-Q1"
  merkleRoot: string;          // "0x4f855996bf88ffdacabbdd8ac4b56dde..."
  ipfsCID: string;             // "QmXyz789..." (Storacha CID)
  timestamp: string;           // ISO 8601
  districtCount: number;
  version: string;             // "1.0.0"
  coverage: {
    countries: string[];       // ["US", "CA", "GB"]
    states: string[];          // ["AL", "AK", "WI", ...]
  };
}
```

### Storacha Storage Schema

```typescript
/**
 * IPFS Object: shadow-atlas-2025-Q1.json
 * Complete Merkle tree with all districts + proofs
 *
 * This is the canonical source of truth for cryptographic verification.
 * R2 is a serving cache optimized for API performance.
 */
interface StorachaSnapshot {
  version: string;             // "1.0.0"
  snapshotId: string;          // "shadow-atlas-2025-Q1"
  merkleTree: {
    root: string;              // Hex string
    leaves: string[];          // Array of leaf hashes
    tree: string[][];          // Array of layers (bottom to top)
    districts: Array<{
      id: string;
      name: string;
      jurisdiction: string;
      districtType: string;
      geometry: Polygon | MultiPolygon;
      provenance: {
        source: string;
        authority: string;
        timestamp: number;
        method: string;
        responseHash: string;
      };
      bbox: [number, number, number, number];
    }>;
  };
  metadata: {
    generatedAt: string;       // ISO 8601
    boundaryCount: number;
    extractionPipeline: {
      version: string;
      commit: string;          // Git commit hash
    };
    coverage: {
      countries: string[];
      states: string[];
    };
  };
}
```

### Update Synchronization Flow

```
EXTRACTION PIPELINE (Quarterly)
  │
  ├─ 1. Extract state boundaries
  ├─ 2. Validate + build Merkle tree
  ├─ 3. Upload to Storacha
  │     → Get IPFS CID: QmXyz789...
  │
  ├─ 4. Extract districts for R2 sync
  │     for each state:
  │       - Convert ExtractedBoundary[] → R2DistrictFile
  │       - Compress with gzip
  │       - Upload to R2: districts/US/{state}.geojson
  │
  ├─ 5. Update snapshot metadata
  │     → Upload to R2: metadata/snapshot-current.json
  │     → Contains: Merkle root, IPFS CID, timestamp
  │
  └─ 6. (Optional) Update on-chain registry
        → Scroll L2 transaction: registerSnapshot(CID, merkleRoot)
        → Cost: ~100k gas = $0.02
```

---

## API Specification

### Base URL

```
Production: https://api.shadow-atlas.org/v1
Testnet:    https://testnet.shadow-atlas.org/v1
```

### Endpoints

#### `GET /v1/districts`

Lookup district by address or coordinates.

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | No* | Full address (e.g., "123 Main St, Denver, CO") |
| `lat` | number | No* | Latitude (-90 to 90) |
| `lng` | number | No* | Longitude (-180 to 180) |

*Exactly one of `address` or `(lat, lng)` required.

**Request Example**:

```bash
# Address lookup
curl "https://api.shadow-atlas.org/v1/districts?address=123+Main+St,+Denver,+CO"

# Coordinate lookup
curl "https://api.shadow-atlas.org/v1/districts?lat=39.7392&lng=-104.9903"
```

**Response (200 OK)**:

```json
{
  "district": {
    "id": "0809",
    "name": "Congressional District 9",
    "jurisdiction": "USA/Colorado/Congressional District 9",
    "districtType": "congressional",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[-105.0, 39.7], [-104.9, 39.7], ...]]
    }
  },
  "coordinates": {
    "lat": 39.7392,
    "lng": -104.9903
  },
  "merkleProof": {
    "root": "0x4f855996bf88ffdacabbdd8ac4b56dde9ff5ef48e80ff91c149b0ae560af8f54",
    "leaf": "0x50fa016cf737a511e83d8f8f99420aa1234567890abcdef1234567890abcdef",
    "siblings": [
      "0x7e25e38a34daf68780556839d53cfdc5...",
      "0x1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p..."
    ],
    "pathIndices": [0, 1, 0, 1]
  },
  "provenance": {
    "snapshotId": "shadow-atlas-2025-Q1",
    "ipfsCID": "QmXyz789...",
    "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
    "retrievedAt": "2025-12-18T10:30:00Z"
  },
  "latencyMs": 23.4,
  "cacheHit": false
}
```

**Error Responses**:

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_PARAMETERS` | Missing or invalid address/coordinates |
| 404 | `DISTRICT_NOT_FOUND` | No district found at location |
| 429 | `RATE_LIMIT_EXCEEDED` | Exceeded 1000 requests/day |
| 500 | `INTERNAL_ERROR` | Server error (logged for investigation) |

---

#### `GET /v1/districts/:id`

Direct district lookup by ID (no geocoding).

**Path Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | District ID (e.g., "5501" for WI-CD1) |

**Request Example**:

```bash
curl "https://api.shadow-atlas.org/v1/districts/5501"
```

**Response (200 OK)**:

```json
{
  "district": {
    "id": "5501",
    "name": "Congressional District 1",
    "jurisdiction": "USA/Wisconsin/Congressional District 1",
    "districtType": "congressional",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[-88.0, 42.5], ...]]
    }
  },
  "merkleProof": {
    "root": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
    "leaf": "0x50fa016cf737a511e83d8f8f99420aa1...",
    "siblings": ["0x7e25e38a34daf68780556839d53cfdc5...", ...],
    "pathIndices": [0, 1, 0, 1]
  },
  "provenance": {
    "snapshotId": "shadow-atlas-2025-Q1",
    "ipfsCID": "QmXyz789...",
    "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
    "retrievedAt": "2025-12-18T10:30:00Z"
  },
  "latencyMs": 8.2,
  "cacheHit": true
}
```

---

#### `GET /v1/health`

Health check with comprehensive metrics.

**Request Example**:

```bash
curl "https://api.shadow-atlas.org/v1/health"
```

**Response (200 OK)**:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "queries": {
    "total": 10000,
    "successful": 9950,
    "failed": 50,
    "latencyP50": 18.2,
    "latencyP95": 42.1,
    "latencyP99": 87.3,
    "throughput": 2.78
  },
  "cache": {
    "size": 8234,
    "hits": 8500,
    "misses": 1500,
    "hitRate": 0.85,
    "evictions": 234
  },
  "snapshot": {
    "currentId": "shadow-atlas-2025-Q1",
    "ipfsCID": "QmXyz789...",
    "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
    "districtCount": 10000,
    "ageSeconds": 86400,
    "nextCheckSeconds": 2700
  },
  "errors": {
    "last5m": 2,
    "last1h": 15,
    "last24h": 50,
    "recentErrors": []
  },
  "timestamp": 1700000000000
}
```

**Status Values**:
- `healthy`: All metrics within target range
- `degraded`: Some metrics outside target but operational
- `unhealthy`: Critical metrics failing

---

#### `GET /v1/snapshot`

Get current snapshot metadata.

**Request Example**:

```bash
curl "https://api.shadow-atlas.org/v1/snapshot"
```

**Response (200 OK)**:

```json
{
  "snapshotId": "shadow-atlas-2025-Q1",
  "ipfsCID": "QmXyz789...",
  "merkleRoot": "0x4f855996bf88ffdacabbdd8ac4b56dde...",
  "timestamp": "2025-01-15T00:00:00Z",
  "districtCount": 10000,
  "version": "1.0.0",
  "coverage": {
    "countries": ["US", "CA", "GB"],
    "states": ["AL", "AK", "AZ", "AR", "CA", ...]
  }
}
```

---

### Rate Limiting

**Free Tier**:
- **Limit**: 1000 requests/day per IP address
- **Window**: Rolling 24-hour window
- **Headers**:
  - `X-RateLimit-Limit: 1000`
  - `X-RateLimit-Remaining: 847`
  - `X-RateLimit-Reset: 1734528000` (Unix timestamp)

**Premium Tier** (Future):
- **Limit**: 100,000 requests/day per API key
- **Cost**: $10/month
- **Authentication**: `Authorization: Bearer <api_key>`

**Rate Limit Exceeded Response**:

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "limit": 1000,
  "remaining": 0,
  "resetAt": "2025-12-19T00:00:00Z",
  "timestamp": 1734528000000
}
```

---

## Data Flow

### Address Lookup Flow (Complete Pipeline)

```
CLIENT REQUEST
  GET /v1/districts?address=123+Main+St,+Denver,+CO
  │
  ▼
CLOUDFLARE WORKER (Edge)
  ├─ 1. Rate Limit Check (KV lookup)
  │     → IP: 127.0.0.1
  │     → Count: 847/1000 (OK)
  │
  ├─ 2. Geocode Address
  │     → Pelias API (OSM, free tier)
  │     → Result: { lat: 39.7392, lng: -104.9903 }
  │     → Fallback: Mapbox (if Pelias fails)
  │
  ├─ 3. Determine State from Coordinates
  │     → Bounding box check
  │     → State: Colorado (CO)
  │
  ├─ 4. Fetch District GeoJSON from R2
  │     → R2 Key: districts/US/CO.geojson
  │     → Cache: Cloudflare CDN (1 hour TTL)
  │     → Latency: <10ms (CDN hit)
  │
  ├─ 5. Point-in-Polygon Test
  │     → Algorithm: Ray casting
  │     → Complexity: O(n) where n = vertex count
  │     → Result: District ID "0809"
  │
  ├─ 6. Fetch Current Snapshot Metadata
  │     → R2 Key: metadata/snapshot-current.json
  │     → Cache: Cloudflare KV (1 hour TTL)
  │     → Result: { merkleRoot, ipfsCID, ... }
  │
  ├─ 7. Generate Merkle Proof
  │     → Load Merkle tree from R2 (cached)
  │     → Compute path from leaf to root
  │     → Result: { root, leaf, siblings, pathIndices }
  │
  └─ 8. Return Response
        → Status: 200 OK
        → Latency: 23.4ms (geocode: 15ms, PIP: 8ms)
        → Cache: None (first lookup for this address)

CLIENT VERIFICATION (Optional)
  ├─ 1. Verify Merkle Proof Locally
  │     → Hash leaf: hash(district.id + district.geometry)
  │     → Walk siblings: hash(sibling, hash) for each sibling
  │     → Compare root: computed_root === response.merkleRoot
  │
  ├─ 2. Verify IPFS CID
  │     → Fetch from IPFS: ipfs.io/ipfs/{CID}
  │     → Validate Merkle root matches IPFS snapshot
  │
  └─ 3. (Optional) Generate ZK Proof
        → Circuit: Noir district verification circuit
        → Private inputs: address, coordinates
        → Public inputs: district ID, Merkle root
        → Output: ZK proof for on-chain submission
```

### Coordinate Lookup Flow (Fast Path)

```
CLIENT REQUEST
  GET /v1/districts?lat=39.7392&lng=-104.9903
  │
  ▼
CLOUDFLARE WORKER (Edge)
  ├─ 1. Rate Limit Check
  │     → IP: 127.0.0.1
  │     → Count: 848/1000 (OK)
  │
  ├─ 2. Determine State from Coordinates
  │     → Bounding box check
  │     → State: Colorado (CO)
  │
  ├─ 3. Fetch District GeoJSON from R2
  │     → R2 Key: districts/US/CO.geojson
  │     → Cache: CDN hit (already cached from previous request)
  │     → Latency: <5ms
  │
  ├─ 4. Point-in-Polygon Test
  │     → Algorithm: Ray casting
  │     → Result: District ID "0809"
  │
  ├─ 5. Fetch Snapshot Metadata
  │     → Cache: KV hit
  │     → Latency: <2ms
  │
  ├─ 6. Generate Merkle Proof
  │     → Cache: Merkle tree cached in memory
  │     → Latency: <1ms
  │
  └─ 7. Return Response
        → Status: 200 OK
        → Latency: 8.2ms (all cache hits)
        → Cache: true
```

---

## Quarterly Update Workflow

### GitHub Actions Pipeline

```yaml
# .github/workflows/quarterly-update.yml
name: Shadow Atlas Quarterly Update

on:
  schedule:
    - cron: '0 0 1 */3 *'  # First day of every quarter
  workflow_dispatch:       # Manual trigger

jobs:
  extract-and-publish:
    runs-on: ubuntu-latest
    timeout-minutes: 120

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Extract state boundaries
        run: |
          npm run extract:all-states
        env:
          EXTRACTION_CONCURRENCY: 5
          RETRY_ATTEMPTS: 3

      - name: Validate extractions
        run: |
          npm run validate:all
        env:
          MIN_PASS_RATE: 0.9

      - name: Build Merkle tree
        run: |
          npm run merkle:build
        env:
          OUTPUT_PATH: ./dist/shadow-atlas-2025-Q1.json

      - name: Upload to Storacha
        run: |
          npm run storacha:upload -- ./dist/shadow-atlas-2025-Q1.json
        env:
          STORACHA_TOKEN: ${{ secrets.STORACHA_TOKEN }}

      - name: Extract GeoJSON for R2
        run: |
          npm run r2:prepare
        env:
          INPUT_PATH: ./dist/shadow-atlas-2025-Q1.json
          OUTPUT_DIR: ./dist/r2-upload

      - name: Upload to Cloudflare R2
        run: |
          npm run r2:upload -- ./dist/r2-upload
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          CLOUDFLARE_R2_ACCESS_KEY: ${{ secrets.CLOUDFLARE_R2_ACCESS_KEY }}
          CLOUDFLARE_R2_SECRET_KEY: ${{ secrets.CLOUDFLARE_R2_SECRET_KEY }}

      - name: Update snapshot metadata
        run: |
          npm run metadata:update
        env:
          SNAPSHOT_ID: shadow-atlas-2025-Q1
          IPFS_CID: ${{ steps.storacha.outputs.cid }}
          MERKLE_ROOT: ${{ steps.merkle.outputs.root }}

      - name: (Optional) Update on-chain registry
        if: github.event_name == 'workflow_dispatch'
        run: |
          npm run onchain:update
        env:
          SCROLL_RPC_URL: ${{ secrets.SCROLL_RPC_URL }}
          DEPLOYER_PRIVATE_KEY: ${{ secrets.DEPLOYER_PRIVATE_KEY }}

      - name: Verify deployment
        run: |
          npm run verify:deployment
        env:
          API_URL: https://api.shadow-atlas.org/v1
```

### Update Stages

**Stage 1: Extraction (30-60 minutes)**
```typescript
// Extract all configured states
const extractor = new StateBatchExtractor();
const results = await extractor.extractAllStates();

// Expected output: 50 states × 4 layers = 200 extractions
// Success rate: >90% (per validation threshold)
```

**Stage 2: Validation (5-10 minutes)**
```typescript
// Validate against ground truth registries
const validator = new DeterministicValidationPipeline();
const validationResults = await validator.validateAll(results);

// Criteria:
// - District count matches official registry
// - Geometry topology is valid (no self-intersections)
// - Authority resolution applied correctly
```

**Stage 3: Merkle Tree Construction (1-2 minutes)**
```typescript
// Build cryptographic commitment
const builder = new MerkleTreeBuilder();
const merkleTree = builder.buildTree(validatedBoundaries);

// Output:
// - Merkle root: 0x4f855996bf88ffdacabbdd8ac4b56dde...
// - Tree depth: 14 (for ~10,000 districts)
// - Proofs: Pre-computed for all districts
```

**Stage 4: Storacha Upload (10-20 minutes)**
```typescript
// Upload full snapshot to IPFS/Filecoin
const storacha = new StorachaClient(process.env.STORACHA_TOKEN);
const cid = await storacha.upload('shadow-atlas-2025-Q1.json', merkleTree);

// Output:
// - IPFS CID: QmXyz789...
// - Size: ~500MB compressed
// - Pinned: Permanently on Filecoin
```

**Stage 5: R2 Sync (5-10 minutes)**
```typescript
// Extract GeoJSON for each state
for (const state of merkleTree.districts.groupBy('state')) {
  const geojson = extractGeoJSON(state.districts);
  await r2.upload(`districts/US/${state.code}.geojson`, geojson);
}

// Update snapshot metadata
await r2.upload('metadata/snapshot-current.json', {
  snapshotId: 'shadow-atlas-2025-Q1',
  ipfsCID: cid,
  merkleRoot: merkleTree.root,
  timestamp: new Date().toISOString(),
});
```

**Stage 6: Verification (2-5 minutes)**
```typescript
// Health check against production API
const health = await fetch('https://api.shadow-atlas.org/v1/health');
const snapshot = await fetch('https://api.shadow-atlas.org/v1/snapshot');

// Assertions:
// - API responds within 100ms
// - Snapshot metadata matches uploaded data
// - Random district lookups succeed
// - Merkle proofs verify correctly
```

### Rollback Strategy

**Immutable IPFS + Mutable R2 = Safe Rollback**:

```typescript
// If deployment fails validation, rollback R2 to previous snapshot
async function rollback(previousSnapshotId: string) {
  const previousMetadata = await loadSnapshotMetadata(previousSnapshotId);

  // Update R2 metadata to point to previous snapshot
  await r2.upload('metadata/snapshot-current.json', previousMetadata);

  // R2 district files remain unchanged (same data, different Merkle root)
  // IPFS snapshot remains permanently accessible
}

// IPFS provides permanent audit trail
// R2 provides fast rollback capability
```

---

## Cost Analysis

### Free Tier Infrastructure Costs

**Cloudflare Workers + R2**:

| Component | Metric | Free Tier | Paid Rate | Monthly Cost (100M req) |
|-----------|--------|-----------|-----------|-------------------------|
| Workers Requests | 100M | 10M included | $0.50/1M | $45 |
| Workers CPU Time | 100k ms | 10k ms included | $0.02/1k ms | $1.80 |
| R2 Storage | 50GB | 10GB included | $0.015/GB | $0.60 |
| R2 Reads | 100M | 10M included | $0.36/1M | $32.40 |
| KV Reads (rate limiting) | 100M | 100k included | $0.50/10M | $5 |
| KV Storage | 1GB | 1GB included | $0.50/GB | $0 |
| **Total** | | | | **$84.80** |

**Storacha/IPFS**:

| Component | Metric | Rate | Monthly Cost |
|-----------|--------|------|--------------|
| IPFS Pinning | 500MB | $5/month unlimited | $5 |
| Filecoin Backing | Automatic | Included | $0 |
| IPFS Gateway Reads | Unlimited | Free | $0 |
| **Total** | | | **$5** |

**Geocoding**:

| Provider | Metric | Free Tier | Paid Rate | Monthly Cost (50M geocodes) |
|----------|--------|-----------|-----------|----------------------------|
| Pelias (OSM) | 50M | Unlimited | Free | $0 |
| Mapbox (fallback) | 5M (10% failures) | 100k included | $0.002/geocode | $9.80 |
| **Total** | | | | **$9.80** |

**Total Monthly Cost (100M requests)**:
- Infrastructure: $84.80
- Storage: $5
- Geocoding: $9.80
- **Grand Total: $99.60**

### Revenue Model

**Free Tier**:
- 1000 requests/day per IP = ~3M unique IPs/month
- Revenue: $0
- Cost: $99.60
- **Loss: $99.60**

**Premium Tier** ($10/month):
- 100,000 requests/day per API key
- Target: 100 customers
- Revenue: $1,000/month
- Cost: $150 (incremental infrastructure)
- **Profit: $850**

**Break-Even Analysis**:
```
Free Tier Cost: $100/month
Premium Tier Contribution: $850 per 100 customers
Break-Even: 12 premium customers @ $10/month
```

**Comparison to Competitors**:

| Provider | Free Tier | Paid Tier | Annual Cost (1M lookups) |
|----------|-----------|-----------|-------------------------|
| **Shadow Atlas** | 1000/day | $10/month (100k/day) | $120 |
| Cicero | 0 | $1500/month flat | $18,000 |
| Google Civic API | 0 | $0.005/lookup | $5,000 |

**Competitive Advantage**: 99% cost reduction vs. Cicero, 97% vs. Google.

---

## Deployment Architecture

### Cloudflare Workers Configuration

```typescript
// wrangler.toml
name = "shadow-atlas-api"
main = "src/index.ts"
compatibility_date = "2025-12-18"

[vars]
ENVIRONMENT = "production"
API_VERSION = "v1"

[[r2_buckets]]
binding = "DISTRICTS_BUCKET"
bucket_name = "shadow-atlas-districts"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "..."

[build]
command = "npm run build"
```

**Worker Entry Point**:

```typescript
// src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `ratelimit:${clientIP}:${getCurrentDay()}`;
    const currentCount = await env.RATE_LIMIT_KV.get(rateLimitKey);

    if (currentCount && parseInt(currentCount) >= 1000) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          limit: 1000,
          resetAt: getNextDayTimestamp(),
        }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // Increment rate limit counter
    await env.RATE_LIMIT_KV.put(
      rateLimitKey,
      String((parseInt(currentCount || '0') + 1)),
      { expirationTtl: 86400 } // 24 hours
    );

    // Route request
    if (url.pathname === '/v1/districts') {
      return handleDistrictLookup(request, env);
    } else if (url.pathname.startsWith('/v1/districts/')) {
      return handleDistrictById(request, env);
    } else if (url.pathname === '/v1/health') {
      return handleHealth(request, env);
    } else if (url.pathname === '/v1/snapshot') {
      return handleSnapshot(request, env);
    }

    return new Response(
      JSON.stringify({ error: 'Endpoint not found', code: 'NOT_FOUND' }),
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};
```

**District Lookup Handler**:

```typescript
async function handleDistrictLookup(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const address = url.searchParams.get('address');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  // Geocode if address provided
  let coordinates: { lat: number; lng: number };
  if (address) {
    coordinates = await geocodeAddress(address);
  } else if (lat && lng) {
    coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) };
  } else {
    return new Response(
      JSON.stringify({ error: 'Missing address or coordinates', code: 'INVALID_PARAMETERS' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Determine state from coordinates (bounding box check)
  const state = await determineState(coordinates);

  // Fetch district GeoJSON from R2
  const districtFile = await env.DISTRICTS_BUCKET.get(`districts/US/${state}.geojson`);
  if (!districtFile) {
    return new Response(
      JSON.stringify({ error: 'State not found', code: 'STATE_NOT_FOUND' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const districts = await districtFile.json() as R2DistrictFile;

  // Point-in-polygon test
  const matchingDistrict = findDistrictByPoint(districts, coordinates);
  if (!matchingDistrict) {
    return new Response(
      JSON.stringify({ error: 'No district found at coordinates', code: 'DISTRICT_NOT_FOUND' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Generate Merkle proof
  const snapshot = await env.DISTRICTS_BUCKET.get('metadata/snapshot-current.json');
  const snapshotMetadata = await snapshot.json() as R2SnapshotMetadata;

  // Load Merkle tree (cached in Worker KV)
  const merkleTree = await loadMerkleTree(env, snapshotMetadata.snapshotId);
  const proof = generateMerkleProof(merkleTree, matchingDistrict.id);

  // Return response
  return new Response(
    JSON.stringify({
      district: matchingDistrict,
      coordinates,
      merkleProof: proof,
      provenance: {
        snapshotId: snapshotMetadata.snapshotId,
        ipfsCID: snapshotMetadata.ipfsCID,
        merkleRoot: snapshotMetadata.merkleRoot,
        retrievedAt: new Date().toISOString(),
      },
      latencyMs: Date.now() - startTime,
      cacheHit: false,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
```

---

## Implementation Roadmap

### Phase 1: Core API (Weeks 1-4)

**Week 1-2: Cloudflare Workers Setup**
- Setup Cloudflare Workers project
- Implement rate limiting (KV storage)
- Setup R2 bucket + access credentials
- Deploy "Hello World" API

**Deliverables**:
```typescript
// workers/src/index.ts (minimal viable API)
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return new Response(
      JSON.stringify({ message: 'Shadow Atlas API v1', status: 'ok' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
```

**Week 3-4: District Lookup Implementation**
- Implement coordinate-based lookup (no geocoding)
- Implement point-in-polygon algorithm (ray casting)
- Fetch district GeoJSON from R2
- Generate Merkle proofs

**Deliverables**:
```bash
# Test coordinate lookup
curl "https://api.shadow-atlas.org/v1/districts?lat=39.7392&lng=-104.9903"

# Expected: 200 OK with district + Merkle proof
```

---

### Phase 2: Geocoding Integration (Weeks 5-6)

**Week 5: Pelias OSM Integration**
- Setup Pelias geocoding API (self-hosted or Mapzen)
- Implement address normalization
- Handle geocoding failures gracefully

**Week 6: Mapbox Fallback**
- Integrate Mapbox Geocoding API (paid tier)
- Implement fallback logic (Pelias → Mapbox)
- Monitor geocoding success rates

**Deliverables**:
```bash
# Test address lookup
curl "https://api.shadow-atlas.org/v1/districts?address=123+Main+St,+Denver,+CO"

# Expected: 200 OK with geocoded coordinates + district
```

---

### Phase 3: Quarterly Update Automation (Weeks 7-8)

**Week 7: GitHub Actions Pipeline**
- Implement extraction workflow
- Implement validation + Merkle tree build
- Implement Storacha upload script

**Week 8: R2 Sync Automation**
- Extract GeoJSON from Merkle tree
- Upload to R2 (atomic swap)
- Update snapshot metadata
- Verify deployment

**Deliverables**:
```yaml
# .github/workflows/quarterly-update.yml (complete pipeline)
# Triggers: Quarterly cron OR manual dispatch
```

---

### Phase 4: Production Hardening (Weeks 9-10)

**Week 9: Monitoring + Alerts**
- Setup Cloudflare Analytics
- Implement Prometheus metrics endpoint
- Configure PagerDuty/Sentry alerts
- Load testing (k6, Artillery)

**Week 10: Documentation + Launch**
- API documentation (OpenAPI spec)
- Client SDK (TypeScript, Python)
- Example integrations
- Public launch announcement

**Deliverables**:
- Production-ready API (99.9% uptime SLA)
- Comprehensive documentation
- Client libraries for popular languages

---

## Security Considerations

### Rate Limiting (DDoS Protection)

**Challenge**: Cloudflare Workers free tier = 10M requests/month.
**Solution**: IP-based rate limiting (1000 req/day) enforced in Worker KV.

```typescript
// Rate limit enforcement (in Worker)
const clientIP = request.headers.get('CF-Connecting-IP');
const rateLimitKey = `ratelimit:${clientIP}:${getCurrentDay()}`;
const currentCount = await env.RATE_LIMIT_KV.get(rateLimitKey);

if (currentCount && parseInt(currentCount) >= 1000) {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' }),
    { status: 429 }
  );
}

await env.RATE_LIMIT_KV.put(
  rateLimitKey,
  String((parseInt(currentCount || '0') + 1)),
  { expirationTtl: 86400 } // Auto-expire after 24 hours
);
```

### Merkle Proof Verification (Client-Side)

**Threat**: Malicious server returns forged district data.
**Mitigation**: Client verifies Merkle proof against published IPFS CID.

```typescript
// Client-side verification (browser)
async function verifyDistrictLookup(response: DistrictLookupResponse): Promise<boolean> {
  // 1. Compute leaf hash
  const leafHash = poseidonHash(response.district.id, response.district.geometry);

  // 2. Walk Merkle proof
  let currentHash = leafHash;
  for (let i = 0; i < response.merkleProof.siblings.length; i++) {
    const sibling = response.merkleProof.siblings[i];
    const isLeftChild = response.merkleProof.pathIndices[i] === 0;

    if (isLeftChild) {
      currentHash = poseidonHash(currentHash, sibling);
    } else {
      currentHash = poseidonHash(sibling, currentHash);
    }
  }

  // 3. Verify root matches IPFS snapshot
  const ipfsSnapshot = await fetch(`https://ipfs.io/ipfs/${response.provenance.ipfsCID}`);
  const snapshotData = await ipfsSnapshot.json();

  return currentHash === snapshotData.merkleTree.root;
}
```

### IPFS Content Addressing (Immutability)

**Guarantee**: Once published to IPFS, snapshots are immutable.
**Verification**: CID cryptographically commits to content.

```typescript
// IPFS CID = hash(snapshot content)
// Any modification to snapshot → different CID
// On-chain registry stores CID → tamper-proof audit trail
```

---

## Summary

Shadow Atlas Public API provides free, cryptographically verifiable district lookups via two-tier storage architecture:

1. **R2 (serving)**: Fast API responses, <50ms p95 latency, $100/month for 100M requests
2. **Storacha (verification)**: Permanent IPFS archive, Merkle proof verification, $5/month

**Launch Readiness**:
- Infrastructure: Cloudflare Workers + R2 + Storacha configured
- API: RESTful endpoints with rate limiting + CORS
- Pipeline: GitHub Actions quarterly update automation
- Cost: $100/month free tier, break-even at 12 premium customers

**Next Steps**:
1. Deploy Cloudflare Workers (Week 1-2)
2. Implement district lookup (Week 3-4)
3. Integrate geocoding (Week 5-6)
4. Automate quarterly updates (Week 7-8)
5. Production hardening (Week 9-10)

**Competitive Moat**: 99% cost reduction vs. Cicero, cryptographic verification, zero platform lock-in.
