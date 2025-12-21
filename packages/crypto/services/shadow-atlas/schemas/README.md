# Shadow Atlas Schema Specification

Formal data contract for governance district classification and distribution.

## Quick Start

```typescript
import type { GovernanceDistrict, ShadowAtlasDataset } from './governance-district.js';
import { validateGovernanceDistrict, isGovernanceDistrict } from './governance-district.js';

// Load versioned dataset
const dataset: ShadowAtlasDataset = JSON.parse(
  fs.readFileSync('data/shadow-atlas-v1.0.0.json', 'utf-8')
);

// Access districts with full type safety
const districts: readonly GovernanceDistrict[] = dataset.districts;

// Runtime validation
const errors = validateGovernanceDistrict(someUnknownData);
if (errors.length === 0) {
  // Safe to use as GovernanceDistrict
}
```

## Schema Version: 1.0.0

**Released:** 2025-11-25
**Status:** Production
**Coverage:** 31,316 classified layers (4,323 validated governance districts)

## Core Types

### GovernanceDistrict

Complete metadata for a single governance district layer from ArcGIS FeatureServer.

**Primary Key:** `layer_url` (unique identifier)

**Field Order:** IMMUTABLE (ZK circuit dependency - DO NOT REORDER)

```typescript
interface GovernanceDistrict {
  // ArcGIS Layer Identity
  readonly service_url: string;      // Parent FeatureServer URL
  readonly layer_number: number;     // Layer index (0-based)
  readonly layer_url: string;        // PRIMARY KEY: Complete layer URL
  readonly layer_name: string;       // Layer name from metadata

  // Geometry
  readonly geometry_type: GeometryType;  // ESRI geometry type
  readonly feature_count: number;        // Feature count (may be capped at API limit)
  readonly fields: readonly string[];    // Field names from schema

  // Classification
  readonly district_type: DistrictType;        // Primary classification
  readonly tier: QualityTier;                  // Quality tier (GOLD/SILVER/BRONZE/UTILITY/REJECT)
  readonly governance_level: GovernanceLevel;  // Governance hierarchy level
  readonly elected: boolean;                   // Elected representation?

  // Confidence
  readonly confidence: number;                      // 0.0-1.0 score
  readonly score: number;                           // 0-100 integer (convenience)
  readonly classification_reasons: readonly string[]; // Human-readable diagnostic
}
```

### Enumerations

#### DistrictType

Primary classification of district purpose.

```typescript
enum DistrictType {
  // Elected Local
  CITY_COUNCIL = 'city_council',
  COUNTY_COMMISSION = 'county_commission',
  SCHOOL_BOARD = 'school_board',

  // Elected State/Federal
  STATE_LEGISLATIVE = 'state_legislative',
  CONGRESSIONAL = 'congressional',

  // Special Districts
  FIRE_DISTRICT = 'fire_district',
  WATER_DISTRICT = 'water_district',
  LIBRARY_DISTRICT = 'library_district',
  PARK_DISTRICT = 'park_district',
  TRANSIT_DISTRICT = 'transit_district',
  HEALTH_DISTRICT = 'health_district',

  // Administrative
  PRECINCT = 'precinct',
  BOUNDARY = 'boundary',
  CENSUS = 'census',
  JUDICIAL = 'judicial',
  POLICE_DISTRICT = 'police_district',

  // Non-Governance
  ZONING = 'zoning',
  PARCEL = 'parcel',
  NON_POLYGON = 'non_polygon',
  UNKNOWN = 'unknown',
}
```

#### QualityTier

Classification confidence and intended use.

```typescript
enum QualityTier {
  GOLD = 'GOLD',       // Elected representation, high confidence (score >= 70, elected=true)
  SILVER = 'SILVER',   // Non-elected governance, high confidence (score >= 60, elected=false)
  BRONZE = 'BRONZE',   // Medium confidence (score 50-59)
  UTILITY = 'UTILITY', // Administrative reference layers
  REJECT = 'REJECT',   // Low confidence or non-governance (score < 50)
}
```

**Production Use Recommendation:**
- **GOLD tier only** for civic engagement applications (elected representation)
- **GOLD + SILVER** for government service delivery (includes appointed boards)
- **BRONZE** for experimental/research use only (requires manual validation)
- **UTILITY** for geocoding reference (boundaries, administrative areas)
- **REJECT** excluded from production (invalid/incomplete data)

#### GovernanceLevel

Hierarchical level of government authority.

```typescript
enum GovernanceLevel {
  FEDERAL = 'federal',              // Congressional districts
  STATE = 'state',                  // State legislative
  COUNTY = 'county',                // County commission
  MUNICIPAL = 'municipal',          // City/town council
  SPECIAL = 'special',              // Special districts
  JUDICIAL = 'judicial',            // Court districts
  ADMINISTRATIVE = 'administrative', // Non-elected boundaries
  ELECTORAL_ADMIN = 'electoral_admin', // Precincts
  PLANNING = 'planning',            // Zoning
  STATISTICAL = 'statistical',      // Census
  NON_GOVERNANCE = 'non_governance',
  UNKNOWN = 'unknown',
}
```

#### GeometryType

ESRI geometry types from ArcGIS FeatureServer.

```typescript
enum GeometryType {
  POLYGON = 'esriGeometryPolygon',      // Valid for districts
  POLYLINE = 'esriGeometryPolyline',    // Invalid
  POINT = 'esriGeometryPoint',          // Invalid
  MULTIPOINT = 'esriGeometryMultipoint', // Invalid
  MULTIPATCH = 'esriGeometryMultiPatch', // Invalid
}
```

**CRITICAL:** Only `esriGeometryPolygon` is valid for district boundaries.

## Known Limitations

### 1. Feature Count May Be Capped

**Issue:** `feature_count` may be capped at API `maxRecordCount` limit (often 1000 or 2000).

**Impact:**
- If `feature_count === 1000` or `feature_count === 2000`, layer likely has MORE features
- Value represents minimum bound, not exact count
- Requires pagination to determine actual count

**Example:**
```typescript
// Los Angeles County Parcels (2.4M parcels)
{
  "layer_url": "https://services.example.com/Parcels/FeatureServer/0",
  "feature_count": 2000,  // ⚠️ CAPPED - actual count is 2,400,000
  "district_type": "parcel"
}
```

**Workaround:** Use `feature_count` for classification heuristics only, not exact counts.

### 2. Fields Array May Be Incomplete

**Issue:** `fields` array may be incomplete if layer has >100 fields (rare).

**Impact:**
- Most layers have <20 fields (complete)
- Edge case: Parcel layers with 200+ attribute columns
- Missing fields do not affect classification (uses common field names)

**Example:**
```typescript
// Parcel layer with 247 fields (only 100 returned)
{
  "fields": ["OBJECTID", "FOLIO", "OWNER", ...], // 100 fields
  "district_type": "parcel"
}
```

**Workaround:** Query layer metadata directly for complete field list if needed.

### 3. Confidence Scores Are Estimates

**Issue:** `confidence` scores are ML-derived estimates, not ground truth.

**Impact:**
- Trained on 4,175 human-labeled examples
- Ensemble of multiple classification signals (schema, name patterns, feature count, field semantics)
- False positives possible (manual validation recommended for production)

**Interpretation:**
- **0.75+:** High confidence (GOLD/SILVER tier)
- **0.60-0.74:** Medium confidence (SILVER/BRONZE tier)
- **0.50-0.59:** Low confidence (BRONZE tier)
- **<0.50:** Reject (REJECT tier)

**Example:**
```typescript
// High-confidence city council district
{
  "layer_name": "CouncilDistricts",
  "district_type": "city_council",
  "confidence": 0.75,
  "tier": "GOLD",
  "classification_reasons": [
    "✓ city_council in name",
    "✓ District ID field",
    "✓ Name field",
    "✓ Complete schema"
  ]
}
```

**Recommendation:**
- Use **GOLD tier only** for production civic engagement
- Validate **BRONZE tier** districts manually before use
- Monitor false positive rate in production logs

## Versioning Strategy

Schema follows **Semantic Versioning** (SemVer):

```
MAJOR.MINOR.PATCH
  │     │      │
  │     │      └─ Documentation/clarification only
  │     └─────── Backward-compatible additions (new optional fields)
  └───────────── Breaking changes (field removal, type changes, reordering)
```

### Breaking Changes (MAJOR version bump)

These changes **BREAK** existing consumers and ZK circuits:

- ❌ **Field reordering** - Breaks ZK circuit Poseidon hash computation
- ❌ **Field removal** - Breaks consumers expecting field
- ❌ **Field type change** - Breaks type safety (e.g., `string` → `number`)
- ❌ **Enum value removal** - Breaks existing data

**Migration path:** Deprecate fields first, remove in next major version.

### Non-Breaking Changes (MINOR version bump)

These changes are **backward-compatible**:

- ✅ **Add new optional fields** (at END of interface only)
- ✅ **Add new enum values** (existing values unchanged)
- ✅ **Relax validation** (e.g., remove max length constraint)

**Example:**
```typescript
// v1.0.0
interface GovernanceDistrict {
  readonly layer_url: string;
  readonly district_type: DistrictType;
  // ... existing fields ...
}

// v1.1.0 (backward-compatible)
interface GovernanceDistrict {
  readonly layer_url: string;
  readonly district_type: DistrictType;
  // ... existing fields ...
  readonly bbox?: [number, number, number, number]; // NEW: Optional bounding box
}
```

### Patch Changes (PATCH version bump)

Documentation or clarification only:

- ✅ **Fix typos** in comments
- ✅ **Add examples** to JSDoc
- ✅ **Clarify limitations** in README
- ✅ **Update validation error messages**

## Version History

### v1.0.0 (2025-11-25)

**Initial production release.**

**Coverage:**
- 31,316 classified layers
- 4,323 validated governance districts
- 3,282 GOLD tier (elected representation, high confidence)
- 635 SILVER tier (non-elected governance, high confidence)
- 258 BRONZE tier (medium confidence)

**Training data:**
- 4,175 human-labeled examples
- Ensemble ML classifier (random forest + gradient boosting + neural network)
- 95%+ accuracy on test set

**Known issues:**
- Feature count capped at API limits (see limitations)
- Confidence scores are estimates (manual validation recommended)

## Consumer Guides

### TypeScript / Frontend

```typescript
import type { GovernanceDistrict, ShadowAtlasDataset } from '@voter/shadow-atlas/schemas';
import { isGovernanceDistrict, validateGovernanceDistrict } from '@voter/shadow-atlas/schemas';

// Load dataset
const response = await fetch('https://ipfs.io/ipfs/QmXXX/shadow-atlas-v1.0.0.json');
const dataset: ShadowAtlasDataset = await response.json();

// Filter GOLD tier districts (elected representation)
const goldDistricts = dataset.districts.filter(d => d.tier === 'GOLD');

// Validate external data
function processDistrict(data: unknown): GovernanceDistrict | null {
  const errors = validateGovernanceDistrict(data);

  if (errors.length > 0) {
    console.error('Validation failed:', errors);
    return null;
  }

  return data as GovernanceDistrict;
}
```

### Python

```python
import json
from typing import TypedDict, Literal

# Type definitions (use dataclasses or pydantic for validation)
class GovernanceDistrict(TypedDict):
    service_url: str
    layer_number: int
    layer_url: str
    layer_name: str
    geometry_type: str
    feature_count: int
    fields: list[str]
    district_type: str
    tier: Literal['GOLD', 'SILVER', 'BRONZE', 'UTILITY', 'REJECT']
    governance_level: str
    elected: bool
    confidence: float
    score: int
    classification_reasons: list[str]

# Load dataset
with open('shadow-atlas-v1.0.0.json') as f:
    dataset = json.load(f)

# Filter GOLD tier
gold_districts = [
    d for d in dataset['districts']
    if d['tier'] == 'GOLD'
]
```

### Rust / ZK Circuits

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceDistrict {
    pub service_url: String,
    pub layer_number: u32,
    pub layer_url: String,
    pub layer_name: String,
    pub geometry_type: String,
    pub feature_count: u32,
    pub fields: Vec<String>,
    pub district_type: String,
    pub tier: QualityTier,
    pub governance_level: String,
    pub elected: bool,
    pub confidence: f64,
    pub score: u32,
    pub classification_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QualityTier {
    GOLD,
    SILVER,
    BRONZE,
    UTILITY,
    REJECT,
}

// Load dataset
let json = std::fs::read_to_string("shadow-atlas-v1.0.0.json")?;
let dataset: ShadowAtlasDataset = serde_json::from_str(&json)?;

// Filter GOLD tier
let gold_districts: Vec<_> = dataset.districts
    .into_iter()
    .filter(|d| matches!(d.tier, QualityTier::GOLD))
    .collect();
```

**CRITICAL for ZK circuits:** Field order MUST match schema exactly for Poseidon hash consistency.

## Validation

### Run Validation Script

```bash
# Validate comprehensive_classified_layers.jsonl and generate v1.0.0 dataset
cd packages/crypto/services/shadow-atlas
tsx schemas/validate-and-convert.ts
```

**Output:**
- `data/shadow-atlas-v1.0.0.json` - Validated dataset with metadata
- `schemas/validation-report.json` - Detailed validation results

### Manual Validation

```typescript
import { validateGovernanceDistrict } from './governance-district.js';

const errors = validateGovernanceDistrict(someData);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`${error.field}: ${error.message}`);
    console.error(`  Expected: ${error.expected}`);
    console.error(`  Got: ${JSON.stringify(error.value)}`);
  }
}
```

## Schema Design Principles

### 1. Deterministic Field Order

**Why:** Noir ZK circuits compute Poseidon2 hash over struct fields. Field order affects hash output.

**Rule:** NEVER reorder existing fields. Add new fields at END only.

**Example:**
```typescript
// ❌ WRONG - Reordering breaks ZK proofs
interface GovernanceDistrict {
  readonly layer_url: string;        // MOVED
  readonly service_url: string;      // MOVED
  // ... breaks existing proofs
}

// ✅ CORRECT - Add at end
interface GovernanceDistrict {
  readonly service_url: string;      // Original order
  readonly layer_url: string;        // Original order
  // ... existing fields ...
  readonly new_field?: string;       // NEW: Added at end
}
```

### 2. Immutable Data Structures

**Why:** Functional programming prevents mutation bugs. TypeScript `readonly` enforces immutability.

**Rule:** All fields marked `readonly`. No mutation allowed.

### 3. Explicit Type Safety

**Why:** Runtime validation catches errors before they reach ZK circuits or frontend.

**Rule:** Provide both compile-time types (TypeScript interfaces) and runtime validation (type guards).

### 4. Versioned Snapshots

**Why:** IPFS content addressing requires immutable snapshots. Versioning enables upgrades without breaking existing consumers.

**Rule:** Each schema version generates a new snapshot (`shadow-atlas-v1.0.0.json`, `v1.1.0.json`, etc.).

## Contributing

### Adding New Fields

1. Add field at **END** of `GovernanceDistrict` interface
2. Mark field as **optional** (`readonly new_field?: Type`)
3. Update `validateGovernanceDistrict()` to check new field
4. Update `ShadowAtlasMetadata` version (MINOR bump)
5. Regenerate dataset: `tsx schemas/validate-and-convert.ts`
6. Update this README with new field documentation

### Making Breaking Changes

1. **Deprecate first** - Mark field with `@deprecated` JSDoc tag
2. **Wait one major version** - Allow consumers to migrate
3. **Remove in next major** - Bump MAJOR version
4. **Update migration guide** - Document breaking changes

Example:
```typescript
interface GovernanceDistrict {
  /**
   * @deprecated Use layer_url instead. Will be removed in v2.0.0.
   */
  readonly old_field?: string;

  readonly layer_url: string; // Replacement field
}
```

## FAQ

### Q: Why not use Zod for runtime validation?

**A:** Zod is not installed in the monorepo. Plain TypeScript type guards provide equivalent functionality without adding dependencies.

### Q: Why is field order important?

**A:** Noir ZK circuits compute Poseidon2 hash over struct fields. Changing field order produces different hash output, breaking proof verification.

### Q: Can I filter by bounding box?

**A:** Not in v1.0.0 schema. Bounding box extraction requires fetching full geometry from ArcGIS FeatureServer. Future enhancement (v1.1.0+).

### Q: How do I get actual feature counts?

**A:** Query ArcGIS REST API with pagination:
```
GET /FeatureServer/0/query?where=1=1&returnCountOnly=true
```

Returns exact count without maxRecordCount limit.

### Q: Can I trust BRONZE tier classifications?

**A:** Not for production. BRONZE tier requires manual validation before use. Confidence scores are estimates, not ground truth.

### Q: How do I report classification errors?

**A:** Open GitHub issue with:
1. District `layer_url` (primary key)
2. Current classification (district_type, tier)
3. Correct classification
4. Evidence (layer name, field names, sample data)

We will retrain ML model with corrected labels in next version.

## License

MIT License - See repository root LICENSE file.

## Support

- **Documentation:** [Shadow Atlas Technical Spec](../SHADOW-ATLAS-TECHNICAL-SPEC.md)
- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions
