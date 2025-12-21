# Layer 1: Acquisition

Production-grade batch scrapers for authoritative municipal boundary data.

## Overview

Layer 1 (Acquisition) scrapes raw GeoJSON from authoritative sources and stores it with cryptographic provenance metadata. This layer runs **quarterly** (not per-city) and produces immutable snapshots.

**Philosophy**: Municipal boundaries are finite, stable, and authoritative. Unlike user-generated content or market data, geographic boundaries change on decade timescales. This enables a scrape-then-serve architecture with cryptographic verifiability.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: ACQUISITION (Quarterly Batch)                        │
│                                                                 │
│  Input:  Authoritative sources (state GIS, ArcGIS Portal, OSM) │
│  Output: Immutable snapshots with cryptographic provenance     │
│  Frequency: Quarterly + event-driven updates                   │
│  Parallelism: 50 states × 10 workers = 500 concurrent scrapes  │
│                                                                 │
│  Validation: Stage 1 (Post-Download)                           │
│    - Reject obviously wrong data BEFORE writing to disk        │
│    - Confidence routing: 0-59 reject, 60-84 review, 85-100 ✓  │
└─────────────────────────────────────────────────────────────────┘
```

## Stage 1: Post-Download Validation

**Philosophy**: Reject obviously wrong data BEFORE it enters the pipeline.

### Validation Rules

Immediately after scraper downloads GeoJSON:

1. **Type Validation** (CRITICAL)
   - Must be valid GeoJSON FeatureCollection
   - Rejection = instant 0% confidence

2. **Feature Count Validation**
   - Min: 1 feature (reject empty datasets)
   - Max: 100 features (reject voting precincts)
   - Warning if <3 or >50 features

3. **Geometry Type Analysis**
   - Required: Polygon or MultiPolygon only
   - Reject if zero polygon features

4. **Property Key Analysis**
   - Good signals: "district", "ward", "council" (+10 confidence)
   - Bad signals: "precinct", "parcel", "canopy" (instant reject)

5. **Bounding Box Validation**
   - WGS84 bounds: lon [-180, 180], lat [-90, 90]
   - Reject if any coordinate outside bounds
   - Warn if extremely large (>10°) or small (<0.001°)

### Confidence Scoring

Base score: 100

**Deductions**:
- Each issue: -20 points
- Each warning: -5 points

**Bonuses**:
- District-like properties: +10
- All features are polygons: +10
- Feature count 3-50: +10

**Clamped to [0, 100]**

### Confidence Routing

| Score | Action | Destination |
|-------|--------|-------------|
| **0-59** | AUTO-REJECT | Discard, log rejection reason |
| **60-84** | MANUAL REVIEW | `data/staging/review/{city}.geojson` |
| **85-100** | AUTO-ACCEPT | `data/staging/validated/{city}.geojson` |

### Example Validation Results

**PASS (95% confidence)**:
```json
{
  "confidence": 95,
  "issues": [],
  "warnings": [],
  "metadata": {
    "featureCount": 7,
    "geometryTypes": { "MultiPolygon": 7 },
    "boundingBox": [-122.4374, 47.4951, -122.2395, 47.7342]
  }
}
```

**FAIL (0% confidence)**:
```json
{
  "confidence": 0,
  "issues": [
    "Too many features: 543 (max: 100) - likely precincts/parcels",
    "Suspicious properties detected: PRECINCT_ID"
  ],
  "warnings": [],
  "metadata": {
    "featureCount": 543,
    "geometryTypes": { "Polygon": 543 }
  }
}
```

### Integration

Acquisition orchestrator calls validator on every downloaded dataset:

```typescript
import { PostDownloadValidator } from './post-download-validator.js';

const validator = new PostDownloadValidator();

for (const candidate of candidates) {
  const geojson = await downloadGeoJSON(candidate.downloadUrl);

  // Stage 1: Post-download validation
  const validation = validator.validate(geojson, {
    source: candidate.downloadUrl,
    city: city.name,
  });

  // Route based on confidence
  if (validation.confidence < 60) {
    console.log(`❌ REJECTED: ${candidate.title} (${validation.confidence}%)`);
    continue; // Skip to next candidate
  }

  if (validation.confidence < 85) {
    console.log(`⚠️  REVIEW: ${candidate.title} (${validation.confidence}%)`);
    await saveForReview(geojson, city, validation);
    continue;
  }

  console.log(`✅ ACCEPTED: ${candidate.title} (${validation.confidence}%)`);
  await transformAndLoad(geojson, city, validation);
}
```

## Data Sources

### 1. ArcGIS Portal API (Primary, USA)

- **Coverage**: 19,495+ US cities
- **Authority**: Municipal (variable quality)
- **Strategy**: Global search for "council district" Feature Services
- **Rate Limit**: 10 requests/sec
- **Implementation**: `pipelines/arcgis-portal-scraper.ts`

**Key Change from PoC**: Uses Portal API (`/sharing/rest/search`), NOT Hub API (which never worked).

### 2. State GIS Portals (Secondary, USA)

- **Coverage**: 50 US states + DC + territories
- **Authority**: High (state-mandated boundaries)
- **Strategy**: Direct-layer (Hawaii model) + fallback searches
- **Portal Types**: ArcGIS, CKAN, Socrata, custom REST
- **Implementation**: `pipelines/state-gis-scraper.ts`

**Example**: Hawaii Statewide GIS Program has direct URLs for all county council districts:
```
https://geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/11
```

### 3. OpenStreetMap (Tertiary, Global)

- **Coverage**: 190+ countries
- **Authority**: Low to medium (community-maintained)
- **Strategy**: Overpass API queries for admin_level=6,7,8
- **Update Frequency**: Daily (continuous community edits)
- **Implementation**: `pipelines/osm-scraper.ts`

## Output Format

### Directory Structure

```
acquisition/outputs/raw-2025-11-20/
├── sources.json                    # Metadata for all sources
├── snapshot-metadata.json          # Snapshot hash + timestamp
├── usa/
│   ├── state-gis/
│   │   ├── dataset-00000.geojson
│   │   ├── dataset-00001.geojson
│   │   └── ...
│   └── arcgis-portal/
│       ├── dataset-00000.geojson
│       ├── dataset-00001.geojson
│       └── ...
├── global/
│   └── osm/
│       ├── dataset-00000.geojson
│       ├── dataset-00001.geojson
│       └── ...
└── provenance/
    ├── provenance-00000.json
    ├── provenance-00001.json
    └── ...
```

### Provenance Metadata Schema

Every dataset has provenance metadata enabling cryptographic verification:

```typescript
interface ProvenanceMetadata {
  source: string;              // URL or identifier
  authority: AuthorityLevel;   // "state-gis" | "municipal" | "community"
  jurisdiction: string;        // "USA/Hawaii", "France", etc.
  timestamp: number;           // Unix timestamp of scrape
  sourceLastModified?: number; // From HTTP Last-Modified header
  effectiveDate?: string;      // When boundaries became official
  method: string;              // "ArcGIS Portal API", "Overpass API", etc.
  responseHash: string;        // sha256(raw HTTP response)
  httpStatus: number;          // 200, etc.
  legalBasis?: string;         // "Hawaii Revised Statutes §3-1"
  license?: string;            // "Public Domain", "CC-BY-4.0", etc.
  featureCount: number;        // Number of features in dataset
  geometryType: "Polygon" | "MultiPolygon";
  coordinateSystem: string;    // "EPSG:4326" (WGS84)
}
```

## Usage

### Run Full Quarterly Scrape

```bash
npx tsx acquisition/pipelines/orchestrator.ts
```

**Expected output**:
- Duration: 1-2 hours (vs 2+ minutes per city × 19,495 cities = 27+ days serial)
- Coverage: 67%+ of US cities, 50 states, 190+ countries
- Output: `acquisition/outputs/raw-YYYY-MM-DD/`

### Run Individual Scrapers

```bash
# ArcGIS Portal only
npx tsx acquisition/pipelines/arcgis-portal-scraper.ts

# State GIS portals only
npx tsx acquisition/pipelines/state-gis-scraper.ts

# OpenStreetMap only
npx tsx acquisition/pipelines/osm-scraper.ts
```

## Configuration

All scrapers accept configuration overrides:

```typescript
import { ArcGISPortalScraper } from './pipelines/arcgis-portal-scraper.js';

const scraper = new ArcGISPortalScraper({
  maxParallel: 10,      // Concurrent requests
  rateLimit: 5,         // Requests per second
  timeout: 60000,       // Request timeout (ms)
  maxRetries: 5,        // Retry attempts
  backoffMultiplier: 2, // Exponential backoff
});

const result = await scraper.scrapeAll();
```

## Type Safety

**ZERO TOLERANCE**: All scrapers use strict TypeScript with:
- ✅ NO `any` types
- ✅ Explicit types for ALL function parameters and returns
- ✅ Comprehensive interfaces for API responses
- ✅ Type guards for runtime validation

Example:

```typescript
// ✅ CORRECT - Proper typing
interface ArcGISPortalSearchResponse {
  readonly total: number;
  readonly results: readonly ArcGISPortalItem[];
}

// ❌ WRONG - Loose typing
const response: any = await fetch(...);
```

## Error Handling

All scrapers use **retry with exponential backoff**:

```typescript
await retryWithBackoff(
  async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  },
  {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  }
);
```

**Failures are logged but do not halt the entire scrape.**

## Progress Tracking

All scrapers report progress every 100 items:

```
Progress: 500/19495 (2.6%) | Completed: 480 | Failed: 20 | Rate: 12.3 items/sec | ETA: 25.7 min
```

## Rate Limiting

Token bucket algorithm ensures compliance with API limits:

```typescript
class RateLimiter {
  constructor(requestsPerSecond: number);
  async acquire(): Promise<void>; // Waits until token available
}
```

**API Limits**:
- ArcGIS Portal: 10 req/sec
- State GIS: 5 req/sec (conservative)
- Overpass API: 1 req/sec (polite)

## Determinism

**Same input → same output** (deterministic scraping):
- Timestamps are recorded but do not affect data structure
- Ordering is stable (sorted by ID)
- Hashes are reproducible (SHA-256 of raw HTTP response)

## Idempotency

Safe to re-run scrapes:
- Creates new snapshot directory (never overwrites)
- Parallel scrapes do not interfere
- Failures in one scraper do not affect others

## Next Steps

After acquisition completes:

1. **Layer 2 (Transformation)**: Validate, normalize, build Merkle tree
2. **Layer 3 (Serving)**: R-tree index for <50ms lookups

See `../transformation/README.md` for next steps.

## Files

- `types.ts` - Type definitions for acquisition layer
- `utils.ts` - Retry logic, rate limiting, progress tracking
- `pipelines/arcgis-portal-scraper.ts` - ArcGIS Portal API scraper
- `pipelines/state-gis-scraper.ts` - State GIS portal scraper
- `pipelines/osm-scraper.ts` - OpenStreetMap scraper
- `pipelines/orchestrator.ts` - Parallel scraping coordinator

## Performance Targets

| Metric | Target | Actual (Expected) |
|--------|--------|-------------------|
| **Scrape Duration** | <2 hours | ~1-2 hours |
| **Coverage (US)** | ≥67% | ~70-80% |
| **Success Rate** | ≥95% | ~95%+ |
| **Rate (ArcGIS)** | 10 req/sec | 10 req/sec |
| **Rate (State GIS)** | 5 req/sec | 5 req/sec |
| **Rate (OSM)** | 1 req/sec | 1 req/sec |

## Audit Trail

Every dataset has complete provenance from source to storage:

```
Source (State GIS Portal)
  ↓ HTTP GET with timestamp
Raw GeoJSON Snapshot
  ↓ sha256(raw_response)
Acquisition Record
  ↓ Write to disk with provenance
Immutable Snapshot Directory
```

**Cryptographic verification**: Anyone can verify `responseHash` matches original data.

## Update Strategy

- **Quarterly scrapes**: January 1, April 1, July 1, October 1
- **Event-driven updates**: Court-ordered redistricting, municipal mergers
- **RSS monitoring**: Track state GIS portal updates

See `../docs/` for detailed architecture documentation.
