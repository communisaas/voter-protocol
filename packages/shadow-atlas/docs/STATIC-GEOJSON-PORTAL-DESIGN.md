# Static GeoJSON Portal Design

**Author**: Distinguished Software Engineer
**Date**: 2026-01-17
**Status**: Architectural Design Document

---

## Executive Summary

Extends shadow-atlas portal architecture to handle council district data that exists but isn't queryable via REST APIs. Introduces **curated portal types** for data requiring manual extraction, versioning, and provenance tracking while maintaining zero redundancy with existing validation pipeline.

**Problem**: Cities like Baton Rouge, LA have council district data embedded in ArcGIS webmap JSON, proprietary platforms (VertiGIS/Geocortex), or only as PDF maps—all non-queryable via standard REST endpoints.

**Solution**: New portal types (`'static-geojson'`, `'curated-data'`) with file-based storage, IPFS pinning for immutability, and metadata tracking extraction methodology + update schedule.

---

## I. Architecture Overview

### 1.1 Design Principles (Resonance with Existing Patterns)

The existing codebase demonstrates these architectural principles:

- **Zero redundancy**: `IngestionValidator` delegates to existing validators (lines 23-42, `ingestion-validator.ts`)
- **Fail-fast validation tiers**: Structure → Sanity → Full (lines 88-102)
- **Registry-driven gating**: `QUARANTINED_PORTALS`, `AT_LARGE_CITIES` act as pre-filters (lines 282-308)
- **Provenance via metadata**: `lastVerified`, `discoveredBy`, `authorityLevel` on every portal (lines 25-46, `known-portals.ts`)

**Static data integration must follow these patterns**:
- Reuse existing `IngestionValidator` pipeline (no new validation code)
- Introduce registry-based bypass for fetch-time resolution
- Add metadata fields for static data provenance
- Maintain authority scoring and staleness detection

### 1.2 Control Flow: Current vs. Proposed

#### Current Flow (Dynamic Portals)
```
KnownPortal → HTTP fetch → IngestionValidator.validate()
  ├─ TIER_STRUCTURE: fetchDistricts() + validateStructure()
  ├─ TIER_SANITY: boundaryResolver + runSanityChecks()
  └─ TIER_FULL: TessellationProofValidator
```

#### Proposed Flow (Static Portals)
```
KnownPortal (portalType: 'static-geojson') → File system fetch → IngestionValidator.validate()
  ├─ TIER_STRUCTURE: readStaticGeoJSON() + validateStructure() [SAME VALIDATOR]
  ├─ TIER_SANITY: boundaryResolver + runSanityChecks() [SAME VALIDATOR]
  └─ TIER_FULL: TessellationProofValidator [SAME VALIDATOR]
```

**Key insight**: Only the fetch mechanism changes. All validation logic remains identical.

---

## II. Portal Type Extension

### 2.1 Extended PortalType Enum

**File**: `src/core/registry/known-portals.ts`

```typescript
export type PortalType =
  // Existing dynamic portal types
  | 'arcgis'           // Generic ArcGIS REST services
  | 'municipal-gis'    // City-operated GIS portal
  | 'regional-gis'     // Regional council (e.g., HGAC, COG) operated GIS
  | 'state-gis'        // State-operated GIS portal (e.g., Hawaii Statewide GIS)
  | 'socrata'          // Socrata open data platform
  | 'geojson'          // Direct GeoJSON file URL (HTTP-accessible)
  | 'shapefile'        // Shapefile download
  | 'kml'              // KML/KMZ file

  // NEW: Static/curated portal types
  | 'static-geojson'   // Local GeoJSON file (manually extracted, versioned)
  | 'curated-data';    // Manually curated from non-API sources (PDF maps, webmap embeds)
```

**Distinction**:
- `'geojson'`: Direct HTTP URL to GeoJSON file (existing, dynamic)
- `'static-geojson'`: Local file system path (new, requires manual update)
- `'curated-data'`: Manually extracted/digitized from non-queryable sources (new)

### 2.2 Extended KnownPortal Interface

```typescript
export interface KnownPortal {
  // Existing fields (unchanged)
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly portalType: PortalType;
  readonly downloadUrl: string;
  readonly featureCount: number;
  readonly lastVerified: string;
  readonly confidence: number;
  readonly discoveredBy: 'manual' | 'automated' | 'authoritative';
  readonly notes?: string;

  // NEW: Static data provenance fields (optional, only for static/curated types)
  readonly staticMetadata?: {
    /**
     * Extraction methodology
     * Documents HOW the data was obtained from non-API sources
     */
    readonly extractionMethod:
      | 'webmap-json-parse'      // Parsed from ArcGIS webmap JSON
      | 'pdf-digitization'       // Manually digitized from PDF map
      | 'proprietary-platform'   // Extracted from VertiGIS/Geocortex
      | 'screenshot-trace'       // Traced from georeferenced screenshot
      | 'manual-request';        // Obtained via FOIA/data request

    /**
     * Original source URL (the page where data was found, NOT a download URL)
     * Example: ArcGIS webmap viewer URL, city council PDF map URL
     */
    readonly sourceUrl: string;

    /**
     * Date data was last extracted from source (ISO 8601)
     * Different from lastVerified (last validation run)
     */
    readonly extractedDate: string;

    /**
     * Expected update schedule
     * Determines when to re-extract data
     */
    readonly updateSchedule:
      | 'post-census'     // Every 10 years after Census redistricting
      | 'annual'          // Annually (check city website)
      | 'event-driven'    // After known redistricting events
      | 'manual';         // No automatic schedule (manual monitoring)

    /**
     * IPFS CID for immutable provenance
     * Points to the exact GeoJSON file version
     */
    readonly ipfsCid?: string;

    /**
     * Authoritative source verification
     * Links to city charter, ordinance, or official documentation
     * confirming district boundaries
     */
    readonly authoritativeSource?: string;
  };
}
```

### 2.3 Example Static Portal Entry

```typescript
export const KNOWN_PORTALS: Record<string, KnownPortal> = {
  // ... existing entries ...

  '2205000': { // Baton Rouge, LA
    cityFips: '2205000',
    cityName: 'Baton Rouge',
    state: 'LA',
    portalType: 'static-geojson',

    // File path relative to package root (NOT an HTTP URL)
    downloadUrl: 'data/curated/LA/baton-rouge-council-districts-2024.geojson',

    featureCount: 6,
    lastVerified: '2026-01-17T00:00:00.000Z',
    confidence: 85, // High confidence (manually verified from official source)
    discoveredBy: 'manual',
    notes: 'Council districts extracted from city GIS webmap (not queryable via REST API)',

    staticMetadata: {
      extractionMethod: 'webmap-json-parse',
      sourceUrl: 'https://brla.maps.arcgis.com/apps/webappviewer/index.html?id=abc123',
      extractedDate: '2026-01-17',
      updateSchedule: 'post-census',
      ipfsCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      authoritativeSource: 'https://www.brla.gov/DocumentCenter/View/12345/Council-District-Map'
    }
  }
};
```

---

## III. File Organization

### 3.1 Directory Structure

```
packages/shadow-atlas/
├─ data/
│  └─ curated/           # NEW: Manually curated GeoJSON files
│     ├─ AL/
│     │  └─ birmingham-council-districts-2024.geojson
│     ├─ LA/
│     │  └─ baton-rouge-council-districts-2024.geojson
│     ├─ NC/
│     │  └─ charlotte-council-districts-2024.geojson
│     └─ README.md      # Curation guidelines
│
├─ .gitignore           # EXCLUDE: data/curated/*.geojson (too large for git)
│
└─ docs/
   └─ CURATION_GUIDE.md # NEW: Step-by-step extraction methodology
```

### 3.2 Git vs. IPFS Storage

**Problem**: GeoJSON files are 50KB-5MB each. Storing 100+ cities = tens of MB in git history.

**Solution**: Dual storage strategy

| Storage Layer | What Gets Stored | Why |
|---------------|------------------|-----|
| **Git** | `known-portals.ts` metadata (IPFS CIDs, extraction method) | Version control metadata, zero binary bloat |
| **IPFS** | Actual GeoJSON files | Immutable, content-addressed, verifiable provenance |
| **File System** (local dev) | Cached GeoJSON from IPFS | Fast local validation, gitignored |

**Workflow**:
1. Extract GeoJSON manually
2. Pin to IPFS → get CID
3. Add `KnownPortal` entry with `ipfsCid` to `known-portals.ts`
4. Validation fetches from IPFS (or local cache if present)
5. Git tracks only metadata (no binary GeoJSON)

### 3.3 Fetch Resolution Logic

**File**: `src/validators/council/ingestion-validator.ts` (modify existing `fetchDistricts()`)

```typescript
private async fetchDistricts(
  url: string,
  timeoutMs: number,
  portalType: PortalType, // NEW parameter
  ipfsCid?: string        // NEW parameter
): Promise<FeatureCollection<Polygon | MultiPolygon>> {

  // === NEW: Static portal resolution ===
  if (portalType === 'static-geojson' || portalType === 'curated-data') {
    // Priority 1: Local file system (fast, for development)
    const localPath = path.resolve(__dirname, '../../..', url);
    if (fs.existsSync(localPath)) {
      const data = await fs.promises.readFile(localPath, 'utf-8');
      return JSON.parse(data);
    }

    // Priority 2: IPFS fetch (immutable, authoritative)
    if (ipfsCid) {
      const ipfsData = await this.fetchFromIPFS(ipfsCid, timeoutMs);

      // Cache locally for future runs
      await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
      await fs.promises.writeFile(localPath, JSON.stringify(ipfsData, null, 2));

      return ipfsData;
    }

    throw new Error(
      `Static portal '${url}' not found locally and no IPFS CID provided`
    );
  }

  // === EXISTING: HTTP fetch for dynamic portals ===
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data as FeatureCollection<Polygon | MultiPolygon>;
  } finally {
    clearTimeout(timeout);
  }
}

private async fetchFromIPFS(
  cid: string,
  timeoutMs: number
): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  const ipfsGateways = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
  ];

  for (const gateway of ipfsGateways) {
    try {
      const response = await fetch(gateway, {
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn(`IPFS gateway ${gateway} failed, trying next...`);
    }
  }

  throw new Error(`All IPFS gateways failed for CID ${cid}`);
}
```

---

## IV. Validation Pipeline Integration

### 4.1 Zero Redundancy Principle

**Critical insight**: Static GeoJSON requires ZERO new validation logic. Once fetched, it's identical to dynamic GeoJSON.

```typescript
// EXISTING IngestionValidator.validate() - NO CHANGES NEEDED
async validate(
  fips: string,
  url: string,
  options: IngestionValidationOptions = {}
): Promise<IngestionValidationResult> {

  // ... FIPS correction, quarantine checks (unchanged) ...

  // === TIER 1: Structure Validation ===
  let districts: FeatureCollection<Polygon | MultiPolygon>;
  try {
    // ONLY THIS LINE CHANGES: Pass portalType + ipfsCid
    const portal = KNOWN_PORTALS[fips]; // Look up portal metadata
    districts = await this.fetchDistricts(
      url,
      options.fetchTimeoutMs ?? 30000,
      portal?.portalType ?? 'arcgis',       // NEW
      portal?.staticMetadata?.ipfsCid       // NEW
    );
  } catch (error) {
    // ... error handling (unchanged) ...
  }

  // Validate structure (SAME LOGIC)
  const structureValidation = this.validateStructure(districts);

  // === TIER 2: Sanity Checks (UNCHANGED) ===
  const sanityResult = runSanityChecks(districts, boundary, expectedCount);

  // === TIER 3: Tessellation Proof (UNCHANGED) ===
  const proof = this.tessellationValidator.prove(districts, boundary.geometry, ...);

  return this.pass(baseResult, startTime, ValidationTier.FULL, ...);
}
```

**Result**: Static portals flow through identical validation pipeline. Zero new validators needed.

### 4.2 Authority Scoring for Static Data

**File**: `src/validators/council/ingestion-validator.ts`

```typescript
export enum AuthorityLevel {
  UNKNOWN = 0,
  COMMUNITY_MAINTAINED = 1,
  COMMERCIAL_AGGREGATOR = 2,
  MUNICIPAL_OFFICIAL = 3,
  STATE_MANDATE = 4,
  FEDERAL_MANDATE = 5,

  // NEW: Adjust scoring for static data
  CURATED_WITH_SOURCE = 4,  // Manually curated + authoritativeSource link
  CURATED_NO_SOURCE = 2,    // Manually curated, no verification doc
}

// NEW: Helper to compute authority level for static portals
function computeAuthorityLevel(portal: KnownPortal): AuthorityLevel {
  if (portal.portalType === 'static-geojson' || portal.portalType === 'curated-data') {
    // Static data authority depends on verification
    if (portal.staticMetadata?.authoritativeSource) {
      return AuthorityLevel.CURATED_WITH_SOURCE; // High trust
    }
    return AuthorityLevel.CURATED_NO_SOURCE; // Lower trust
  }

  // Dynamic portals use existing logic
  if (portal.portalType === 'municipal-gis') return AuthorityLevel.MUNICIPAL_OFFICIAL;
  if (portal.portalType === 'state-gis') return AuthorityLevel.STATE_MANDATE;
  return AuthorityLevel.UNKNOWN;
}
```

### 4.3 Staleness Detection

**Problem**: Static data goes stale faster than dynamic APIs (no live updates).

**Solution**: Use `staticMetadata.updateSchedule` + `extractedDate` for staleness checks.

```typescript
// NEW: Staleness checker for static portals
function isStale(portal: KnownPortal): boolean {
  if (!portal.staticMetadata) return false; // Not a static portal

  const { extractedDate, updateSchedule } = portal.staticMetadata;
  const extractedTime = new Date(extractedDate).getTime();
  const now = Date.now();
  const daysSinceExtraction = (now - extractedTime) / (1000 * 60 * 60 * 24);

  switch (updateSchedule) {
    case 'post-census':   // 10-year cycle
      return daysSinceExtraction > 3650; // 10 years
    case 'annual':
      return daysSinceExtraction > 365;
    case 'event-driven':
      return daysSinceExtraction > 730; // 2 years (conservative)
    case 'manual':
      return false; // Never auto-stale (manual monitoring)
  }
}

// USAGE: Warning system
if (isStale(portal)) {
  console.warn(
    `Portal ${portal.cityName} (${portal.cityFips}) is stale. ` +
    `Last extracted: ${portal.staticMetadata.extractedDate}. ` +
    `Update schedule: ${portal.staticMetadata.updateSchedule}`
  );
}
```

---

## V. IPFS Integration

### 5.1 Why IPFS?

| Requirement | IPFS Solution |
|-------------|---------------|
| **Immutable provenance** | Content-addressed by cryptographic hash (CID) |
| **Tamper detection** | Any modification changes CID → instant detection |
| **Distributed availability** | No single point of failure (multiple gateways) |
| **Git efficiency** | Store only 46-byte CID in git, not 5MB GeoJSON |

### 5.2 IPFS Pinning Workflow

**Tools**:
- [Pinata](https://www.pinata.cloud/) (free tier: 1GB pinned storage)
- [Web3.Storage](https://web3.storage/) (free, IPFS + Filecoin)
- Local IPFS node (advanced)

**Workflow**:
```bash
# 1. Extract GeoJSON manually
vim data/curated/LA/baton-rouge-council-districts-2024.geojson

# 2. Pin to IPFS (via Pinata API)
curl -X POST "https://api.pinata.cloud/pinning/pinFileToIPFS" \
  -H "Authorization: Bearer YOUR_JWT" \
  -F file=@data/curated/LA/baton-rouge-council-districts-2024.geojson \
  -F pinataMetadata='{"name":"Baton Rouge Council Districts 2024"}'

# Response: { "IpfsHash": "bafybei...", ... }

# 3. Add entry to known-portals.ts
{
  cityFips: '2205000',
  portalType: 'static-geojson',
  downloadUrl: 'data/curated/LA/baton-rouge-council-districts-2024.geojson',
  staticMetadata: {
    ipfsCid: 'bafybei...',  // From Pinata response
    extractedDate: '2026-01-17',
    ...
  }
}

# 4. Validation fetches from IPFS (or local cache)
npm run validate -- --fips 2205000
```

### 5.3 IPFS Gateway Failover

**Problem**: Public IPFS gateways are unreliable (rate limits, downtime).

**Solution**: Multi-gateway retry with exponential backoff.

```typescript
private async fetchFromIPFS(
  cid: string,
  timeoutMs: number
): Promise<FeatureCollection<Polygon | MultiPolygon>> {
  const gateways = [
    `https://ipfs.io/ipfs/${cid}`,             // Protocol Labs (most reliable)
    `https://dweb.link/ipfs/${cid}`,           // Protocol Labs (mirror)
    `https://cloudflare-ipfs.com/ipfs/${cid}`,// Cloudflare (fast CDN)
    `https://gateway.pinata.cloud/ipfs/${cid}`,// Pinata (paid tier bypass)
  ];

  const errors: Error[] = [];

  for (const gateway of gateways) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(gateway, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
      console.warn(`Gateway ${gateway} failed: ${errors[errors.length - 1].message}`);
    }
  }

  throw new Error(
    `All IPFS gateways failed for CID ${cid}. Errors: ${errors.map(e => e.message).join(', ')}`
  );
}
```

---

## VI. Curation Workflow

### 6.1 Manual Extraction Guide

**File**: `docs/CURATION_GUIDE.md`

```markdown
# Static GeoJSON Curation Guide

## When to Use Static Portals

Use `static-geojson` portal type when:
- ✅ City has council district data BUT no queryable API
- ✅ Data embedded in ArcGIS webmap JSON (not REST endpoint)
- ✅ Data only in PDF maps or proprietary platforms
- ✅ FOIA request returned shapefile (converted to GeoJSON)

Do NOT use for:
- ❌ Cities with working REST APIs (use 'arcgis' or 'municipal-gis')
- ❌ At-large cities (use AT_LARGE_CITIES registry)
- ❌ Data quality issues (use QUARANTINED_PORTALS)

## Extraction Methods

### Method 1: ArcGIS Webmap JSON Parse

**Example**: Baton Rouge, LA

1. Find city council district webmap (e.g., ArcGIS WebAppBuilder)
2. Open browser DevTools → Network tab
3. Load map → filter for `query?` requests
4. Find FeatureServer layer with district polygons
5. Copy response JSON → extract `features` array
6. Convert to FeatureCollection:

```json
{
  "type": "FeatureCollection",
  "features": [ /* paste features here */ ]
}
```

7. Validate geometry: `npm run validate -- --file extracted.geojson`
8. Save to `data/curated/{STATE}/{city}-council-districts-{YEAR}.geojson`

### Method 2: PDF Digitization (QGIS)

**Example**: Small town with only PDF map on city website

1. Download high-resolution PDF map from city website
2. Georeference in QGIS (use known landmarks, street intersections)
3. Create new polygon layer
4. Trace district boundaries manually
5. Export as GeoJSON → EPSG:4326 (WGS84)
6. Add district identifiers in properties (district number, name)

### Method 3: Proprietary Platform Extraction

**Example**: VertiGIS/Geocortex Viewers

1. Inspect network requests for GeoJSON responses
2. If obfuscated, use browser console to access map object:
   ```javascript
   // VertiGIS Viewer
   viewer.map.layers.getItemAt(0).source.features.toArray()
   ```
3. Export to GeoJSON via `JSON.stringify()`
4. Validate structure

## Quality Checklist

Before adding to registry:

- [ ] GeoJSON validates (use `npm run validate:geojson`)
- [ ] Projection is EPSG:4326 (WGS84 lat/lon)
- [ ] Feature count matches expected (check `EXPECTED_DISTRICT_COUNTS`)
- [ ] Properties include district identifier (number, name, or both)
- [ ] Geometries are Polygon or MultiPolygon (no LineStrings, Points)
- [ ] No topology errors (self-intersections, invalid rings)
- [ ] Source URL documented in `staticMetadata.sourceUrl`
- [ ] Extraction date recorded (`YYYY-MM-DD`)
- [ ] Authoritative source linked (city ordinance, charter, official map)

## IPFS Pinning

1. Sign up for Pinata (https://www.pinata.cloud/)
2. Get API JWT from dashboard
3. Pin file:
   ```bash
   curl -X POST "https://api.pinata.cloud/pinning/pinFileToIPFS" \
     -H "Authorization: Bearer YOUR_JWT" \
     -F file=@data/curated/LA/baton-rouge-2024.geojson \
     -F pinataMetadata='{"name":"Baton Rouge Districts 2024"}'
   ```
4. Copy `IpfsHash` from response
5. Add to `known-portals.ts` entry as `ipfsCid`

## Update Schedule Guidelines

| Schedule | When to Use | Example |
|----------|-------------|---------|
| `post-census` | Districts redistricted every 10 years | Most US cities |
| `annual` | City updates annually | Rapid growth areas |
| `event-driven` | Known upcoming redistricting | Legal challenges, annexations |
| `manual` | No predictable schedule | Monitor city website |
```

### 6.2 Validation Script

**File**: `scripts/validate-curated-geojson.ts`

```typescript
/**
 * Validate curated GeoJSON files before adding to registry
 */
import { validateForIngestion, ValidationTier } from '../src/validators/council/ingestion-validator.js';
import { EXPECTED_DISTRICT_COUNTS } from '../src/core/registry/district-count-registry.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface CurationValidationResult {
  filePath: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  featureCount: number;
  expectedCount: number | null;
  hasDistrictIdentifiers: boolean;
  projection: string;
  topologyValid: boolean;
}

async function validateCuratedGeoJSON(
  filePath: string,
  fips: string
): Promise<CurationValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Load file
  const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));

  // Check structure
  if (data.type !== 'FeatureCollection') {
    errors.push(`Expected FeatureCollection, got ${data.type}`);
  }

  const featureCount = data.features?.length ?? 0;
  if (featureCount === 0) {
    errors.push('No features in FeatureCollection');
  }

  // Check expected count
  const expectedRecord = EXPECTED_DISTRICT_COUNTS[fips];
  const expectedCount = expectedRecord?.expectedDistrictCount ?? null;

  if (expectedCount !== null && featureCount !== expectedCount) {
    if (Math.abs(featureCount - expectedCount) <= 2) {
      warnings.push(
        `Feature count (${featureCount}) differs from expected (${expectedCount}) by ${Math.abs(featureCount - expectedCount)} (within tolerance)`
      );
    } else {
      errors.push(
        `Feature count mismatch: got ${featureCount}, expected ${expectedCount}`
      );
    }
  }

  // Check district identifiers
  const hasDistrictIdentifiers = data.features.every((f: any) =>
    f.properties?.district !== undefined ||
    f.properties?.District !== undefined ||
    f.properties?.DISTRICT !== undefined ||
    f.properties?.name !== undefined ||
    f.properties?.NAME !== undefined
  );

  if (!hasDistrictIdentifiers) {
    warnings.push('Some features missing district identifiers in properties');
  }

  // Check geometry types
  const invalidGeometries = data.features.filter((f: any) =>
    !['Polygon', 'MultiPolygon'].includes(f.geometry?.type)
  );

  if (invalidGeometries.length > 0) {
    errors.push(
      `${invalidGeometries.length} features have invalid geometry types (expected Polygon/MultiPolygon)`
    );
  }

  // Projection check (should be EPSG:4326)
  const projection = data.crs?.properties?.name ?? 'EPSG:4326';
  if (!projection.includes('4326') && !projection.includes('WGS84')) {
    errors.push(`Projection should be EPSG:4326, got ${projection}`);
  }

  // Run full ingestion validation
  let topologyValid = true;
  try {
    const result = await validateForIngestion(
      fips,
      filePath,
      { tier: ValidationTier.FULL }
    );

    if (!result.valid) {
      errors.push(`Ingestion validation failed: ${result.status}`);
      topologyValid = false;
    }
  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
    topologyValid = false;
  }

  return {
    filePath,
    valid: errors.length === 0,
    errors,
    warnings,
    featureCount,
    expectedCount,
    hasDistrictIdentifiers,
    projection,
    topologyValid,
  };
}

// CLI usage
const [filePath, fips] = process.argv.slice(2);
if (!filePath || !fips) {
  console.error('Usage: npm run validate:curated -- <file-path> <fips>');
  process.exit(1);
}

const result = await validateCuratedGeoJSON(filePath, fips);

console.log('\n=== Curation Validation Report ===');
console.log(`File: ${result.filePath}`);
console.log(`FIPS: ${fips}`);
console.log(`Features: ${result.featureCount} (expected: ${result.expectedCount ?? 'unknown'})`);
console.log(`Projection: ${result.projection}`);
console.log(`District Identifiers: ${result.hasDistrictIdentifiers ? '✅' : '⚠️'}`);
console.log(`Topology Valid: ${result.topologyValid ? '✅' : '❌'}`);

if (result.warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  result.warnings.forEach(w => console.log(`  - ${w}`));
}

if (result.errors.length > 0) {
  console.log('\n❌ Errors:');
  result.errors.forEach(e => console.log(`  - ${e}`));
  process.exit(1);
}

console.log('\n✅ Validation passed! Ready to add to known-portals.ts');
```

---

## VII. Migration Plan

### 7.1 Phase 1: Infrastructure Setup (Week 1)

- [ ] Add `PortalType` extensions (`'static-geojson'`, `'curated-data'`)
- [ ] Extend `KnownPortal` interface with `staticMetadata` field
- [ ] Modify `fetchDistricts()` to support static file resolution
- [ ] Implement IPFS gateway failover
- [ ] Create `data/curated/` directory structure
- [ ] Write `docs/CURATION_GUIDE.md`

### 7.2 Phase 2: Validation Scripts (Week 1-2)

- [ ] Implement `scripts/validate-curated-geojson.ts`
- [ ] Add `isStale()` checker for static portals
- [ ] Add `computeAuthorityLevel()` for static data
- [ ] Write unit tests for static fetch resolution
- [ ] Test IPFS failover with mock CIDs

### 7.3 Phase 3: Pilot Cities (Week 2-3)

Target cities with non-queryable data:

1. **Baton Rouge, LA** (webmap JSON extraction)
   - Extract from ArcGIS webmap
   - Pin to IPFS
   - Add to registry
   - Run full validation

2. **Small NC town** (PDF digitization)
   - Georeference PDF in QGIS
   - Trace boundaries
   - Export GeoJSON
   - Validate + pin

3. **VertiGIS city** (proprietary platform)
   - Extract via browser console
   - Convert to GeoJSON
   - Validate structure

### 7.4 Phase 4: Documentation + Rollout (Week 3-4)

- [ ] Document 5 successful curation examples
- [ ] Create video walkthrough (webmap extraction)
- [ ] Update `README.md` with static portal instructions
- [ ] Open-source curation workflow (community contributions)

---

## VIII. Security Considerations

### 8.1 IPFS Integrity

**Threat**: Malicious actor modifies local cached GeoJSON.

**Mitigation**:
- IPFS CID is cryptographic hash of content
- Any modification breaks CID verification
- Validation fails loudly if CID mismatch detected

```typescript
async function verifyIPFSIntegrity(
  filePath: string,
  expectedCid: string
): Promise<boolean> {
  const content = await fs.readFile(filePath, 'utf-8');
  const computedCid = await computeIPFSCid(content); // Use IPFS hashing lib

  if (computedCid !== expectedCid) {
    throw new Error(
      `IPFS integrity violation: expected ${expectedCid}, got ${computedCid}. ` +
      `File may be corrupted or tampered with.`
    );
  }

  return true;
}
```

### 8.2 Curation Provenance

**Threat**: Low-quality manual curation introduces geometry errors.

**Mitigation**:
- Require `authoritativeSource` link for high confidence
- Authority scoring penalizes unverified static data
- Tessellation validation catches topology errors
- IPFS CID provides tamper-evident trail

### 8.3 Update Schedule Enforcement

**Threat**: Stale data remains in production after redistricting.

**Mitigation**:
- Automated staleness warnings in CI
- `updateSchedule` field triggers re-extraction reminders
- Manual monitoring for event-driven updates

---

## IX. Trade-offs Analysis

### 9.1 Stack Decision: File System vs. Database

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **File system + IPFS** | Simple, git-friendly metadata, immutable provenance | Manual sync, no query interface | ✅ **Chosen** |
| **Database (PostgreSQL)** | Query interface, automated sync | Adds infrastructure, binary storage | ❌ Rejected (overengineered) |
| **Object storage (S3)** | Scalable, versioned | Cost, vendor lock-in | ❌ Rejected (unnecessary) |

**Rationale**: File system + IPFS aligns with existing registry-driven architecture (see `known-portals.ts`, `district-count-registry.ts`). Database adds complexity without clear benefit for <500 cities.

### 9.2 Control Flow: Fetch-Time vs. Registry-Time Resolution

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **Fetch-time** (dynamic lookup) | Flexible, portal-specific logic | Tight coupling | ✅ **Chosen** |
| **Registry-time** (pre-compute URLs) | Decoupled | Can't handle IPFS failover | ❌ Rejected |

**Rationale**: `fetchDistricts()` already handles HTTP fetch. Adding static file resolution at fetch-time maintains single responsibility and enables IPFS gateway failover.

### 9.3 IPFS vs. GitHub LFS

| Storage | Pros | Cons | Decision |
|---------|------|------|----------|
| **IPFS** | Content-addressed, decentralized, no vendor lock-in | Public gateway reliability varies | ✅ **Chosen** |
| **GitHub LFS** | Integrated with GitHub, reliable | 1GB free limit, vendor lock-in | ❌ Rejected |

**Rationale**: IPFS aligns with decentralization principles. Cryptographic CIDs provide stronger integrity than LFS SHA256. Gateway failover mitigates reliability concerns.

---

## X. Code Examples

### 10.1 Adding a Static Portal (Complete Flow)

```typescript
// 1. Extract GeoJSON (manual step - see CURATION_GUIDE.md)
// Assume file saved to: data/curated/LA/baton-rouge-council-districts-2024.geojson

// 2. Validate before adding to registry
import { execSync } from 'node:child_process';

execSync(
  'npm run validate:curated -- ' +
  'data/curated/LA/baton-rouge-council-districts-2024.geojson ' +
  '2205000', // Baton Rouge FIPS
  { stdio: 'inherit' }
);

// 3. Pin to IPFS (curl or Pinata SDK)
const pinataResponse = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${PINATA_JWT}` },
  body: formData, // File upload
});
const { IpfsHash } = await pinataResponse.json();
// IpfsHash: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

// 4. Add entry to known-portals.ts
export const KNOWN_PORTALS: Record<string, KnownPortal> = {
  // ... existing entries ...

  '2205000': {
    cityFips: '2205000',
    cityName: 'Baton Rouge',
    state: 'LA',
    portalType: 'static-geojson',
    downloadUrl: 'data/curated/LA/baton-rouge-council-districts-2024.geojson',
    featureCount: 6,
    lastVerified: '2026-01-17T00:00:00.000Z',
    confidence: 85,
    discoveredBy: 'manual',
    notes: 'Council districts extracted from city GIS webmap (not queryable via REST API)',
    staticMetadata: {
      extractionMethod: 'webmap-json-parse',
      sourceUrl: 'https://brla.maps.arcgis.com/apps/webappviewer/index.html?id=abc123',
      extractedDate: '2026-01-17',
      updateSchedule: 'post-census',
      ipfsCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      authoritativeSource: 'https://www.brla.gov/DocumentCenter/View/12345/Council-District-Map',
    },
  },
};

// 5. Run validation (fetches from IPFS, runs full tessellation)
const result = await validateForIngestion(
  '2205000',
  KNOWN_PORTALS['2205000'].downloadUrl,
  { tier: ValidationTier.FULL }
);

console.log(result.valid ? '✅ Validation passed' : '❌ Validation failed');
```

### 10.2 Automated Staleness Check (CI Integration)

```typescript
// scripts/check-static-portal-staleness.ts
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.js';

function checkStaleness() {
  const stalePortals = Object.entries(KNOWN_PORTALS)
    .filter(([_, portal]) => portal.portalType === 'static-geojson' && isStale(portal))
    .map(([fips, portal]) => ({
      fips,
      cityName: portal.cityName,
      state: portal.state,
      extractedDate: portal.staticMetadata!.extractedDate,
      updateSchedule: portal.staticMetadata!.updateSchedule,
    }));

  if (stalePortals.length > 0) {
    console.warn('\n⚠️  Stale static portals detected:');
    stalePortals.forEach(({ fips, cityName, state, extractedDate, updateSchedule }) => {
      console.warn(
        `  ${cityName}, ${state} (${fips}): ` +
        `Extracted ${extractedDate}, schedule: ${updateSchedule}`
      );
    });

    // Optional: Fail CI if critical cities are stale
    const criticalFips = ['3651000', '0644000', '1714000']; // NYC, LA, Chicago
    const staleCritical = stalePortals.filter(p => criticalFips.includes(p.fips));

    if (staleCritical.length > 0) {
      console.error('\n❌ Critical cities have stale data. Update immediately.');
      process.exit(1);
    }
  } else {
    console.log('✅ All static portals up-to-date');
  }
}

checkStaleness();
```

---

## XI. Success Metrics

### 11.1 Quantitative Goals

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Cities covered** | +50 cities (non-queryable sources) | Portal registry size |
| **Validation pass rate** | ≥85% (same as dynamic portals) | Tessellation proof success |
| **IPFS uptime** | ≥99% (via gateway failover) | Fetch success rate |
| **Staleness rate** | <5% (proactive updates) | CI staleness checks |
| **Curation time** | <30 min per city (streamlined workflow) | Time tracking |

### 11.2 Qualitative Goals

- **Zero redundancy**: Reuse existing validation pipeline without code duplication
- **Maintainability**: Clear separation between static data (file system) and metadata (git)
- **Provenance**: Every static portal traceable to authoritative source + IPFS CID
- **Community-ready**: Curation guide enables external contributors

---

## XII. Future Extensions

### 12.1 Automated IPFS Pinning (Phase 2)

**Problem**: Manual IPFS pinning is tedious for bulk updates.

**Solution**: CI/CD automation

```yaml
# .github/workflows/pin-to-ipfs.yml
name: Pin Static GeoJSON to IPFS

on:
  push:
    paths:
      - 'data/curated/**/*.geojson'

jobs:
  pin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Pin to Pinata
        run: |
          for file in data/curated/**/*.geojson; do
            curl -X POST "https://api.pinata.cloud/pinning/pinFileToIPFS" \
              -H "Authorization: Bearer ${{ secrets.PINATA_JWT }}" \
              -F file=@$file \
              -F pinataMetadata='{"name":"'$(basename $file)'"}'
          done
```

### 12.2 Versioned Static Data

**Problem**: District boundaries change post-redistricting. Need historical versions.

**Solution**: Versioned file paths + IPFS CID history

```typescript
export interface KnownPortal {
  // ... existing fields ...

  staticMetadata?: {
    // ... existing fields ...

    // NEW: Historical versions
    readonly versions?: Array<{
      readonly year: number;
      readonly ipfsCid: string;
      readonly extractedDate: string;
      readonly notes: string;
    }>;
  };
}

// Example: Charlotte, NC (redistricted in 2024)
'3712000': {
  cityFips: '3712000',
  cityName: 'Charlotte',
  state: 'NC',
  portalType: 'static-geojson',
  downloadUrl: 'data/curated/NC/charlotte-council-districts-2024.geojson',
  staticMetadata: {
    ipfsCid: 'bafybei...2024', // Current version
    versions: [
      {
        year: 2014,
        ipfsCid: 'bafybei...2014',
        extractedDate: '2014-03-15',
        notes: 'Pre-2020 Census boundaries'
      },
      {
        year: 2024,
        ipfsCid: 'bafybei...2024',
        extractedDate: '2024-01-10',
        notes: 'Post-2020 Census redistricting'
      }
    ]
  }
}
```

### 12.3 Community Contributions

**Problem**: Manual curation doesn't scale to 10,000+ cities.

**Solution**: Open-source curation workflow with PR templates

```markdown
<!-- .github/PULL_REQUEST_TEMPLATE/static-portal.md -->
## Static Portal Submission

**City**: [e.g., Baton Rouge, LA]
**FIPS**: [e.g., 2205000]
**Extraction Method**: [webmap-json-parse / pdf-digitization / proprietary-platform / manual-request]

### Checklist
- [ ] GeoJSON file added to `data/curated/{STATE}/{city}-{YEAR}.geojson`
- [ ] Validation passed: `npm run validate:curated -- <file> <fips>`
- [ ] IPFS CID obtained (paste below)
- [ ] Authoritative source linked (city ordinance, official map)
- [ ] Entry added to `known-portals.ts`

**IPFS CID**: `bafybei...`
**Source URL**: [URL where data was found]
**Authoritative Source**: [Link to city charter/ordinance confirming boundaries]

### Validation Output
```
[Paste output from npm run validate:curated]
```

---

## XIII. Conclusion

This design extends shadow-atlas to handle **non-queryable council district data** while maintaining **zero redundancy** with existing validation infrastructure. Key achievements:

1. **Minimal code changes**: Only `fetchDistricts()` modified; all validators reused
2. **Immutable provenance**: IPFS CIDs provide tamper-evident data integrity
3. **Git efficiency**: Metadata in git, binaries in IPFS (no repo bloat)
4. **Authority-aware**: Confidence scoring + staleness detection for manual curation
5. **Community-ready**: Curation guide enables external contributions

**Next steps**: Implement Phase 1 infrastructure, validate with Baton Rouge pilot, iterate based on curation complexity.

---

**Architecture Review Checklist**:
- ✅ Resonant with existing patterns (registry-driven, fail-fast validation)
- ✅ Zero redundancy (reuses `IngestionValidator`, `TessellationProofValidator`)
- ✅ Maintainable (clear separation: metadata in git, data in IPFS)
- ✅ Authoritative (provenance tracking, authority scoring)
- ✅ Scalable (community curation, automated staleness checks)

**Estimated LOC Impact**:
- `known-portals.ts`: +10 lines (type extensions)
- `ingestion-validator.ts`: +80 lines (static fetch resolution + IPFS)
- `scripts/validate-curated-geojson.ts`: +150 lines (new script)
- `docs/CURATION_GUIDE.md`: +300 lines (new doc)
- **Total**: ~540 lines (minimal surface area)

**Risk Assessment**: Low. Static portals flow through identical validation as dynamic portals. IPFS failover mitigates gateway unreliability. Staleness detection prevents long-term rot.
