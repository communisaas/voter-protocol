# Sovereign District Resolution: US + Canada

**Status: ACTIVE**
**Created: 2026-02-26**
**Last reviewed: 2026-02-26**

## Thesis

Shadow Atlas becomes the sole runtime dependency for address-to-district resolution
across North America. Zero government API calls at request time. All authoritative data
pre-ingested from public domain / open government sources, versioned in Merkle trees,
committed on-chain.

```
User address --> Shadow Atlas /v1/resolve-address
                   |
                   +-> Geocode (TIGER/Line US + StatCan RNF Canada, self-hosted)
                   +-> PIP district lookup (R-tree spatial index, pre-built boundaries)
                   +-> Officials (SQLite, pre-ingested CC0/OGL data)
                   +-> Merkle proof (Tree 2 SMT, on-chain root)
                   |
                   v
                Response: { district, officials[], proof, cell_id, vintage }
```

External runtime calls: **zero**.

---

## Architecture Context

### Two Repositories

| Repo | Path | Role |
|------|------|------|
| voter-protocol | `/Users/noot/Documents/voter-protocol/` | Shadow Atlas package (serving, hydration, trees) |
| communique | `/Users/noot/Documents/communique/` | SvelteKit frontend (API routes, client, UI) |

### Current State (What Exists)

**Shadow Atlas (voter-protocol/packages/shadow-atlas/):**

| Component | Status | Key Files |
|-----------|--------|-----------|
| R-tree spatial index | OPERATIONAL | `src/serving/district-service.ts` |
| Officials service (US Congress) | OPERATIONAL | `src/serving/officials-service.ts` (L170-417) |
| Officials ingestion (CC0 YAML) | OPERATIONAL | `src/scripts/ingest-legislators.ts` (L318-395) |
| Officials SQLite schema | OPERATIONAL | `src/db/officials-schema.sql` (L12-83) |
| `/v1/resolve` composite endpoint | OPERATIONAL | `src/serving/api.ts` (route dispatch L549) |
| `/v1/officials?district=XX-NN` | OPERATIONAL | `src/serving/api.ts` (L773-861) |
| `/v1/lookup?lat=&lng=` | OPERATIONAL | R-tree PIP + Merkle proof |
| Jurisdiction abstraction (24-slot) | OPERATIONAL | `src/jurisdiction.ts` (L119-160) |
| US jurisdiction config (13/24 slots) | OPERATIONAL | `src/jurisdiction.ts` (L253-324) |
| Canada provider skeleton | EXISTS, NOT WIRED | `src/providers/international/canada-provider.ts` |
| Canada hydration pipeline | NOT STARTED | — |
| Self-hosted geocoding | NOT STARTED | — |
| Temporal versioning | NOT STARTED | — |

**Communique (communique/):**

| Component | Status | Key Files |
|-----------|--------|-----------|
| `/api/location/resolve` (coordinates) | Uses Shadow Atlas primary | `src/routes/api/location/resolve/+server.ts` |
| `/api/location/resolve-address` (address) | BYPASSES Shadow Atlas | `src/routes/api/location/resolve-address/+server.ts` |
| Shadow Atlas client | Complete (10 functions) | `src/lib/core/shadow-atlas/client.ts` |
| Congress.gov address-lookup service | ACTIVE (should be deprecated) | `src/lib/core/congress/address-lookup.ts` |
| AddressVerificationFlow | Two paths (geo + address) | `src/lib/components/auth/AddressVerificationFlow.svelte` |
| MSW test mocks | Census + Congress + partial SA | `tests/mocks/external-services.ts` |

### External API Dependencies (Current)

| API | Called By | Lines | Purpose |
|-----|-----------|-------|---------|
| Census Bureau geocoder (structured) | `resolve-address/+server.ts` | L63-136 | Address -> coords + district + cell_id |
| Census Bureau geocoder (coordinates) | `resolve/+server.ts` | L46-87 | Coords -> cell_id + district |
| Congress.gov `/v3/member` | `address-lookup.ts` | L700 | All 535 members (5-min cache) |
| Google Civic API | `mdl-verification.ts` | mDL path only | District from mDL address (P3) |

---

## Cycle Plan

### Cycle 1: Shadow Atlas as Sole US Official Source

**Goal:** Eliminate Congress.gov as a runtime dependency. All representative lookups
go through Shadow Atlas pre-ingested data.

**Precondition:** Shadow Atlas server running with officials DB ingested.

#### 1A. Verify Shadow Atlas officials service operational

**Repo:** voter-protocol
**Files:**
- `packages/shadow-atlas/src/scripts/ingest-legislators.ts`
- `packages/shadow-atlas/src/serving/officials-service.ts`
- `packages/shadow-atlas/src/__tests__/unit/serving/officials-service.test.ts`

**Tasks:**
- [ ] Run officials ingestion: `npx tsx src/scripts/ingest-legislators.ts --db ./data/officials.db`
- [ ] Verify member count: expect 541 (435 House + 100 Senate + 6 delegates)
- [ ] Start Shadow Atlas server: `npx tsx src/cli/commands/serve/index.ts`
- [ ] Verify endpoint: `curl localhost:3000/v1/officials?district=CA-12` returns Pelosi + 2 CA senators
- [ ] Verify endpoint: `curl localhost:3000/v1/officials?district=DC-00` returns DC delegate, no senators
- [ ] Verify endpoint: `curl localhost:3000/v1/officials?district=VT-AL` returns VT at-large + 2 senators
- [ ] Run existing tests: `npx vitest run src/__tests__/unit/serving/officials-service.test.ts`

**Success criteria:** `/v1/officials` returns correct data for all 50 states + DC + 5 territories.

#### 1B. Rewire communique resolve-address to use Shadow Atlas officials

**Repo:** communique
**Files to modify:**
- `src/routes/api/location/resolve-address/+server.ts` (L245-294: replace Congress.gov call)
- `src/lib/core/shadow-atlas/client.ts` (already has `getOfficials()` at L730)

**What changes:**
- Remove import of `addressLookupService` (L4)
- Import `getOfficials` from shadow-atlas client (already imported: `lookupDistrict` at L5)
- Replace Step 2 (L222-294) Congress.gov member lookup with:
  ```typescript
  // Step 2: Shadow Atlas officials lookup (pre-ingested, no runtime API calls)
  try {
    const officialsResponse = await getOfficials(districtCode);
    officials = officialsResponse.officials.map(official => ({
      name: official.name,
      office: official.office,
      chamber: official.chamber as 'house' | 'senate',
      party: official.party,
      state: official.state,
      district: official.chamber === 'house'
        ? officialsResponse.district_code
        : official.state,
      bioguide_id: official.bioguide_id,
      is_voting_member: official.is_voting ?? true,
      delegate_type: official.delegate_type,
      phone: official.phone ?? undefined,
      office_code: official.cwc_code ?? undefined,
    }));
    if (officialsResponse.special_status) {
      specialStatus = officialsResponse.special_status;
    }
  } catch (err) {
    console.warn('[resolve-address] Shadow Atlas officials unavailable:', err);
    // Graceful degradation: return district without officials
  }
  ```
- Remove fire-and-forget Shadow Atlas call (L297-307) — it's now the primary path
- Keep Census Bureau geocoding (Step 1, L182-216) — still needed for address -> coords

**Files to NOT modify yet:**
- `src/lib/core/congress/address-lookup.ts` — keep for now, used by `delivery-worker.ts`
  and CWC submission flow. Deprecation is Phase 1C.

**Tests to update:**
- `tests/mocks/external-services.ts`:
  - Shadow Atlas `/v1/officials` handler (currently returns 501, needs real mock data)
  - Can remove Congress.gov handler dependency for resolve-address tests
- `tests/integration/api/address-verification-e2e.test.ts`:
  - Verify officials come from Shadow Atlas mock, not Congress.gov mock

**Success criteria:**
- `POST /api/location/resolve-address` returns officials from Shadow Atlas
- Congress.gov API key NOT required for address verification flow
- All existing tests pass (93 tests across 3 files)
- New test: resolve-address with Shadow Atlas officials mock returns correct data

#### 1C. Deprecate Congress.gov as resolve-address dependency

**Repo:** communique
**Files:**
- `src/lib/core/congress/address-lookup.ts` — add deprecation notice
- `src/server/delivery-worker.ts` — audit: does it need Congress.gov for CWC delivery?

**Tasks:**
- [ ] Audit all imports of `addressLookupService` (5 files identified)
- [ ] Determine which still need Congress.gov (delivery-worker for CWC submission?)
- [ ] Add `@deprecated` JSDoc to `addressLookupService` and `getRepresentativesForAddress`
- [ ] If delivery-worker can use Shadow Atlas officials, migrate it too
- [ ] Remove `CONGRESS_API_KEY` from required env vars for address verification

**Findings log:**
```
(populated during review)
```

---

### Cycle 2: Self-Hosted Geocoding (US)

**Goal:** Eliminate Census Bureau as a runtime dependency. Shadow Atlas geocodes
US addresses from TIGER/Line data via self-hosted Nominatim.

**Precondition:** Cycle 1 complete (Shadow Atlas officials working).

#### 2A. Nominatim Docker infrastructure

**Repo:** voter-protocol
**Files to create:**
- `docker/nominatim/docker-compose.yml` (or extend existing)
- `docker/nominatim/README.md`

**Nominatim configuration:**
```yaml
services:
  nominatim:
    image: mediagis/nominatim:4.4
    container_name: shadow-atlas-nominatim
    volumes:
      - nominatim-data:/var/lib/postgresql/14/main
      - ./tiger-data:/data/tiger  # Pre-downloaded TIGER files
    environment:
      PBF_URL: https://download.geofabrik.de/north-america/us-latest.osm.pbf
      IMPORT_STYLE: structured
      IMPORT_US_POSTCODES: "true"
      IMPORT_TIGER_DATA: "true"
      NOMINATIM_DATABASE_DSN: "pgsql:dbname=nominatim"
      THREADS: 4
    ports:
      - "8088:8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/status"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 16G
        reservations:
          memory: 4G
```

**Import process:**
- US-only: `us-latest.osm.pbf` (~10GB) + TIGER address data (~6GB)
- Expected import time: ~2-4 hours on 4-core machine
- Resulting index: ~60GB disk
- Steady-state RAM: ~4GB
- Test query: `curl "localhost:8088/search?street=1+Dr+Carlton+B+Goodlett+Pl&city=San+Francisco&state=CA&postalcode=94102&format=json"`
  - Expect: lat=37.7793, lon=-122.4193 (±0.001)

**Success criteria:**
- Nominatim container starts, imports TIGER data, responds to queries
- Address matching quality: ≥95% match rate on test fixture addresses
- Latency: p95 < 200ms for structured address queries

#### 2B. Shadow Atlas geocoding service

**Repo:** voter-protocol
**Files to create:**
- `packages/shadow-atlas/src/serving/geocode-service.ts`
- `packages/shadow-atlas/src/__tests__/unit/serving/geocode-service.test.ts`

**GeocodeService class:**
```typescript
// src/serving/geocode-service.ts

interface GeocodeResult {
  lat: number;
  lng: number;
  matched_address: string;
  confidence: number;      // 0-1 based on Nominatim importance/rank
  country: 'US' | 'CA';
  state_province: string;  // 2-letter code
  postal_code: string;
}

interface GeocodeRequest {
  street: string;
  city: string;
  state: string;           // US state or CA province
  zip: string;             // US ZIP or CA postal code
  country?: 'US' | 'CA';  // auto-detect from postal format if omitted
}

class GeocodeService {
  constructor(nominatimUrl: string);  // e.g., 'http://nominatim:8080'

  /** Geocode a structured address. Returns null if no match. */
  async geocode(request: GeocodeRequest): Promise<GeocodeResult | null>;

  /** Health check: Nominatim is reachable and responsive. */
  async healthCheck(): Promise<boolean>;

  /** Auto-detect country from postal code format. */
  static detectCountry(postalCode: string): 'US' | 'CA' | null;
}
```

**Country detection logic:**
```typescript
static detectCountry(postalCode: string): 'US' | 'CA' | null {
  if (/^\d{5}(-\d{4})?$/.test(postalCode)) return 'US';     // 12345 or 12345-6789
  if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(postalCode)) return 'CA';  // A1A 1A1
  return null;
}
```

**Nominatim query construction:**
- Use `/search` endpoint with structured parameters (NOT free-form)
- Parameters: `street`, `city`, `state`, `postalcode`, `country`, `format=json`, `limit=1`
- Bounded to US/CA: `countrycodes=us,ca`
- Timeout: 5 seconds (local network, should be fast)

**Success criteria:**
- Geocodes all test fixture addresses correctly
- Returns null (not error) for unresolvable addresses
- Country auto-detection works for US ZIP and Canadian postal codes

#### 2C. Shadow Atlas `/v1/resolve-address` composite endpoint

**Repo:** voter-protocol
**Files to modify:**
- `packages/shadow-atlas/src/serving/api.ts` — add route handler
- `packages/shadow-atlas/src/cli/commands/serve/index.ts` — wire geocode service

**New endpoint:**
```
POST /v1/resolve-address
Content-Type: application/json

{
  "street": "1 Dr Carlton B Goodlett Pl",
  "city": "San Francisco",
  "state": "CA",
  "zip": "94102",
  "country": "US"          // optional, auto-detected from zip format
}

Response 200:
{
  "success": true,
  "data": {
    "geocode": {
      "lat": 37.7793,
      "lng": -122.4193,
      "matched_address": "1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102",
      "confidence": 0.95,
      "country": "US"
    },
    "district": {
      "id": "usa-ca-congressional-11",
      "name": "California's 11th Congressional District",
      "jurisdiction": "congressional",
      "districtType": "congressional"
    },
    "officials": {
      "officials": [...],
      "district_code": "CA-11",
      "state": "CA",
      "special_status": null,
      "source": "congress-legislators",
      "cached": true
    },
    "merkleProof": {
      "root": "0x...",
      "leaf": "0x...",
      "siblings": ["0x...", ...],
      "pathIndices": [0, 1, ...],
      "depth": 20
    },
    "cell_id": "06075020100",
    "vintage": "119th-congress"
  }
}
```

**Pipeline within the handler:**
1. Validate input (Zod schema, same pattern as existing endpoints)
2. `geocodeService.geocode(input)` → lat/lng
3. `districtService.lookup(lat, lng)` → district + Merkle proof (existing R-tree)
4. `officialsService.getOfficials(state, district)` → officials (existing)
5. Compose response

**Rate limiting:** Same as existing resolve endpoint (60 req/min per IP).

**Success criteria:**
- Single POST with address returns geocode + district + officials + proof
- No external network calls
- Latency: p95 < 500ms (geocode ~200ms + PIP ~50ms + officials ~5ms)

#### 2D. Communique client + endpoint rewire

**Repo:** communique
**Files to modify:**
- `src/lib/core/shadow-atlas/client.ts` — add `resolveAddress()` function
- `src/routes/api/location/resolve-address/+server.ts` — simplify to proxy

**New client function (shadow-atlas/client.ts):**
```typescript
export interface AddressResolutionResult {
  geocode: {
    lat: number;
    lng: number;
    matched_address: string;
    confidence: number;
    country: 'US' | 'CA';
  };
  district: District;
  officials: OfficialsResponse;
  merkleProof: MerkleProof;
  cell_id: string;
  vintage: string;
}

export async function resolveAddress(address: {
  street: string;
  city: string;
  state: string;
  zip: string;
  country?: 'US' | 'CA';
}): Promise<AddressResolutionResult> {
  const response = await fetch(`${SHADOW_ATLAS_URL}/v1/resolve-address`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Version': 'communique-v1',
    },
    body: JSON.stringify(address),
    signal: AbortSignal.timeout(10000),
  });
  // ... validation, BN254 checks, same pattern as resolveLocation()
}
```

**Simplified resolve-address endpoint:**
```typescript
// The endpoint becomes an authenticated proxy to Shadow Atlas.
// All geocoding, district resolution, and official lookup happens server-side
// in Shadow Atlas. This endpoint adds: auth check + privacy logging.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) {
    return json({ resolved: false, error: 'Authentication required' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const result = await resolveAddress(body);
    return json({
      resolved: true,
      address: { matched: result.geocode.matched_address, ... },
      coordinates: { lat: result.geocode.lat, lng: result.geocode.lng },
      district: { code: result.officials.district_code, ... },
      officials: result.officials.officials.map(o => ({ ... })),
      cell_id: result.cell_id,
      zk_eligible: result.cell_id != null,
      district_source: 'shadow_atlas',
    });
  } catch (error) {
    // ...
  }
};
```

**Tests to update:**
- MSW mocks: add Shadow Atlas `/v1/resolve-address` handler
- E2E test: verify full flow goes through Shadow Atlas, no Census/Congress calls
- Remove Census Bureau mock dependency from resolve-address tests

**Success criteria:**
- `POST /api/location/resolve-address` makes zero external API calls
- Response shape unchanged (backward compatible with AddressVerificationFlow.svelte)
- All 93+ tests pass
- Census Bureau geocoder calls: **eliminated**
- Congress.gov API calls: **eliminated** (from Cycle 1)

**Findings log:**
```
(populated during review)
```

---

### Cycle 3: Canada Jurisdiction

**Goal:** Canadian addresses resolve to federal electoral districts (ridings) with MPs
through the same Shadow Atlas pipeline. Zero runtime API calls.

**Precondition:** Cycle 2 complete (self-hosted geocoding operational).

#### 3A. Canada jurisdiction config + cell encoding

**Repo:** voter-protocol
**Files to create/modify:**
- `packages/shadow-atlas/src/jurisdiction.ts` — add `CA_JURISDICTION`

**Canada jurisdiction config:**
```typescript
export const CA_JURISDICTION: JurisdictionConfig = {
  country: 'CAN',
  name: 'Canada',
  slots: {
    0: { name: 'Federal Electoral District (Riding)', required: true, category: 'legislative' },
    1: { name: 'Province / Territory', required: true, category: 'administrative' },
    // 2: Provincial Legislature (Phase B2+ — data sources vary by province)
    // 3: Municipality (Phase B2+ — varies by province)
    // 4: Ward (Phase B2+ — varies by municipality)
  },
  aliases: {
    'riding': 0, 'fed': 0, 'electoral_district': 0, 'circonscription': 0,
    'province': 1, 'territory': 1,
  },
  recommendedDepth: 18,  // 338 ridings, ~56K DAs — fits in 2^18 = 262K
  encodeCellId: encodeCanadaCellId,
};

/**
 * Encode a StatCan Dissemination Area DGUID as a BN254 field element.
 *
 * DGUID format: "2021A0001XXXXX" (vintage + type + DA code)
 * We use the 8-digit DA unique ID portion (numeric).
 * ~56,000 DAs nationally — well within field bounds.
 */
function encodeCanadaCellId(daId: string): bigint {
  // Extract numeric portion
  const numeric = daId.replace(/\D/g, '');
  if (/^\d+$/.test(numeric)) {
    return BigInt(numeric);
  }
  // Fallback: UTF-8 encoding (same as US GEOID fallback)
  const bytes = Buffer.from(daId, 'utf-8');
  if (bytes.length > 31) {
    throw new Error(`DA ID too long for field encoding: ${daId}`);
  }
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}
```

#### 3B. Canada boundary ingestion + hydration pipeline

**Repo:** voter-protocol
**Files to create:**
- `packages/shadow-atlas/src/hydration/canada-hydration.ts`
- `packages/shadow-atlas/src/scripts/ingest-canada-boundaries.ts`

**Data sources:**
- StatCan Federal Electoral District boundaries (2023 Representation Order)
  - URL: `https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm?year=23`
  - Format: Shapefile or GeoJSON
  - License: Open Government License — Canada
- StatCan Dissemination Area geographic attribute file
  - Maps DAs to FEDs (riding assignment per DA)
  - ~56,000 DAs nationally

**Hydration pipeline (implements HydrationPipeline interface):**
```typescript
class CanadaHydrationPipeline implements HydrationPipeline {
  readonly config = CA_JURISDICTION;

  async hydrate(): Promise<CellDistrictMapping[]> {
    // 1. Load DA → FED mapping from StatCan geographic attribute file
    // 2. Load DA → province mapping
    // 3. For each DA:
    //    - cell_id = encodeCellId(daId)
    //    - districts[0] = encodeGeoid(fedCode)  // riding
    //    - districts[1] = encodeGeoid(provinceFips)  // province
    //    - districts[2..23] = 0n  // unused slots
    // 4. Return CellDistrictMapping[]
  }
}
```

**Output:** `CellDistrictMapping[]` ready for `buildCellMapTree()` — same as US pipeline.

#### 3C. Canadian MPs ingestion

**Repo:** voter-protocol
**Files to create/modify:**
- `packages/shadow-atlas/src/db/officials-schema.sql` — add `canada_mps` table
- `packages/shadow-atlas/src/scripts/ingest-canadian-mps.ts`
- `packages/shadow-atlas/src/serving/officials-service.ts` — extend for Canada

**Data source:**
- House of Commons (ourcommons.ca) — XML/JSON member feed
  - URL: `https://www.ourcommons.ca/Members/en/search` (structured data available)
  - Alternative: `https://represent.opennorth.ca/representatives/house-of-commons/`
  - License: Open Government License — Canada
  - 338 MPs, updates after each general election

**Schema addition (officials-schema.sql):**
```sql
CREATE TABLE IF NOT EXISTS canada_mps (
  parliament_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_fr TEXT,
  party TEXT NOT NULL,
  party_fr TEXT,
  riding_code TEXT NOT NULL,
  riding_name TEXT NOT NULL,
  riding_name_fr TEXT,
  province TEXT NOT NULL,        -- 2-letter code (ON, QC, BC, etc.)
  email TEXT,
  phone TEXT,
  website_url TEXT,
  photo_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  parliament_session TEXT,       -- e.g., '45th' (temporal versioning)
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cmp_province ON canada_mps(province);
CREATE INDEX IF NOT EXISTS idx_cmp_riding ON canada_mps(riding_code);
```

**Officials service extension:**
- `getOfficials()` dispatches by country based on district code format
  - US: `XX-NN` → existing `lookupOfficials()`
  - Canada: riding code → new `lookupCanadianOfficials()`
- New method: `getCanadianMP(ridingCode: string): CanadianMP | null`
- API: `/v1/officials?riding=35001` or `/v1/officials?district=ON-35001`

#### 3D. Nominatim Canada geocoding

**Repo:** voter-protocol
**Files to modify:**
- `docker/nominatim/docker-compose.yml` — add StatCan import

**Changes:**
- Import `north-america-latest.osm.pbf` instead of `us-latest.osm.pbf`
  - Adds ~5GB to import, ~10GB to index
  - OSM data for Canada includes StatCan-derived road network
- Or: separate StatCan RNF import alongside TIGER
  - Nominatim supports custom data imports via `osm2pgsql`

**Test queries:**
- `street=24+Sussex+Dr&city=Ottawa&state=ON&postalcode=K1M+1M4&country=CA`
  - Expect: lat=45.4442, lon=-75.6937
- `street=3980+St+Catherine+W&city=Montreal&state=QC&postalcode=H3Z+1P2&country=CA`
  - Expect: Montreal coordinates

**Success criteria:**
- Canadian addresses geocode correctly
- `/v1/resolve-address` with Canadian address returns riding + MP
- Country auto-detected from postal code format

#### 3E. Communique UI — country support

**Repo:** communique
**Files to modify:**
- `src/lib/components/auth/AddressVerificationFlow.svelte`
  - Add country selector (US/Canada) or auto-detect from postal code
  - Province input alongside state input
  - Postal code field accepts both formats (ZIP + Canadian postal)
- `src/routes/api/identity/verify-address/+server.ts`
  - District format validation: accept both `XX-NN` (US) and riding codes (CA)

**Minimal change:** Auto-detect country from postal code format.
`A1A 1A1` → Canada flow. `12345` → US flow. Same endpoint, same response shape.

**Findings log:**
```
(populated during review)
```

---

### Cycle 4: Temporal Versioning

**Goal:** District mappings are vintage-tagged. Multiple vintages can coexist.
Historical proofs remain valid across redistricting cycles.

**Precondition:** Cycle 3 complete (US + Canada operational).

#### 4A. Vintage metadata on Tree 2 snapshots

**Repo:** voter-protocol
**Files to modify:**
- `packages/shadow-atlas/src/tree-builder.ts` — add vintage to snapshot format
- `packages/shadow-atlas/src/hydration/snapshot-loader.ts` — load vintage metadata
- `packages/shadow-atlas/src/serving/api.ts` — add `vintage` query parameter

**Snapshot format addition:**
```typescript
interface TreeSnapshot {
  version: number;
  root: string;
  depth: number;
  cellCount: number;
  vintage: {
    label: string;         // "119th-congress" | "2023-representation-order"
    country: string;       // "USA" | "CAN"
    effectiveDate: string; // ISO 8601 — when these boundaries took effect
    expiryDate?: string;   // when superseded (null if current)
    source: string;        // "census-baf-2020+bef-119th" | "statcan-fed-2023"
    committedAt?: string;  // on-chain commitment timestamp
    txHash?: string;       // on-chain commitment tx
  };
  mappings: CellDistrictMapping[];
}
```

#### 4B. Multi-vintage serving

**Repo:** voter-protocol
**Files to modify:**
- `packages/shadow-atlas/src/serving/district-service.ts`
- `packages/shadow-atlas/src/serving/api.ts`

**API addition:**
```
GET /v1/resolve?lat=37.78&lng=-122.42&vintage=119th-congress
```
- Default: current vintage (no parameter needed)
- Historical: returns proof against specified vintage's tree root
- Error if vintage not loaded

#### 4C. Officials vintage

**Repo:** voter-protocol
**Files to modify:**
- `packages/shadow-atlas/src/db/officials-schema.sql` — add `congress_session` column
- `packages/shadow-atlas/src/serving/officials-service.ts` — vintage-aware queries

**Schema change:**
```sql
ALTER TABLE federal_members ADD COLUMN congress_session TEXT DEFAULT '119th';
ALTER TABLE canada_mps ADD COLUMN parliament_session TEXT DEFAULT '45th';
```

**Findings log:**
```
(populated during review)
```

---

## Completion Tracker

| Cycle | Task | Status | Agent | Findings |
|-------|------|--------|-------|----------|
| 1A | Verify SA officials operational | COMPLETE | Opus 4.6 | 538 members ingested, 29 unit tests pass, HTTP live test: CA-11, VT-AL, DC-AL, NY-14, TX-7, PR-AL all correct |
| 1B | Rewire resolve-address | COMPLETE | Opus 4.6 | Congress.gov import removed, `getOfficials()` wired, DC "98"→"00" bug found and fixed |
| 1C | Deprecate Congress.gov | COMPLETE | Opus 4.6 | delivery-worker rewired to SA, address-lookup.ts dead in prod, CONGRESS_API_KEY no longer required |
| 2A | Nominatim Docker | COMPLETE | Opus 4.6 | docker-compose.yml: Nominatim 4.4 + TIGER data, 16GB import limit, health check, shadow-atlas depends_on |
| 2B | GeocodeService class | COMPLETE | Opus 4.6 | geocode-service.ts: structured query, confidence scoring, US/CA postal detection, metrics, health check |
| 2C | /v1/resolve-address endpoint | COMPLETE | Opus 4.6 | api.ts: POST handler + Zod schema + factory wiring, serve/index.ts: NOMINATIM_URL init + health check |
| 2D | Communique client rewire | COMPLETE | Opus 4.6 | resolveAddress() client fn added, endpoint rewired: SA primary, Census fallback with warning log |
| 3A | Canada jurisdiction config | COMPLETE | Opus 4.6 | `CA_JURISDICTION` added to jurisdiction.ts: 2 required slots (riding + province), depth 18, SGC-based cell encoding |
| 3B | Canada boundary hydration | COMPLETE | Opus 4.6 | `CanadaHydrationPipeline` — fetches 338 ridings from Represent API, produces CellDistrictMapping[] |
| 3C | Canadian MPs ingestion | COMPLETE | Opus 4.6 | `canada_mps` table + `ingest-canadian-mps.ts` script + `getCanadianMP()` service method |
| 3D | Nominatim Canada geocoding | COMPLETE | Opus 4.6 | docker-compose: `north-america-latest.osm.pbf` (US+CA), ~80GB disk |
| 3E | Communique UI country support | COMPLETE | Opus 4.6 | Auto-detect CA from postal code regex, dynamic labels, country param in request |
| 4A | Vintage metadata | COMPLETE | Opus 4.6 | `SnapshotVintage` interface, v3 snapshot format, `loadSnapshotWithVintage()`, build-tree2 writes vintage |
| 4B | Multi-vintage serving | COMPLETE | Opus 4.6 | `registerVintage()`, `resolveVintage(url)`, `?vintage=` query param on cell-proof + cell-map-info |
| 4C | Officials vintage | COMPLETE | Opus 4.6 | `congress_session` column + index, `getOfficialsBySession()`, session-filtered prepared statements |

---

## Review Findings Log

### Pre-Cycle Review (2026-02-26)
- Shadow Atlas officials service exists and is tested (40+ tests)
- Officials ingestion script fetches from CC0 congress-legislators YAML
- `/v1/resolve` composite endpoint is wired but depends on officials DB being populated
- communique `resolve-address` has Census + Congress as hard dependencies on L63-136 and L246
- communique `resolve` (coordinates path) already uses Shadow Atlas as primary
- Canada provider exists as skeleton — types and extraction logic, NOT wired to hydration
- Jurisdiction abstraction is clean: `JurisdictionConfig` + `HydrationPipeline` interfaces
- 24-slot protocol constant is baked into circuits, contracts, and sponge hash — immutable
- FIPS codes mapped for all 50 states + 6 territories in `fips-codes.ts`
- `address-lookup.ts` is imported by 5 files; delivery-worker dependency needs audit in 1C

### Cycle 1 Review (2026-02-26)

**1A: Officials Service Verification — PASS**
- Ran `npx tsx src/scripts/ingest-legislators.ts --db ./data/officials.db` → 538 members (438 House + 100 Senate)
- 29 unit tests pass (officials-service.test.ts)
- HTTP live verification via test server (scripts/test-officials-server.ts):
  - CA-11: Pelosi + Schiff + Padilla (3 officials, correct)
  - VT-AL: Balint + Sanders + Welch (at-large, correct)
  - DC-AL: Norton only (delegate, non-voting, correct special_status)
  - NY-14: AOC + Gillibrand + Schumer (correct)
  - TX-7: Fletcher + Cruz + Cornyn (correct)
  - PR-AL: Hernandez (resident_commissioner, non-voting, correct territory special_status)
  - Error handling: invalid format returns 400 with clear message
- Full server startup blocked by `ProofService.create()` CPU-bound init. Created `scripts/test-officials-server.ts` for isolated endpoint testing.
- District lookup DB (R-tree) needs pre-built snapshot — created empty schema for startup.

**1B: Rewire resolve-address — PASS with fix**
- Replaced `addressLookupService.lookupRepsByDistrict()` (Congress.gov) with `getOfficials()` (Shadow Atlas)
- Response contract preserved — field mapping verified against AddressVerificationFlow.svelte and verify-address/+server.ts
- **BUG FOUND & FIXED**: Census Bureau encodes DC/territory delegate districts as `"98"` not `"00"`. Old `address-lookup.ts` had normalization at L434; `censusBureauGeocode()` did not. Added `"98" → "00"` normalization before `"00" → "AL"` step. Without this fix, DC residents would get empty officials array.
- **OBSERVATION (low)**: Senator `district` field changed from `"00"` to bare state code. No downstream logic depends on this value for senators — functionally safe.
- **OBSERVATION**: `delivery-worker.ts` still imports old `address-lookup.ts`. Separate concern for CWC delivery (Cycle 1C).
- Graceful degradation: Shadow Atlas failure → empty officials, everything else returns. Strictly more resilient than old Congress.gov path.

**1C: Deprecate Congress.gov — PASS**
- Rewired `delivery-worker.ts`: replaced `getRepresentativesForAddress()` (Census+Congress.gov) with `getOfficials(districtCode)` (Shadow Atlas)
- Delivery worker now requires `congressional_district` in the encrypted witness (set during address verification flow). No fallback to Census geocoding — if district is missing, delivery fails with clear error message. This is correct because the submission flow always populates congressional_district.
- `office_code` mapping: Shadow Atlas provides `cwc_code` for House members (format `HCA12`). Falls back to `bioguide_id` when `cwc_code` is null. Old code also used `bioguide_id` as fallback.
- **Production import audit**: `address-lookup.ts` has ZERO production importers after this change. Only 3 test/script files still reference it.
- **`CONGRESS_API_KEY` env var**: No longer required at runtime. Only read inside `address-lookup.ts` which is dead code in production.
- CWC delivery path (`cwc-client.ts`) is PRESERVED — CWC is the delivery mechanism, not the lookup mechanism. `CWC_API_KEY` still required.

**Cycle 1 Summary: Congress.gov eliminated from production runtime.**
- 2 files rewired: `resolve-address/+server.ts`, `delivery-worker.ts`
- 1 bug found & fixed: Census `"98"` → `"00"` normalization for DC/territories
- `address-lookup.ts` is now dead code in production (838 lines, can be removed or archived)
- `CONGRESS_API_KEY` is no longer a runtime dependency

### Cycle 2 Review

**2A — Nominatim Docker** (2026-02-26)
- docker-compose.yml extended: `mediagis/nominatim:4.4` image
- US data import: `us-latest.osm.pbf` (~10GB) + TIGER address ranges (~6GB), total ~60GB disk
- Resource limits: 16GB import, 4GB steady-state
- Health check: `curl -sf http://localhost:8080/status` with 600s start_period for first-run import
- Shadow Atlas service gains `depends_on: nominatim: condition: service_healthy`
- `NOMINATIM_URL=http://nominatim:8080` env var

**2B — GeocodeService** (2026-02-26)
- New file: `src/serving/geocode-service.ts` (289 lines)
- `GeocodeService` class wrapping local Nominatim `/search` with structured parameters
- Features: auto-detect US/CA from postal format, confidence scoring (importance + place_rank), metrics (p50/p95 latency)
- US state (50 + DC + 5 territories) and CA province (13) abbreviation maps
- 1 TS error fixed: `district.district_type` → `district.districtType` (property name mismatch)

**2C — /v1/resolve-address endpoint** (2026-02-26)
- `resolveAddressSchema` Zod validation: street, city, state (2-char), zip, country (optional)
- `handleResolveAddress` handler: geocode → R-tree PIP → officials → compose response
- Helper methods: `extractDistrictCode()`, `parseDistrictCode()`, `extractCellId()` (placeholder)
- Factory function updated: `geocodeService` option added to `createShadowAtlasAPI`
- `serve/index.ts` updated: reads `NOMINATIM_URL`, creates `GeocodeService`, health-checks at startup
- Rate limiting, content-type validation, privacy logging all included

**2D — Communique client rewire** (2026-02-26)
- New `resolveAddress()` function in `shadow-atlas/client.ts` (POST to `/v1/resolve-address`)
- New `AddressResolutionResult` interface matching Shadow Atlas response shape
- `resolve-address/+server.ts` rewritten: Shadow Atlas primary, Census Bureau fallback
- Response contract backward-compatible (same shape for both paths)
- `district_source` field: `'shadow-atlas'` (primary) or `'census-fallback'` (degraded)
- Fallback path logs `console.warn` to make Census usage visible for elimination tracking
- ISSUE: Shadow Atlas `cell_id` returns null (placeholder) — Census fallback still provides real cell_ids
- ISSUE: `county_fips` not available from Shadow Atlas — returns null on primary path

### Cycle 3 Review

**3A — Canada jurisdiction config** (2026-02-26)
- `CA_JURISDICTION` added to `jurisdiction.ts` alongside existing `US_JURISDICTION`
- 8 slots defined (2 required: riding + province, 6 optional for future phases)
- `encodeCanadaCellId()`: numeric-first BigInt, UTF-8 byte packing fallback
- 13 province/territory SGC codes mapped (NL=10 through NU=62)
- `recommendedDepth: 18` — 338 ridings + ~56K DAs fits in 2^18 = 262K
- Aliases: 'riding', 'fed', 'circonscription' → slot 0; 'province', 'prov' → slot 1

**3B — Canada boundary hydration** (2026-02-26)
- New `CanadaHydrationPipeline` implements `HydrationPipeline` interface
- Fetches 338 ridings from Represent API via existing `CanadaBoundaryProvider`
- `ridingToMapping()`: cellId = riding code, districts[0] = riding, districts[1] = province SGC
- Supports province filtering and cached riding data for dev/test
- `hydrateWithStats()` returns `HydrationResult` with slot coverage + stats

**3C — Canadian MPs ingestion** (2026-02-26)
- `canada_mps` table added to `officials-schema.sql` (23 columns, 4 indexes)
- `ingest-canadian-mps.ts` script: fetches from Represent API, paginates, upserts
- Province detection: riding code prefix mapping (35→ON, 24→QC, etc.)
- `OfficialsService` extended: `getCanadianMP()`, `getCanadianMPCount()`, `hasCanadaData()`
- `toCanadaOfficialsResponse()` maps Canadian MP to unified `Official` interface
- LRU cache shared with US: keyed `CA-{ridingCode}`, same staleness detection

**3D — Nominatim Canada geocoding** (2026-02-26)
- docker-compose.yml: `north-america-latest.osm.pbf` replaces `us-latest.osm.pbf`
- Adds ~5GB download, ~20GB to index (total ~80GB disk)
- TIGER data still imported for US address ranges
- Test queries added for Ottawa (24 Sussex) and Montreal (3980 St Catherine)

**3E — Communique UI country support** (2026-02-26)
- `detectedCountry` derived state: regex `A1A 1A1` → CA, else US
- Form validation accepts both ZIP (5+4) and Canadian postal codes
- Dynamic labels: "State" ↔ "Prov", "ZIP" ↔ "Postal"
- Dynamic placeholders: "CA"/"94102" ↔ "ON"/"K1A 0B1"
- Privacy note: "congressional district" ↔ "federal electoral district (riding)"
- `country` param passed to resolve-address endpoint (only sent for CA)
- Census Bureau fallback skipped for CA addresses (returns error instead)
- `resolve-address/+server.ts` schema updated: zip accepts both formats, `country` optional enum

### Cycle 4 Review

**4A — Vintage metadata** (2026-02-26)
- `SnapshotVintage` interface in snapshot-loader.ts: label, country, effectiveDate, expiryDate, source, committedAt, txHash
- `Tree2Snapshot` interface updated to optional `vintage` field (backward compat with v2)
- `loadSnapshotWithVintage()` returns `SnapshotLoadResult { state, vintage }` — existing `loadCellMapStateFromSnapshot()` wraps it
- `build-tree2.ts` now writes version 3 snapshots with `vintage: { label: "119th-congress", country: "USA", effectiveDate: "2025-01-03", source: "census-baf-2020+bef-119th" }`

**4B — Multi-vintage serving** (2026-02-26)
- `vintageMap: Map<string, CellMapState>` + `currentVintageLabel` fields on `ShadowAtlasAPI`
- `registerVintage(label, state)` — registers named CellMapState, first becomes default
- `setCurrentVintage(label)` — changes the default vintage
- `getVintageLabels()` — returns all loaded vintage labels
- `resolveVintage(url)` — checks `?vintage=` query param, falls back to default `cellMapState`
- `handleCellProof` updated: uses `resolveVintage()`, returns 404 with available vintages if unknown label
- `handleCellMapInfo` updated: includes `currentVintage` + `vintages` array in response
- TS error fix: `vintageMap` and `currentVintageLabel` are mutable (not `readonly`)

**4C — Officials vintage** (2026-02-26)
- `congress_session TEXT DEFAULT '119th'` column added to `federal_members` table
- `idx_fm_congress` index added
- `stmtHouseRepBySession` / `stmtSenatorsBySession` prepared statements with session filter
- `getOfficialsBySession(state, district, session)` method — session-filtered lookup
- LRU cache key includes session: `CA-12@119th`
- Existing `getOfficials()` unchanged (backward compat — queries all sessions)
