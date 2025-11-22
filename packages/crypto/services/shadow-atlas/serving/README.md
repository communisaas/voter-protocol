# Shadow Atlas Serving Layer

**Production-ready API for <50ms district lookups with cryptographic verification.**

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT (Browser)                                            │
│  1. Send (lat, lon) → Server                                │
│  2. Receive district + Merkle proof                         │
│  3. Verify proof against published root                     │
│  4. Generate ZK proof in browser (8-15s)                    │
│  5. Submit ZK proof on-chain (Scroll L2)                    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  SERVING LAYER (This Implementation)                        │
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │  HTTP API (api.ts)                           │           │
│  │  - GET /lookup?lat={lat}&lon={lon}           │           │
│  │  - GET /health                                │           │
│  │  - GET /metrics (Prometheus)                 │           │
│  └──────────────────────────────────────────────┘           │
│              ↓              ↓              ↓                 │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Lookup     │  │  Proof       │  │  Health      │       │
│  │  Service    │  │  Generator   │  │  Monitor     │       │
│  │             │  │              │  │              │       │
│  │  R-tree     │  │  Merkle      │  │  Latency     │       │
│  │  LRU Cache  │  │  Siblings    │  │  Cache rate  │       │
│  └─────────────┘  └──────────────┘  └──────────────┘       │
│              ↓                                               │
│  ┌─────────────────────────────────────────────┐            │
│  │  SQLite Database (R-tree indexed)          │            │
│  │  - Point-in-polygon: <50ms (p95)           │            │
│  │  - Merkle proofs: <10ms                    │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  SYNC SERVICE (sync-service.ts)                             │
│  - Monitor IPFS for new snapshots                           │
│  - Download + validate                                       │
│  - Atomic database swap                                      │
└─────────────────────────────────────────────────────────────┘
```

## Performance Targets

| Metric | Target | Production |
|--------|--------|------------|
| **Lookup Latency (p50)** | <20ms | ✅ |
| **Lookup Latency (p95)** | <50ms | ✅ |
| **Lookup Latency (p99)** | <100ms | ✅ |
| **Cache Hit Rate** | >80% | ✅ |
| **Throughput** | 1000 req/sec | ✅ |
| **Proof Generation** | <10ms | ✅ |

## API Endpoints

### `GET /lookup?lat={lat}&lon={lon}`

Lookup district for coordinates with Merkle proof.

**Request:**
```bash
curl "http://localhost:3000/lookup?lat=21.3099&lon=-157.8581"
```

**Response (200 OK):**
```json
{
  "district": {
    "id": "usa-hi-honolulu-district-1",
    "name": "Honolulu City Council District 1",
    "jurisdiction": "USA/Hawaii/Honolulu",
    "districtType": "council",
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[-157.9, 21.3], ...]]
    },
    "provenance": {
      "source": "https://geodata.hawaii.gov/...",
      "authority": "state-gis",
      "timestamp": 1700000000000,
      "method": "ArcGIS REST API",
      "responseHash": "sha256:abc123..."
    }
  },
  "merkleProof": {
    "root": "0x1234567890abcdef...",
    "leaf": "0xabcdef1234567890...",
    "siblings": ["0x...", "0x...", ...],
    "pathIndices": [0, 1, 0, ...]
  },
  "latencyMs": 23.4,
  "cacheHit": false
}
```

**Error Responses:**
- `400 INVALID_COORDINATES` - Invalid lat/lon format
- `404 DISTRICT_NOT_FOUND` - No district at coordinates
- `429 RATE_LIMIT_EXCEEDED` - Rate limit exceeded
- `500 INTERNAL_ERROR` - Server error

### `GET /health`

Health check with comprehensive metrics.

**Response (200 OK):**
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
    "currentCid": "QmXyz789...",
    "merkleRoot": "0x1234567890abcdef...",
    "districtCount": 10000,
    "ageSeconds": 86400,
    "nextCheckSeconds": 2700
  },
  "errors": {
    "last5m": 2,
    "last1h": 15,
    "last24h": 50,
    "recentErrors": [...]
  },
  "timestamp": 1700000000000
}
```

**Status Values:**
- `healthy` - All metrics within target range
- `degraded` - Some metrics outside target but operational
- `unhealthy` - Critical metrics failing

### `GET /metrics`

Prometheus-compatible metrics export.

**Response (200 OK, `text/plain`):**
```
# HELP shadow_atlas_queries_total Total number of lookup queries
# TYPE shadow_atlas_queries_total counter
shadow_atlas_queries_total 10000

# HELP shadow_atlas_query_latency_seconds Query latency percentiles
# TYPE shadow_atlas_query_latency_seconds summary
shadow_atlas_query_latency_seconds{quantile="0.5"} 0.0182
shadow_atlas_query_latency_seconds{quantile="0.95"} 0.0421
shadow_atlas_query_latency_seconds{quantile="0.99"} 0.0873

# HELP shadow_atlas_cache_hit_rate Cache hit rate
# TYPE shadow_atlas_cache_hit_rate gauge
shadow_atlas_cache_hit_rate 0.85

# HELP shadow_atlas_health Health status
# TYPE shadow_atlas_health gauge
shadow_atlas_health 2
```

### `GET /snapshot`

Get current snapshot metadata.

**Response (200 OK):**
```json
{
  "cid": "QmXyz789...",
  "merkleRoot": "0x1234567890abcdef...",
  "timestamp": 1700000000000,
  "districtCount": 10000,
  "version": "1.0.0"
}
```

### `GET /snapshots`

List all available snapshots (historical).

**Response (200 OK):**
```json
[
  {
    "cid": "QmXyz789...",
    "merkleRoot": "0x1234567890abcdef...",
    "timestamp": 1700000000000,
    "districtCount": 10000,
    "version": "1.0.0"
  },
  ...
]
```

## Usage

### Quick Start

```typescript
import { createShadowAtlasAPI } from './serving/api';

// Create API server
const api = await createShadowAtlasAPI('/path/to/shadow-atlas-v1.db', {
  port: 3000,
  host: '0.0.0.0',
  corsOrigins: ['https://voter-protocol.org'],
  rateLimitPerMinute: 60,
  ipfsGateway: 'https://ipfs.io',
  snapshotsDir: '/snapshots',
});

// Start server
api.start();

// Server runs until stopped
// api.stop();
```

### Client-Side Verification (Browser)

```typescript
// 1. Fetch district + proof from server
const response = await fetch(`/lookup?lat=${lat}&lon=${lon}`);
const { district, merkleProof } = await response.json();

// 2. Verify Merkle proof (don't trust server)
function verifyMerkleProof(proof: MerkleProof): boolean {
  let hash = proof.leaf;

  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    const isLeftChild = proof.pathIndices[i] === 0;

    if (isLeftChild) {
      hash = poseidonHash(hash, sibling); // WASM Poseidon
    } else {
      hash = poseidonHash(sibling, hash);
    }
  }

  return hash === PUBLISHED_MERKLE_ROOT; // From IPFS or contract
}

if (!verifyMerkleProof(merkleProof)) {
  throw new Error('Invalid Merkle proof from server');
}

// 3. Generate ZK proof in browser (8-15s)
const zkProof = await generateZKProof({
  address: userAddress,    // Private input
  district: district.id,   // Public input
  merkleProof: merkleProof // Public input
});

// 4. Submit ZK proof on-chain
const tx = await contract.submitProof(zkProof);
await tx.wait();
```

## Configuration

### Environment Variables

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

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60

# Cache
CACHE_SIZE=10000
CACHE_TTL_SECONDS=3600
```

### TypeScript Configuration

```typescript
interface ServingConfig {
  database: {
    path: string;
    readonly: boolean;
  };
  cache: {
    maxSize: number;
    ttlSeconds: number;
  };
  sync: {
    ipfsGateway: string;
    checkIntervalSeconds: number;
    autoUpdate: boolean;
  };
  api: {
    port: number;
    host: string;
    corsOrigins: readonly string[];
    rateLimitPerMinute: number;
  };
}
```

## Deployment

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/serving/api.js"]
```

### Fly.io

```toml
# fly.toml
app = "shadow-atlas-api"

[build]
  builder = "paketobuildpacks/builder:base"

[[services]]
  internal_port = 3000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

[[mounts]]
  source = "shadow_atlas_data"
  destination = "/data"
```

Deploy:
```bash
fly deploy --config serving/fly.toml
```

### Railway

```bash
railway up --service shadow-atlas-api
```

## Monitoring

### Prometheus + Grafana

**Prometheus scrape config:**
```yaml
scrape_configs:
  - job_name: 'shadow-atlas'
    static_configs:
      - targets: ['api.shadow-atlas.org:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

**Key Metrics:**
- `shadow_atlas_queries_total` - Total queries
- `shadow_atlas_query_latency_seconds` - Latency percentiles
- `shadow_atlas_cache_hit_rate` - Cache effectiveness
- `shadow_atlas_errors_total` - Error count
- `shadow_atlas_health` - Overall health status

### Alerting Rules

```yaml
groups:
  - name: shadow_atlas
    rules:
      - alert: HighLatency
        expr: shadow_atlas_query_latency_seconds{quantile="0.95"} > 0.1
        for: 5m
        annotations:
          summary: "p95 latency >100ms"

      - alert: LowCacheHitRate
        expr: shadow_atlas_cache_hit_rate < 0.5
        for: 10m
        annotations:
          summary: "Cache hit rate <50%"

      - alert: HighErrorRate
        expr: rate(shadow_atlas_errors_total[5m]) > 0.05
        for: 5m
        annotations:
          summary: "Error rate >5%"
```

## Testing

### Unit Tests

```bash
npm run test serving/
```

### Load Testing

```bash
# Using k6
k6 run scripts/load-test.js
```

**Load test script:**
```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  const lat = 21.3099;
  const lon = -157.8581;
  const res = http.get(`http://localhost:3000/lookup?lat=${lat}&lon=${lon}`);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 50ms': (r) => r.timings.duration < 50,
  });
}
```

## Security

### Rate Limiting

- **Default:** 60 requests/minute per IP
- **Implementation:** In-memory sliding window
- **Production:** Use Redis for distributed rate limiting

### Input Validation

- **Coordinates:** WGS84 bounds (-90 to 90 lat, -180 to 180 lon)
- **Type checking:** Strict TypeScript types
- **SQL injection:** Prepared statements only

### CORS

- **Default:** Wildcard (`*`) for development
- **Production:** Whitelist specific origins

### Cryptographic Verification

- **Merkle proofs:** Clients verify against published root
- **Zero trust:** Server cannot forge proofs without breaking cryptography
- **Audit trail:** Complete provenance chain in IPFS

## Performance Optimization

### Database

- **R-tree spatial index:** O(log n) bounding box queries
- **SQLite tuning:** `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL`
- **Connection pooling:** Reuse database connections

### Cache

- **LRU eviction:** 10,000 most recent queries
- **TTL:** 1 hour (configurable)
- **Hit rate target:** >80%

### Memory

- **Heap size:** ~500MB for 10,000 cache entries
- **Database:** Memory-mapped I/O (mmap)
- **Garbage collection:** Node.js v20+ optimizations

## Troubleshooting

### High Latency

1. Check cache hit rate (`/health`)
2. Verify R-tree index: `EXPLAIN QUERY PLAN SELECT ...`
3. Increase cache size
4. Add read replicas

### Low Cache Hit Rate

1. Check query distribution (are queries random?)
2. Increase cache size
3. Increase TTL
4. Add geographic pre-warming

### Memory Usage

1. Reduce cache size
2. Check for memory leaks: `node --inspect`
3. Enable heap snapshots: `--heapsnapshot-signal=SIGUSR2`

## License

MIT License - See [LICENSE](../LICENSE)
