# Shadow Atlas Technical Specification

**Version:** 2.0.0
**Date:** 2026-01-25
**Status:** Cell-Based Architecture
**Implementation Status:** Phase 1 (Architecture Defined)
**Standards Compliance:** IEEE 1471-2000 (Architecture Description), RFC 8949 (CBOR), GeoJSON RFC 7946

**Implementation Progress:**
- ✅ Geocoding pipeline (Census API, Geocodio, Nominatim)
- ✅ District resolution (Congressional, State Legislature, City Council)
- ✅ 716 city portals discovered and cataloged
- ✅ Data acquisition protocols and validation
- ✅ Bulk discovery automation (wave-based extraction)
- ⏳ Cell tree construction (types defined, full integration pending)
- ⏳ IPFS storage layer (planned)
- ❌ Global scaling (US-only implementation currently)

**Architecture Model:** Cell-Based (Census Block Groups)
- Single Merkle tree with ~242K cells (depth 18)
- Each cell contains ALL 14 district mappings
- Proof reveals all districts as public outputs
- Anonymity set = Block Group population (600-3000 residents)

---

## 1. Executive Summary

### 1.1 Purpose

This specification defines the Shadow Atlas data structure, acquisition protocols, and interface contracts for establishing **verified geographic identity** in the VOTER Protocol zero-knowledge proof system.

**Core Purpose: District-to-User Mapping**

Shadow Atlas enables users to prove their geographic identity - the cryptographic association between a verified user and all the districts they belong to. The cell-based model uses Census Block Groups as the fundamental unit, with each cell containing all 14 district mappings for that geographic area.

**What Shadow Atlas Provides:**
- A user proves: "I am a verified resident of this geographic cell"
- The proof reveals: All 14 districts the user belongs to (their "district profile")
- This establishes: Verified district-to-user mapping

**What Shadow Atlas Does NOT Do:**
- Decide which representative to contact (downstream application concern)
- Route messages or submissions (downstream application concern)
- Determine what actions to take (downstream application concern)

The proof creates a verified geographic identity. Applications like Communique then USE this proven identity for their specific purposes (e.g., routing civic messages to representatives).

### 1.2 Scope

**IN SCOPE:**
- Shadow Atlas Cell Tree data structure (Section 3)
- Data acquisition protocols for US Census Block Groups and districts (Section 4)
- Geocoding service interfaces (Section 5)
- Cell resolution algorithms (Section 6)
- Data validation and quality assurance (Section 7)
- Privacy model and anonymity guarantees (Section 8)

**OUT OF SCOPE:**
- Zero-knowledge proof circuit implementation (see ZK-PROOF-SPEC-REVISED.md)
- Smart contract verification logic (see ZK-PROOF-SPEC-REVISED.md)
- Congressional message delivery (see ARCHITECTURE.md)

**Scope Boundary:** This specification covers the single cell tree containing ~242K Census Block Group cells. Each cell contains all 14 district mappings, eliminating the need for per-district trees.

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
- **[DISTRICT-TAX]** DISTRICT-TAXONOMY.md - Complete BoundaryType classifications and circuit slot mappings

**Census Data Sources:**
- **[TIGER-BG]** Census TIGER Block Group Relationship Files - Maps blocks to governance boundaries
- **[CENSUS-BG]** Census Block Group Shapefiles - Geographic boundaries for ~242K block groups

---

## 2. System Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Client Application (Browser)                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐      ┌───────────────────────────┐  │
│  │ Cell             │──────│ Geocoding Service         │  │
│  │ Resolver         │      │ (Provider Router)         │  │
│  └──────────────────┘      └───────────────────────────┘  │
│         │                            │                      │
│         │                            ▼                      │
│         │                   ┌─────────────────┐            │
│         │                   │ Census API      │            │
│         │                   │ (Block Groups)  │            │
│         │                   └─────────────────┘            │
│         │                            │                      │
│         │                            ▼                      │
│         │                   ┌─────────────────┐            │
│         │                   │ Geocodio/       │            │
│         │                   │ Nominatim       │            │
│         │                   └─────────────────┘            │
│         ▼                                                   │
│  ┌──────────────────────────────────────────────────┐     │
│  │ Shadow Atlas Cell Tree                            │     │
│  │ (~242K cells, depth 18)                          │     │
│  │ (IndexedDB/IPFS)                                 │     │
│  └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Data Sources                                                 │
├─────────────────────────────────────────────────────────────┤
│  • Census TIGER Block Group Relationship Files              │
│  • Census Bureau API (Congressional + State Legislature)    │
│  • Municipal GIS Portals (City Council Districts)           │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow (Cell-Based Model)

```
Address Input (PRIVATE)
    │
    ▼
Geocoding Service (lat/lon)
    │
    ▼
Census Block Group Lookup (cell_id) ─── PRIVATE
    │
    ▼
Cell Data (contains ALL 14 districts)
    │
    ▼
Cell Tree Merkle Proof
    │
    ▼
ZK Proof Generation (see [ZK-SPEC])
    │
    ▼
VERIFIED GEOGRAPHIC IDENTITY (PUBLIC OUTPUTS):
  • nullifier (sybil resistance for any application)
  • 14 district hashes (user's complete "district profile")
```

**Core Purpose:** The proof establishes the user's **verified geographic identity** - the cryptographic association between a verified user and all their districts. The address and cell ID remain hidden; the district profile is public.

**Key Architectural Change:** Unlike the old model where users had separate proofs per district, the cell-based model produces a single proof that reveals all 14 district memberships simultaneously. This creates a complete district-to-user mapping in one proof.

---

## 3. Shadow Atlas Data Structure

### 3.1 Cell Tree Specification

**Structure:** Single Merkle tree where each leaf represents a Census Block Group (cell).
Each cell contains a BoundaryMap with all 14 district mappings for that geographic area.

**Parameters:**
- **Hash Function:** Poseidon hash (SNARK-friendly, BN254 field)
- **Tree Depth:** 18 (supports up to 262,144 cells; ~242K US block groups)
- **Leaf Node:** `Poseidon(cell_id, identity_commitment, boundary_commitment)`
- **Internal Node:** `Poseidon(left_child_hash || right_child_hash)`

**Cell Structure:**
```
Cell {
  cell_id: Field,                    // Census Block Group GEOID (12-digit FIPS)
  identity_commitment: Field,        // User's identity commitment
  boundary_commitment: Field         // H(all 14 district hashes)
}
```

**BoundaryMap (14 district slots):**
```
BoundaryMap {
  slot_0:  congressional_district,     // US House district
  slot_1:  state_senate,               // State upper chamber
  slot_2:  state_house,                // State lower chamber
  slot_3:  county,                     // County
  slot_4:  city,                       // Municipality
  slot_5:  city_council,               // City council district
  slot_6:  school_district,            // School district
  slot_7:  school_board,               // School board zone
  slot_8:  special_district_1,         // Water/utility district
  slot_9:  special_district_2,         // Fire/transit district
  slot_10: judicial_district,          // Court jurisdiction
  slot_11: precinct,                   // Voting precinct
  slot_12: reserved_1,                 // Future use
  slot_13: reserved_2                  // Future use
}
```

**NULL_HASH:** `Poseidon("NULL")` - Used for unpopulated district slots

### 3.5 District Type Coverage

Shadow Atlas tracks **50+ BoundaryType classifications** representing the full taxonomy of US local governments. These classifications are mapped to **24 circuit slots** for ZK proofs, allowing comprehensive district coverage within circuit constraints.

**Census 2022 Local Government Data:**
| Government Type | Count | Notes |
|-----------------|-------|-------|
| **Total Local Governments** | 90,837 | All sub-state entities |
| Special District Governments | 39,555 | Single-purpose districts |
| Independent School Districts | 12,546 | Fiscally independent |
| Counties | 3,031 | Including equivalents (LA parishes, AK boroughs) |
| Municipalities | 19,491 | Cities, towns, villages, boroughs |
| Townships | 16,214 | Town/township governments |

**BoundaryType to Circuit Slot Mapping:**

The 50+ BoundaryType classifications (e.g., `us:fire-district`, `us:water-district`, `us:library-district`) are mapped to 24 circuit slots using category-based aggregation. For the complete mapping specification, see **[DISTRICT-TAXONOMY.md](./DISTRICT-TAXONOMY.md)**.

**Key Mapping Categories:**
- Slots 0-3: Federal/State (Congressional, State Senate, State House, County)
- Slots 4-5: Municipal (City, City Council)
- Slots 6-7: Education (School District, School Board)
- Slots 8-15: Special Districts (Fire, Water, Transit, Library, Hospital, Utility, etc.)
- Slots 16-19: Judicial/Electoral (Courts, Precincts, Wards)
- Slots 20-23: Reserved/International

**Rationale:**
- Single tree depth (18) = 18 Poseidon hashes per proof (constant circuit depth)
- ~242K cells covers entire US at block group granularity
- All districts resolved in one proof, not multiple per-district proofs
- Anonymity set = block group population (typically 600-3000 residents)

### 3.2 Cell Tree Construction Algorithm

```
ALGORITHM: ConstructCellTree
INPUT: cells[] (Census Block Groups with BoundaryMaps)
OUTPUT: root_hash, tree_structure

1. TREE_DEPTH := 18
   max_capacity := 2^TREE_DEPTH  # 262,144 cells

   IF len(cells) > max_capacity THEN
     ERROR "Cell count exceeds tree capacity"

2. # Sort cells by cell_id (GEOID) for deterministic ordering
   cells := SORT(cells, BY cell_id)

3. # Build leaves from cells
   leaves := []
   FOR EACH cell IN cells DO
     boundary_commitment := ComputeBoundaryCommitment(cell.boundary_map)
     leaf_hash := Poseidon(cell.cell_id, cell.identity_commitment, boundary_commitment)
     leaves.APPEND(leaf_hash)
   END FOR

4. # Pad to full tree capacity
   WHILE len(leaves) < max_capacity DO
     leaves.APPEND(Poseidon("PADDING"))  # Deterministic padding
   END WHILE

5. # Build tree layers
   current_layer := leaves
   tree_structure := [current_layer]

6. FOR level := 0 TO (TREE_DEPTH - 1) DO
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

7. root_hash := current_layer[0]
8. RETURN root_hash, tree_structure
```

**Boundary Commitment Algorithm:**
```
ALGORITHM: ComputeBoundaryCommitment
INPUT: boundary_map (14 district slots)
OUTPUT: commitment_hash

1. NULL_HASH := Poseidon("NULL")

2. # Collect all 14 district hashes (or NULL_HASH if empty)
   district_hashes := []
   FOR slot := 0 TO 13 DO
     IF boundary_map[slot] != NULL THEN
       district_hashes.APPEND(Poseidon(boundary_map[slot]))
     ELSE
       district_hashes.APPEND(NULL_HASH)
     END IF
   END FOR

3. # Compute commitment as hash of all district hashes
   commitment := Poseidon(district_hashes[0..13])
4. RETURN commitment
```

### 3.3 Cell Proof Generation Algorithm

```
ALGORITHM: GenerateCellProof
INPUT: cell_id, identity_commitment, boundary_map, tree_structure
OUTPUT: proof_siblings[], proof_indices[], boundary_commitment

1. TREE_DEPTH := 18

2. # Compute leaf hash
   boundary_commitment := ComputeBoundaryCommitment(boundary_map)
   leaf_hash := Poseidon(cell_id, identity_commitment, boundary_commitment)

3. # Find leaf index (cells sorted by cell_id)
   leaf_index := BINARY_SEARCH(tree_structure[0], leaf_hash)

4. IF leaf_index == -1 THEN
     ERROR "Cell not in tree"

5. proof_siblings := []
   proof_indices := []
   current_index := leaf_index

6. FOR level := 0 TO (TREE_DEPTH - 1) DO
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

7. RETURN proof_siblings, proof_indices, boundary_commitment
```

**ZK Circuit Outputs (Verified Geographic Identity):**
The ZK proof establishes the user's geographic identity and outputs:
- `nullifier` - Sybil resistance (derived from identity + epoch) - one action per context
- `district_hashes[14]` - The user's "district profile" - all 14 district memberships as PUBLIC outputs

**What This Proves:**
- The user is a verified resident of a geographic cell
- The user belongs to all 14 revealed districts
- The nullifier prevents the same user from proving twice in the same context

**Private Inputs (hidden - preserves address privacy):**
- `address` - User's physical address
- `cell_id` - Census Block Group identifier
- `identity_secret` - User's private key material
- `merkle_path` - Proof siblings and indices

### 3.4 On-Chain Storage

**Smart Contract State:**
```solidity
// Shadow Atlas Cell Tree registry
bytes32 public cellTreeRoot;        // Single tree root for all ~242K cells
uint256 public currentEpoch;        // Current Shadow Atlas version
uint256 public lastUpdated;         // Timestamp of last root update

// Nullifier tracking (prevents double-voting)
mapping(bytes32 => bool) public usedNullifiers;
```

**Root Update Protocol:**
```solidity
function updateCellTreeRoot(
    bytes32 newRoot,
    uint256 newEpoch,
    bytes calldata governanceProof
) external onlyGovernance {
    require(newEpoch > currentEpoch, "Epoch must increase");
    require(verifyGovernanceProof(governanceProof), "Invalid governance proof");

    cellTreeRoot = newRoot;
    currentEpoch = newEpoch;
    lastUpdated = block.timestamp;

    emit CellTreeUpdated(newRoot, newEpoch, block.timestamp);
}
```

**Proof Verification (Establishes Geographic Identity):**
```solidity
function verifyGeographicIdentity(
    bytes32 nullifier,
    bytes32[14] calldata districtHashes,  // User's "district profile" - all 14 districts
    bytes calldata zkProof
) external returns (bool) {
    require(!usedNullifiers[nullifier], "Nullifier already used - sybil attempt");
    require(verifyZKProof(cellTreeRoot, nullifier, districtHashes, zkProof), "Invalid proof");

    usedNullifiers[nullifier] = true;
    emit GeographicIdentityVerified(nullifier, districtHashes);
    return true;
}
```

**What This Establishes:**
- User has proven geographic identity (district-to-user mapping)
- The 14 districtHashes are the user's verified "district profile"
- Nullifier prevents duplicate claims in the same context
- Applications can now use this proven identity for their purposes

---

## 4. Data Acquisition Protocol

### 4.1 Cell-Based Data Strategy

**Foundation: Census Block Groups (~242K cells)**
- **Source:** Census TIGER/Line Block Group Relationship Files
- **Format:** CSV relationship tables + Shapefiles
- **Coverage:** 100% US (all ~242K block groups)
- **Cost:** $0 (FREE public data)
- **Update Frequency:** Annual (decennial census + ACS updates)
- **Key Files:**
  - `tl_YYYY_SS_bg.shp` - Block group boundaries
  - `tl_YYYY_SS_tabblock.dbf` - Block-to-block-group relationships
  - Congressional/Legislative district relationship files

**Tier 1: City Council Districts (Municipal GIS)**
- **Source:** Municipal open data portals
- **Format:** GeoJSON ([RFC7946])
- **Coverage:** Top 50 US cities (50M population)
- **Cost:** $0 (FREE downloads)
- **Update Frequency:** Annual (post-redistricting)
- **Purpose:** Populates `slot_5` (city_council) in BoundaryMap

**Tier 2: Congressional + State Legislature (Census API)**
- **Source:** US Census Bureau Geocoding API ([CENSUS-API])
- **Format:** JSON
- **Coverage:** 100% US addresses
- **Cost:** $0 (FREE unlimited)
- **Update Frequency:** Automatic (API maintained by Census Bureau)
- **Purpose:** Populates `slots 0-3` (congressional, state_senate, state_house, county)

**Tier 3: Special Districts (State GIS + Census)**
- **Source:** State GIS portals, Census TIGER special district files
- **Format:** GeoJSON, Shapefiles
- **Coverage:** Varies by state
- **Cost:** $0 (FREE)
- **Purpose:** Populates `slots 6-11` (school, special districts, judicial, precinct)

### 4.2 Special District Acquisition

Special districts represent the largest category of US local governments (39,555 per Census 2022). Shadow Atlas prioritizes acquisition by district type prevalence and civic impact.

**Special District Counts (Nationwide Estimates):**
| District Type | Estimated Count | Primary Data Source |
|---------------|-----------------|---------------------|
| School Districts | 12,546 | Census of Governments |
| Library Districts | ~9,000 | IMLS Public Library Survey |
| Fire Districts | ~5,600 | NFPA, State Fire Marshal offices |
| Water Districts | 5,000+ | EPA, State environmental agencies |
| Soil/Water Conservation | ~3,000 | NACD, USDA-NRCS |
| Hospital Districts | ~700 | AHA, State health departments |
| Transit Districts | ~500 | FTA National Transit Database |

**Acquisition Priority:**
1. **High Priority:** School districts (elected boards, tax authority)
2. **Medium Priority:** Fire, water, library (direct constituent services)
3. **Lower Priority:** Soil/water conservation, hospital, transit (less frequent elections)

**Data Sources by District Type:**
- **School Districts:** NCES School District Geographic Relationship Files (annual)
- **Fire Districts:** State Fire Marshal boundary files, NFPA district registry
- **Water Districts:** State water boards, EPA SDWIS database
- **Library Districts:** State library agencies, IMLS outlet data
- **Transit Districts:** FTA service area boundaries, MPO GIS portals

For complete BoundaryType classifications and slot mappings, see **[DISTRICT-TAXONOMY.md](./DISTRICT-TAXONOMY.md)**.

### 4.3 International Coverage

Shadow Atlas is designed for global expansion beyond US local governments. The international governance landscape includes significantly more granular representation structures.

**Supported International Jurisdictions:**

| Region | Entity Type | Estimated Count | Status |
|--------|-------------|-----------------|--------|
| **EU Parliament** | MEP constituencies | 27 countries | Planned (Phase 4) |
| **India** | Gram Panchayats (village councils) | 262,834 | Research phase |
| **UK** | Parish/Town Councils | 10,000+ | Planned (Phase 3) |
| **Canada** | Municipal wards | ~5,000 | Planned (Phase 2) |
| **Australia** | Local Government Areas | 537 | Planned (Phase 5) |

**Township Equivalents by Country:**
- **France:** 34,945 communes
- **Germany:** 10,787 Gemeinden
- **Italy:** 7,904 comuni
- **Spain:** 8,131 municipios

**International Data Sources:**
- **EU:** Eurostat NUTS regions, national electoral commissions
- **India:** Ministry of Panchayati Raj, State Election Commissions
- **UK:** ONS geography, Electoral Commission boundary data
- **Canada:** Statistics Canada census subdivisions

**BoundaryType Extensions for International:**
International jurisdictions use the `intl:` namespace prefix (e.g., `intl:eu-parliament`, `intl:uk-parish`, `intl:in-gram-panchayat`). These map to reserved circuit slots 20-23.

For complete international BoundaryType mappings, see **[DISTRICT-TAXONOMY.md](./DISTRICT-TAXONOMY.md)**.

### 4.5 Data Source Interface Contract

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

### 4.6 Census Bureau API Integration

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

### 4.7 Municipal GIS Data Collection Protocol

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

**Note:** This data acquisition protocol feeds into the cell tree construction pipeline. City council districts populate slot_5 in the BoundaryMap for cells within that municipality.

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

## 6. Cell Resolution Algorithm

### 6.1 Main Resolution Flow

```
ALGORITHM: ResolveCell
INPUT: address (Address)
OUTPUT: cell_id, boundary_map (all 14 districts), merkle_proof

1. # Step 1: Geocode address
   geocoding_service := GetGeocodingService()
   coords := geocoding_service.geocode(address)

2. # Step 2: Resolve Census Block Group (cell)
   cell_id := ResolveCensusBlockGroup(address, coords)
   IF cell_id == NULL THEN
     ERROR "Could not resolve block group for address"
   END IF

3. # Step 3: Fetch all districts for this cell
   boundary_map := FetchCellBoundaryMap(cell_id)
   # boundary_map contains all 14 district slots

4. # Step 4: Fetch Cell Tree Merkle proof
   merkle_proof := FetchCellTreeProof(cell_id)

5. RETURN cell_id, boundary_map, merkle_proof
```

### 6.2 Census Block Group Resolution

```
ALGORITHM: ResolveCensusBlockGroup
INPUT: address (Address), coords (Coordinates)
OUTPUT: cell_id (12-digit FIPS GEOID)

1. # Call Census Bureau API with block group layer
   url := "https://geocoding.geo.census.gov/geocoder/geographies/address"
   params := {
     street: address.street,
     city: address.city,
     state: address.state,
     benchmark: "Public_AR_Current",
     vintage: "Current_Current",
     layers: "Census Block Groups",
     format: "json"
   }
   response := HTTP_GET(url, params)

2. IF response.status != 200 THEN
     ERROR "Census API error: " + response.status
   END IF

3. data := JSON_PARSE(response.body)
   block_groups := data.result.geographies["Census Block Groups"]

4. IF len(block_groups) == 0 THEN
     ERROR "No block group found for address"
   END IF

5. # Extract 12-digit GEOID (State FIPS + County FIPS + Tract + Block Group)
   cell_id := block_groups[0].GEOID  # e.g., "060375277021"

6. RETURN cell_id
```

### 6.3 Boundary Map Population

```
ALGORITHM: FetchCellBoundaryMap
INPUT: cell_id (12-digit GEOID)
OUTPUT: boundary_map (14 district slots)

1. NULL_HASH := Poseidon("NULL")
   boundary_map := [NULL_HASH] * 14  # Initialize all slots to NULL

2. # Fetch from Census API (slots 0-3)
   census_districts := FetchCensusDistricts(cell_id)
   boundary_map[0] := census_districts.congressional OR NULL_HASH
   boundary_map[1] := census_districts.state_senate OR NULL_HASH
   boundary_map[2] := census_districts.state_house OR NULL_HASH
   boundary_map[3] := census_districts.county OR NULL_HASH

3. # Fetch from municipal GIS (slots 4-5)
   city_info := FetchCityInfo(cell_id)
   boundary_map[4] := city_info.municipality OR NULL_HASH
   boundary_map[5] := city_info.council_district OR NULL_HASH

4. # Fetch from school district data (slots 6-7)
   school_info := FetchSchoolDistricts(cell_id)
   boundary_map[6] := school_info.district OR NULL_HASH
   boundary_map[7] := school_info.board_zone OR NULL_HASH

5. # Fetch special districts (slots 8-9)
   special_districts := FetchSpecialDistricts(cell_id)
   boundary_map[8] := special_districts.water_utility OR NULL_HASH
   boundary_map[9] := special_districts.fire_transit OR NULL_HASH

6. # Fetch judicial/precinct (slots 10-11)
   judicial_info := FetchJudicialInfo(cell_id)
   boundary_map[10] := judicial_info.judicial_district OR NULL_HASH
   boundary_map[11] := judicial_info.voting_precinct OR NULL_HASH

7. # Reserved slots (12-13) remain NULL_HASH

8. RETURN boundary_map
```

### 6.4 Census API District Resolution

```
ALGORITHM: FetchCensusDistricts
INPUT: cell_id (12-digit GEOID)
OUTPUT: CensusDistricts { congressional, state_senate, state_house, county }

1. # Extract state FIPS from cell_id (first 2 digits)
   state_fips := cell_id[0:2]

2. # Use Census relationship files or API
   url := "https://geocoding.geo.census.gov/geocoder/geographies/coordinates"
   # Get centroid of block group for API call
   centroid := GetBlockGroupCentroid(cell_id)
   params := {
     x: centroid.longitude,
     y: centroid.latitude,
     benchmark: "Public_AR_Current",
     vintage: "Current_Current",
     format: "json"
   }
   response := HTTP_GET(url, params)

3. data := JSON_PARSE(response.body)
   geo := data.result.geographies

4. RETURN CensusDistricts({
     congressional: FormatDistrictId("US-Congress", state_fips, geo["119th Congressional Districts"][0]),
     state_senate: FormatDistrictId("US-StateSenate", state_fips, geo["State Legislative Districts - Upper"][0]),
     state_house: FormatDistrictId("US-StateHouse", state_fips, geo["State Legislative Districts - Lower"][0]),
     county: FormatDistrictId("US-County", state_fips, geo["Counties"][0])
   })
```

**Key Difference from Old Model:** The cell resolution algorithm returns ALL 14 districts in a single call, not just the "finest granularity" district. All districts are populated (or set to NULL_HASH) and returned together.

---

## 7. Data Validation Specification

### 7.1 Cell-Level Validation

**Cell Validation Rules:**
```typescript
interface CellValidation {
  // Cell ID validation
  cell_id: {
    format_valid: boolean;       // 12-digit FIPS GEOID
    state_fips_valid: boolean;   // First 2 digits = valid state (01-56)
    county_fips_valid: boolean;  // Digits 3-5 = valid county
    tract_valid: boolean;        // Digits 6-11 = valid tract
    block_group_valid: boolean;  // Digit 12 = 0-9
  };

  // BoundaryMap validation
  boundary_map: {
    all_14_slots_present: boolean;  // Must have exactly 14 slots
    no_empty_slots: boolean;        // Each slot = district_hash OR NULL_HASH
    valid_hash_format: boolean;     // All values are valid Poseidon hashes
    required_slots_populated: boolean;  // Slots 0-3 (Census) must be non-NULL
  };

  // Geographic consistency
  geography: {
    districts_contain_cell: boolean;  // All non-NULL districts should contain this cell
    no_impossible_combinations: boolean;  // e.g., CA city council in TX block group
  };
}
```

**Required Slot Population:**
- Slots 0-3 (congressional, state_senate, state_house, county): REQUIRED (never NULL)
- Slots 4-5 (city, city_council): REQUIRED if in incorporated area, else NULL_HASH
- Slots 6-11: Optional (NULL_HASH acceptable)
- Slots 12-13: Reserved (always NULL_HASH)

### 7.2 Cell Validation Algorithm

```
ALGORITHM: ValidateCell
INPUT: cell_id, boundary_map
OUTPUT: ValidationResult

1. NULL_HASH := Poseidon("NULL")

2. # Validate cell_id format (12-digit FIPS GEOID)
   IF len(cell_id) != 12 THEN
     ERROR "Invalid cell_id length: expected 12, got " + len(cell_id)
   END IF

   state_fips := cell_id[0:2]
   IF state_fips NOT IN VALID_STATE_FIPS THEN
     ERROR "Invalid state FIPS: " + state_fips
   END IF

3. # Validate boundary_map has exactly 14 slots
   IF len(boundary_map) != 14 THEN
     ERROR "Invalid boundary_map: expected 14 slots, got " + len(boundary_map)
   END IF

4. # Validate required slots are populated (0-3)
   FOR slot := 0 TO 3 DO
     IF boundary_map[slot] == NULL_HASH THEN
       ERROR "Required slot " + slot + " is NULL (Census districts required)"
     END IF
   END FOR

5. # Validate all slots are valid hashes (not empty/malformed)
   FOR slot := 0 TO 13 DO
     IF NOT IsValidPoseidonHash(boundary_map[slot]) THEN
       ERROR "Invalid hash in slot " + slot
     END IF
   END FOR

6. # Validate reserved slots are NULL
   IF boundary_map[12] != NULL_HASH OR boundary_map[13] != NULL_HASH THEN
     ERROR "Reserved slots 12-13 must be NULL_HASH"
   END IF

7. RETURN ValidationResult(success=true)
```

### 7.3 GeoJSON Validation ([RFC7946])

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

### 7.4 Topology Validation Algorithm

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

## 8. Privacy Model

### 8.1 Data Classification

The cell-based model provides clear separation between private inputs and public outputs, establishing **verified geographic identity** while preserving address privacy:

**PRIVATE (Hidden in ZK Proof - Address Privacy Preserved):**
| Data Element | Description | Why Hidden |
|--------------|-------------|------------|
| `address` | User's physical street address | PII, location privacy |
| `cell_id` | Census Block Group GEOID | Reveals approximate location |
| `identity_secret` | User's private key material | Cryptographic security |
| `merkle_path` | Tree proof siblings/indices | Implementation detail |

**PUBLIC (Revealed as ZK Outputs - The User's Geographic Identity):**
| Data Element | Description | Purpose |
|--------------|-------------|---------|
| `nullifier` | Derived from identity + epoch | Sybil resistance for any application |
| `district_hashes[14]` | User's "district profile" | Establishes district-to-user mapping |
| `cell_tree_root` | Current epoch root | Proves against valid tree |

**The Fundamental Value:** A user can prove which districts they belong to without revealing their address. The 14 district hashes together form the user's verified "district profile" - their cryptographic geographic identity.

### 8.2 Anonymity Set Analysis

**Cell Granularity: Census Block Group**
- **Population:** 600-3000 residents per block group (by Census design)
- **US Total:** ~242,000 block groups
- **Anonymity Set:** User is indistinguishable from all other residents of same block group

**Privacy Guarantees:**
```
Given: ZK proof with public outputs (nullifier, 14 district_hashes)

Observer CANNOT determine:
- User's exact address (hidden)
- User's specific block group (hidden)
- Which of 600-3000 residents produced the proof

Observer CAN determine:
- User's complete "district profile" (all 14 district memberships)
- The nullifier (for sybil resistance)

This IS the user's verified geographic identity - the cryptographic
association between a user and all their districts.
```

**Downstream Applications** can then use this proven identity for:
- Civic engagement (route messages to correct representatives)
- Analytics/PR (aggregate district-level data)
- Voter verification (confirm eligibility)
- Research (geographic demographic analysis)
- Governance (district-scoped voting or polling)

**Attack Surface:**
- **Intersection Attack:** If user proves membership in rare combination of districts, anonymity set may shrink
- **Mitigation:** Block groups are designed to nest within larger boundaries; district intersections typically affect entire block groups

### 8.3 Privacy Comparison: Old vs New Model

| Aspect | Old (Per-District Trees) | New (Cell-Based) |
|--------|--------------------------|------------------|
| **Address hidden** | Yes | Yes |
| **District hidden** | Partially (proves one at a time) | No (all 14 public) |
| **Proof count per user** | Multiple (one per district) | One (all districts) |
| **Correlation risk** | Low (separate proofs) | None (single proof) |
| **Anonymity set** | Entire district population | Block group (600-3000) |
| **Tree count** | ~2M trees | 1 tree |

**Trade-off:** The cell-based model reveals more district information publicly (all 14 vs. one at a time) but provides simpler, more efficient proofs. The anonymity set is smaller (block group vs. district) but still provides meaningful privacy (600-3000 residents).

### 8.4 Nullifier Construction

```
ALGORITHM: ComputeNullifier
INPUT: identity_secret, epoch, cell_id
OUTPUT: nullifier

1. # Nullifier binds identity to epoch, providing sybil resistance
   nullifier := Poseidon(identity_secret, epoch, cell_id)

2. # Nullifier reveals nothing about identity or location
   # (one-way hash, cannot reverse to find inputs)

3. RETURN nullifier
```

**Purpose: Sybil Resistance for Any Application**

The nullifier provides sybil resistance - ensuring one user cannot act multiple times in the same context. This is independent of what the application does with the proven geographic identity.

**Properties:**
- **Deterministic:** Same inputs always produce same nullifier
- **Unlinkable:** Different epochs produce different nullifiers (no cross-epoch tracking)
- **Binding:** User cannot produce valid proof with different cell_id
- **Application-agnostic:** Works for any downstream use case (voting, messaging, analytics, etc.)

---

## 9. Implementation Status

### 9.1 Completed Components (Updated 2025-11-18)

✅ **Multi-Layer Boundary Resolution System (PRODUCTION-READY):**
- Layer 2 (Foundation): TIGER PLACE provider operational (100% US coverage)
- Enhanced validation pipeline with geographic bounds checking
- Multi-layer coordinator with graceful fallback
- State-level caching (download once, filter many cities)

✅ **Core Implementation Files:**
- `packages/crypto/services/shadow-atlas/providers/tiger-place.ts` (448 lines)
- `packages/crypto/services/shadow-atlas/providers/multi-layer-provider.ts` (324 lines)
- `packages/crypto/services/shadow-atlas/validation/geographic-bounds-validator.ts` (380 lines)
- `packages/crypto/services/shadow-atlas/validation/deterministic-validators.ts` (enhanced with async geography)

✅ **Testing Infrastructure:**
- `test-tiger-place.ts` - PLACE provider (3 cities, 100% success)
- `test-multi-layer.ts` - Multi-layer system (5 cities, 100% coverage)
- 37/37 validation tests passing

✅ **Documentation:**
- `docs/SHADOW-ATLAS-MULTI-LAYER-IMPLEMENTATION.md` - Implementation plan
- `docs/SHADOW-ATLAS-DATA-SOURCES-RESEARCH.md` - Research findings
- `docs/SHADOW-ATLAS-STATUS-2025-11-18.md` - Production status

✅ **Data Quality:**
- Geographic bounds validation (cross-checks against PLACE boundaries)
- State coordinate validation (50 US states + DC)
- Name pattern validation (rejects state/county/transit keywords)
- District count validation (3-50 for city councils)

### 9.2 Implementation Status (Updated 2025-11-18)

**Phase 1: Foundation Layer (✅ COMPLETE)**
- [x] TIGER PLACE provider (100% US coverage, annual updates)
- [x] State-level caching infrastructure
- [x] Geographic bounds validation
- [x] Multi-layer coordinator architecture
- [x] Test suite (5 diverse cities validated)

**Phase 2: Portal Discovery Integration (🚧 IN PROGRESS)**
- [x] Enhanced validation pipeline
- [x] Geographic cross-validation against PLACE
- [ ] Re-enable portal discovery in multi-layer provider
- [ ] Test on 100 cities to measure quality improvement
- [ ] Scale to all 32,041 cities

**Phase 3: Cell Tree Architecture (⏳ PLANNED)**
- [ ] Build Census Block Group cell lookup (address → cell_id)
- [ ] Populate BoundaryMaps for all ~242K cells (14 districts each)
- [ ] Construct single Cell Tree (depth 18)
- [ ] Deploy cell tree to IPFS with epoch-based versioning
- [ ] Create cell proof generation API

**Phase 4: End-to-End Integration (⏳ PLANNED)**
- [ ] Address → geocoding → cell resolution → proof
- [ ] ZK circuit: verify cell membership, output 14 district hashes
- [ ] Browser-native ZK proof generation
- [ ] On-chain verification via CellTreeRegistry contract

### 9.3 Missing Specifications

❌ **NOT YET SPECIFIED:**
- [ ] IPFS pinning strategy for Shadow Atlas distribution
- [ ] Shadow Atlas versioning protocol
- [ ] Governance process for root updates
- [ ] International expansion protocols (UK, CA, AU)
- [ ] Disaster recovery for data source outages
- [ ] Performance SLAs (geocoding latency, proof generation time)

---

## 10. Open Questions

1. **Shadow Atlas Versioning:** How do we handle district boundary changes mid-year?
   - Proposed: Epoch-based versioning with grace periods

2. **IPFS Hosting:** Who pins Shadow Atlas data? Decentralized redundancy strategy?
   - **RESOLVED:** Unified IPFS strategy for Shadow Atlas + Identity Blobs
   - **Primary Pinning:** Pinata free tier (1 GB = 5M users at 200 bytes/blob)
   - **Redundancy:** NFT.storage (Filecoin permanence, one-time fee)
   - **Community:** Incentivize self-pinning with Phase 2 VOTER tokens
   - **Cost:** Near-zero (Pinata free tier covers millions of users)
   - **Reference:** See `docs/specs/portable-identity.md` (external repo: communique)

3. **Data Freshness:** How do we detect stale municipal GIS data?
   - Proposed: Automated quarterly checks with diff detection

4. **International Expansion:** Which countries after US launch?
   - Proposed: Canada (Phase 2), UK (Phase 3), EU (Phase 4)
   - See Section 4.3 for International Coverage scope

5. **Cicero Dependency:** What if Cicero shuts down or raises prices?
   - Proposed: Build fallback scraping infrastructure for city council data

6. **Identity Blob Storage:** Same IPFS infrastructure used for encrypted identity blobs
   - **Phase 1 (MVP):** Postgres encrypted blob storage (platform cannot decrypt)
   - **Phase 2 (optimized):** IPFS + on-chain IdentityRegistry pointers
   - **Cost reduction:** $500/month → $10 one-time for 100k users (99.97% savings)
   - **Portability:** Users own encrypted blobs, can move between platforms
   - **Architecture:** XChaCha20-Poly1305 encryption to TEE key, IPFS CIDv1 storage

---

## 11. Compliance Matrix

| Standard | Requirement | Status | Reference |
|----------|-------------|--------|-----------|
| **[IEEE1471]** | Architecture description | ✅ COMPLETE | Section 2.1 |
| **[RFC7946]** | GeoJSON format compliance | ⏸️ PARTIAL | Section 7.3 |
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
- 2.0.0 (2026-01-25): **MAJOR** - Cell-based architecture (Census Block Groups as leaves, single tree, 14 districts per cell)
- 1.2.0 (2025-12-12): Aligned with Merkle Forest architecture (variable depth tiers, multi-boundary coordination)
- 1.1.0 (2025-11-18): Multi-layer boundary resolution implementation complete
- 1.0.0 (2025-11-08): Initial specification

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/voter-protocol
