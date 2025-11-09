# Shadow Atlas Technical Specification

**Version:** 1.0.0
**Date:** 2025-11-08
**Status:** Draft - Awaiting Implementation
**Standards Compliance:** IEEE 1471-2000 (Architecture Description), RFC 8949 (CBOR), GeoJSON RFC 7946

---

## 1. Executive Summary

### 1.1 Purpose

This specification defines the Shadow Atlas data structure, acquisition protocols, and interface contracts for address-to-district resolution in the VOTER Protocol zero-knowledge proof system.

### 1.2 Scope

**IN SCOPE:**
- Shadow Atlas Merkle tree data structure (Section 3)
- Data acquisition protocols for US legislative districts (Section 4)
- Geocoding service interfaces (Section 5)
- District resolution algorithms (Section 6)
- Data validation and quality assurance (Section 7)

**OUT OF SCOPE:**
- Zero-knowledge proof circuit implementation (see ZK-PROOF-SPEC-REVISED.md)
- Smart contract verification logic (see ZK-PROOF-SPEC-REVISED.md)
- Congressional message delivery (see TECHNICAL.md)

### 1.3 References

**Standards:**
- **[IEEE1471]** IEEE Standard 1471-2000: Recommended Practice for Architectural Description
- **[RFC7946]** GeoJSON Format (https://datatracker.ietf.org/doc/html/rfc7946)
- **[RFC8949]** Concise Binary Object Representation (CBOR)
- **[ISO3166]** ISO 3166-1 alpha-2 country codes

**Data Sources:**
- **[CENSUS-API]** US Census Bureau Geocoding Services API (https://geocoding.geo.census.gov/geocoder/)
- **[TIGER]** TIGER/Line Shapefiles (https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html)
- **[CICERO]** Cicero API Documentation (https://cicero.azavea.com/docs/)
- **[OSM]** OpenStreetMap Nominatim API (https://nominatim.org/)

**Project Documents:**
- **[ZK-SPEC]** ZK-PROOF-SPEC-REVISED.md - Zero-knowledge proof implementation
- **[GEO-ARCH]** GEOCODING-ARCHITECTURE.md - Provider-agnostic geocoding design
- **[DATA-STRAT]** SHADOW-ATLAS-DATA-STRATEGY.md - Data acquisition strategy

---

## 2. System Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Client Application (Browser)                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐      ┌───────────────────────────┐  │
│  │ District         │──────│ Geocoding Service         │  │
│  │ Resolver         │      │ (Provider Router)         │  │
│  └──────────────────┘      └───────────────────────────┘  │
│         │                            │                      │
│         │                            ▼                      │
│         │                   ┌─────────────────┐            │
│         │                   │ Geocodio        │            │
│         │                   │ (US/CA)         │            │
│         │                   └─────────────────┘            │
│         │                            │                      │
│         │                            ▼                      │
│         │                   ┌─────────────────┐            │
│         │                   │ Nominatim       │            │
│         │                   │ (Global)        │            │
│         │                   └─────────────────┘            │
│         ▼                                                   │
│  ┌──────────────────────────────────────────────────┐     │
│  │ Shadow Atlas Merkle Tree                          │     │
│  │ (IndexedDB/IPFS)                                 │     │
│  └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Data Sources                                                 │
├─────────────────────────────────────────────────────────────┤
│  • Census Bureau API (Congressional + State Legislature)    │
│  • Municipal GIS Portals (City Council Districts)           │
│  • Cicero API (Validation Fence)                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
Address Input
    │
    ▼
Geocoding Service (lat/lon)
    │
    ▼
District Resolver (country-specific strategy)
    │
    ├─→ Tier 1: City Council GIS (point-in-polygon)
    ├─→ Tier 2: Census API (direct lookup)
    └─→ Tier 3: Cicero Fence (on-demand)
    │
    ▼
District ID
    │
    ▼
Shadow Atlas Merkle Proof
    │
    ▼
ZK Proof Generation (see [ZK-SPEC])
```

---

## 3. Shadow Atlas Data Structure

### 3.1 Merkle Tree Specification

**Structure:** Single-tier balanced binary Merkle tree per legislative district

**Parameters:**
- **Depth:** 12 levels (fixed)
- **Capacity:** 2^12 = 4,096 addresses per tree
- **Hash Function:** Poseidon hash (SNARK-friendly, BN254 field)
- **Leaf Node:** `Poseidon(address_string)`
- **Internal Node:** `Poseidon(left_child_hash || right_child_hash)`

**Rationale:**
- 4,096 capacity exceeds max district population density
- 12 levels = 12 Poseidon hashes per proof (150 gates, see [ZK-SPEC])
- Balanced tree ensures O(log n) proof size

### 3.2 Tree Construction Algorithm

```
ALGORITHM: ConstructMerkleTree
INPUT: addresses[] (sorted lexicographically)
OUTPUT: root_hash, tree_structure

1. IF len(addresses) > 4096 THEN
     ERROR "District capacity exceeded"

2. leaves := []
   FOR EACH address IN addresses DO
     leaf_hash := Poseidon(address)
     leaves.APPEND(leaf_hash)
   END FOR

3. WHILE len(leaves) < 4096 DO
     leaves.APPEND(Poseidon("PADDING"))  # Deterministic padding
   END WHILE

4. current_layer := leaves
   tree_structure := [current_layer]

5. FOR level := 0 TO 11 DO  # 12 levels total
     next_layer := []
     FOR i := 0 TO len(current_layer)-1 STEP 2 DO
       left := current_layer[i]
       right := current_layer[i+1]
       parent := Poseidon(left || right)
       next_layer.APPEND(parent)
     END FOR
     current_layer := next_layer
     tree_structure.APPEND(current_layer)
   END FOR

6. root_hash := current_layer[0]
7. RETURN root_hash, tree_structure
```

### 3.3 Proof Generation Algorithm

```
ALGORITHM: GenerateMerkleProof
INPUT: address, tree_structure
OUTPUT: proof_siblings[], proof_indices[]

1. leaf_hash := Poseidon(address)
2. leaf_index := FIND_INDEX(tree_structure[0], leaf_hash)

3. IF leaf_index == -1 THEN
     ERROR "Address not in tree"

4. proof_siblings := []
   proof_indices := []
   current_index := leaf_index

5. FOR level := 0 TO 11 DO
     IF current_index % 2 == 0 THEN  # Left child
       sibling_index := current_index + 1
       proof_indices.APPEND(0)
     ELSE  # Right child
       sibling_index := current_index - 1
       proof_indices.APPEND(1)
     END IF

     sibling_hash := tree_structure[level][sibling_index]
     proof_siblings.APPEND(sibling_hash)
     current_index := current_index / 2
   END FOR

6. RETURN proof_siblings, proof_indices
```

### 3.4 On-Chain Storage

**Smart Contract State:**
```solidity
// Shadow Atlas root registry
mapping(bytes32 => bool) public shadowAtlasRoots;  // district_hash => valid
bytes32 public currentEpoch;  // Current Shadow Atlas version
```

**Root Update Protocol:**
```solidity
function updateShadowAtlasRoot(
    bytes32 districtHash,
    bytes32 newRoot,
    bytes calldata governanceProof
) external onlyGovernance {
    require(verifyGovernanceProof(governanceProof), "Invalid governance proof");
    shadowAtlasRoots[districtHash] = newRoot;
    emit ShadowAtlasUpdated(districtHash, newRoot, block.timestamp);
}
```

---

## 4. Data Acquisition Protocol

### 4.1 Three-Tier Strategy

**Tier 1: City Council Districts (Municipal GIS)**
- **Source:** Municipal open data portals
- **Format:** GeoJSON ([RFC7946])
- **Coverage:** Top 50 US cities (50M population)
- **Cost:** $0 (FREE downloads)
- **Update Frequency:** Annual (post-redistricting)

**Tier 2: Congressional + State Legislature (Census API)**
- **Source:** US Census Bureau Geocoding API ([CENSUS-API])
- **Format:** JSON
- **Coverage:** 100% US addresses
- **Cost:** $0 (FREE unlimited)
- **Update Frequency:** Automatic (API maintained by Census Bureau)

**Tier 3: Cicero Validation Fence**
- **Source:** Cicero API ([CICERO])
- **Format:** JSON
- **Coverage:** 100+ US cities (on-demand)
- **Cost:** $0.03 per lookup (deferred, user-consent required)
- **Update Frequency:** Monthly (coverage endpoint check)

### 4.2 Data Source Interface Contract

**Interface:** `DataSourceProvider`

```typescript
/**
 * Data source provider interface
 * Compliant with: [IEEE1471] Section 5.3 (Interface Specification)
 */
export interface DataSourceProvider {
  /**
   * Provider identification
   */
  readonly id: string;  // e.g., "census-api", "nyc-open-data"
  readonly name: string;
  readonly version: string;

  /**
   * Supported jurisdiction types per [ISO3166]
   */
  readonly supportedJurisdictions: JurisdictionType[];

  /**
   * Cost model
   */
  readonly pricing: {
    costPerLookup: number;  // USD
    freeTierLimit?: number;  // Requests per day/month
  };

  /**
   * Fetch district boundaries
   * @param jurisdiction - Jurisdiction identifier ([ISO3166] + local code)
   * @param districtType - Legislative district type
   * @returns GeoJSON FeatureCollection ([RFC7946] compliant)
   */
  fetchDistrictBoundaries(
    jurisdiction: string,
    districtType: DistrictType
  ): Promise<GeoJSON.FeatureCollection>;

  /**
   * Fetch district list for jurisdiction
   * @returns Array of district identifiers
   */
  listDistricts(
    jurisdiction: string,
    districtType: DistrictType
  ): Promise<string[]>;

  /**
   * Validate data currency
   * @returns Last update timestamp
   */
  getDataVersion(): Promise<{
    lastUpdated: Date;
    source: string;
    authority: string;  // e.g., "US Census Bureau"
  }>;
}
```

**Enum:** `JurisdictionType`

```typescript
/**
 * Legislative jurisdiction types
 * Compliant with: US FIPS codes, [ISO3166]
 */
export enum JurisdictionType {
  FEDERAL = "federal",               // National legislature
  STATE = "state",                   // State legislature
  COUNTY = "county",                 // County commission
  CITY = "city",                     // City council
  CONGRESSIONAL = "congressional",   // US House districts
  STATE_SENATE = "state_senate",     // State upper chamber
  STATE_HOUSE = "state_house",       // State lower chamber
}
```

### 4.3 Census Bureau API Integration

**Endpoint:** `https://geocoding.geo.census.gov/geocoder/geographies/address`

**Request Specification:**
```
GET /geocoder/geographies/address
  ?street={street}
  &city={city}
  &state={state}
  &benchmark=Public_AR_Current
  &vintage=Current_Current
  &format=json
```

**Response Schema:**
```typescript
interface CensusGeocodeResponse {
  result: {
    addressMatches: Array<{
      matchedAddress: string;
      coordinates: {
        x: number;  // Longitude
        y: number;  // Latitude
      };
      addressComponents: {
        streetName: string;
        city: string;
        state: string;
        zip: string;
      };
    }>;
    geographies: {
      "119th Congressional Districts": Array<{
        GEOID: string;       // e.g., "0612" for CA-12
        NAME: string;
        BASENAME: string;
        CENTLAT: string;
        CENTLON: string;
      }>;
      "State Legislative Districts - Upper": Array<{
        GEOID: string;
        NAME: string;
      }>;
      "State Legislative Districts - Lower": Array<{
        GEOID: string;
        NAME: string;
      }>;
    };
  };
}
```

**Error Handling:**
```typescript
enum CensusAPIError {
  ADDRESS_NOT_FOUND = "No address match found",
  INVALID_REQUEST = "Invalid request parameters",
  SERVICE_UNAVAILABLE = "Census API temporarily unavailable"
}
```

**Implementation Reference:** See `packages/crypto/services/census-geocoder.ts` (TO BE IMPLEMENTED)

### 4.4 Municipal GIS Data Collection Protocol

**Collection Script:** `scripts/collect-city-council-gis.ts`

**Supported Platforms:**
- ArcGIS Hub (REST API)
- Socrata Open Data API
- CKAN API

**Data Validation Requirements:**
```typescript
interface GISValidationRules {
  /**
   * Topology validation per [RFC7946] Section 3.1.6
   */
  topology: {
    noGaps: boolean;        // All area covered
    noOverlaps: boolean;    // No district overlaps
    closedPolygons: boolean;  // First point = last point
  };

  /**
   * Attribution requirements
   */
  attribution: {
    districtID: boolean;     // Unique district identifier required
    districtName: boolean;   // Human-readable name required
    electionYear: boolean;   // Year boundaries effective
    source: boolean;         // Data source provenance
  };

  /**
   * Coordinate system per [RFC7946] Section 4
   */
  crs: {
    type: "EPSG:4326";  // WGS 84 required
    validated: boolean;
  };
}
```

**Quality Assurance Workflow:**
```
1. Download GeoJSON from municipal portal
2. Validate against [RFC7946] schema
3. Check topology (gaps/overlaps via JSTS library)
4. Verify attribution completeness
5. Transform to WGS 84 if necessary
6. Store in `/packages/crypto/data/city-council-districts/{city}.geojson`
7. Generate checksum (SHA-256)
8. Commit with metadata: source URL, download date, authority
```

---

## 5. Geocoding Service Interface

### 5.1 Abstract Interface

**Compliance:** [IEEE1471] Section 5.3 (Interface Specification)

```typescript
/**
 * Geocoding provider abstract interface
 * Implementations: Geocodio (US/CA), Nominatim (Global)
 */
export interface GeocodingProvider {
  /**
   * Convert address to coordinates
   * @param address - Structured address per [ISO19160]
   * @returns Coordinates in WGS 84 ([EPSG:4326])
   */
  geocode(address: Address): Promise<GeocodeResult>;

  /**
   * Convert coordinates to address
   * @param coords - Coordinates in WGS 84
   * @returns Structured address
   */
  reverseGeocode(coords: Coordinates): Promise<ReverseGeocodeResult>;

  /**
   * Batch geocoding (if supported)
   * @param addresses - Array of addresses
   * @returns Array of geocode results (preserving order)
   */
  geocodeBatch?(addresses: Address[]): Promise<GeocodeResult[]>;

  /**
   * Provider capabilities
   */
  readonly capabilities: {
    supportedCountries: string[];  // [ISO3166] codes
    batchSize?: number;            // Max batch size
    rateLimit?: number;            // Requests per minute
    accuracy: AccuracyLevel;
  };

  /**
   * Pricing model
   */
  readonly pricing: {
    costPerLookup: number;  // USD
    freeTierLimit?: number;
  };
}
```

**Type Definitions:**
```typescript
/**
 * Address structure per [ISO19160-1]
 */
export interface Address {
  readonly street?: string;
  readonly city?: string;
  readonly state?: string;      // State/Province
  readonly postalCode?: string;
  readonly country: string;     // [ISO3166] alpha-2 code
}

/**
 * Coordinates per [EPSG:4326] (WGS 84)
 */
export interface Coordinates {
  readonly latitude: number;   // -90 to 90
  readonly longitude: number;  // -180 to 180
}

/**
 * Geocode result
 */
export interface GeocodeResult {
  readonly coordinates: Coordinates;
  readonly accuracy: number;  // 0.0-1.0 confidence
  readonly source: string;    // Provider identifier
}

/**
 * Accuracy levels
 */
export enum AccuracyLevel {
  ROOFTOP = "rooftop",       // Exact building
  STREET = "street",         // Street-level
  CITY = "city",             // City-level
  APPROXIMATE = "approximate"  // Region-level
}
```

### 5.2 Geocodio Implementation

**Provider:** Geocodio (https://www.geocod.io)

**Supported:** US + Canada ([ISO3166]: US, CA)

**Capabilities:**
```typescript
{
  supportedCountries: ["US", "CA"],
  batchSize: 10000,
  rateLimit: 1000,  // Per minute (paid tier)
  accuracy: AccuracyLevel.ROOFTOP
}
```

**Pricing:**
```typescript
{
  costPerLookup: 0.0005,  // $0.50 per 1,000 lookups
  freeTierLimit: 2500      // Per day
}
```

**API Endpoint:** `https://api.geocod.io/v1.7/geocode`

**Implementation:** `packages/crypto/services/geocoding/providers/geocodio.ts`

### 5.3 Nominatim Implementation

**Provider:** OpenStreetMap Nominatim (https://nominatim.org)

**Supported:** Global ([ISO3166]: *)

**Capabilities:**
```typescript
{
  supportedCountries: ["*"],  // All countries with OSM data
  rateLimit: 1,               // 1 request per second (public instance)
  accuracy: AccuracyLevel.STREET
}
```

**Pricing:**
```typescript
{
  costPerLookup: 0,       // FREE (public instance)
  freeTierLimit: undefined // Rate-limited only
}
```

**API Endpoint:** `https://nominatim.openstreetmap.org/search`

**Implementation:** `packages/crypto/services/geocoding/providers/nominatim.ts`

### 5.4 Provider Selection Algorithm

```
ALGORITHM: SelectGeocodingProvider
INPUT: country_code (ISO3166 alpha-2), strategy (cost-optimized | accuracy-first)
OUTPUT: GeocodingProvider

1. IF strategy == "cost-optimized" THEN
     IF country_code IN ["US", "CA"] AND geocodio_available THEN
       RETURN Geocodio
     ELSE
       RETURN Nominatim  # FREE global fallback
     END IF

2. ELSE IF strategy == "accuracy-first" THEN
     IF country_code IN ["US", "CA"] THEN
       RETURN Geocodio  # Best accuracy for North America
     ELSE
       # Future: Google Maps for premium international
       RETURN Nominatim  # Current fallback
     END IF

3. ELSE
     ERROR "Invalid strategy"
   END IF
```

---

## 6. District Resolution Algorithm

### 6.1 Main Resolution Flow

```
ALGORITHM: ResolveDistrict
INPUT: address (Address)
OUTPUT: district (District), merkle_proof (MerkleProof)

1. # Step 1: Geocode address
   geocoding_service := GetGeocodingService()
   coords := geocoding_service.geocode(address)

2. # Step 2: Select country-specific strategy
   strategy := GetCountryStrategy(address.country)
   IF strategy == NULL THEN
     ERROR "Country not supported: " + address.country
   END IF

3. # Step 3: Resolve districts (finest → fallback)
   districts := strategy.resolveDistricts(address, coords)
   IF len(districts) == 0 THEN
     ERROR "No district found for address"
   END IF

4. # Step 4: Select finest available granularity
   finest_district := districts[0]  # Sorted by granularity

5. # Step 5: Fetch Shadow Atlas Merkle proof
   merkle_proof := FetchMerkleProof(finest_district.id, address)

6. RETURN finest_district, merkle_proof
```

### 6.2 US District Resolution Strategy

```
ALGORITHM: USDistrictResolution
INPUT: address (Address), coords (Coordinates)
OUTPUT: districts[] (sorted finest → fallback)

1. districts := []

2. # Tier 1: City Council GIS (FREE, finest granularity)
   city_council := ResolveCityCouncilGIS(address, coords)
   IF city_council != NULL THEN
     districts.APPEND(city_council)
   END IF

3. # Tier 2: Census API (FREE, 100% coverage)
   census_districts := ResolveCensusAPI(address)
   districts.APPEND(census_districts)  # Congressional, state senate, state house

4. # Tier 3: Cicero Fence (on-demand, $0.03 per lookup)
   IF city_council == NULL THEN  # Only if Tier 1 unavailable
     cicero_coverage := CheckCiceroCoverage(address.city)
     IF cicero_coverage.hasLocalCouncil THEN
       user_consent := PromptUserConsent(cost=0.03)
       IF user_consent THEN
         city_council := ResolveCicero(address)
         districts.PREPEND(city_council)  # Finest granularity
       END IF
     END IF
   END IF

5. RETURN districts  # Already sorted finest → fallback
```

### 6.3 City Council GIS Resolution

```
ALGORITHM: ResolveCityCouncilGIS
INPUT: address (Address), coords (Coordinates)
OUTPUT: district (District) OR NULL

1. # Load cached GIS boundaries
   city_slug := address.city.toLowerCase().replace(" ", "-")
   boundaries := LoadCityCouncilBoundaries(city_slug)

2. IF boundaries == NULL THEN
     RETURN NULL  # No FREE GIS for this city
   END IF

3. # Point-in-polygon check (Turf.js)
   point := CreatePoint(coords.longitude, coords.latitude)

4. FOR EACH feature IN boundaries.features DO
     IF BooleanPointInPolygon(point, feature.geometry) THEN
       RETURN District({
         type: DistrictType.CITY_COUNCIL,
         id: "US-CityCouncil-" + city_slug + "-" + feature.properties.district,
         name: address.city + " City Council District " + feature.properties.district,
         country: "US",
         granularity: "finest",
         source: "gis"
       })
     END IF
   END FOR

5. RETURN NULL  # Point not found in any district (error)
```

### 6.4 Census API Resolution

```
ALGORITHM: ResolveCensusAPI
INPUT: address (Address)
OUTPUT: districts[]

1. # Call Census Bureau API
   url := "https://geocoding.geo.census.gov/geocoder/geographies/address"
   params := {
     street: address.street,
     city: address.city,
     state: address.state,
     benchmark: "Public_AR_Current",
     vintage: "Current_Current",
     format: "json"
   }
   response := HTTP_GET(url, params)

2. IF response.status != 200 THEN
     ERROR "Census API error: " + response.status
   END IF

3. data := JSON_PARSE(response.body)
   geo := data.result.geographies
   districts := []

4. # Congressional district
   cd := geo["119th Congressional Districts"][0]
   IF cd != NULL THEN
     districts.APPEND(District({
       type: DistrictType.CONGRESSIONAL,
       id: "US-Congress-" + address.state + "-" + cd.GEOID,
       name: address.state + " Congressional District " + cd.GEOID,
       country: "US",
       granularity: "intermediate",
       source: "census"
     }))
   END IF

5. # State Senate
   state_senate := geo["State Legislative Districts - Upper"][0]
   IF state_senate != NULL THEN
     districts.APPEND(District({
       type: DistrictType.STATE_SENATE,
       id: "US-StateSenate-" + address.state + "-" + state_senate.GEOID,
       name: address.state + " State Senate District " + state_senate.GEOID,
       country: "US",
       granularity: "fallback",
       source: "census"
     }))
   END IF

6. # State House
   state_house := geo["State Legislative Districts - Lower"][0]
   IF state_house != NULL THEN
     districts.APPEND(District({
       type: DistrictType.STATE_HOUSE,
       id: "US-StateHouse-" + address.state + "-" + state_house.GEOID,
       name: address.state + " State House District " + state_house.GEOID,
       country: "US",
       granularity: "fallback",
       source: "census"
     }))
   END IF

7. RETURN districts
```

---

## 7. Data Validation Specification

### 7.1 GeoJSON Validation ([RFC7946])

**Required Fields:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "district": "1",           // REQUIRED: District ID
        "name": "District 1",      // REQUIRED: Human-readable name
        "election_year": 2022,     // REQUIRED: Year boundaries effective
        "source": "nyc.gov"        // REQUIRED: Data provenance
      },
      "geometry": {
        "type": "Polygon",         // Or MultiPolygon
        "coordinates": [...]       // REQUIRED: [RFC7946] compliant
      }
    }
  ]
}
```

**Validation Rules:**
```typescript
interface GeoJSONValidation {
  // Schema validation
  schema: {
    type: "FeatureCollection";  // [RFC7946] Section 3.3
    features_present: boolean;
    all_features_valid: boolean;
  };

  // Geometry validation
  geometry: {
    type_valid: boolean;         // Polygon or MultiPolygon only
    coordinates_valid: boolean;  // [RFC7946] Section 3.1.6
    closed_rings: boolean;       // First point == last point
    right_hand_rule: boolean;    // [RFC7946] Section 3.1.6
  };

  // CRS validation
  crs: {
    is_wgs84: boolean;          // EPSG:4326 required
    longitude_range: [-180, 180];
    latitude_range: [-90, 90];
  };

  // Topology validation
  topology: {
    no_self_intersections: boolean;
    no_gaps: boolean;
    no_overlaps: boolean;
  };
}
```

### 7.2 Topology Validation Algorithm

```
ALGORITHM: ValidateTopology
INPUT: districts[] (GeoJSON FeatureCollection)
OUTPUT: ValidationResult

1. # Check for gaps
   total_area := UnionAll(districts)
   expected_area := GetJurisdictionBoundary()
   coverage := total_area / expected_area

   IF coverage < 0.99 THEN
     ERROR "Coverage gap detected: " + (1 - coverage) * 100 + "%"
   END IF

2. # Check for overlaps
   FOR i := 0 TO len(districts)-1 DO
     FOR j := i+1 TO len(districts)-1 DO
       intersection := Intersect(districts[i], districts[j])
       IF area(intersection) > 0.0001 THEN  # Tolerance for rounding
         ERROR "Overlap detected between " + districts[i].id + " and " + districts[j].id
       END IF
     END FOR
   END FOR

3. # Check polygon closure
   FOR EACH district IN districts DO
     FOR EACH ring IN district.geometry.coordinates DO
       first_point := ring[0]
       last_point := ring[len(ring)-1]
       IF first_point != last_point THEN
         ERROR "Polygon not closed: " + district.id
       END IF
     END FOR
   END FOR

4. RETURN ValidationResult(success=true)
```

---

## 8. Implementation Status

### 8.1 Completed Components

✅ **Architecture Design:**
- Provider-agnostic geocoding interface defined
- Country-specific district resolution strategies specified
- Three-tier data acquisition protocol documented

✅ **Implementation Files Created:**
- `packages/crypto/services/geocoding/types.ts`
- `packages/crypto/services/geocoding/providers/geocodio.ts`
- `packages/crypto/services/geocoding/providers/nominatim.ts`
- `packages/crypto/services/geocoding/index.ts`
- `packages/crypto/services/district-resolver.ts`

✅ **Automation Scripts Created:**
- `scripts/collect-city-council-gis.ts`
- `scripts/update-cicero-coverage.ts`

### 8.2 Implementation Roadmap

**Week 1-2: Data Collection (NOT STARTED)**
- [ ] Execute `collect-city-council-gis.ts` for top 10 cities
- [ ] Validate GeoJSON against [RFC7946]
- [ ] Run topology validation (gaps/overlaps)
- [ ] Commit verified GIS data to repo

**Week 3-4: Census Integration (NOT STARTED)**
- [ ] Implement `CensusGeocoder` service
- [ ] Add error handling for API edge cases
- [ ] Create integration tests with real API
- [ ] Validate against TIGER/Line shapefiles

**Week 5-6: Cicero Fence (NOT STARTED)**
- [ ] Query Cicero coverage endpoint
- [ ] Parse coverage JSON into city map
- [ ] Implement user consent flow
- [ ] Add cost tracking

**Week 7-8: Shadow Atlas Generation (NOT STARTED)**
- [ ] Implement Merkle tree construction
- [ ] Generate trees for collected districts
- [ ] Deploy to IPFS
- [ ] Create proof generation API

**Week 9-10: Integration Testing (NOT STARTED)**
- [ ] End-to-end address → proof flow
- [ ] Performance benchmarking
- [ ] Mobile device testing
- [ ] Security audit prep

### 8.3 Missing Specifications

❌ **NOT YET SPECIFIED:**
- [ ] IPFS pinning strategy for Shadow Atlas distribution
- [ ] Shadow Atlas versioning protocol
- [ ] Governance process for root updates
- [ ] International expansion protocols (UK, CA, AU)
- [ ] Disaster recovery for data source outages
- [ ] Performance SLAs (geocoding latency, proof generation time)

---

## 9. Open Questions

1. **Shadow Atlas Versioning:** How do we handle district boundary changes mid-year?
   - Proposed: Epoch-based versioning with grace periods

2. **IPFS Hosting:** Who pins Shadow Atlas data? Decentralized redundancy strategy?
   - Proposed: Multiple pinning services + incentivized community pinning

3. **Data Freshness:** How do we detect stale municipal GIS data?
   - Proposed: Automated quarterly checks with diff detection

4. **International Expansion:** Which countries after US launch?
   - Proposed: Canada (Phase 2), UK (Phase 3), EU (Phase 4)

5. **Cicero Dependency:** What if Cicero shuts down or raises prices?
   - Proposed: Build fallback scraping infrastructure for city council data

---

## 10. Compliance Matrix

| Standard | Requirement | Status | Reference |
|----------|-------------|--------|-----------|
| **[IEEE1471]** | Architecture description | ✅ COMPLETE | Section 2.1 |
| **[RFC7946]** | GeoJSON format compliance | ⏸️ PARTIAL | Section 7.1 |
| **[ISO3166]** | Country code usage | ✅ COMPLETE | Section 5.1 |
| **[EPSG:4326]** | WGS 84 coordinate system | ✅ COMPLETE | Section 5.1 |

---

## Appendix A: Type Definitions

See `packages/crypto/services/geocoding/types.ts` for complete TypeScript interfaces.

## Appendix B: API Endpoints

**Census Bureau:**
- Geocoding: `https://geocoding.geo.census.gov/geocoder/`
- Documentation: https://www.census.gov/programs-surveys/geography/technical-documentation/complete-technical-documentation/census-geocoder.html

**Cicero:**
- Coverage: `https://app.cicerodata.com/v3.1/coverage`
- Documentation: https://cicero.azavea.com/docs/

**Geocodio:**
- Geocoding: `https://api.geocod.io/v1.7/geocode`
- Documentation: https://www.geocod.io/docs/

**Nominatim:**
- Search: `https://nominatim.openstreetmap.org/search`
- Documentation: https://nominatim.org/release-docs/latest/api/Search/

---

**Version History:**
- 1.0.0 (2025-11-08): Initial specification
- Status: DRAFT - Awaiting implementation and validation

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/voter-protocol
