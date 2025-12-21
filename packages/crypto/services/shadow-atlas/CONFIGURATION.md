# Shadow Atlas Configuration Reference

Unified configuration reference for all Shadow Atlas subsystems.

---

## Configuration Layers

Shadow Atlas configuration is organized into four layers:

```
┌─────────────────────────────────────────────────────────┐
│  1. Core Service Configuration                          │
│     (createShadowAtlasService, createProductionService) │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  2. Acquisition Configuration                           │
│     (ArcGIS Portal, State GIS, OSM scrapers)            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  3. Persistence Configuration                           │
│     (SQLite/PostgreSQL job orchestration)               │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│  4. Serving Configuration                               │
│     (HTTP API, cache, R-tree index)                     │
└─────────────────────────────────────────────────────────┘
```

---

## Environment Variables

### Core Service

```bash
# Service mode
NODE_ENV=production              # "development" | "production" | "test"

# IPFS configuration
IPFS_GATEWAY=https://ipfs.io     # IPFS gateway URL
IPFS_PIN_SERVICE=storacha        # "storacha" | "pinata" | "web3storage"
IPFS_API_TOKEN=<token>           # Service-specific API token

# Logging
LOG_LEVEL=info                   # "debug" | "info" | "warn" | "error"
LOG_FORMAT=json                  # "json" | "pretty"
```

### Acquisition

```bash
# Rate limiting
ARCGIS_RATE_LIMIT=10             # Requests per second (ArcGIS Portal)
STATE_GIS_RATE_LIMIT=5           # Requests per second (State GIS)
OSM_RATE_LIMIT=1                 # Requests per second (Overpass API)

# Retry configuration
MAX_RETRIES=3                    # Maximum retry attempts
RETRY_DELAY_MS=2000              # Initial retry delay (exponential backoff)
REQUEST_TIMEOUT_MS=60000         # Request timeout (60 seconds)

# Concurrency
MAX_PARALLEL_SCRAPERS=10         # Concurrent scraper instances

# Output directories
RAW_OUTPUT_DIR=./acquisition/outputs/raw  # Raw GeoJSON output
STAGING_DIR=./data/staging       # Staging for manual review
```

### Persistence

```bash
# Database
DB_TYPE=sqlite                   # "sqlite" | "postgresql"
DB_PATH=./.shadow-atlas/persistence.db  # SQLite file path

# PostgreSQL (if DB_TYPE=postgresql)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=shadow_atlas
DB_USER=shadow_atlas_app
DB_PASSWORD=<password>
DB_SSL=true                      # Enable SSL
DB_POOL_MIN=2                    # Minimum pool size
DB_POOL_MAX=10                   # Maximum pool size

# Job configuration
JOB_TIMEOUT_MS=3600000           # Job timeout (1 hour)
JOB_CLEANUP_DAYS=30              # Archive jobs older than 30 days
```

### Serving

```bash
# API server
API_PORT=3000
API_HOST=0.0.0.0
API_CORS_ORIGINS=https://voter-protocol.org,https://app.voter-protocol.org

# Rate limiting
API_RATE_LIMIT_PER_MINUTE=60     # Requests per minute per IP

# Cache configuration
CACHE_SIZE=10000                 # LRU cache size (entries)
CACHE_TTL_SECONDS=3600           # Cache TTL (1 hour)

# Database (R-tree indexed)
SERVING_DB_PATH=./data/shadow-atlas-v1.db  # Production database

# Sync service
SYNC_INTERVAL_SECONDS=3600       # Check for updates every hour
SYNC_AUTO_UPDATE=true            # Automatically apply updates
SNAPSHOTS_DIR=./snapshots        # Snapshot storage directory

# Monitoring
ENABLE_METRICS=true              # Enable Prometheus metrics
METRICS_PORT=9090                # Metrics endpoint port
```

---

## TypeScript Configuration

### Core Service Configuration

```typescript
interface ShadowAtlasConfig {
  /** Extraction configuration */
  extraction: ExtractionConfig;

  /** Validation configuration */
  validation: ValidationConfig;

  /** IPFS configuration */
  ipfs: IPFSConfig;

  /** Logging configuration */
  logging?: LoggingConfig;
}

interface ExtractionConfig {
  /** Maximum concurrent extractions */
  concurrency: number;              // Default: 5

  /** Maximum retry attempts */
  retryAttempts: number;            // Default: 3

  /** Initial retry delay (ms) */
  retryDelayMs: number;             // Default: 2000

  /** Request timeout (ms) */
  timeoutMs: number;                // Default: 30000
}

interface ValidationConfig {
  /** Minimum validation pass rate (0-1) */
  minPassRate: number;              // Default: 0.9

  /** Enable cross-validation with TIGER */
  crossValidate: boolean;           // Default: true

  /** Store validation results to database */
  storeResults: boolean;            // Default: true
}

interface IPFSConfig {
  /** IPFS gateway URL */
  gateway: string;                  // Default: "https://ipfs.io/ipfs/"

  /** IPFS pinning service */
  pinService?: 'storacha' | 'pinata' | 'web3storage';

  /** API token for pinning service */
  apiToken?: string;
}

interface LoggingConfig {
  /** Log level */
  level: 'debug' | 'info' | 'warn' | 'error';  // Default: "info"

  /** Log format */
  format: 'json' | 'pretty';        // Default: "json"
}
```

### Factory Presets

```typescript
import {
  createShadowAtlasService,
  createProductionService,
  createDevelopmentService,
  createTestService
} from './core';

// Default configuration
const atlas = createShadowAtlasService();

// Production configuration (async - requires await)
const production = await createProductionService();
// - Higher concurrency (10)
// - Stricter validation (95% pass rate)
// - IPFS pinning enabled
// - JSON logging

// Development configuration (async - requires await)
const development = await createDevelopmentService();
// - Lower concurrency (3)
// - Relaxed validation (80% pass rate)
// - Local IPFS gateway
// - Pretty logging

// Test configuration (synchronous - no await needed)
const test = createTestService();
// - Sequential execution (1)
// - No retries
// - Minimal validation (70% pass rate)
// - Debug logging
```

### Custom Configuration

```typescript
import { createShadowAtlasService } from './core';

const atlas = createShadowAtlasService({
  extraction: {
    concurrency: 8,
    retryAttempts: 5,
    retryDelayMs: 3000,
    timeoutMs: 45000,
  },
  validation: {
    minPassRate: 0.92,
    crossValidate: true,
    storeResults: true,
  },
  ipfs: {
    gateway: 'https://dweb.link/ipfs/',
    pinService: 'storacha',
    apiToken: process.env.STORACHA_API_TOKEN,
  },
  logging: {
    level: 'info',
    format: 'json',
  },
});
```

---

## Acquisition Configuration

### ArcGIS Portal Scraper

```typescript
import { ArcGISPortalScraper } from './acquisition/pipelines/arcgis-portal-scraper.js';

const scraper = new ArcGISPortalScraper({
  /** Maximum parallel requests */
  maxParallel: 10,              // Default: 10

  /** Rate limit (requests per second) */
  rateLimit: 10,                // Default: 10

  /** Request timeout (ms) */
  timeout: 60000,               // Default: 60000

  /** Maximum retry attempts */
  maxRetries: 3,                // Default: 3

  /** Exponential backoff multiplier */
  backoffMultiplier: 2,         // Default: 2

  /** Output directory for raw GeoJSON */
  outputDir: './acquisition/outputs/raw',
});

const result = await scraper.scrapeAll();
```

### State GIS Scraper

```typescript
import { StateGISScraper } from './acquisition/pipelines/state-gis-scraper.js';

const scraper = new StateGISScraper({
  maxParallel: 5,               // Default: 5
  rateLimit: 5,                 // Default: 5 (conservative)
  timeout: 60000,
  maxRetries: 3,
  backoffMultiplier: 2,
  outputDir: './acquisition/outputs/raw',
});

// Extract specific state
const wiData = await scraper.scrapeState('WI');

// Extract all configured states
const allData = await scraper.scrapeAll();
```

### OpenStreetMap Scraper

```typescript
import { OSMScraper } from './acquisition/pipelines/osm-scraper.js';

const scraper = new OSMScraper({
  maxParallel: 1,               // Default: 1 (Overpass API is strict)
  rateLimit: 1,                 // Default: 1 req/sec
  timeout: 120000,              // Default: 120 seconds (OSM queries are slow)
  maxRetries: 3,
  backoffMultiplier: 2,
  outputDir: './acquisition/outputs/raw',

  /** Overpass API endpoint */
  overpassEndpoint: 'https://overpass-api.de/api/interpreter',
});

const result = await scraper.scrapeCountry('US');
```

### Post-Download Validator

```typescript
import { PostDownloadValidator } from './acquisition/post-download-validator.js';

const validator = new PostDownloadValidator({
  /** Minimum feature count */
  minFeatureCount: 1,           // Default: 1

  /** Maximum feature count (reject precincts) */
  maxFeatureCount: 100,         // Default: 100

  /** Minimum confidence for auto-accept */
  minConfidence: 85,            // Default: 85

  /** Confidence threshold for manual review */
  reviewThreshold: 60,          // Default: 60
});

const validation = validator.validate(geojson, {
  source: 'https://portal.example.gov/...',
  city: 'Madison',
  state: 'WI',
});

if (validation.confidence >= 85) {
  console.log('✅ Auto-accepted');
} else if (validation.confidence >= 60) {
  console.log('⚠️  Manual review required');
} else {
  console.log('❌ Rejected');
}
```

---

## Persistence Configuration

### Database Schema

**SQLite (Development)**:

```typescript
import Database from 'better-sqlite3';

const db = new Database('./.shadow-atlas/persistence.db');

// Enable foreign keys (required for constraints)
db.pragma('foreign_keys = ON');

// Enable WAL mode (better concurrency)
db.pragma('journal_mode = WAL');

// Optimize for speed (less durability)
db.pragma('synchronous = NORMAL');

// Load schema
const schema = await fs.readFile('./persistence/schema.sql', 'utf-8');
db.exec(schema);
```

**PostgreSQL (Production)**:

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'shadow_atlas',
  user: process.env.DB_USER || 'shadow_atlas_app',
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Load schema
const schema = await fs.readFile('./persistence/schema.sql', 'utf-8');
await pool.query(schema);
```

### Job Store Configuration

```typescript
import { JobStateStore } from './persistence/job-state-store.js';

const jobStore = new JobStateStore({
  /** Database type */
  dbType: 'sqlite',             // "sqlite" | "postgresql"

  /** Database path (SQLite only) */
  dbPath: './.shadow-atlas/persistence.db',

  /** PostgreSQL connection pool (if dbType = "postgresql") */
  pgPool: pool,

  /** Job timeout (ms) */
  jobTimeoutMs: 3600000,        // 1 hour

  /** Auto-cleanup archived jobs older than (days) */
  cleanupDays: 30,
});

// Create job
const jobId = await jobStore.createJob({
  scopeStates: ['WI', 'MI'],
  scopeLayers: ['congressional', 'state_senate'],
});

// Update job status
await jobStore.updateJobStatus(jobId, 'running');

// Record extraction
await jobStore.recordExtraction({
  jobId,
  stateCode: 'WI',
  layerType: 'congressional',
  boundaryCount: 8,
  validationPassed: true,
  provenance: { ... },
});

// Query jobs
const activeJobs = await jobStore.getActiveJobs();
```

---

## Serving Configuration

### HTTP API Server

```typescript
import { createShadowAtlasAPI } from './serving/api.js';

const api = await createShadowAtlasAPI('/path/to/shadow-atlas-v1.db', {
  /** API server configuration */
  api: {
    port: 3000,
    host: '0.0.0.0',
    corsOrigins: ['https://voter-protocol.org'],
    rateLimitPerMinute: 60,
  },

  /** Database configuration */
  database: {
    path: '/data/shadow-atlas-v1.db',
    readonly: true,
  },

  /** Cache configuration */
  cache: {
    maxSize: 10000,             // LRU cache size
    ttlSeconds: 3600,           // 1 hour TTL
  },

  /** Sync service configuration */
  sync: {
    ipfsGateway: 'https://ipfs.io',
    checkIntervalSeconds: 3600, // Check for updates every hour
    autoUpdate: true,           // Automatically apply updates
  },

  /** Monitoring configuration */
  monitoring: {
    enableMetrics: true,        // Enable Prometheus metrics
    metricsPort: 9090,          // Separate port for /metrics
  },
});

// Start server
api.start();
console.log(`Shadow Atlas API listening on port 3000`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await api.stop();
  process.exit(0);
});
```

### District Lookup Service

```typescript
import { DistrictService } from './serving/district-service.js';

const service = new DistrictService({
  /** Database path */
  dbPath: '/data/shadow-atlas-v1.db',

  /** Cache configuration */
  cache: {
    maxSize: 10000,
    ttlSeconds: 3600,
  },

  /** R-tree index configuration */
  rtree: {
    maxEntries: 9,              // R-tree max entries per node
    minEntries: 4,              // R-tree min entries per node
  },
});

// Lookup district
const result = await service.lookup(47.6062, -122.3321);
console.log(result.district.name);  // "Seattle City Council District 7"
console.log(result.latencyMs);      // 23.4
console.log(result.cacheHit);       // false
```

### Proof Generator

```typescript
import { ProofGenerator } from './serving/proof-generator.js';

const generator = new ProofGenerator({
  /** Database path */
  dbPath: '/data/shadow-atlas-v1.db',

  /** Merkle tree cache */
  cacheTree: true,              // Cache merkle tree in memory
});

// Generate proof for district
const proof = await generator.generateProof('usa-wa-seattle-district-7');

console.log(proof.root);        // "0x1234567890abcdef..."
console.log(proof.leaf);        // "0xabcdef1234567890..."
console.log(proof.siblings);    // ["0x...", "0x...", ...]
console.log(proof.pathIndices); // [0, 1, 0, ...]
```

### Sync Service

```typescript
import { SyncService } from './serving/sync-service.js';

const sync = new SyncService({
  /** IPFS gateway URL */
  ipfsGateway: 'https://ipfs.io',

  /** Check interval (seconds) */
  checkIntervalSeconds: 3600,

  /** Automatically apply updates */
  autoUpdate: true,

  /** Snapshots directory */
  snapshotsDir: './snapshots',

  /** Current database path */
  currentDbPath: '/data/shadow-atlas-v1.db',

  /** Callback on update available */
  onUpdateAvailable: async (newCid) => {
    console.log(`New snapshot available: ${newCid}`);
  },

  /** Callback on update applied */
  onUpdateApplied: async (newCid) => {
    console.log(`Updated to snapshot: ${newCid}`);
    // Reload API server with new database
  },
});

// Start sync service
sync.start();

// Manual sync check
const hasUpdate = await sync.checkForUpdates();
if (hasUpdate) {
  await sync.applyUpdate();
}

// Stop sync service
sync.stop();
```

---

## Cross-Cutting Concerns

### Provenance Configuration

```typescript
import { ProvenanceWriter } from './provenance/provenance-writer.js';

const writer = new ProvenanceWriter('./discovery-attempts', {
  /** Enable staging mode (zero contention) */
  staging: true,

  /** Compression level (0-9) */
  compressionLevel: 6,          // Default: 6

  /** Flush interval (ms) */
  flushIntervalMs: 5000,        // Default: 5000

  /** Enable FIPS sharding (50-state parallelism) */
  enableSharding: true,         // Default: true
});

// Append discovery entry
await writer.append(entry, { staging: true, agentId: 'agt-042' });

// Background merge (runs periodically)
setInterval(async () => {
  const { merged, errors } = await writer.mergeStagingFiles();
  console.log(`Merged ${merged} entries, ${errors} errors`);
}, 60000); // Every minute
```

### Logging Configuration

```typescript
import { createLogger } from './utils/logger.js';

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.LOG_FORMAT || 'json',
  destination: process.env.LOG_FILE || 'stdout',
});

logger.info('Starting Shadow Atlas API', { port: 3000 });
logger.error('Failed to extract state', { state: 'WI', error: err.message });
logger.debug('Cache hit', { key: 'WI-congressional', latency: 5.2 });
```

---

## Configuration Validation

### Runtime Validation

```typescript
import { validateConfig } from './core/config.js';

const config = {
  extraction: {
    concurrency: 5,
    retryAttempts: 3,
    retryDelayMs: 2000,
    timeoutMs: 30000,
  },
  validation: {
    minPassRate: 0.9,
    crossValidate: true,
    storeResults: true,
  },
  ipfs: {
    gateway: 'https://ipfs.io/ipfs/',
  },
};

// Validate configuration (throws if invalid)
const validated = validateConfig(config);
```

### Environment Variable Validation

```bash
# Run validation script
npx tsx scripts/validate-config.ts

# Output:
# ✅ All required environment variables present
# ✅ Database connection successful
# ✅ IPFS gateway reachable
# ✅ Rate limits within safe bounds
```

---

## Docker Configuration

### Development

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Development configuration
ENV NODE_ENV=development
ENV LOG_LEVEL=debug
ENV LOG_FORMAT=pretty

CMD ["npm", "run", "dev"]
```

### Production

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .
RUN npm run build

# Production configuration
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV LOG_FORMAT=json

# API server
EXPOSE 3000

# Metrics endpoint
EXPOSE 9090

CMD ["node", "dist/serving/api.js"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
      - "9090:9090"
    environment:
      - NODE_ENV=production
      - DB_TYPE=postgresql
      - DB_HOST=postgres
      - DB_NAME=shadow_atlas
      - DB_USER=shadow_atlas_app
      - DB_PASSWORD=${DB_PASSWORD}
      - IPFS_GATEWAY=https://ipfs.io
    depends_on:
      - postgres
    volumes:
      - ./data:/data
      - ./snapshots:/snapshots

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=shadow_atlas
      - POSTGRES_USER=shadow_atlas_app
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## Configuration Examples

### Minimal (Development)

```bash
# .env.development
NODE_ENV=development
LOG_LEVEL=debug
LOG_FORMAT=pretty
DB_TYPE=sqlite
DB_PATH=./.shadow-atlas/dev.db
API_PORT=3000
CACHE_SIZE=1000
```

### Complete (Production)

```bash
# .env.production
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=json

# Database
DB_TYPE=postgresql
DB_HOST=shadow-atlas-db.internal
DB_PORT=5432
DB_NAME=shadow_atlas
DB_USER=shadow_atlas_app
DB_PASSWORD=<secure-password>
DB_SSL=true
DB_POOL_MIN=5
DB_POOL_MAX=20

# API
API_PORT=3000
API_HOST=0.0.0.0
API_CORS_ORIGINS=https://voter-protocol.org,https://app.voter-protocol.org
API_RATE_LIMIT_PER_MINUTE=120

# Cache
CACHE_SIZE=50000
CACHE_TTL_SECONDS=3600

# IPFS
IPFS_GATEWAY=https://dweb.link/ipfs/
IPFS_PIN_SERVICE=storacha
IPFS_API_TOKEN=<storacha-token>

# Sync
SYNC_INTERVAL_SECONDS=1800
SYNC_AUTO_UPDATE=true
SNAPSHOTS_DIR=/data/snapshots

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090

# Acquisition
ARCGIS_RATE_LIMIT=15
STATE_GIS_RATE_LIMIT=8
MAX_PARALLEL_SCRAPERS=15
```

---

## References

- **Core API**: [core/README.md](core/README.md)
- **Acquisition**: [acquisition/README.md](acquisition/README.md)
- **Persistence**: [persistence/README.md](persistence/README.md)
- **Serving**: [serving/README.md](serving/README.md)
- **Technical Spec**: [SHADOW-ATLAS-TECHNICAL-SPEC.md](SHADOW-ATLAS-TECHNICAL-SPEC.md)
