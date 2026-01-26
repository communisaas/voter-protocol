# Shadow Atlas Serving Layer - Quick Start

Get the production API running in **under 5 minutes**.

---

## Prerequisites

- Node.js 20+
- TypeScript 5.7+
- SQLite database with R-tree index (from Layer 2 transformation)

---

## Installation

```bash
# From packages/crypto directory
cd packages/crypto

# Dependencies already installed (better-sqlite3, @turf/turf)
npm install
```

---

## Quick Start (Development)

### 1. **Run Example Usage**

```bash
# Run all examples (lookup, proof, sync, load test)
npx tsx services/shadow-atlas/serving/example.ts
```

**Expected Output**:
```
=== Example 1: Basic Lookup Service ===
District found: Honolulu City Council District 1
Latency: 23.45 ms
Cache hit: false

Metrics:
  Total queries: 1
  Cache hit rate: 0.0 %
  Latency p50: 23.45 ms
  Latency p95: 23.45 ms
  Latency p99: 23.45 ms

=== Example 2: Proof Generation ===
Generated Merkle proof for: usa-hi-honolulu-district-1
  Root: 0x1234567890abcdef...
  Leaf: 0xabcdef1234567890...
  Siblings: 12
  Path indices: [0, 1, 0, ...]

Proof valid: ✅

=== Example 3: IPFS Sync Service ===
Checking for updates...
✅ Already on latest snapshot

Current snapshot:
  CID: QmXyz789...
  Merkle root: 0x1234567890abcdef...
  District count: 10000
  Version: 1.0.0

=== Example 5: Load Testing Simulation ===
Load test results:
  Total queries: 1000
  Total time: 12,345.67 ms
  Average throughput: 81.0 queries/sec
  Cache hit rate: 85.2 %
  Latency p50: 18.2 ms
  Latency p95: 42.1 ms
  Latency p99: 87.3 ms

Performance targets: ✅ MET
```

---

### 2. **Start HTTP API Server**

```typescript
// server.ts
import { createShadowAtlasAPI } from './services/shadow-atlas/serving';

const api = await createShadowAtlasAPI('/data/shadow-atlas-v1.db', {
  port: 3000,
  host: '0.0.0.0',
  corsOrigins: ['*'], // Development only
  rateLimitPerMinute: 60,
});

api.start();
```

**Run**:
```bash
npx tsx server.ts
```

**Test**:
```bash
# District lookup
curl "http://localhost:3000/lookup?lat=21.3099&lon=-157.8581"

# Health check
curl "http://localhost:3000/health"

# Prometheus metrics
curl "http://localhost:3000/metrics"
```

---

## Production Deployment

### Environment Variables

Create `.env`:
```bash
# API Server
PORT=3000
HOST=0.0.0.0
CORS_ORIGINS=https://voter-protocol.org,https://app.voter-protocol.org

# Database
DB_PATH=/data/shadow-atlas-v1.db

# IPFS Sync
IPFS_GATEWAY=https://ipfs.io
SNAPSHOTS_DIR=/snapshots
SYNC_INTERVAL_SECONDS=3600

# Cache
CACHE_SIZE=10000
CACHE_TTL_SECONDS=3600

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60
```

### Docker Deployment (Self-Hosted)

**Quick Start (Zero Cloud Costs):**
```bash
# Build image
cd packages/shadow-atlas
docker build -t shadow-atlas .

# Run container locally
docker run -d \
  --name shadow-atlas \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  --env-file .env \
  --restart unless-stopped \
  shadow-atlas

# Verify
curl http://localhost:3000/v1/health
```

**Production Deployment:**
```bash
# With persistent volume and custom environment
docker run -d \
  --name shadow-atlas \
  -p 3000:3000 \
  -v /path/to/data:/data \
  -e PORT=3000 \
  -e DB_PATH=/data/shadow-atlas.db \
  -e IPFS_GATEWAY=https://w3s.link \
  --restart unless-stopped \
  shadow-atlas
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  shadow-atlas:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
    environment:
      - PORT=3000
      - DB_PATH=/data/shadow-atlas.db
    restart: unless-stopped
```

Deploy:
```bash
docker-compose up -d
```

### Cost-Efficient VPS Deployment

**DigitalOcean Droplet ($6/month):**
```bash
# SSH into droplet
ssh root@your-droplet-ip

# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and deploy
git clone https://github.com/voter-protocol/voter-protocol.git
cd voter-protocol/packages/shadow-atlas
docker build -t shadow-atlas .
docker run -d -p 3000:3000 -v /data:/data shadow-atlas
```

**Runs on any Docker host:** Home server, Raspberry Pi 4+, NAS, or VPS

---

## API Usage

### JavaScript/TypeScript Client

```typescript
// Client-side district lookup
async function lookupDistrict(lat: number, lon: number) {
  const response = await fetch(
    `https://api.shadow-atlas.org/lookup?lat=${lat}&lon=${lon}`
  );

  if (!response.ok) {
    throw new Error(`Lookup failed: ${response.status}`);
  }

  const { district, merkleProof } = await response.json();

  // Verify Merkle proof
  const isValid = verifyMerkleProof(merkleProof);
  if (!isValid) {
    throw new Error('Invalid Merkle proof from server');
  }

  return district;
}

// Merkle proof verification (browser)
function verifyMerkleProof(proof: MerkleProof): boolean {
  let hash = proof.leaf;

  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    const isLeftChild = proof.pathIndices[i] === 0;

    // Use WASM Poseidon hash (matches circuit)
    hash = isLeftChild
      ? poseidonHash(hash, sibling)
      : poseidonHash(sibling, hash);
  }

  return hash === PUBLISHED_MERKLE_ROOT;
}
```

### cURL Examples

```bash
# Basic lookup
curl "https://api.shadow-atlas.org/lookup?lat=21.3099&lon=-157.8581"

# With jq formatting
curl -s "https://api.shadow-atlas.org/lookup?lat=21.3099&lon=-157.8581" | jq

# Health check
curl "https://api.shadow-atlas.org/health" | jq '.status'

# Metrics (Prometheus format)
curl "https://api.shadow-atlas.org/metrics"
```

---

## Monitoring

### Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'shadow-atlas'
    static_configs:
      - targets: ['api.shadow-atlas.org:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboard

**Import JSON**:
```json
{
  "dashboard": {
    "title": "Shadow Atlas API",
    "panels": [
      {
        "title": "Query Latency (p95)",
        "targets": [
          {
            "expr": "shadow_atlas_query_latency_seconds{quantile=\"0.95\"}"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "targets": [
          {
            "expr": "shadow_atlas_cache_hit_rate"
          }
        ]
      }
    ]
  }
}
```

---

## Performance Testing

### Load Test (k6)

```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },  // Ramp up
    { duration: '1m', target: 100 },   // Sustained
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'],   // 95% < 50ms
  },
};

export default function () {
  const lat = 21.3099;
  const lon = -157.8581;
  const res = http.get(`http://localhost:3000/lookup?lat=${lat}&lon=${lon}`);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 50ms': (r) => r.timings.duration < 50,
  });

  sleep(1);
}
```

**Run**:
```bash
k6 run load-test.js
```

---

## Troubleshooting

### Issue: High Latency

**Symptoms**: p95 latency >50ms

**Solutions**:
1. Check cache hit rate: `curl localhost:3000/health | jq '.cache.hitRate'`
2. Increase cache size: Set `CACHE_SIZE=20000`
3. Verify R-tree index: `sqlite3 shadow-atlas-v1.db "EXPLAIN QUERY PLAN SELECT ..."`

### Issue: Low Cache Hit Rate

**Symptoms**: Hit rate <50%

**Solutions**:
1. Check query distribution (are queries random?)
2. Increase cache TTL: Set `CACHE_TTL_SECONDS=7200`
3. Pre-warm cache with popular coordinates

### Issue: Memory Usage

**Symptoms**: Process using >2GB RAM

**Solutions**:
1. Reduce cache size: Set `CACHE_SIZE=5000`
2. Check for leaks: `node --inspect server.ts`
3. Enable heap snapshots: `kill -SIGUSR2 <pid>`

---

## Next Steps

1. **Build Transformation Pipeline** (Layer 2)
   - Create SQLite database with R-tree index
   - Populate with real district data
   - Generate Merkle tree

2. **Deploy to Production**
   - Deploy with Docker (local or VPS)
   - Configure Prometheus scraping (optional)
   - Create Grafana dashboards (optional)
   - Set up alerting (optional)

3. **Integrate with Frontend**
   - Add client-side verification
   - Implement ZK proof generation
   - Submit proofs on-chain

---

## Support

**Documentation**: `/serving/README.md`
**Examples**: `/serving/example.ts`

**Questions?** Check the core documentation:
`/packages/crypto/services/shadow-atlas/core/README.md`

---

**Quick start complete! 🚀**

You now have a production-ready API serving district lookups with <50ms latency and cryptographic verification.
