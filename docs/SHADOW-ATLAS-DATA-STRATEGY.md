# Shadow Atlas Data Acquisition Strategy

**Date:** 2025-11-08
**Status:** Implementation Plan
**Goal:** Build Shadow Atlas with finest granularity (city council) for most Americans, FREE

---

## Executive Summary

**Strategy:** Three-tier approach with city council districts for major metros (FREE), congressional/state legislature fallback (FREE), Cicero API for address validation (later).

**Coverage Target:**
- **Tier 1:** Top 50 cities = 50M Americans (city council, FREE)
- **Tier 2:** All other addresses = 280M Americans (congressional + state legislature, FREE Census API)
- **Tier 3:** Cicero validation fence = Identify which addresses have city council coverage (on-demand)

**Total Cost:** $0 upfront, Cicero validation costs deferred until Phase 2

---

## Why City Council is the Right Granularity

Congressional districts are **trivial** (435 districts, ~750k people each). City council districts provide:
- **Finest legislative granularity** (19,502+ municipalities)
- **Local representation** where civic impact happens (zoning, transit, policing)
- **Precise targeting** for constituent-representative matching
- **Authenticity** (small districts = real local knowledge)

**Example:** San Francisco has 11 city council districts (avg ~80k people) vs 8 congressional districts (avg ~945k). City council is 11x finer granularity.

---

## The Free Data Reality

### What's FREE and Comprehensive:

**1. Census Bureau Geocoder API** (100% US coverage, ZERO cost)
- Congressional districts (435) ✅
- State senate districts (~2,000) ✅
- State house districts (~5,000) ✅
- City council districts ❌

**2. Municipal Open Data Portals** (spotty coverage, ZERO cost)
- Top 50 cities: ~90% have free GIS downloads ✅
- Mid-size cities: ~40% have open data ✅
- Small cities: <10% have open data ❌

**3. Cicero API Coverage Endpoint** (FREE to query, 0 credits)
- Returns list of cities with city council coverage ✅
- Endpoint: `GET https://app.cicerodata.com/v3.1/coverage`
- Use case: Validation fence (is this address in a covered city?)

### What's EXPENSIVE:

**Cicero API Lookups** ($0.03 per address)
- 140M addresses × $0.03 = $4.2M (prohibitive)
- Used ONLY for validation, not bulk data acquisition

---

## Three-Tier Data Strategy

### Tier 1: City Council Districts (FREE, Top 50 Cities)

**Data Sources:** Municipal open data portals (GIS shapefiles, FREE downloads)

**Confirmed FREE Coverage (10 cities verified):**
1. **New York** - NYC Open Data (nyc.gov/planning)
2. **Los Angeles** - LA GeoHub (geohub.lacity.org)
3. **Chicago** - Chicago Data Portal (data.cityofchicago.org)
4. **Houston** - COH GIS Hub (cohgis-mycity.opendata.arcgis.com)
5. **Philadelphia** - PASDA/OpenDataPhilly (opendataphilly.org)
6. **San Francisco** - DataSF (datasf.org)
7. **Seattle** - Seattle Open Data (data.seattle.gov)
8. **Denver** - Denver Open Data (denvergov.org)
9. **Portland** - Portland Open Data (portland.gov/open-data)
10. **San Jose** - San Jose Open Data (data.sanjoseca.gov)

**Next 40 Cities to Verify:**
- Phoenix, San Antonio, San Diego, Dallas, Austin (TX)
- Jacksonville, Fort Worth, Columbus, Charlotte, Indianapolis
- Boston, Nashville, El Paso, Detroit, Oklahoma City
- Las Vegas, Memphis, Louisville, Baltimore, Milwaukee
- Albuquerque, Tucson, Fresno, Mesa, Sacramento
- Atlanta, Kansas City, Colorado Springs, Raleigh, Miami
- Long Beach, Virginia Beach, Oakland, Minneapolis, Tulsa
- Tampa, Arlington, New Orleans, Wichita, Cleveland

**Collection Method:**
1. Query each city's open data portal (ArcGIS Hub, Socrata, CKAN)
2. Download council district shapefiles (GeoJSON preferred, SHP acceptable)
3. Convert to standardized GeoJSON format
4. Validate topology (no gaps/overlaps)
5. Store in `/packages/crypto/data/city-council-districts/{city}.geojson`

**Estimated Coverage:** 50M Americans (15% population, 90% major metro density)

---

### Tier 2: Congressional + State Legislature (FREE, 100% US)

**Data Source:** Census Bureau Geocoder API (FREE, unlimited)

**API Endpoint:**
```
GET https://geocoding.geo.census.gov/geocoder/geographies/address
  ?street={street}
  &city={city}
  &state={state}
  &benchmark=Public_AR_Current
  &vintage=Current_Current
  &format=json
```

**Returns:**
- Congressional district (119th Congress, 435 districts)
- State senate district (upper chamber, ~2,000 districts)
- State house district (lower chamber, ~5,000 districts)
- County, census tract, block

**Use Case:** Fallback for addresses NOT in Tier 1 cities

**Coverage:** 280M Americans (85% population, all non-Tier-1 addresses)

---

### Tier 3: Cicero Validation Fence (On-Demand, Deferred Cost)

**Purpose:** Determine which addresses have city council coverage BEFORE charging users

**Method:**
1. User submits address for verification
2. Check Tier 1 cache (do we already have city council GIS for this city?)
3. If not in cache, query Cicero coverage endpoint (FREE, 0 credits):
   ```
   GET https://app.cicerodata.com/v3.1/coverage
   ```
4. Parse response to see if user's city has local council data
5. If YES: Offer city council district verification (charge for Cicero lookup ONLY when user proceeds)
6. If NO: Use Tier 2 congressional/state legislature (FREE Census API)

**Cost Model:**
- Coverage check: $0 (FREE endpoint)
- Address lookup: $0.03 per user (ONLY if city council available AND user proceeds)
- Expected usage: ~15% of users (those in cities with council data but NOT in Tier 1 cache)

**Example Fence Logic:**
```typescript
async function getFinestGranularity(address: Address): Promise<District> {
  // Check Tier 1: Do we have city council GIS for this city?
  const cityCouncilGIS = await loadCityCouncilBoundaries(address.city);
  if (cityCouncilGIS) {
    return resolveDistrictFromGIS(address, cityCouncilGIS); // FREE
  }

  // Check Tier 3: Does Cicero have city council for this city?
  const ciceroCoverage = await checkCiceroCoverage(address.city); // FREE
  if (ciceroCoverage.hasLocalCouncil) {
    // Offer user city council option (will cost $0.03 if they proceed)
    return offerCiceroLookup(address); // PAID ($0.03)
  }

  // Fallback Tier 2: Use Census API for congressional + state legislature
  return resolveCensusDistricts(address); // FREE
}
```

**Expected Cost:** ~21M addresses (15% of 140M) × $0.03 = $630k (deferred to Phase 2, charged on-demand)

---

## Implementation Plan

### Phase 1: Build Tier 1 Cache (Weeks 1-6)

**Week 1-2: Data Collection Script**
- Automate GIS downloads from municipal open data portals
- Support ArcGIS Hub, Socrata, CKAN APIs
- Handle format conversions (SHP → GeoJSON)
- Validate topology (detect gaps/overlaps)

**Week 3-4: Top 10 Cities**
- Manually verify NYC, LA, Chicago, Houston, Philadelphia, SF, Seattle, Denver, Portland, San Jose
- Download, convert, validate, commit to repo
- Test geocoding pipeline (Geocodio coords → turf.js point-in-polygon)

**Week 5-6: Next 40 Cities**
- Run automated collection script
- Manual fallback for cities without standard APIs
- Achieve 50M population coverage

**Deliverable:** 50 city council district GeoJSON files in `/packages/crypto/data/city-council-districts/`

---

### Phase 2: Integrate Census API (Week 7)

**Implementation:**
1. Create `CensusGeocoder` service (`/packages/crypto/services/census-geocoder.ts`)
2. Endpoint wrapper for Census Bureau API
3. Parse congressional + state legislature districts
4. Cache results in IndexedDB (client-side)

**Deliverable:** FREE congressional/state legislature fallback for 100% US coverage

---

### Phase 3: Cicero Validation Fence (Week 8-10)

**Implementation:**
1. Query Cicero coverage endpoint (FREE)
2. Parse city-level coverage map (which cities have local council data)
3. Store coverage map in `/packages/crypto/data/cicero-coverage.json`
4. Implement fence logic (check Tier 1 → check Tier 3 → fallback Tier 2)
5. User flow: "City council available for your address. Verify now? ($0.03)"

**Deliverable:** On-demand Cicero lookups with cost transparency

---

## Shadow Atlas Structure

### Single-Tier Merkle Trees Per District

**City Council Districts (Tier 1):**
- NYC District 1: 12 levels, 4,096 addresses
- NYC District 2: 12 levels, 4,096 addresses
- ... (all city council districts for Tier 1 cities)

**Congressional Districts (Tier 2):**
- CA-12: 12 levels, 4,096 addresses
- TX-07: 12 levels, 4,096 addresses
- ... (all 435 congressional districts)

**State Legislature Districts (Tier 2):**
- CA State Senate 11: 12 levels, 4,096 addresses
- TX State House 134: 12 levels, 4,096 addresses
- ... (all ~7,000 state districts)

**Total Trees:**
- Tier 1: ~1,500 city council districts (50 cities × 30 avg)
- Tier 2: ~7,500 congressional + state legislature
- **Total:** ~9,000 Merkle trees

**IPFS Distribution:**
- Each tree: ~150KB compressed
- Total: ~1.35GB compressed
- Progressive loading: User downloads only their district(s)

---

## Address → District Resolution Pipeline

### Step 1: Geocode Address (FREE or $0.0005)

**Option A: Census Bureau (FREE, no coordinates returned)**
- Direct district lookup without lat/lon
- Use for Tier 2 congressional/state legislature

**Option B: Geocodio ($0.0005 per lookup)**
- Returns lat/lon coordinates
- Use for Tier 1 city council (point-in-polygon against GeoJSON)

**Decision:** Use Geocodio for Tier 1 (need coords for GIS), Census for Tier 2 (direct district IDs)

---

### Step 2: District Resolution

**Tier 1 (City Council):**
```typescript
import * as turf from '@turf/turf';

// Geocode with Geocodio
const coords = await geocodio.geocode(address); // $0.0005

// Load city council GeoJSON (cached in IndexedDB)
const boundaries = await loadCityCouncilBoundaries(address.city);

// Point-in-polygon check (client-side, < 10ms)
for (const district of boundaries.features) {
  if (turf.booleanPointInPolygon(coords, district)) {
    return {
      type: 'city_council',
      city: address.city,
      district: district.properties.district,
      granularity: 'finest'
    };
  }
}
```

**Tier 2 (Congressional/State Legislature):**
```typescript
// Census Bureau API (FREE, unlimited)
const response = await fetch(
  `https://geocoding.geo.census.gov/geocoder/geographies/address?` +
  `street=${address.street}&city=${address.city}&state=${address.state}` +
  `&benchmark=Public_AR_Current&vintage=Current_Current&format=json`
);

const data = await response.json();
return {
  type: 'congressional',
  congressional: data.result.geographies['119th Congressional Districts'][0].GEOID,
  stateSenate: data.result.geographies['State Legislative Districts - Upper'][0].GEOID,
  stateHouse: data.result.geographies['State Legislative Districts - Lower'][0].GEOID,
  granularity: 'fallback'
};
```

**Tier 3 (Cicero On-Demand):**
```typescript
// Check coverage first (FREE)
const coverage = await cicero.getCoverage(); // 0 credits
const hasLocalCouncil = coverage.cities[address.city]?.chambers.includes('LOCAL_COUNCIL');

if (hasLocalCouncil) {
  // Offer user option to use Cicero ($0.03)
  const userConsent = await promptUser(
    `City council verification available for ${address.city}. ` +
    `This costs $0.03. Use congressional district instead (FREE)?`
  );

  if (userConsent) {
    const result = await cicero.lookupDistricts(address); // $0.03
    return {
      type: 'city_council',
      city: address.city,
      district: result.districts.find(d => d.district_type === 'LOCAL_COUNCIL').district_id,
      granularity: 'finest',
      cost: 0.03
    };
  }
}

// User declined or no coverage, use Tier 2
return resolveCensusDistricts(address); // FREE
```

---

## Cost Summary

| Tier | Coverage | Data Source | Cost per Address | Total Cost (140M) |
|------|----------|-------------|------------------|-------------------|
| **Tier 1** | 50M (city council) | Municipal GIS (FREE) | Geocodio: $0.0005 | $25,000 |
| **Tier 2** | 280M (congress/state) | Census API (FREE) | $0 | $0 |
| **Tier 3** | 21M (Cicero fence) | Cicero (on-demand) | $0.03 | $630,000 (deferred) |
| **TOTAL** | 330M addresses | Mixed | Avg: $0.076 | $655,000 |

**Comparison to Cicero-only:** $4.2M - $655k = **$3.545M saved (84% reduction)**

**Phase 1 Launch Cost:** $25k (Tier 1 + Tier 2 only, Tier 3 deferred)

---

## Validation & Quality Control

### GIS Data Validation (Tier 1)

**Topology Checks:**
- No gaps between districts (full coverage)
- No overlaps (each address in exactly one district)
- Boundaries close properly (first point = last point)

**Attribution Checks:**
- District IDs present and unique
- District names standardized
- Metadata includes: city, state, election year, source

**Script:** `/scripts/validate-city-council-gis.ts`

---

### Census API Validation (Tier 2)

**Accuracy Checks:**
- Congressional district matches TIGER/Line boundaries
- State legislature districts current (2024 redistricting)
- Handles edge cases (unincorporated areas, territories)

**Script:** `/scripts/validate-census-districts.ts`

---

### Cicero Coverage Validation (Tier 3)

**Coverage Map Accuracy:**
- Cicero coverage endpoint returns current data
- Cache invalidation (check coverage monthly)
- Handle cities added/removed from Cicero

**Script:** `/scripts/update-cicero-coverage.ts` (runs monthly via GitHub Actions)

---

## Data Update Strategy

### City Council Districts (Annual Updates)

**Trigger:** Redistricting after census (every 10 years) + special elections

**Process:**
1. Monitor municipal open data portals for boundary updates
2. Download new GeoJSON files
3. Validate topology
4. Commit to repo with version tag (e.g., `nyc-2025-redistricting`)
5. Deploy updated IPFS Shadow Atlas

**Frequency:** Annual check, updates as needed

---

### Congressional/State Legislature (Every 2 Years)

**Trigger:** Elections (2026, 2028, 2030...) + census redistricting (2030)

**Process:**
1. Census Bureau updates TIGER/Line files
2. Census Geocoder API auto-updates
3. No action required (API always returns current districts)

**Frequency:** Automatic via Census Bureau

---

### Cicero Coverage (Monthly)

**Trigger:** Cicero adds/removes cities

**Process:**
1. GitHub Actions runs `/scripts/update-cicero-coverage.ts` monthly
2. Query Cicero coverage endpoint (FREE)
3. Compare to cached coverage map
4. Update `/packages/crypto/data/cicero-coverage.json` if changes detected
5. Commit and deploy

**Frequency:** Monthly automated check

---

## File Structure

```
/packages/crypto/data/
├── city-council-districts/
│   ├── new-york.geojson           # NYC city council (51 districts)
│   ├── los-angeles.geojson        # LA city council (15 districts)
│   ├── chicago.geojson            # Chicago wards (50 wards)
│   ├── houston.geojson            # Houston city council (16 districts)
│   └── ... (46 more cities)
├── cicero-coverage.json           # City-level coverage map (FREE endpoint)
└── README.md                      # Data sources, licenses, update history

/scripts/
├── collect-city-council-gis.ts    # Automated GIS downloads
├── validate-city-council-gis.ts   # Topology + attribution checks
├── validate-census-districts.ts   # Census API accuracy tests
├── update-cicero-coverage.ts      # Monthly coverage refresh
└── generate-shadow-atlas.ts       # Build Merkle trees from GIS + addresses

/packages/crypto/services/
├── census-geocoder.ts             # Census Bureau API wrapper
├── geocodio-client.ts             # Geocodio API wrapper
├── cicero-client.ts               # Cicero API wrapper
└── district-resolver.ts           # Tier 1 → Tier 2 → Tier 3 logic
```

---

## Next Steps

### Week 1: Data Collection Automation
- Build `/scripts/collect-city-council-gis.ts`
- Support ArcGIS Hub, Socrata CKAN APIs
- Test with top 10 cities

### Week 2: Census Integration
- Implement `CensusGeocoder` service
- Test congressional + state legislature lookups
- Validate against TIGER/Line shapefiles

### Week 3: Cicero Coverage Fence
- Query Cicero coverage endpoint (FREE)
- Build coverage validation logic
- Design user consent flow for $0.03 lookups

### Week 4-6: Scale to 50 Cities
- Collect GIS for top 50 cities
- Validate topology for all datasets
- Commit to repo, deploy to IPFS

**Deliverable:** FREE city council coverage for 50M Americans, FREE congressional/state legislature fallback for 100% US, Cicero validation fence for on-demand finest granularity.

---

**Implementation:** Claude Code
**Date:** 2025-11-08
**Status:** Ready for execution
