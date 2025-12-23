# Shadow Atlas TODO Resolution Tracker

## Overview

This document tracks remaining TODOs across the shadow-atlas package with solution paths for systematic resolution. Created 2025-12-22.

---

## Wave 1: High Priority (Parallel Execution)

### 1.1 Wire Up Real Poseidon2 in integrity-checker.ts

**File**: `src/security/integrity-checker.ts:107`
**Current State**: Uses SHA256 placeholder for Merkle proof verification
**Solution Path**:
1. Import `hashPair` from `@voter-protocol/crypto/poseidon2`
2. Replace `poseidonHash()` function (lines 114-126) with async call to crypto package
3. Make `verifyMerkleProof()` async since Poseidon2 hasher is async
4. Update all callers to handle async verification
5. Add tests verifying compatibility with merkle-tree.ts output

**Dependencies**: `@voter-protocol/crypto/poseidon2` (already exported)

### 1.2 Expand Global Merkle Tree for 190+ Countries

**File**: `src/integration/global-merkle-tree.ts:777`
**Current State**: Hardcoded limited country list
**Solution Path**:
1. Create comprehensive country registry with ISO 3166-1 codes
2. Map countries to regions (Americas, Europe, Asia-Pacific, Africa, Middle East)
3. Implement lazy loading for country-specific data
4. Add region-level Merkle subtrees for efficient verification
5. Update `buildGlobalTree()` to iterate all countries

**Reference**: `src/providers/international/` has UK, Canada, Australia providers as templates

### 1.3 Implement Recursive Service Exploration in Scanners

**File**: `src/scanners/state-gis-clearinghouse.ts:434`
**Current State**: TODO comment, no implementation
**Solution Path**:
1. Parse ArcGIS REST `/services` endpoint recursively
2. Handle folder structures (services can be nested in folders)
3. Detect MapServer vs FeatureServer types
4. Extract layer metadata from each service
5. Filter for governance-relevant layers (council, district, ward, precinct)
6. Implement depth limiting to prevent infinite recursion
7. Add rate limiting for API calls

**Pattern**: Similar to `gis-server-discovery.ts` service enumeration

---

## Wave 2: Medium Priority (Sequential)

### 2.1 Parse Services for Council District Layers

**File**: `src/scanners/authoritative-multi-path.ts:274`
**Current State**: TODO to find council district layer in services
**Solution Path**:
1. Query MapServer `/layers` endpoint
2. Parse layer names for governance keywords
3. Score layers by relevance (exact match > partial match)
4. Validate layer has polygon geometry type
5. Return best matching layer with confidence score

### 2.2 Load Expected GEOIDs from Authoritative Source

**File**: `src/services/tiger-extraction-service.ts:560`
**Current State**: TODO for completeness check
**Solution Path**:
1. Create GEOID registry from Census TIGER documentation
2. Map state FIPS to expected county/place GEOIDs
3. Implement validation against extracted data
4. Report missing/unexpected GEOIDs

### 2.3 Implement Census Crosswalk Lookup

**File**: `src/services/county-geometry.ts:216`
**Current State**: TODO for actual Census lookup
**Solution Path**:
1. Use Census Geocoder API or TIGER crosswalk files
2. Map place FIPS to containing county FIPS
3. Handle multi-county places (NYC, etc.)
4. Cache results for performance

---

## Wave 3: Infrastructure & Data Expansion (In Progress)

### 3.A Audit Logger Completion (3 TODOs)
- `audit-logger.ts:417` - Cleanup old log files
- `audit-logger.ts:609` - Implement log querying
- `audit-logger.ts:626` - Implement hash chain verification

### 3.B Performance/Caching (3 TODOs)
- `preload-strategy.ts:335` - DB query for district IDs
- `regional-cache.ts:150` - IPFS content-addressed cache
- `tiger-extraction-service.ts:640` - Cache clearing

### 3.C Transformation Pipeline (3 TODOs)
- `pipeline.ts:180` - Track rejection reasons
- `pipeline.ts:182` - IPFS publication
- `state-batch-to-merkle.ts:423` - Update detection

### 3.D Global Tree Enhancement (3 TODOs)
- `global-merkle-tree.ts:435` - Human-readable region names
- `global-merkle-tree.ts:863` - Store full district in tree
- `validator.ts:462` - FIPS lookup service

### 3.E Data Expansion (2 TODOs) - COMPLETED 2025-12-22
- ✅ `crawl-state-governance-districts.ts:145` - Add remaining 45 states (ALL 50 STATES + DC COMPLETE)
- ✅ `international-providers.ts:77` - Implement NZ provider (PHASE 1 ANGLOSPHERE COMPLETE)

---

## Completion Criteria

- [x] All Wave 1 TODOs resolved (2025-12-22)
- [x] All Wave 2 TODOs resolved (2025-12-22)
- [x] All Wave 3.E Data Expansion TODOs resolved (2025-12-22)
- [x] TypeScript compilation passes
- [x] Core tests pass (pre-existing geometry validation issues remain)
- [x] New tests added for changed functionality

## Resolution Summary (2025-12-22)

### Wave 1 - Completed
- **1.1 Poseidon2 Integration**: Replaced SHA256 placeholder with real Poseidon2 from crypto package
- **1.2 Global Merkle Tree**: Added 195-country ISO 3166-1 registry with regional proofs
- **1.3 Recursive Scanner**: Implemented ArcGIS REST service exploration with governance layer detection

### Wave 2 - Completed
- **2.1 Layer Detection**: Added `findGovernanceLayers()` with keyword scoring (100-20 points)
- **2.2 GEOID Validation**: Created expected-geoids registry with completeness checking
- **2.3 Census Crosswalk**: Added 54-city place-to-county crosswalk with bidirectional lookups

### Test Results
- **Passing**: 174+ tests across all new functionality (24 new NZ provider tests)
- **Pre-existing issues**: 5 geometry validation tests (winding order, snapshot verification)

### Wave 3.E - Data Expansion Completed (2025-12-22)

**US State Coverage Expansion:**
- **Before**: 5 states (CA, TX, FL, NY, PA)
- **After**: ALL 50 states + District of Columbia (51 total)
- **Portal Distribution**:
  - ArcGIS Hub/REST: 35 states
  - Socrata: 3 states (IL, OK, TX)
  - CKAN: 1 state (PA)
  - Custom platforms: 12 states
- **Validation**: TypeScript compilation passes, portal URLs verified from official state GIS sources
- **Testing**: Wisconsin test execution successful (infrastructure validated)

**International Provider - New Zealand:**
- **Implementation**: NewZealandBoundaryProvider following established UK/CA/AU pattern
- **Coverage**: 72 electorates (65 general + 7 Māori)
- **Data Source**: Stats NZ (Statistics New Zealand) via ArcGIS REST API
- **Endpoints**:
  - General Electorates: datafinder.stats.govt.nz layer 122741
  - Māori Electorates: datafinder.stats.govt.nz layer 122742
- **Vintage**: 2025 boundary review (finalized August 2025)
- **Authority**: National-statistics (Stats NZ)
- **License**: CC-BY-4.0
- **Testing**: 24 unit tests (100% pass rate)
  - Provider configuration validation
  - Expected counts verification
  - Type safety enforcement
  - Region inference (North/South Island, Chatham Islands)
  - Population parsing
  - Validation logic
- **Registry Integration**: Added to INTERNATIONAL_PROVIDERS map
- **Export Integration**: Added to international providers index.ts

**Phase 1 Anglosphere Status: COMPLETE**
- ✅ United Kingdom (650 parliamentary constituencies)
- ✅ Canada (338 federal electoral districts)
- ✅ Australia (151 federal electoral divisions)
- ✅ New Zealand (72 electorates)

**Sources:**
- Wisconsin Legislature GIS Hub: https://gis-ltsb.hub.arcgis.com/
- Stats NZ Boundary Review: https://www.stats.govt.nz/news/final-electorate-names-and-boundaries-released/
- Stats NZ Geographic Data Service: https://datafinder.stats.govt.nz/group/census/data/category/electorates/
- Elections NZ Maps: https://elections.nz/democracy-in-nz/historical-events/boundary-review-2025/electorate-maps/

## Notes

- Poseidon2 hasher is async (uses Noir WASM) - affects integrity-checker signature
- Global Merkle tree expansion should maintain backward compatibility
- Scanner improvements should not break existing discovery workflows
