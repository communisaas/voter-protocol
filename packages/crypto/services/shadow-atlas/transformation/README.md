# Shadow Atlas: Layer 2 - Transformation Pipeline

Production-grade validation, normalization, and indexing for municipal boundary data.

## Overview

The transformation pipeline takes raw scraped GeoJSON from Layer 1 (Acquisition) and produces:

1. **Validated districts** - Semantic, geographic, and geometry validation
2. **Normalized geometries** - Simplified, cleaned, standardized
3. **SQLite R-tree index** - <50ms spatial lookups
4. **Merkle tree commitment** - Cryptographic verifiability
5. **Audit trail** - Complete provenance metadata

## Architecture

```
Raw GeoJSON (Layer 1)
  ↓ validation
Validated Districts
  ↓ normalization
Normalized Districts
  ↓ indexing + commitment
SQLite Database + Merkle Root
```

### Pipeline Stages

**Input**: Raw GeoJSON from Layer 1 with Stage 1 validation (confidence ≥85)

1. **Stage 2: Semantic Validation** (`validators/semantic-layer-validator.ts`)
   - Title scoring with positive/negative keywords
   - Reject: "precinct", "canopy", "zoning" (instant 0)
   - Accept: "council" (+40), "ward" (+30), "district" (+20)
   - **Threshold**: Score ≥30 to proceed

2. **Stage 3: Geographic Validation** (`validators/enhanced-geographic-validator.ts`)
   - State bounding box validation (coordinates within jurisdiction)
   - Multi-county detection (adjacent counties only)
   - FIPS code validation (state code matches)
   - Cross-border contamination prevention

3. **Stage 4: Geometry Normalization** (`normalizers/geometry-normalizer.ts`)
   - CRS transformation to WGS84 (EPSG:4326)
   - Topology validation (repair self-intersections)
   - Ring orientation (exterior CCW, interior CW)
   - Vertex simplification (Douglas-Peucker, 0.0001° tolerance)

4. **Stage 5: District Count Validation** (`validators/district-count-validator.ts`)
   - Compare to known registry (53 cities with known counts)
   - Flag if |actual - expected| > 2 districts
   - **Informational only** (warns but doesn't block)

5. **R-tree Index** (`rtree-builder.ts`)
   - Schema: SQLite with R*Tree virtual table
   - Bounding boxes: Spatial index for fast filtering
   - Auxiliary table: Full GeoJSON + provenance
   - Performance: <50ms point-in-polygon via R-tree

6. **Merkle Tree** (`merkle-builder.ts`)
   - Deterministic ordering: Sort districts by ID (lexicographic)
   - Leaf hash: `keccak256(id + geometry + provenance)`
   - Tree construction: Binary tree with `keccak256(left + right)`
   - Output: Merkle root + proof generation capability

## Usage

### CLI

```bash
# Run complete pipeline
npx tsx transformation/pipeline.ts \
  --input acquisition/outputs/raw-2025-11-20 \
  --output transformation/outputs/validated-2025-11-20

# Expected output:
# transformation/outputs/validated-2025-11-20/
#   ├── shadow-atlas-v1.db          (SQLite with R-tree)
#   ├── merkle-root.txt             (0x1234...abcd)
#   ├── merkle-tree.json            (Full tree for proof generation)
#   └── transformation-metadata.json (Audit trail)
```

### Programmatic

```typescript
import { TransformationPipeline } from './transformation/pipeline.js';

const pipeline = new TransformationPipeline({
  inputDir: 'acquisition/outputs/raw-2025-11-20',
  outputDir: 'transformation/outputs/validated-2025-11-20',
  skipValidation: false,
});

const result = await pipeline.transform();

console.log(`Merkle root: ${result.merkleRoot}`);
console.log(`Database: ${result.databasePath}`);
console.log(`Districts: ${result.districtCount}`);
```

## Type Safety

**NUCLEAR-LEVEL STRICTNESS**: No `any`, no loose casts, no type bypasses.

### Example Type Signatures

```typescript
// Validator: Deterministic validation
async validate(
  dataset: RawDataset,
  context: ValidationContext
): Promise<ValidationResult>

// Normalizer: Deterministic normalization
normalize(dataset: RawDataset): readonly NormalizedDistrict[]

// R-tree: Idempotent index building
build(districts: readonly NormalizedDistrict[], dbPath: string): void

// Merkle: Deterministic tree construction
build(districts: readonly NormalizedDistrict[]): MerkleTree
```

## Determinism

**CRITICAL**: Same input → same output (required for Merkle tree reproducibility)

### Deterministic Guarantees

1. **Validation**: Same dataset → same validation result
   - Validators use deterministic rules (no randomness)
   - State bounds are fixed constants
   - District count checks use known registry

2. **Normalization**: Same feature → same normalized district
   - Geometry simplification is deterministic (turf.js)
   - Coordinate rounding uses fixed precision
   - ID generation uses deterministic hash

3. **Merkle Tree**: Same districts → same Merkle root
   - Districts sorted by ID (lexicographic)
   - Canonical JSON serialization
   - keccak256 hash function

4. **R-tree Index**: Same districts → same database structure
   - SQLite schema is fixed
   - Insertion order doesn't affect R-tree
   - Bounding boxes are deterministic

## Performance

### Validation

- **Semantic**: <1ms per layer (keyword matching)
- **Geographic**: <10ms per dataset (bounding box checks)
- **Geometry**: <5ms per feature (coordinate validation)
- **District count**: <1ms per dataset (simple comparison)

### Normalization

- **Simplification**: ~20ms per feature (depends on vertex count)
- **Coordinate rounding**: <1ms per feature
- **ID generation**: <1ms per district (sha256 hash)

### Indexing

- **R-tree construction**: ~100ms per 1,000 districts
- **Merkle tree construction**: ~50ms per 1,000 districts
- **Database optimization**: ~500ms (vacuum, analyze)

### Total Pipeline

- **1,000 districts**: ~5 seconds
- **10,000 districts**: ~30 seconds
- **100,000 districts**: ~5 minutes

## Validation Stages (2-5)

### Stage 2: Semantic Validation

**Purpose**: Filter out wrong layer types (voting precincts, zoning, canopy cover)

**Scoring Algorithm**:
```typescript
let score = 0;

// Negative keywords (instant rejection)
if (title.includes('precinct')) return 0;
if (title.includes('canopy')) return 0;
if (title.includes('zoning')) return 0;

// Positive keywords (scoring)
if (/council.*district/i.test(title)) score += 40;
else if (/ward/i.test(title)) score += 30;
else if (/district/i.test(title)) score += 20;

return score; // Must be ≥30 to proceed
```

**Example Results**:
- "Seattle City Council Districts" → 90 points ✅
- "Seattle Voting Precincts" → 0 points ❌ (negative keyword)
- "Urban Tree Canopy" → 0 points ❌ (negative keyword)

### Stage 3: Geographic Validation

**Purpose**: Prevent cross-city and cross-state contamination

**Validation Rules**:

1. **State Bounding Box Check**
   - All 50 US states have known bounding boxes
   - GeoJSON bbox must be FULLY CONTAINED within state bounds
   - Example: Lexington, KY data outside KY bounds → REJECT

2. **Multi-County Detection**
   - Some cities span multiple counties (e.g., NYC spans 5)
   - Validate counties are adjacent (no suspicious gaps)
   - Example: NYC + Miami counties → REJECT

3. **FIPS Code Validation**
   - Every US city has 7-digit PLACE code (SSFPPPP)
   - Validate state FIPS matches target city
   - Example: `5363000` = WA (53) + Seattle (63000)

**Example Results**:
- GeoJSON bbox INSIDE state bounds → PASS ✅
- GeoJSON bbox OUTSIDE state bounds → FAIL ❌
- Adjacent multi-county → PASS ✅
- Non-adjacent multi-county → FAIL ❌

### Stage 4: Geometry Normalization

**Purpose**: Ensure all geometries meet Shadow Atlas format requirements

**Normalization Steps**:

1. **CRS Transformation**
   - Required: WGS84 (EPSG:4326)
   - Transform if `crs` field present and not EPSG:4326
   - Assume WGS84 if `crs` field missing (GeoJSON standard)

2. **Topology Validation**
   - Self-intersection detection (Turf.js)
   - Ring orientation: exterior CCW, interior CW
   - Repair strategies:
     - Self-intersections → Split polygon
     - Wrong orientation → Reverse coordinate order

3. **Vertex Simplification**
   - Algorithm: Douglas-Peucker (tolerance=0.0001°)
   - Typical reduction: 30-50% fewer vertices
   - Validate simplified geometry still passes Stage 1

**Example Results**:
- 45,832 vertices → 23,416 vertices (48.9% reduction)
- Self-intersections repaired: 3 polygons
- Ring orientation fixed: 12 features

### Stage 5: District Count Validation

**Purpose**: Flag suspicious district counts vs known registry

**Known District Counts** (53 cities):
```typescript
const DISTRICT_COUNTS = {
  '5363000': 9,   // Seattle, WA
  '3651000': 51,  // New York, NY
  '0644000': 6,   // Irvine, CA
  // ... 50 more cities
};
```

**Validation Logic**:
- **PASS** if |actual - expected| ≤ 2
  - Expected: 9, Actual: 9 → PASS ✅
  - Expected: 9, Actual: 10 → PASS ✅ (redistricting)
  - Expected: 9, Actual: 8 → PASS ✅

- **WARN** if |actual - expected| > 2
  - Expected: 9, Actual: 15 → WARN ⚠️
  - Expected: 9, Actual: 120 → WARN ⚠️ (likely precincts)

**Informational Only**: Does NOT block loading to Shadow Atlas

**Example Results**:
- Seattle: Expected 9, Got 7 → PASS ✅ (within tolerance)
- Portland: Expected 7, Got 120 → WARN ⚠️ (likely precincts, review needed)

## Known District Counts

Hardcoded registry for validation:

- Honolulu, HI: 9 districts
- New York, NY: 51 districts
- Los Angeles, CA: 15 districts
- Chicago, IL: 50 districts
- Houston, TX: 11 districts
- Phoenix, AZ: 8 districts
- Philadelphia, PA: 10 districts
- San Antonio, TX: 10 districts
- San Diego, CA: 9 districts
- Dallas, TX: 14 districts

Add more via `KNOWN_DISTRICT_COUNTS` in `validator.ts`.

## Error Handling

### Partial Failures

Pipeline handles partial failures gracefully:

- **Validation**: Rejects invalid datasets, continues with valid ones
- **Normalization**: Skips features that fail normalization
- **R-tree**: Transactional (all-or-nothing)
- **Merkle**: Fails fast if any district missing

### Provenance

Every rejection recorded in metadata:

```json
{
  "rejectionReasons": {
    "Semantic validation failed": 5,
    "Geographic validation failed": 3,
    "District count mismatch": 1
  }
}
```

## Testing

### Unit Tests

```bash
# Test validator
npx tsx transformation/validator.test.ts

# Test normalizer
npx tsx transformation/normalizer.test.ts

# Test R-tree builder
npx tsx transformation/rtree-builder.test.ts

# Test Merkle builder
npx tsx transformation/merkle-builder.test.ts
```

### Integration Tests

```bash
# Test full pipeline
npx tsx transformation/pipeline.test.ts
```

### Golden Vectors

**CRITICAL**: Merkle tree golden vectors prevent supply-chain attacks

```typescript
// Test deterministic Merkle root
const districts = loadGoldenVectorDistricts();
const tree = merkleBuilder.build(districts);

assert(tree.root === EXPECTED_GOLDEN_ROOT);
```

## Output Format

### SQLite Database Schema

```sql
CREATE TABLE districts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  district_type TEXT NOT NULL,
  geometry TEXT NOT NULL,        -- GeoJSON as text
  provenance TEXT NOT NULL,      -- JSON as text
  min_lon REAL NOT NULL,
  min_lat REAL NOT NULL,
  max_lon REAL NOT NULL,
  max_lat REAL NOT NULL
);

CREATE VIRTUAL TABLE rtree_index USING rtree(
  id,         -- Integer ID (rowid)
  min_lon,    -- Bounding box
  max_lon,
  min_lat,
  max_lat
);
```

### Merkle Tree Format

```json
{
  "root": "0x1234abcd...",
  "treeDepth": 14,
  "leafCount": 9527,
  "districtCount": 9527,
  "districts": [
    { "id": "abc123...", "name": "District 1", "jurisdiction": "USA/HI/Honolulu" }
  ]
}
```

### Transformation Metadata

```json
{
  "snapshotId": "2025-11-20",
  "inputPath": "acquisition/outputs/raw-2025-11-20",
  "outputPath": "transformation/outputs/validated-2025-11-20",
  "rawDatasetCount": 100,
  "validatedCount": 85,
  "normalizedCount": 9527,
  "rejectionReasons": { "Semantic validation failed": 10 },
  "merkleRoot": "0x1234abcd...",
  "ipfsCID": "QmXyz789...",
  "transformationDuration": 45000,
  "transformationCommit": "abc123def",
  "timestamp": 1700524800000
}
```

## Next Steps

1. **IPFS Publication** (`ipfs-publisher.ts`)
   - Upload entire snapshot to IPFS
   - Pin to multiple providers (Pinata, Web3.Storage)
   - Publish IPNS mutable pointer

2. **Layer 3: Serving** (`../serving/`)
   - Fast lookup service (<50ms)
   - Merkle proof generation
   - Client verification workflow

3. **Update Strategy** (`../serving/update-monitor.ts`)
   - Quarterly scheduled updates
   - Event-driven emergency updates
   - Community-submitted proposals

## Contributing

When adding new validators or normalizers:

1. **Maintain determinism**: Same input → same output
2. **Type safety**: No `any`, no loose casts
3. **Test with golden vectors**: Prevent regression
4. **Document rejection reasons**: Provenance audit trail

## References

- [SHADOW-ATLAS-PRODUCTION-ARCHITECTURE.md](../SHADOW-ATLAS-PRODUCTION-ARCHITECTURE.md) - Complete specification
- [ZK-PROOF-SPEC-REVISED.md](../../../../specs/ZK-PROOF-SPEC-REVISED.md) - Merkle proof verification
- [CLAUDE.md](../../../../../CLAUDE.md) - Type safety standards
