# Cell Trees Specification

> **⚠️ PHASE 2 SPECIFICATION - NOT IMPLEMENTED ⚠️**
>
> This describes a **future cell-based architecture** that does not yet exist. The current implementation uses a simpler single-district proof system. This is Phase 2 architecture requiring significant cryptographic and smart contract development before it can be deployed.

**Version:** 2.1.0
**Date:** 2026-01-25
**Status:** Draft Specification
**Implementation Status:** Phase 2 (Design Only - No Implementation)
**Scope:** Cell-based proof architecture for global civic infrastructure

**Implementation Progress:**
- ✅ Architecture specification complete
- ✅ Cell tree structure design (single tree of geographic cells)
- ✅ Full disclosure proof design (all 14 districts revealed)
- ✅ Simplified nullifier formula (no authority_hash)
- ✅ Global ontology for governance types
- ✅ Epoch management strategy
- ❌ On-chain root registry contract
- ❌ Cell tree implementation
- ❌ Full disclosure circuit (`cell_membership`)
- ❌ Epoch-based root management
- ❌ Cell data distribution pipeline

**Key Architectural Changes (v2.1):**
- Eliminated `authority_hash` parameter from circuit
- Simplified nullifier: `H(secret, campaign, epoch)` - no authority component
- Full disclosure: ALL 14 districts revealed as public outputs
- Privacy boundary: address hidden, districts public
- Anonymity set: Block Group population (~1,500 people)

**Note:** The current implementation (`district_membership/src/main.nr`) proves membership in ONE boundary only. This specification defines the cell-based architecture where a single proof reveals ALL district memberships for a location, but no implementation exists. This is a Phase 2 feature requiring significant cryptographic and smart contract development.

---

## 1. Executive Summary

Shadow Atlas uses a **single Merkle tree of geographic cells** (Census Block Groups), where each cell contains the complete set of district mappings for that location. A single address belongs to exactly ONE cell, and that cell encodes all 12-25+ boundaries (congressional district, state legislature, county, city council, school board, water district, etc.).

**Core Purpose: Geographic Identity**

The proof system establishes a user's **verified geographic identity** - the cryptographic association between a user and all the districts they belong to. This is the fundamental primitive that enables any downstream application requiring district-verified users.

**What the Proof Does:**
```
User proves: "I am a verified resident of this geographic cell"
Proof reveals: All 14 districts I belong to (my "district profile")

Purpose: Establish verified district-to-user mapping
Not: Decide what to do with that mapping (downstream concern)
```

**Core Innovation:** Full disclosure proofs that attest to ALL district memberships with a single ZK proof. The user's precise address remains hidden, but all district assignments are revealed as public outputs. This creates a **verified geographic identity** - the user's complete district profile.

**Privacy Model:**
- **HIDDEN:** User's address, specific cell, identity
- **PUBLIC:** All 14 district hashes (the user's district profile)
- **Nullifier:** H(secret, campaign, epoch) - sybil resistance for any application

**Design Principle:** Governance structures are configuration, not code. The same architecture handles US congressional districts, UK parliamentary constituencies, German Gemeinden, and Japanese prefectures.

---

## 2. Problem Statement

### 2.1 Current Limitation

The existing circuit (`district_membership/src/main.nr`) proves membership in **one** boundary:

```noir
fn main(
    merkle_root: Field,      // Single root
    nullifier: Field,
    epoch_id: Field,
    campaign_id: Field,
    leaf: Field,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    user_secret: Field,
) -> pub (Field, Field, Field, Field)  // root, nullifier, epoch, campaign
```

**Note:** The old design included `authority_hash` to enable selective disclosure (reveal only one district). The new cell-based model eliminates this parameter since ALL districts are revealed as public outputs.

### 2.2 Real-World Requirements

A US resident needs to prove their complete **geographic identity** - membership in all applicable districts:

| Slot | Boundary Type | Example | What It Proves |
|------|--------------|---------|----------------|
| 0 | Congressional District | CA-12 | User belongs to this House district |
| 1 | State Senate | CA SD-11 | User belongs to this state senate district |
| 2 | State Assembly | CA AD-17 | User belongs to this assembly district |
| 3 | County | San Francisco | User resides in this county |
| 4 | City/Place | San Francisco | User resides in this municipality |
| 5 | City Council District | SF D5 | User belongs to this council district |
| 6 | Unified School District | SFUSD | User belongs to this school district |
| 7 | Elementary School District | (null) | Not applicable in SF |
| 8 | Secondary School District | (null) | Not applicable in SF |
| 9 | Voting Precinct | PCT 3521 | User's voting precinct |
| 10 | Water District | SFPUC | User belongs to this utility district |
| 11 | Fire District | (null) | Not applicable in SF |
| 12 | Transit District | SFMTA | User belongs to this transit district |
| 13 | Special District | (varies) | Other special district memberships |

**Total: 14 slots, 9-12 typically populated per US resident.**

**The 14 district hashes together form the user's "district profile" - their verified geographic identity.**

### 2.3 Cell-Based Scale

| Country | Est. Cells (Block Groups) | Boundary Slots |
|---------|--------------------------|----------------|
| United States | ~242,000 | 14 |
| United Kingdom | ~50,000 | 8 |
| Germany | ~15,000 | 8 |
| France | ~40,000 | 8 |
| Japan | ~5,000 | 6 |
| India | ~600,000 | 10 |
| Brazil | ~10,000 | 8 |
| **Global (190 countries)** | **~1,500,000** | 6-14 |

**Key insight:** ~1.5M cells is far more manageable than ~2M boundaries, and a single proof covers ALL districts.

---

## 3. Cell Tree Architecture

### 3.1 Single Tree Structure

```
Shadow Atlas Cell Tree (depth 18, ~242K cells for US)
│
├── registry/                          # On-chain root registry
│   └── cell_tree_root.sol             # Epoch → Global Merkle Root
│
├── tree/                              # Single Merkle tree
│   └── cell_tree.bin                  # All cells as leaves
│       │
│       ├── leaf[0]:     cell_060750171001  # SF Block Group
│       │   └── districts: [CA-12, CA-SD-11, CA-AD-17, SF-County, SF-City, SF-D5, SFUSD, NULL, NULL, PCT-3521, SFPUC, NULL, SFMTA, NULL]
│       │
│       ├── leaf[1]:     cell_060750171002  # Adjacent SF Block Group
│       │   └── districts: [CA-12, CA-SD-11, CA-AD-17, SF-County, SF-City, SF-D5, SFUSD, NULL, NULL, PCT-3522, SFPUC, NULL, SFMTA, NULL]
│       │
│       ├── leaf[2]:     cell_060750172001  # Different precinct
│       │   └── districts: [CA-12, CA-SD-11, CA-AD-19, SF-County, SF-City, SF-D6, SFUSD, NULL, NULL, PCT-3601, SFPUC, NULL, SFMTA, NULL]
│       │
│       └── ... (~242,000 cells for US)
│
├── cells/                             # Cell data by country
│   ├── US/
│   │   └── cells.ndjson               # All US cells with district mappings
│   ├── GB/
│   │   └── cells.ndjson               # UK cells (Output Areas)
│   ├── DE/
│   │   └── cells.ndjson               # German cells (Gemeinden)
│   └── ... (190 countries)
│
└── indices/                           # Lookup optimization
    ├── geocode_index.cbor             # (lat,lon) → cell_id
    └── address_index.cbor             # normalized_address → cell_id
```

### 3.2 Cell Leaf Structure

Each leaf in the tree encodes a geographic cell and its complete district mapping:

```typescript
/**
 * Cell leaf structure
 *
 * leaf = H(cell_id, identity_commitment, boundary_commitment)
 *
 * Where:
 *   cell_id = Census Block Group FIPS code (e.g., "060750171001")
 *   identity_commitment = H(address_hash, user_secret)
 *   boundary_commitment = H(district_hashes[0..13])
 */
interface CellLeaf {
  cell_id: string;                    // Census Block Group identifier
  identity_commitment: Field;         // H(address_hash, user_secret)
  boundary_commitment: Field;         // H(all 14 district hashes)
  district_hashes: Field[14];         // Individual district hashes
}

/**
 * District slot assignments (US)
 */
const DISTRICT_SLOTS = {
  CONGRESSIONAL: 0,        // US House district
  STATE_SENATE: 1,         // State upper chamber
  STATE_HOUSE: 2,          // State lower chamber
  COUNTY: 3,               // County
  CITY: 4,                 // City/Place
  COUNCIL: 5,              // City council/ward
  SCHOOL_UNIFIED: 6,       // Unified school district
  SCHOOL_ELEMENTARY: 7,    // Elementary school district
  SCHOOL_SECONDARY: 8,     // Secondary school district
  VOTING_PRECINCT: 9,      // Voting precinct
  WATER: 10,               // Water district
  FIRE: 11,                // Fire district
  TRANSIT: 12,             // Transit district
  SPECIAL: 13,             // Other special district
} as const;

/**
 * NULL_HASH for empty slots
 * Used when a cell doesn't have a particular district type
 */
const NULL_HASH: Field = poseidon2Hash("NULL_DISTRICT");
```

### 3.3 Cell Identifier Schema

```typescript
/**
 * Cell identifier based on Census Block Groups
 *
 * US Format: {state_fips}{county_fips}{tract}{block_group}
 *   - state_fips: 2 digits
 *   - county_fips: 3 digits
 *   - tract: 6 digits
 *   - block_group: 1 digit
 *
 * Examples:
 *   060750171001  (San Francisco, CA - Tract 0171.00, Block Group 1)
 *   484391234002  (Houston, TX - Tract 1234.00, Block Group 2)
 *
 * International cells use country-specific geographic units:
 *   GB: Output Areas (OA)
 *   DE: Gemeindeschlüssel
 *   FR: IRIS codes
 */
export interface CellId {
  readonly country: string;      // ISO 3166-1 alpha-2
  readonly code: string;         // Country-specific cell code
}

/**
 * District hash computation
 *
 * district_hash = H(country, layer, jurisdiction, id)
 *
 * Examples:
 *   H("US", "congress", "CA", "12")     → CA-12 hash
 *   H("US", "state-senate", "CA", "11") → CA SD-11 hash
 *   H("NULL_DISTRICT")                  → NULL_HASH for empty slots
 */
function computeDistrictHash(
  country: string,
  layer: BoundaryLayer,
  jurisdiction: string,
  id: string
): Field {
  return poseidon2Hash(country, layer, jurisdiction, id);
}

export type BoundaryLayer =
  // Federal/National
  | 'congress' | 'parliament' | 'bundestag' | 'diet' | 'duma'
  // Regional/State
  | 'state-senate' | 'state-house' | 'landtag' | 'provincial'
  // County/District
  | 'county' | 'kreis' | 'prefecture' | 'department'
  // Municipal
  | 'city' | 'place' | 'commune' | 'gemeinde' | 'municipality'
  | 'council' | 'ward' | 'precinct'
  // Special Districts
  | 'school-unified' | 'school-elem' | 'school-secondary'
  | 'water' | 'fire' | 'transit' | 'library' | 'hospital'
  // Electoral
  | 'voting-precinct' | 'polling-district';
```

### 3.4 Tree Parameters

The cell tree uses a fixed depth based on the total number of cells:

| Country | Est. Cells | Tree Depth | Capacity | Headroom |
|---------|-----------|------------|----------|----------|
| United States | ~242,000 | 18 | ~262K | 8% |
| Global (all countries) | ~1.5M | 21 | ~2M | 33% |

**US Cell Tree Parameters:**

```typescript
const US_CELL_TREE = {
  depth: 18,                    // Fixed depth for all US cells
  capacity: 262_144,            // 2^18 leaves
  estimated_cells: 242_000,     // Census Block Groups
  district_slots: 14,           // Fixed slot count
  leaf_size: 32,                // bytes (single Field)
};
```

**Global Cell Tree Parameters:**

```typescript
const GLOBAL_CELL_TREE = {
  depth: 21,                    // Accommodates all countries
  capacity: 2_097_152,          // 2^21 leaves
  estimated_cells: 1_500_000,   // All geographic cells worldwide
  district_slots: 14,           // Fixed slot count (max across all countries)
  leaf_size: 32,                // bytes (single Field)
};
```

**Key Simplification:** Unlike the old forest model with variable depths per boundary type, the cell tree uses ONE fixed depth. This eliminates depth-class complexity in the circuit.

---

## 4. Full Disclosure Proof Architecture

### 4.1 Design Philosophy

The cell-based model uses **full disclosure proofs**: a single proof that reveals ALL district memberships for a location. This creates the user's **verified geographic identity**.

**Core Purpose: District-to-User Mapping**

The proof establishes a cryptographic association between a verified user and all their districts. This is the fundamental primitive - applications then use this proven identity for their specific purposes.

**Old Model (Selective Disclosure):**
- User chooses which districts to reveal
- Multiple proofs for multiple districts
- `authority_hash` parameter enabled targeting

**New Model (Full Disclosure - Geographic Identity):**
- ALL 14 district hashes revealed as public outputs
- Single proof creates complete "district profile"
- User's geographic identity is fully established
- Privacy preserved: address/cell hidden, district memberships public

**What Applications Can Do With Verified Geographic Identity:**
- **Civic engagement:** Route messages to correct representatives
- **Analytics/PR:** Aggregate district-level sentiment data
- **Voter verification:** Confirm eligibility for district-specific actions
- **Research:** Geographic demographic analysis with privacy
- **Governance:** Enable district-scoped voting or polling

### 4.2 Full Disclosure Circuit

```noir
// cell_membership/src/main.nr

global TREE_DEPTH: u32 = 18;       // Fixed depth for US cell tree
global DISTRICT_SLOTS: u32 = 14;   // Fixed number of district slots

fn main(
    // Public inputs
    merkle_root: Field,
    nullifier: Field,
    epoch_id: Field,
    campaign_id: Field,
    district_hashes: [Field; DISTRICT_SLOTS],  // ALL districts revealed

    // Private inputs
    leaf: Field,
    merkle_path: [Field; TREE_DEPTH],
    leaf_index: u32,
    user_secret: Field,
    cell_id: Field,
    boundary_commitment: Field,
) -> pub (
    Field,                      // merkle_root
    Field,                      // nullifier
    Field,                      // epoch_id
    Field,                      // campaign_id
    [Field; DISTRICT_SLOTS],    // district_hashes (ALL revealed)
) {
    // 1. Verify Merkle membership
    let computed_root = compute_merkle_root(leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    // 2. Verify leaf structure: leaf = H(cell_id, identity_commitment, boundary_commitment)
    let identity_commitment = poseidon2_hash([user_secret, cell_id]);
    let computed_leaf = poseidon2_hash([cell_id, identity_commitment, boundary_commitment]);
    assert(computed_leaf == leaf);

    // 3. Verify boundary_commitment = H(district_hashes[0..13])
    let computed_boundary = poseidon2_hash(district_hashes);
    assert(computed_boundary == boundary_commitment);

    // 4. Compute nullifier: H(secret, campaign, epoch)
    // NOTE: Simplified nullifier - no authority_hash needed
    let computed_nullifier = poseidon2_hash([user_secret, campaign_id, epoch_id]);
    assert(computed_nullifier == nullifier);

    (merkle_root, nullifier, epoch_id, campaign_id, district_hashes)
}
```

### 4.3 Proof Characteristics

```
Full Disclosure Proof:
  Public Inputs:  [merkle_root, nullifier, epoch_id, campaign_id, district_hashes[14]]
  Private Inputs: [leaf, merkle_path[18], leaf_index, user_secret, cell_id, boundary_commitment]
  Constraints:    ~5,000 (depth 18 + 14 hash verifications)
  Proof Size:     ~2 KB
  Verify Gas:     ~350k
```

**Comparison to Old Model:**

| Aspect | Old (Forest) | New (Cell) |
|--------|-------------|------------|
| Proofs per user action | 1-4 (per boundary) | 1 (covers all) |
| Districts revealed | 1 per proof | 14 per proof |
| Total gas (4 districts) | ~1.2M (4 proofs) | ~350k (1 proof) |
| Nullifier scope | Per-boundary | Campaign-only |
| Circuit complexity | Variable depth | Fixed depth |

### 4.4 Nullifier Design

The simplified nullifier formula eliminates the `authority_hash` parameter:

```typescript
// OLD: nullifier = H(secret, campaign, authority, epoch)
// NEW: nullifier = H(secret, campaign, epoch)

function computeNullifier(
  userSecret: Field,
  campaignId: Field,
  epochId: Field
): Field {
  return poseidon2Hash(userSecret, campaignId, epochId);
}
```

**Purpose: Sybil Resistance for Any Application**

The nullifier provides sybil resistance - ensuring one user cannot act multiple times in the same context. This is independent of what the application does with the proven geographic identity.

**Implications:**
- One nullifier per campaign per epoch (regardless of which districts)
- Prevents duplicate actions in same campaign context
- Applications define what "campaign" means for their use case
- Simpler sybil prevention logic

---

## 5. On-Chain Registry Architecture

### 5.1 Simplified Cell Tree Registry

The cell-based model dramatically simplifies the on-chain registry: ONE root instead of per-boundary roots.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CellTreeRegistry
 * @notice Manages the single Merkle root for the Shadow Atlas cell tree
 * @dev Epoch-based versioning with governance timelocks
 */
contract CellTreeRegistry {

    // ============ State ============

    /// @notice Current epoch (increments on boundary updates)
    uint256 public currentEpoch;

    /// @notice Current cell tree root
    bytes32 public cellTreeRoot;

    /// @notice Epoch metadata
    struct EpochInfo {
        uint256 activatedAt;
        bytes32 cellTreeRoot;     // Single root for entire cell tree
        string ipfsCid;           // Cell data on IPFS
        uint256 cellCount;        // Number of cells in tree
        uint8 treeDepth;          // Tree depth (18 for US, 21 for global)
    }
    mapping(uint256 => EpochInfo) public epochs;

    /// @notice Historical roots for grace period
    mapping(bytes32 => bool) public validRoots;

    /// @notice Grace period for old roots (allows proof generation during transitions)
    uint256 public constant ROOT_GRACE_PERIOD = 7 days;

    // ============ Events ============

    event EpochAdvanced(
        uint256 indexed epoch,
        bytes32 cellTreeRoot,
        string ipfsCid,
        uint256 cellCount
    );

    event RootDeprecated(
        bytes32 indexed oldRoot,
        uint256 indexed epoch
    );

    // ============ Views ============

    /**
     * @notice Check if a merkle root is valid
     * @param merkleRoot Root to validate
     */
    function isValidRoot(bytes32 merkleRoot) external view returns (bool) {
        return validRoots[merkleRoot];
    }

    /**
     * @notice Get current tree depth
     */
    function getTreeDepth() external view returns (uint8) {
        return epochs[currentEpoch].treeDepth;
    }

    /**
     * @notice Get epoch info
     */
    function getEpochInfo(uint256 epoch) external view returns (
        uint256 activatedAt,
        bytes32 root,
        string memory ipfsCid,
        uint256 cellCount,
        uint8 treeDepth
    ) {
        EpochInfo storage info = epochs[epoch];
        return (
            info.activatedAt,
            info.cellTreeRoot,
            info.ipfsCid,
            info.cellCount,
            info.treeDepth
        );
    }

    // ============ Governance Functions ============

    /**
     * @notice Advance to new epoch with updated cell tree
     * @dev Requires governance timelock
     */
    function advanceEpoch(
        bytes32 newCellTreeRoot,
        string calldata ipfsCid,
        uint256 cellCount,
        uint8 treeDepth
    ) external onlyGovernance {
        bytes32 oldRoot = cellTreeRoot;

        currentEpoch++;
        cellTreeRoot = newCellTreeRoot;
        validRoots[newCellTreeRoot] = true;

        // Store epoch metadata
        epochs[currentEpoch] = EpochInfo({
            activatedAt: block.timestamp,
            cellTreeRoot: newCellTreeRoot,
            ipfsCid: ipfsCid,
            cellCount: cellCount,
            treeDepth: treeDepth
        });

        emit EpochAdvanced(
            currentEpoch,
            newCellTreeRoot,
            ipfsCid,
            cellCount
        );

        // Schedule old root deprecation (handled by keeper)
        emit RootDeprecated(oldRoot, currentEpoch - 1);
    }

    /**
     * @notice Deprecate an old root after grace period
     * @dev Called by keeper after ROOT_GRACE_PERIOD
     */
    function deprecateRoot(bytes32 oldRoot, uint256 oldEpoch) external {
        require(
            block.timestamp >= epochs[oldEpoch].activatedAt + ROOT_GRACE_PERIOD,
            "Grace period not elapsed"
        );
        validRoots[oldRoot] = false;
    }
}
```

### 5.2 Contract Comparison

| Aspect | Old (Forest Registry) | New (Cell Registry) |
|--------|----------------------|---------------------|
| State variables | ~5 mappings | 2 mappings |
| Root storage | O(boundaries) ~300K | O(1) single root |
| Epoch update | Loop over boundaries | Single assignment |
| Gas per epoch | ~500K+ | ~50K |
| Verification | Lookup per boundary | Single comparison |

---

## 6. Data Distribution Architecture

### 6.1 IPFS Structure for Cell Data

```
Shadow Atlas IPFS Structure (Cell-Based)
│
├── /epoch-{N}/                        # Epoch root directory
│   ├── manifest.json                  # Epoch metadata
│   │   {
│   │     "epoch": 42,
│   │     "cellTreeRoot": "0x...",
│   │     "treeDepth": 18,
│   │     "cellCount": 242000,
│   │     "districtSlots": 14,
│   │     "countries": ["US", "GB", "DE", ...]
│   │   }
│   │
│   ├── cell-tree.bin                  # Complete Merkle tree (serialized)
│   │
│   ├── /US/                           # Country shard
│   │   ├── cells.ndjson               # All US cells with district mappings
│   │   │   {"cell_id": "060750171001", "districts": ["CA-12", "CA-SD-11", ...]}
│   │   │   {"cell_id": "060750171002", "districts": ["CA-12", "CA-SD-11", ...]}
│   │   │   ...
│   │   ├── cells.ndjson.gz            # Compressed version
│   │   └── index.cbor                 # Cell ID → leaf index mapping
│   │
│   ├── /GB/
│   │   ├── cells.ndjson
│   │   └── index.cbor
│   │
│   ├── /DE/
│   │   ├── cells.ndjson
│   │   └── index.cbor
│   │
│   └── ... (190 countries)
│
├── /indices/                          # Lookup indices
│   ├── geocode-index.cbor             # (lat,lon) → cell_id
│   └── address-index.cbor             # normalized_address → cell_id
│
└── /latest -> /epoch-{N}              # Symlink to current epoch
```

### 6.2 Client Fetching Strategy

```typescript
interface CellTreeClient {
  /**
   * Fetch cell data on-demand
   *
   * Strategy:
   * 1. Resolve address → cell_id via geocoding
   * 2. Check IndexedDB cache for cell data
   * 3. Fetch from IPFS gateway if miss
   * 4. Verify against on-chain root
   * 5. Cache for future use
   */
  async getCell(cellId: string): Promise<CellData>;

  /**
   * Resolve address to cell
   */
  async resolveAddressToCell(
    address: NormalizedAddress
  ): Promise<CellId>;

  /**
   * Generate full disclosure proof
   *
   * Single proof reveals ALL districts for the user's cell.
   */
  async generateProof(
    address: NormalizedAddress,
    campaignId: Field,
    epochId: Field,
    userSecret: Field
  ): Promise<FullDisclosureProof>;

  /**
   * Verify district membership from proof outputs
   */
  verifyDistrictMembership(
    proof: FullDisclosureProof,
    targetDistrict: string,
    slotIndex: number
  ): boolean;
}

interface CellData {
  cell_id: string;
  district_hashes: Field[14];
  district_names: string[14];  // Human-readable (for display)
  leaf_index: number;
  merkle_path: Field[];
}
```

### 6.3 Storage Estimates (Cell-Based)

**Cell Tree Storage:**

| Country | Cells | Tree Depth | Tree Size | Cell Data |
|---------|-------|------------|-----------|-----------|
| US | ~242,000 | 18 | ~8 MB | ~50 MB |
| UK | ~50,000 | 16 | ~2 MB | ~10 MB |
| Germany | ~15,000 | 14 | ~500 KB | ~3 MB |
| France | ~40,000 | 16 | ~1.5 MB | ~8 MB |
| **Global** | ~1.5M | 21 | ~64 MB | ~300 MB |

**Storage Comparison:**

| Model | US Storage | Global Storage | IPFS Cost |
|-------|-----------|----------------|-----------|
| Old (Forest) | ~500 GB | ~1.5 TB | $350/month |
| **New (Cells)** | **~60 MB** | **~400 MB** | **~$0** (free tier) |

**Why so much smaller?**
- Old: One tree per boundary × 300K boundaries = massive duplication
- New: One tree with all cells = no duplication
- Cell data is compact: 14 district hashes per cell
- Merkle paths are recomputed client-side, not stored

**IPFS Pinning Cost:**
- Pinata free tier: 1 GB (sufficient for US + EU)
- NFT.storage: $0 (free perpetual storage)
- Self-hosted: Negligible (~$5/month)

---

## 7. International Scaling

### 7.1 Country Cell Provider Interface

```typescript
/**
 * Country-specific cell provider
 *
 * Each country implements this interface to map their
 * geographic units (cells) to district assignments.
 */
export interface CountryCellProvider {
  readonly countryCode: string;  // ISO 3166-1 alpha-2
  readonly countryName: string;

  /**
   * Cell unit type for this country
   *
   * Examples:
   *   US: Census Block Groups
   *   UK: Output Areas (OA)
   *   DE: Gemeindeschlüssel
   *   FR: IRIS codes
   */
  readonly cellUnitType: string;

  /**
   * Number of district slots used by this country
   */
  readonly districtSlotCount: number;

  /**
   * Slot mapping: which district types go in which slots
   */
  readonly slotMapping: Map<number, BoundaryLayer>;

  /**
   * Data sources for cells and boundaries
   */
  readonly dataSources: DataSource[];

  /**
   * Resolve cell for an address
   */
  resolveCell(
    address: Address,
    coords: Coordinates
  ): Promise<CellId>;

  /**
   * Get all districts for a cell
   */
  getCellDistricts(cellId: CellId): Promise<string[14]>;

  /**
   * Download all cells with district mappings
   */
  downloadCells(options?: DownloadOptions): Promise<CellCollection>;

  /**
   * Build cell data for tree inclusion
   */
  buildCellLeaves(
    cells: CellCollection
  ): Promise<CellLeaf[]>;
}
```

### 7.2 Country Slot Configurations

Each country maps their governance layers to the 14 district slots:

```typescript
// US Slot Configuration (14 slots, all used)
const US_SLOTS: SlotConfig = {
  cellUnit: 'Census Block Group',
  cellCount: 242_000,
  slots: [
    { index: 0, layer: 'congress', count: 435 },
    { index: 1, layer: 'state-senate', count: 1972 },
    { index: 2, layer: 'state-house', count: 5411 },
    { index: 3, layer: 'county', count: 3143 },
    { index: 4, layer: 'city', count: 32041 },
    { index: 5, layer: 'council', count: 50000 },
    { index: 6, layer: 'school-unified', count: 10526 },
    { index: 7, layer: 'school-elementary', count: 4631 },
    { index: 8, layer: 'school-secondary', count: 469 },
    { index: 9, layer: 'voting-precinct', count: 178000 },
    { index: 10, layer: 'water', count: 3500 },
    { index: 11, layer: 'fire', count: 2400 },
    { index: 12, layer: 'transit', count: 800 },
    { index: 13, layer: 'special', count: 8000 },
  ],
};

// UK Slot Configuration (8 slots used, 6 NULL)
const UK_SLOTS: SlotConfig = {
  cellUnit: 'Output Area',
  cellCount: 50_000,
  slots: [
    { index: 0, layer: 'parliament', count: 650 },       // Westminster
    { index: 1, layer: 'scottish-parliament', count: 129 }, // Devolved
    { index: 2, layer: 'senedd', count: 60 },            // Wales
    { index: 3, layer: 'council', count: 8000 },         // Local authority
    { index: 4, layer: 'ward', count: 8000 },            // Electoral ward
    { index: 5, layer: 'parish', count: 10000 },         // Civil parish
    { index: 6, layer: 'NULL', count: 0 },               // Unused
    { index: 7, layer: 'NULL', count: 0 },
    // ... slots 8-13 also NULL (filled with NULL_HASH)
  ],
};

// German Slot Configuration (8 slots used)
const DE_SLOTS: SlotConfig = {
  cellUnit: 'Gemeindeschluessel',
  cellCount: 15_000,
  slots: [
    { index: 0, layer: 'bundestag', count: 299 },        // Federal
    { index: 1, layer: 'landtag', count: 1800 },         // State
    { index: 2, layer: 'kreis', count: 401 },            // County
    { index: 3, layer: 'gemeinde', count: 10800 },       // Municipal
    { index: 4, layer: 'bezirk', count: 400 },           // District
    { index: 5, layer: 'NULL', count: 0 },               // Unused
    // ... remaining slots NULL (filled with NULL_HASH)
  ],
};
```

### 7.3 Data Source Registry

```typescript
/**
 * Global registry of authoritative data sources
 *
 * Priority: Government > Electoral Commission > Stats Office > OSM
 */
const DATA_SOURCES: Map<string, DataSource[]> = new Map([
  ['US', [
    {
      layer: 'congress',
      provider: 'census-tiger',
      url: 'https://www2.census.gov/geo/tiger/',
      format: 'shapefile',
      license: 'public-domain',
      updateFrequency: 'biennial',
    },
    {
      layer: 'state-senate',
      provider: 'census-tiger',
      url: 'https://www2.census.gov/geo/tiger/',
      format: 'shapefile',
      license: 'public-domain',
      updateFrequency: 'biennial',
    },
    // ... all US layers
  ]],

  ['GB', [
    {
      layer: 'parliament',
      provider: 'ordnance-survey',
      url: 'https://osdatahub.os.uk/',
      format: 'geopackage',
      license: 'open-government',
      updateFrequency: 'event-driven',  // Boundary Commission reviews
    },
    {
      layer: 'council',
      provider: 'ordnance-survey',
      url: 'https://osdatahub.os.uk/',
      format: 'geopackage',
      license: 'open-government',
      updateFrequency: 'annual',
    },
  ]],

  ['DE', [
    {
      layer: 'bundestag',
      provider: 'bundeswahlleiter',
      url: 'https://www.bundeswahlleiter.de/',
      format: 'shapefile',
      license: 'dl-de-by-2.0',
      updateFrequency: 'quadrennial',
    },
    {
      layer: 'gemeinde',
      provider: 'bkg',
      url: 'https://gdz.bkg.bund.de/',
      format: 'shapefile',
      license: 'dl-de-by-2.0',
      updateFrequency: 'annual',
    },
  ]],

  // ... 190 countries
]);
```

---

## 8. Cost Model (Cell-Based)

### 8.1 Data Acquisition Costs

| Source Type | Data Type | Cost | Notes |
|-------------|-----------|------|-------|
| Census TIGER (US) | Block Groups + Boundaries | $0 | Public domain |
| Ordnance Survey (UK) | Output Areas + Boundaries | $0 | Open Government License |
| BKG (Germany) | Gemeinden + Boundaries | $0 | Open data |
| IGN (France) | IRIS + Boundaries | $0 | Open data |
| Statistics Canada | Dissemination Areas | $0 | Open data |
| OpenStreetMap | Admin boundaries | $0 | ODbL |
| **Total Data** | ~1.5M cells | **$0** | |

### 8.2 Infrastructure Costs (Cell-Based)

| Component | Specification | Monthly Cost |
|-----------|--------------|--------------|
| IPFS Pinning (Pinata) | 1 GB (free tier) | $0 |
| CDN (Cloudflare R2) | 100 GB bandwidth | $0 (free tier) |
| Build Pipeline (GitHub Actions) | 10k minutes | $0 (free tier) |
| Monitoring (Grafana Cloud) | Basic | $0 (free tier) |
| **Total Infrastructure** | | **$0/month** |

**Cell-based model eliminates infrastructure costs!**
- Old model: ~500 GB (US) to 1.5 TB (global) = $150-$440/month
- New model: ~60 MB (US) to 400 MB (global) = $0/month (free tier)

### 8.3 Engineering Costs (One-Time)

| Phase | Scope | Hours | Cost @ $150/hr |
|-------|-------|-------|----------------|
| Phase 1 | US Cell Tree + Circuit | 200 | $30k |
| Phase 2 | G7 Cell Mappings | 120 | $18k |
| Phase 3 | OECD + BRICS (30) | 150 | $22.5k |
| Phase 4 | Global (150) | 100 | $15k |
| **Total Engineering** | | **570 hrs** | **$85.5k** |

*Engineering costs halved due to simpler single-tree architecture.*

### 8.4 Comparison to Commercial APIs

| Provider | Cost per Lookup | 1M Lookups/month | Shadow Atlas (Cell) |
|----------|----------------|------------------|---------------------|
| Google Civic | $0.007 | $7,000 | $0 |
| Mapbox Boundaries | $0.005 | $5,000 | $0 |
| Cicero | $0.03 | $30,000 | $0 |
| **Shadow Atlas (US)** | **$0** | **$0** | **$0** (free tier) |
| **Shadow Atlas (Global)** | **$0** | **$0** | **$0** (free tier) |

**Break-even:** Immediate - no infrastructure costs to recover

---

## 9. Migration Path

### 9.1 From Per-Boundary Forest to Cell Tree

1. **Phase 1 (Legacy):** Single `district_membership` circuit, one boundary per proof
2. **Phase 2 (Current):** Design cell tree architecture (this spec)
3. **Phase 3 (Next):** Implement `cell_membership` circuit with full disclosure
4. **Phase 4:** Add international cell mappings (UK, DE, FR, CA)
5. **Phase 5:** Global rollout with unified cell schema

### 9.2 Circuit Evolution

```
v1.0 (legacy):   district_membership  -> 1 boundary proof (selective disclosure)
v2.0 (current):  cell_membership      -> 14 districts (full disclosure)
v3.0 (future):   cell_membership_int  -> 14 districts, international cell support
```

### 9.3 Smart Contract Evolution

```solidity
// v1 (legacy): Per-boundary root mapping (obsolete)
mapping(bytes32 => bool) public boundaryRoots;

// v2 (current): Single cell tree root per epoch
bytes32 public cellTreeRoot;
mapping(uint256 => bytes32) public epochRoots;

// v3 (future): Multi-country cell registries
mapping(bytes3 => bytes32) public countryRoots;  // ISO country -> root
```

---

## 10. Security Considerations

### 10.1 Threat Model

| Threat | Impact | Mitigation |
|--------|--------|------------|
| Root poisoning | Fake citizens | Governance timelock + guardian veto |
| Stale data | Wrong district assignment | Quarterly refresh + diff monitoring |
| IPFS unavailability | Users can't generate proofs | Multi-gateway fallback + local cache |
| Epoch desync | Proofs rejected | Grace period (old epoch valid 7 days) |

### 10.2 Data Integrity

- **Single Cell Tree Root:** One cryptographic commitment per country per epoch
- **Leaf Binding:** Each cell leaf = H(cell_id, identity_commitment, boundary_commitment)
- **IPFS CID:** Content-addressed storage ensures data integrity
- **On-chain registry:** Smart contract provides tamper-evident single root storage

### 10.3 Privacy Model (Full Disclosure)

**What is HIDDEN:**
- User's precise address
- Specific cell (Census Block Group)
- User identity (beyond proof of residency)

**What is PUBLIC (revealed as proof outputs):**
- All 14 district hashes
- Campaign ID and epoch
- Nullifier (linkable within same campaign)

**Anonymity Set:**
- **Size:** Block Group population (~1,500 people average)
- **Trade-off:** Smaller than district-level anonymity, but enables full disclosure
- **Mitigation:** Addresses within same Block Group are indistinguishable

**Nullifier Privacy:**
- Formula: H(user_secret, campaign_id, epoch_id)
- Same user, same campaign = same nullifier (prevents double-voting)
- Different campaign = different nullifier (unlinkable across campaigns)
- No authority component (simplified from old model)

---

## 11. Implementation Checklist

### Phase 1: Foundation (Current)
- [x] Single-boundary circuit (`district_membership`) - legacy
- [x] US TIGER PLACE provider
- [x] Multi-layer coordinator
- [x] Geographic validation pipeline
- [x] Cell tree architecture specification

### Phase 2: Cell Tree Implementation (Next)
- [ ] `cell_membership` circuit (full disclosure, 14 districts)
- [ ] Cell tree builder (Census Block Groups)
- [ ] District mapping per cell (14 slots)
- [ ] `CellTreeRegistry` contract (single root per epoch)
- [ ] IPFS cell data distribution
- [ ] Address-to-cell resolver

### Phase 3: International
- [ ] UK cells (Output Areas)
- [ ] Germany cells (Gemeindeschluessel)
- [ ] France cells (IRIS)
- [ ] Canada cells (Dissemination Areas)

### Phase 4: Global
- [ ] Unified cell schema for 190 countries
- [ ] OpenStreetMap-derived cells for sparse regions
- [ ] Community contribution system

---

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/voter-protocol

---

## Cell Model Addendum

### 1. Purpose: Geographic Identity Infrastructure

Shadow Atlas builds the infrastructure for **geographic identity proofs**. Its purpose is to map addresses to their complete district profile, enabling users to prove "I belong to these 14 districts."

This addendum specifies the transition from **district-centric** to **cell-centric** data model.

### 1.1 Before (District-Centric)

```
District Tree (CA-12)          District Tree (CA-SD-11)
├── leaf: address_1_hash       ├── leaf: address_1_hash
├── leaf: address_2_hash       ├── leaf: address_2_hash
└── leaf: address_n_hash       └── leaf: address_n_hash

Problem: Same address appears in multiple trees
         User proves membership in one district at a time
         Incomplete geographic identity per proof
```

### 1.2 After (Cell-Centric)

```
Geographic Cell Tree (depth 18, ~242K cells)
├── cell_060750171001: {congressional: "CA-12", state_senate: "CA-SD-11", ...}
├── cell_060750171002: {congressional: "CA-12", state_senate: "CA-SD-11", ...}
└── cell_060750234001: {congressional: "CA-13", state_senate: "CA-SD-12", ...}

Benefit: Single tree contains complete district profile per cell
         User registration creates their complete geographic identity
         One proof reveals membership in ALL 14 districts
```

---

## 2. Geographic Cell Definition

A geographic cell represents a location's **complete district profile** - all 14 districts that any address in that cell belongs to. When a user registers at an address, they inherit the cell's district profile as their **geographic identity**.

### 2.1 Cell Identifier: Census Block Group

**Why Census Block Groups?**
- US Census provides complete coverage (~242,000 block groups)
- Pre-computed mappings to all governance boundaries
- Stable identifiers (GEOID format)
- Sufficient granularity for district assignment (avg ~1,200 people)

**GEOID Structure:**
```
060750171001234
│││││││││└────── Block (within block group)
││││││└──────── Block Group (0-9)
│││└──────────── Census Tract (6 digits)
││└────────────── County (3 digits)
└──────────────── State (2 digits)
```

For cells, we use **Block Group level** (first 12 digits):
```
060750171001
│││││││││└── Block Group
││││││└───── Tract
│││└──────── County (San Francisco = 075)
└──────────── State (California = 06)
```

### 2.2 Cell Data Structure

> **Privacy Model:** The cell stores the user's complete district profile (geographic identity). On proof generation, ALL 14 district hashes become **public outputs** - this IS the user's geographic identity. The address itself (which maps to cell_id) remains private. This is acceptable because Census Block Groups contain 600-3000 people - revealing district membership does not identify any individual address.

```typescript
interface GeographicCell {
  // Identifier
  cellId: string;                    // Block Group GEOID: "060750171001"
  centroid: [number, number];        // [lat, lon] for spatial lookup

  // Complete district profile (becomes user's geographic identity)
  // NOTE: All boundaries become PUBLIC proof outputs - this IS the identity
  boundaries: {
    // Federal (100% coverage from Census)
    congressional: string;           // "CA-12"
    senateFederal: string;           // "CA" (state = 2 senators)

    // State Legislature (100% coverage from Census)
    stateSenate: string;             // "CA-SD-11"
    stateHouse: string;              // "CA-AD-17"

    // County (100% coverage from Census)
    county: string;                  // "06075"
    countyName: string;              // "San Francisco"

    // Municipal (from Census PLACE, may be null for unincorporated)
    city?: string;                   // "0667000" (FIPS code)
    cityName?: string;               // "San Francisco"

    // City Council (from municipal GIS, may be null)
    cityCouncil?: string;            // "SF-D5"

    // School Districts (from Census)
    schoolUnified?: string;          // "0634410"
    schoolElementary?: string;
    schoolSecondary?: string;

    // Voting (from Census VTD)
    votingPrecinct?: string;         // "060750001"

    // Special Districts (when available)
    waterDistrict?: string;
    fireDistrict?: string;
    transitDistrict?: string;
  };

  // Merkle data
  boundaryCommitment: string;        // H(concat of all boundary hashes) - simple commitment
  leafHash?: string;                 // Computed when user registers

  // Provenance
  sources: {
    congressional: "census-tiger-2024";
    stateSenate: "census-tiger-2024";
    cityCouncil?: "sf-opendata-2024";
    // ...
  };
  lastUpdated: string;               // ISO timestamp
}
```

---

## 3. Data Acquisition Pipeline

### 3.1 Census TIGER Relationship Files

**Primary Source:** Census Bureau TIGER/Line Relationship Files

```bash
# Download block group shapefiles
wget https://www2.census.gov/geo/tiger/TIGER2024/BG/tl_2024_06_bg.zip

# Download relationship files
wget https://www2.census.gov/geo/tiger/TIGER2024/RELFILES/tl_2024_06_bg_cd.txt
wget https://www2.census.gov/geo/tiger/TIGER2024/RELFILES/tl_2024_06_bg_sldu.txt
wget https://www2.census.gov/geo/tiger/TIGER2024/RELFILES/tl_2024_06_bg_sldl.txt
wget https://www2.census.gov/geo/tiger/TIGER2024/RELFILES/tl_2024_06_bg_county.txt
wget https://www2.census.gov/geo/tiger/TIGER2024/RELFILES/tl_2024_06_bg_place.txt
wget https://www2.census.gov/geo/tiger/TIGER2024/RELFILES/tl_2024_06_bg_unsd.txt
```

**Relationship File Format:**
```csv
GEOID_BG,GEOID_CD,AREALAND
060750101001,0612,1234567
060750101002,0612,2345678
060750201001,0611,3456789
```

### 3.2 ETL Pipeline

```typescript
// scripts/build-cell-database.ts

interface CellBuilder {
  /**
   * Build complete cell database from Census TIGER files
   */
  async buildCellDatabase(): Promise<Map<string, GeographicCell>> {
    const cells = new Map<string, GeographicCell>();

    // 1. Load block group geometries (for centroids)
    const blockGroups = await loadBlockGroupShapefiles();

    // 2. Load all relationship files
    const relations = {
      congressional: await loadRelationFile('bg_cd'),
      stateSenate: await loadRelationFile('bg_sldu'),
      stateHouse: await loadRelationFile('bg_sldl'),
      county: await loadRelationFile('bg_county'),
      place: await loadRelationFile('bg_place'),
      schoolUnified: await loadRelationFile('bg_unsd'),
      votingPrecinct: await loadRelationFile('bg_vtd'),
    };

    // 3. Build cell for each block group
    for (const [geoid, geometry] of blockGroups) {
      const cell: GeographicCell = {
        cellId: geoid,
        centroid: computeCentroid(geometry),
        boundaries: {
          congressional: formatCongressionalDistrict(relations.congressional.get(geoid)),
          senateFederal: geoid.slice(0, 2), // State FIPS = 2 senators
          stateSenate: formatStateSenate(relations.stateSenate.get(geoid)),
          stateHouse: formatStateHouse(relations.stateHouse.get(geoid)),
          county: relations.county.get(geoid),
          city: relations.place.get(geoid),
          schoolUnified: relations.schoolUnified.get(geoid),
          votingPrecinct: relations.votingPrecinct.get(geoid),
        },
        sources: {
          congressional: 'census-tiger-2024',
          stateSenate: 'census-tiger-2024',
          stateHouse: 'census-tiger-2024',
          county: 'census-tiger-2024',
          city: 'census-tiger-2024',
          schoolUnified: 'census-tiger-2024',
          votingPrecinct: 'census-tiger-2024',
        },
        lastUpdated: new Date().toISOString(),
      };

      // 4. Compute boundary commitment (simple hash of all boundaries)
      const { commitment } = await computeBoundaryHashes(cell.boundaries);
      cell.boundaryCommitment = commitment;

      cells.set(geoid, cell);
    }

    // 5. Augment with city council data (from municipal GIS)
    await augmentWithCityCouncilData(cells);

    return cells;
  }
}
```

### 3.3 City Council Augmentation

Census doesn't provide city council districts. These are acquired via:

1. **Municipal GIS Portals** (free, bulk download)
2. **Point-in-polygon matching** against cell centroids

```typescript
async function augmentWithCityCouncilData(
  cells: Map<string, GeographicCell>
): Promise<void> {
  // Load city council boundaries from municipal GIS
  const cityCouncilBoundaries = await loadCityCouncilGIS();

  for (const [geoid, cell] of cells) {
    if (!cell.boundaries.city) continue; // Skip unincorporated

    const centroid = cell.centroid;
    const cityFips = cell.boundaries.city;

    // Find city council boundaries for this city
    const councilPolygons = cityCouncilBoundaries.get(cityFips);
    if (!councilPolygons) continue; // No GIS data for this city

    // Point-in-polygon test
    const district = findContainingPolygon(centroid, councilPolygons);
    if (district) {
      cell.boundaries.cityCouncil = `${cityFips}-D${district.properties.district}`;
      cell.sources.cityCouncil = district.properties.source;
    }
  }
}
```

---

## 4. Merkle Tree Construction

### 4.1 Boundary Hashes (Geographic Identity)

All boundary hashes are computed and returned as **public circuit outputs** - these hashes ARE the user's geographic identity. No Merkle tree is needed for selective disclosure since the identity includes all 14 districts.

```typescript
const NUM_BOUNDARIES = 14;

/**
 * Compute geographic identity hashes - the user's complete district-to-user mapping.
 * All 14 hashes become public outputs in the proof (this IS the identity).
 * Returns array of 14 hashes plus a commitment for the leaf formula.
 */
async function computeBoundaryHashes(boundaries: BoundaryMap): Promise<{
  hashes: Field[];
  commitment: Field;
}> {
  // Hash each boundary - these form the user's geographic identity
  const boundaryHashes: Field[] = [
    await poseidonHash(boundaries.congressional ?? 'EMPTY'),
    await poseidonHash(boundaries.senateFederal ?? 'EMPTY'),
    await poseidonHash(boundaries.stateSenate ?? 'EMPTY'),
    await poseidonHash(boundaries.stateHouse ?? 'EMPTY'),
    await poseidonHash(boundaries.county ?? 'EMPTY'),
    await poseidonHash(boundaries.city ?? 'EMPTY'),
    await poseidonHash(boundaries.cityCouncil ?? 'EMPTY'),
    await poseidonHash(boundaries.schoolUnified ?? 'EMPTY'),
    await poseidonHash(boundaries.schoolElementary ?? 'EMPTY'),
    await poseidonHash(boundaries.schoolSecondary ?? 'EMPTY'),
    await poseidonHash(boundaries.waterDistrict ?? 'EMPTY'),
    await poseidonHash(boundaries.fireDistrict ?? 'EMPTY'),
    await poseidonHash(boundaries.transitDistrict ?? 'EMPTY'),
    await poseidonHash(boundaries.votingPrecinct ?? 'EMPTY'),
  ];

  // Commitment = hash of concatenated boundary hashes (for leaf formula)
  const commitment = await poseidonHashN(boundaryHashes);

  return { hashes: boundaryHashes, commitment };
}
```

### 4.2 Cell Tree

The main Shadow Atlas tree contains all geographic cells:

```typescript
const CELL_TREE_DEPTH = 18; // 2^18 = 262,144 cells (covers ~242K US block groups)

async function buildCellTree(
  cells: Map<string, GeographicCell>,
  registrations: Map<string, UserRegistration>
): Promise<MerkleTree> {
  // Sort cells by GEOID for deterministic ordering
  const sortedCellIds = Array.from(cells.keys()).sort();

  const leaves: Field[] = [];

  for (const cellId of sortedCellIds) {
    const cell = cells.get(cellId)!;

    // Get all users registered in this cell
    const usersInCell = getUsersInCell(cellId, registrations);

    if (usersInCell.length === 0) {
      // Empty cell: use padding hash
      leaves.push(PADDING_HASH);
    } else {
      // For each user, compute their leaf
      for (const user of usersInCell) {
        const leafHash = await computeUserLeaf(cell, user.identityCommitment);
        leaves.push(leafHash);
      }
    }
  }

  // Pad to 2^CELL_TREE_DEPTH
  while (leaves.length < 2 ** CELL_TREE_DEPTH) {
    leaves.push(PADDING_HASH);
  }

  return buildMerkleTree(leaves);
}

async function computeUserLeaf(
  cell: GeographicCell,
  identityCommitment: Field
): Promise<Field> {
  // leaf = H(cell_id_hash, identity_commitment, boundary_commitment)
  // boundary_commitment is H(all_boundary_hashes) - simpler than Merkle root
  return poseidonHash3(
    await poseidonHash(cell.cellId),
    identityCommitment,
    cell.boundaryCommitment
  );
}
```

---

## 5. User Registration Flow

Registration creates the user's **geographic identity** - the district-to-user mapping that proofs will reveal.

### 5.1 Registration API

```typescript
// POST /api/shadow-atlas/register
// Creates user's geographic identity from their address
interface RegisterRequest {
  identityCommitment: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}

interface RegisterResponse {
  cellId: string;
  boundaries: BoundaryMap;            // User's complete district profile (geographic identity)
  boundaryHashes: string[];           // The 14 hashes that will be revealed in proofs
  boundaryCommitment: string;         // H(boundaryHashes) for leaf computation
  leafIndex: number;
  merklePath: string[];
  merkleRoot: string;
  epochId: string;
}

async function handleRegister(req: RegisterRequest): Promise<RegisterResponse> {
  // 1. Geocode address to lat/lon
  const coords = await geocodeAddress(req.address);

  // 2. Find containing block group (point-in-polygon or spatial index)
  const cellId = await findBlockGroup(coords);

  // 3. Get cell data (contains complete district profile)
  const cell = await getCellData(cellId);

  // 4. Compute geographic identity hashes (all 14 districts)
  const { hashes: boundaryHashes, commitment: boundaryCommitment } =
    await computeBoundaryHashes(cell.boundaries);

  // 5. Compute user's leaf hash
  const leafHash = await computeUserLeaf(cell, req.identityCommitment);

  // 6. Insert into tree and get proof
  const { leafIndex, merklePath, merkleRoot } = await insertIntoTree(
    cellId,
    leafHash,
    req.identityCommitment
  );

  // Return user's complete geographic identity
  return {
    cellId: cell.cellId,
    boundaries: cell.boundaries,           // User's district profile
    boundaryHashes: boundaryHashes.map(h => h.toString()),  // Will be revealed in proofs
    boundaryCommitment: boundaryCommitment.toString(),
    leafIndex,
    merklePath,
    merkleRoot,
    epochId: getCurrentEpoch(),
  };
}
```

### 5.2 Session Credentials Update

```typescript
// Session credentials contain user's geographic identity
interface SessionCredential {
  userId: string;
  identityCommitment: string;

  // User's geographic identity (complete district-to-user mapping)
  cellId: string;
  boundaries: BoundaryMap;            // Complete district profile
  boundaryHashes: string[];           // The 14 hashes revealed in proofs
  boundaryCommitment: string;         // For leaf formula

  // Merkle proof for cell tree
  leafIndex: number;
  merklePath: string[];
  merkleRoot: string;

  // Metadata
  epochId: string;
  userSecret: string;
  createdAt: Date;
  expiresAt: Date;
}
```

---

## 6. Query API

### 6.1 Resolve Address to Geographic Identity

```typescript
// GET /api/shadow-atlas/resolve?address=...
// Returns complete geographic identity (all 14 districts)
interface ResolveResponse {
  cellId: string;
  boundaries: BoundaryMap;           // Complete district profile
  boundaryHashes: string[];          // The 14 hashes for proof generation
  boundaryCommitment: string;        // For leaf formula
  coverage: {                        // Which district types have values
    congressional: boolean;    // Always true
    stateSenate: boolean;      // Always true
    stateHouse: boolean;       // Always true
    county: boolean;           // Always true
    city: boolean;             // False for unincorporated
    cityCouncil: boolean;      // Depends on GIS availability
    schoolUnified: boolean;    // Usually true
    votingPrecinct: boolean;   // Always true
  };
}
```

### 6.2 Get Geographic Identity

```typescript
// Returns complete geographic identity for a cell
// The proof system reveals ALL 14 districts - no per-district queries needed
async function getGeographicIdentity(cellId: string): Promise<{
  boundaries: BoundaryMap;
  hashes: Field[];
  commitment: Field;
}> {
  const cell = await getCellData(cellId);
  const { hashes, commitment } = await computeBoundaryHashes(cell.boundaries);

  return {
    boundaries: cell.boundaries,  // Complete district-to-user mapping
    hashes,                       // The 14 hashes revealed in proofs
    commitment,
  };
}
```

---

## 7. Privacy Model

### 7.1 What Is Hidden vs. Public

| Data Element | Visibility | Rationale |
|--------------|------------|-----------|
| Street address | **PRIVATE** | Never leaves user device after geocoding |
| Cell ID (Block Group GEOID) | **PRIVATE** | Maps 1:1 to address location |
| Identity commitment | **PRIVATE** | Hidden in Merkle leaf |
| User secret | **PRIVATE** | Used for nullifier derivation |
| **Geographic identity (14 districts)** | **PUBLIC** | The proof's purpose - district-to-user mapping |
| Nullifier | **PUBLIC** | Sybil resistance - prevents duplicate proofs |
| Merkle root | **PUBLIC** | Commitment to registered users |

### 7.2 Why Revealing Geographic Identity Is Safe

**Key Insight:** Geographic identity (district membership) is NOT the same as address.

Even if an adversary sees the complete geographic identity:
- Congressional: CA-12
- State Senate: CA-SD-11
- City Council: SF-D5
- School District: SFUSD
- ... (all 14 districts)

They **cannot** determine the specific address because:
1. Census Block Groups contain **600-3000 people** who share the same identity
2. The address itself is never revealed - only hashed district identifiers
3. Block groups are designed by Census Bureau specifically to maintain statistical privacy

```
Anonymity Set Analysis:
┌─────────────────────────────────────────────────────────┐
│  Block Group 060750171001                               │
│  Population: ~1,200 people                              │
│  Addresses: ~500 households                             │
│                                                         │
│  Geographic identity revealed ──> Still 500 possible   │
│  (all 14 districts)              addresses             │
│                                                         │
│  Privacy preserved: k-anonymity where k ≈ 500          │
└─────────────────────────────────────────────────────────┘
```

### 7.3 Privacy Boundary

```
┌──────────────────────────────────────────────────────────┐
│                    PRIVATE DOMAIN                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │  User's address: "123 Main St, San Francisco"    │   │
│  │            ↓ (geocoding - local)                 │   │
│  │  Coordinates: [37.7749, -122.4194]               │   │
│  │            ↓ (cell lookup - local)               │   │
│  │  Cell ID: 060750171001                           │   │
│  │            ↓ (commitment)                        │   │
│  │  Identity commitment + boundary commitment       │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
                           │
                    ZK Proof Boundary
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    PUBLIC DOMAIN                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  GEOGRAPHIC IDENTITY (14 district hashes):       │   │
│  │    - H("CA-12")        Congressional             │   │
│  │    - H("CA")           Federal Senate            │   │
│  │    - H("CA-SD-11")     State Senate              │   │
│  │    - H("CA-AD-17")     State Assembly            │   │
│  │    - H("06075")        County                    │   │
│  │    - H("0667000")      City                      │   │
│  │    - H("SF-D5")        City Council              │   │
│  │    - H("0634410")      School District           │   │
│  │    - ... (6 more)                                │   │
│  │                                                  │   │
│  │  Merkle root: 0x7a3b...                          │   │
│  │  Nullifier: 0x9c4d... (sybil resistance)         │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 7.4 Acceptable for Civic Applications

This privacy model is appropriate because:

1. **Purpose alignment:** The proof's purpose IS to establish geographic identity (district-to-user mapping). Revealing district membership is the goal, not a leak.

2. **No address leakage:** The sensitive data (exact address) remains hidden. Geographic identity is public by design.

3. **Adequate anonymity set:** 600-3000 people share the same geographic identity. This exceeds typical k-anonymity thresholds (k=5 to k=100).

4. **Census-designed boundaries:** Block groups were specifically designed by the Census Bureau to balance geographic precision with privacy.

5. **Application flexibility:** Any downstream application can use the geographic identity without the proof system knowing what they do with it.

---

## 8. Storage Estimates

### 8.1 Cell Database

| Component | Count | Size/Item | Total |
|-----------|-------|-----------|-------|
| Block Groups | 242,000 | ~500 bytes | ~121 MB |
| Boundary commitments | 242,000 | 32 bytes | ~8 MB |
| Spatial index | 242,000 | 64 bytes | ~15 MB |
| **Total** | | | **~144 MB** |

### 8.2 Cell Tree (with users)

| Depth | Capacity | Tree Size | Notes |
|-------|----------|-----------|-------|
| 18 | 262,144 | ~8 MB | Base tree structure |
| User leaves | 1M users | ~32 MB | Identity commitments |
| Proofs (cached) | 1M users | ~500 MB | Merkle paths |

---

## 9. Performance Comparison

### 9.1 Query Performance

| Operation | District-Centric | Cell-Centric (Geographic Identity) |
|-----------|-----------------|---------------------------|
| Address → Districts | 3-5 PIP tests | 1 PIP + 1 lookup |
| Get geographic identity | N tree lookups | 1 lookup (complete identity) |
| Proof generation | N proofs | 1 proof (proves all 14 districts) |

### 9.2 Proof Generation

| Metric | District-Centric (v1) | Cell-Centric (Geographic Identity) |
|--------|----------------------|---------------------------|
| Tree depth | 14-22 | 18 (cell tree only) |
| Constraints | ~4,000 | ~8,000 (no boundary Merkle) |
| Proving time (mobile) | ~5s | ~8-10s |
| Proof size | ~2 KB | ~3 KB (14 public outputs) |
| Proofs per campaign | N (one per district type) | 1 (complete identity) |
| Public outputs | 1 district hash | 14 district hashes (full identity) |

**Note:** The circuit outputs the complete geographic identity (all 14 districts). Downstream applications can use whichever districts are relevant to their use case.

---

## 10. Migration Strategy

### 10.1 Data Migration

1. **Build cell database** from Census TIGER (one-time)
2. **Map existing registrations** to cells (address → cell lookup)
3. **Recompute leaf hashes** with new formula
4. **Build new tree** with cell-based leaves

### 10.2 User Migration

**Option A: Transparent Migration**
- Backend migrates all users automatically
- Users don't need to re-verify
- Requires address retention (privacy concern)

**Option B: Re-registration**
- Users re-verify address on next login
- Cleaner data, no address retention
- Requires user action

**Recommended: Option B** (re-registration) for privacy

---

## 11. Open Questions

1. **Block group vs tract:** Should we use Census tracts (~85K) instead of block groups (~242K) for smaller tree?

2. **International cells:** How to define cells for countries without Census block groups?

3. **Redistricting updates:** When congressional districts change, how do we update cells without re-registering users?

4. **Sparse cells:** Many block groups may have 0 users. Should we use sparse Merkle tree?

---

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/voter-protocol

---

## Circuit Specification

- Multi-depth circuit compilation (18, 20, 22, 24) for international support
- Nullifier is campaign-scoped (not authority-scoped)
- See Section 3.3 for privacy rationale

**International Validation (v2.2):** Parameters validated through comprehensive research of 20+ democracies:
- **Depth 24** supports 16.7M voters (covers Netherlands 13.4M, India Malkajgiri 3.78M + future growth)
- **16 slots** covers USA's 15-18 elected governance levels (most complex globally)

---

## 1. Overview

### 1.1 Core Purpose: Geographic Identity

**The proof answers one question:** "What districts does this verified user belong to?"

This is a proof of **geographic identity** - it establishes the complete district-to-user mapping for a verified individual. The proof does NOT answer "where should this message go?" or "which authority should receive this?" - those are downstream application concerns.

**What the proof proves:**
- User has a verified identity (via Self.xyz)
- User is registered in a specific geographic cell
- User belongs to exactly these 16 districts (or fewer if some are empty)
- User has not already submitted for this campaign (sybil resistance)

### 1.2 Architectural Change

**Current Model (v1):**
- One Merkle tree per district
- User proves membership in a single district per proof
- Multiple proofs required for multiple district levels

**New Model (v2.2):**
- One Merkle tree of geographic cells (depth parameterized: 18-24)
- Each cell contains the user's complete district profile
- Single proof reveals ALL 16 district hashes as public outputs
- Multi-depth compilation for international constituencies (see Section 3.5)
- Privacy boundary: ADDRESS is hidden, district memberships are public
- Anonymity set: 600-3000 people per Census Block Group (acceptable)

### 1.3 Key Principle: Prove All Districts, Let Applications Decide

**All 16 district hashes are revealed as public outputs.** The circuit proves geographic identity - membership in all 16 districts simultaneously. What applications DO with this identity is their concern.

```typescript
// Proof output (from circuit)
interface ProofOutput {
  nullifier: Field;                    // H(secret, campaign, epoch) - sybil resistance
  district_hashes: [Field; 16];        // User's complete geographic identity
}
```

**The proof establishes geographic identity:**
1. Circuit proves user is registered in a geographic cell
2. Circuit outputs ALL 16 district hashes (the user's district memberships)
3. Nullifier provides sybil resistance (one proof per user per campaign)

**Downstream applications** (like Communique) use this identity for their own purposes:
- Routing messages to representatives
- Geographic analytics and breakdowns
- Eligibility verification
- Constituent verification

---

## 2. Geographic Cell Data Model

### 2.1 Cell Structure

A geographic cell represents a unique geographic location (Census block group) with pre-computed mappings to all governance boundaries:

```typescript
interface GeographicCell {
  // Unique identifier (Census Block Group GEOID)
  cellId: string;                    // e.g., "060750171001234"

  // All governance boundaries this cell belongs to
  boundaries: {
    // Federal
    congressional: string;           // "CA-12"
    senateFederal: string;           // "CA" (state FIPS for 2 senators)

    // State Legislature
    stateSenate: string;             // "CA-SD-11"
    stateHouse: string;              // "CA-AD-17"

    // County
    county: string;                  // "06037" (FIPS code)

    // Municipal
    city: string;                    // "San Francisco"
    cityCouncil: string;             // "SF-D5"

    // School
    schoolUnified: string;           // "SFUSD"
    schoolElementary?: string;
    schoolSecondary?: string;

    // Special Districts (where available)
    waterDistrict?: string;
    fireDistrict?: string;
    transitDistrict?: string;
    hospitalDistrict?: string;       // v2.2: Added for US special district coverage
    communityCollege?: string;       // v2.2: Added for US community college districts

    // Electoral
    votingPrecinct: string;          // "SF-PCT-3521"
  };
}
```

### 2.2 Authority Levels

```typescript
enum AuthorityLevel {
  // Federal
  CONGRESSIONAL = 0,
  SENATE_FEDERAL = 1,

  // State
  STATE_SENATE = 2,
  STATE_HOUSE = 3,

  // County
  COUNTY = 4,

  // Municipal
  CITY = 5,
  CITY_COUNCIL = 6,

  // School
  SCHOOL_UNIFIED = 7,
  SCHOOL_ELEMENTARY = 8,
  SCHOOL_SECONDARY = 9,

  // Special Districts (validated for US edge cases)
  WATER_DISTRICT = 10,
  FIRE_DISTRICT = 11,
  TRANSIT_DISTRICT = 12,
  HOSPITAL_DISTRICT = 13,      // v2.2: Added for US special district coverage
  COMMUNITY_COLLEGE = 14,      // v2.2: Added for US community college districts

  // Electoral
  VOTING_PRECINCT = 15,
}

const MAX_AUTHORITY_LEVELS = 16;

/**
 * SLOT COUNT RATIONALE (v2.2):
 *
 * Research across 20+ democracies found:
 * - USA: 15-18 elected governance levels (most complex globally)
 *   - Federal (2): Congress, Senate
 *   - State (2): State Senate, State House
 *   - County (1-2): County Board, Sheriff
 *   - Municipal (2): Mayor, City Council
 *   - School (3-4): Unified, Elementary, Secondary, Community College
 *   - Special (4-6): Water, Fire, Transit, Hospital, Cemetery, Mosquito Abatement
 *
 * - India: 10-12 levels (urban vs rural paths differ)
 * - UK: 7-9 levels (varies by region)
 * - Most other countries: 5-8 levels
 *
 * 16 slots provides headroom for USA edge cases without excessive padding.
 * Empty slots use EMPTY_BOUNDARY hash for unused district types.
 */
```

### 2.3 Merkle Leaf Construction

Each leaf in the geographic cell tree is computed as:

```typescript
// Off-chain leaf construction
function computeLeafHash(cell: GeographicCell, identityCommitment: Field): Field {
  // 1. Hash all boundary mappings into a fixed array
  const boundaryHashes: Field[] = Object.values(cell.boundaries)
    .map(b => b ? poseidon2Hash(b) : EMPTY_BOUNDARY);

  // Pad to MAX_AUTHORITY_LEVELS (16)
  while (boundaryHashes.length < MAX_AUTHORITY_LEVELS) {
    boundaryHashes.push(EMPTY_BOUNDARY);
  }

  // 2. Hash the boundary subtree into a single commitment
  // This is stored as a flat array in the cell, not a Merkle tree
  const boundarySubtreeHash = poseidon2HashArray(boundaryHashes);

  // 3. Final leaf = H(cellId, identityCommitment, boundarySubtreeHash)
  return poseidon2Hash3(
    poseidon2Hash(cell.cellId),
    identityCommitment,
    boundarySubtreeHash
  );
}

const EMPTY_BOUNDARY = poseidon2Hash("EMPTY_BOUNDARY");
```

**Key insight:** We store boundary hashes as a flat array (not a Merkle tree) because we reveal ALL of them. No need for selective disclosure = no need for boundary Merkle proofs.

---

## 3. Circuit Specification

### 3.1 New Circuit: `geographic_cell_membership`

```noir
// geographic_cell_membership/src/main.nr

use dep::std::hash::poseidon2_permutation;

// ═══════════════════════════════════════════════════════════════════════════
// COMPILE-TIME CONSTANTS (parameterized via build pipeline)
// ═══════════════════════════════════════════════════════════════════════════

// Tree depth - build pipeline replaces this for each variant (18/20/22/24)
// Noir requires compile-time array sizes, so we compile multiple circuit variants
// See Section 3.5 for multi-depth architecture
global CELL_TREE_DEPTH: u32 = 20;  // Default: 1M voters (covers most countries)

// Boundary slots - fixed at 16 to cover USA's governance complexity
global MAX_BOUNDARIES: u32 = 16;

// ═══════════════════════════════════════════════════════════════════════════
// DEPTH VARIANTS (generated by build pipeline)
// ═══════════════════════════════════════════════════════════════════════════
//
// | Depth | Max Voters | Example Constituencies | Countries |
// |-------|------------|------------------------|-----------|
// | 18 | 262K | UK (77K max), Germany (200K avg) | UK, DE, FR |
// | 20 | 1M | US Congress (760K), Pakistan (484K avg) | USA, PK, BD |
// | 22 | 4M | India Malkajgiri (3.78M), Indonesia (3-4M) | IN, ID, BR |
// | 24 | 16.7M | Netherlands (13.4M national), future growth | NL, IL, future |
//

// ═══════════════════════════════════════════════════════════════════════════
// HASH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let mut state: [Field; 4] = [left, right, 0, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

fn poseidon2_hash3(a: Field, b: Field, c: Field) -> Field {
    let h1 = poseidon2_hash2(a, b);
    poseidon2_hash2(h1, c)
}

/// Hash an array of fields into a single commitment (chain of Poseidon2)
fn poseidon2_hash_array<N>(arr: [Field; N]) -> Field {
    let mut acc = arr[0];
    for i in 1..N {
        acc = poseidon2_hash2(acc, arr[i]);
    }
    acc
}

// ═══════════════════════════════════════════════════════════════════════════
// MERKLE ROOT COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

fn compute_merkle_root<N>(
    leaf: Field,
    merkle_path: [Field; N],
    leaf_index: u32
) -> Field {
    let mut node = leaf;
    for i in 0..N {
        let bit: bool = ((leaf_index >> i) & 1u32) == 1u32;
        let sibling = merkle_path[i];
        node = if bit {
            poseidon2_hash2(sibling, node)
        } else {
            poseidon2_hash2(node, sibling)
        };
    }
    node
}

// ═══════════════════════════════════════════════════════════════════════════
// NULLIFIER COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

/// Nullifier provides sybil resistance: one proof per (user, campaign, epoch)
/// Prevents duplicate submissions within the same campaign
fn compute_nullifier(
    user_secret: Field,
    campaign_id: Field,
    epoch_id: Field
) -> Field {
    poseidon2_hash3(user_secret, campaign_id, epoch_id)
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CIRCUIT
// ═══════════════════════════════════════════════════════════════════════════

/// Prove geographic identity: membership in all 16 districts
/// The proof establishes district-to-user mapping for a verified individual
/// Privacy: ADDRESS hidden, district memberships public (anonymity set: 600-3000 people)
fn main(
    // ══════════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS (revealed to verifier)
    // ══════════════════════════════════════════════════════════════════════

    /// Root of the geographic cell Merkle tree (anchors proof to Shadow Atlas epoch)
    cell_merkle_root: Field,

    /// Epoch identifier (Shadow Atlas version)
    epoch_id: Field,

    /// Campaign/template identifier
    campaign_id: Field,

    // ══════════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS (never revealed)
    // ══════════════════════════════════════════════════════════════════════

    /// Hash of the cell ID (Census block group) - THIS IS THE SENSITIVE DATA
    cell_id: Field,

    /// All 16 district hashes stored in the cell (passed in to be revealed)
    boundary_subtree: [Field; 16],

    /// Merkle path to prove cell is in cell_merkle_root
    cell_merkle_path: [Field; CELL_TREE_DEPTH],

    /// Cell's position in the tree
    cell_index: u32,

    /// User's secret (for nullifier derivation)
    user_secret: Field,

    /// User's identity commitment (from Self.xyz verification)
    identity_commitment: Field,

) -> pub (Field, [Field; 16]) {
    // Returns: (nullifier, all_16_district_hashes)

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 1: Compute boundary subtree hash from the 16 district hashes
    // ══════════════════════════════════════════════════════════════════════

    let boundary_subtree_hash = poseidon2_hash_array(boundary_subtree);

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 2: Compute and verify cell leaf hash
    // ══════════════════════════════════════════════════════════════════════

    // leaf = H(cell_id, identity_commitment, boundary_subtree_hash)
    let cell_leaf = poseidon2_hash3(cell_id, identity_commitment, boundary_subtree_hash);

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 3: Verify cell is in the tree
    // ══════════════════════════════════════════════════════════════════════

    let computed_cell_root = compute_merkle_root(
        cell_leaf,
        cell_merkle_path,
        cell_index
    );
    assert(computed_cell_root == cell_merkle_root);

    // ══════════════════════════════════════════════════════════════════════
    // CONSTRAINT 4: Compute nullifier (sybil resistance)
    // ══════════════════════════════════════════════════════════════════════

    // One nullifier per (user, campaign, epoch) - prevents duplicate proofs
    // Ensures each verified user can only prove identity once per campaign
    let nullifier = compute_nullifier(
        user_secret,
        campaign_id,
        epoch_id
    );

    // ══════════════════════════════════════════════════════════════════════
    // PUBLIC OUTPUTS
    // ══════════════════════════════════════════════════════════════════════

    // Return nullifier + ALL 16 district hashes
    // Privacy: Cell ID (address) is hidden, but district memberships are public
    // This is acceptable because anonymity set is 600-3000 people per block group
    (nullifier, boundary_subtree)
}
```

### 3.2 Constraint Analysis

| Component | Constraints | Notes |
|-----------|-------------|-------|
| Boundary subtree hash | ~15 × 500 = 7,500 | Chain of 15 poseidon2_hash2 calls (16 slots) |
| Cell leaf hash | ~500 | poseidon2_hash3 |
| Cell Merkle verification | Depth × 500 | See depth-specific table below |
| Nullifier computation | ~500 | poseidon2_hash3 (simpler than v1) |
| Equality assertion | ~50 | 1 assertion (root check) |

**Constraint Count by Depth:**

| Depth | Merkle Constraints | Boundary + Other | Total | Max Voters |
|-------|-------------------|------------------|-------|------------|
| 18 | 9,000 | 8,550 | ~17,550 | 262K |
| 20 | 10,000 | 8,550 | ~18,550 | 1M |
| 22 | 11,000 | 8,550 | ~19,550 | 4M |
| 24 | 12,000 | 8,550 | ~20,550 | 16.7M |

**Proving Time by Depth (Estimated):**

| Depth | Mobile (Snapdragon 8) | Desktop (M2) | Use Case |
|-------|----------------------|--------------|----------|
| 18 | ~14s | ~3s | UK, Germany, France |
| 20 | ~16s | ~4s | USA, Pakistan, most countries |
| 22 | ~18s | ~5s | India, Indonesia, Brazil |
| 24 | ~20s | ~6s | Netherlands, Israel (national PR) |

**Trade-off:** Adding depth levels costs ~1-2s proving time per level. This is acceptable given:
- Proofs are cached per (user, campaign, epoch)
- Users prove identity once per campaign, not per message
- The alternative (insufficient depth) would exclude entire countries

### 3.3 Privacy Properties

| Property | Guarantee |
|----------|-----------|
| **Address hidden** | Cell ID (Census Block Group) is private input, never revealed |
| **Geographic identity revealed** | All 16 district hashes are public outputs |
| **User unlinkability** | Different campaigns produce different nullifiers |
| **Sybil resistance** | One nullifier per (user, campaign, epoch) - prevents duplicate proofs |

**Privacy Model Rationale:**

The key insight is that revealing ALL district memberships does NOT compromise user privacy:

1. **Anonymity Set:** Each Census Block Group contains 600-3,000 people. Knowing someone's districts narrows them to this group - still highly anonymous.

2. **Address is the Sensitive Data:** The specific address (which identifies 1-5 people in a household) is what must be hidden. District memberships are already semi-public information (you can infer them from general neighborhood knowledge).

3. **Simpler Architecture:** No boundary selection logic means simpler circuits, easier auditing, and fewer attack surfaces.

4. **Application Flexibility:** One proof establishes complete geographic identity. Any downstream application can use the relevant districts without requiring new proofs.

**What the verifier learns:**
- User's complete geographic identity (all 16 district memberships)
- User has not previously proven identity for this campaign (sybil resistance)
- User's identity was verified by Self.xyz (identity commitment in Merkle tree)

**What remains hidden:**
- User's specific address (the Census Block Group ID)
- User's real-world identity (no link between proof and personal information)
- Which specific household within the block group

### 3.5 Multi-Depth Architecture (International Support)

**Why Multiple Depths?**

Noir arrays must have compile-time known sizes. ZK circuits have fixed constraint counts. Therefore, we cannot have runtime-variable Merkle tree depth. Instead, we compile multiple circuit variants and select at runtime.

```
BUILD TIME                                RUNTIME

main.nr (template)                        User Registration
CELL_TREE_DEPTH: u32 = PLACEHOLDER;       └── jurisdiction: "IN" (India)
        │                                 └── constituency_size: 3,150,000
        ├──────┬──────┬──────┐            └── required_depth: 22
        ▼      ▼      ▼      ▼                    │
   sed DEPTH=18  20   22   24                     ▼
        │      │      │      │            Session Credentials
        ▼      ▼      ▼      ▼            └── depth: 22
 nargo compile × 4                        └── merkle_path: Field[22]
        │      │      │      │                    │
        ▼      ▼      ▼      ▼                    ▼
 circuit_18  _20   _22   _24              Prover (lazy load)
   .json  .json .json .json               └── import(`./circuits/cell_22.json`)
```

**Depth Selection Logic:**

```typescript
type CircuitDepth = 18 | 20 | 22 | 24;

const JURISDICTION_CONFIGS: Record<string, CircuitDepth> = {
  // Small constituencies (< 262K)
  'GB': 18,  // UK max: 77K
  'DE': 18,  // Germany avg: 200K
  'FR': 18,  // France avg: 85K

  // Medium constituencies (< 1M)
  'US': 20,  // USA max: ~760K (congress)
  'PK': 20,  // Pakistan avg: 484K
  'BD': 20,  // Bangladesh max: 804K

  // Large constituencies (< 4M)
  'IN': 22,  // India max: 3.78M (Malkajgiri)
  'ID': 22,  // Indonesia: 3-4M per dapil
  'BR': 22,  // Brazil: large state lists

  // Very large / national PR (< 16.7M)
  'NL': 24,  // Netherlands: 13.4M (single national constituency)
  'IL': 24,  // Israel: 10M population (single Knesset list)

  // Default for unknown jurisdictions
  '*': 24,   // Safe default covers any scenario
};

function selectDepthForConstituencySize(size: number): CircuitDepth {
  if (size <= 262_144) return 18;
  if (size <= 1_048_576) return 20;
  if (size <= 4_194_304) return 22;
  return 24;
}
```

**Build Pipeline:**

```bash
#!/bin/bash
# build-circuits.sh - Multi-depth compilation

DEPTHS=(18 20 22 24)

for depth in "${DEPTHS[@]}"; do
    echo "=== Compiling DEPTH=${depth} ==="

    # Replace depth constant (Noir requires compile-time values)
    sed -i.bak "s/global CELL_TREE_DEPTH: u32 = [0-9]*;/global CELL_TREE_DEPTH: u32 = ${depth};/" src/main.nr

    # Compile
    nargo compile

    # Rename output
    mv target/geographic_cell_membership.json target/geographic_cell_${depth}.json

    # Generate Solidity verifier (for on-chain verification)
    bb write_vk -b target/geographic_cell_${depth}.json -o target/vk_${depth}.bin
    bb contract -k target/vk_${depth}.bin -o ../contracts/verifiers/GeographicCellVerifier_${depth}.sol

    # Restore original
    mv src/main.nr.bak src/main.nr
done
```

**Prover Updates (Lazy Loading):**

```typescript
const circuitLoaders: Record<CircuitDepth, () => Promise<CompiledCircuit>> = {
  18: () => import('../circuits/geographic_cell_18.json').then(m => m.default),
  20: () => import('../circuits/geographic_cell_20.json').then(m => m.default),
  22: () => import('../circuits/geographic_cell_22.json').then(m => m.default),
  24: () => import('../circuits/geographic_cell_24.json').then(m => m.default),
};

export class NoirProver {
  private backends: Map<CircuitDepth, UltraHonkBackend> = new Map();

  async initForDepth(depth: CircuitDepth): Promise<void> {
    if (this.backends.has(depth)) return;  // Already initialized

    const circuit = await circuitLoaders[depth]();
    const backend = new UltraHonkBackend(circuit.bytecode, { threads: navigator.hardwareConcurrency });
    this.backends.set(depth, backend);
  }

  async prove(inputs: CircuitInputs, depth: CircuitDepth): Promise<ProofResult> {
    await this.initForDepth(depth);

    // Validate merkle_path length matches depth
    if (inputs.cell_merkle_path.length !== depth) {
      throw new Error(`Merkle path length ${inputs.cell_merkle_path.length} != depth ${depth}`);
    }

    const backend = this.backends.get(depth)!;
    const { proof, publicInputs } = await backend.generateProof(inputs);

    return { proof, publicInputs, depth };
  }
}
```

**On-Chain Verifier Registry:**

Each depth has its own verifier contract. The `DistrictGateV2` contract routes verification based on depth stored in `DistrictRegistry`:

```solidity
contract DistrictGateV2 {
    VerifierRegistry public verifierRegistry;
    DistrictRegistry public districtRegistry;

    function verifyAndAuthorize(bytes calldata proof, bytes32 districtRoot, ...) external {
        // 1. Look up depth from district metadata
        (bytes3 country, uint8 depth) = districtRegistry.getCountryAndDepth(districtRoot);

        // 2. Get depth-specific verifier
        address verifier = verifierRegistry.getVerifier(depth);

        // 3. Verify with correct verifier
        bool valid = IVerifier(verifier).verify(proof, publicInputs);
        require(valid, "Invalid proof");

        // 4. Record nullifier, emit event...
    }
}
```

See `/Users/noot/Documents/voter-protocol/specs/DEPTH-PARAMETERIZATION-PLAN.md` for complete implementation details.

---

## 4. Downstream Applications

The proof establishes geographic identity. What applications DO with this identity is their concern. Below are examples of how applications might consume the proof.

### 4.1 Example: Communique (Message Routing)

Communique uses geographic identity to route messages to representatives. The proof provides the district mapping; Communique decides which districts matter for a given campaign.

```typescript
// Example: Communique campaign configuration
// This is Communique's concern, not the proof's concern
interface CommuniqueCampaign {
  id: string;
  title: string;
  body: string;

  // Communique decides which districts from the proof to use for routing
  targetDistricts: AuthorityLevel[];  // One or more district types
}

// Example: A campaign about a congressional bill
const campaign: CommuniqueCampaign = {
  id: "hr-1234-support",
  title: "Support HR 1234",
  body: "Dear Representative...",
  targetDistricts: [AuthorityLevel.CONGRESSIONAL],
};

// Example: Campaign targeting multiple levels
const multiCampaign: CommuniqueCampaign = {
  id: "federal-budget-2026",
  title: "Federal Budget Concerns",
  body: "Dear Members of Congress...",
  targetDistricts: [
    AuthorityLevel.CONGRESSIONAL,
    AuthorityLevel.SENATE_FEDERAL,
  ],
};
```

### 4.2 Proof Generation Flow

```typescript
// The proof generation is campaign-agnostic - it just proves geographic identity
async function generateGeographicIdentityProof(
  userId: string,
  campaignId: string  // Only used for nullifier scope (sybil resistance)
): Promise<ProofData> {
  // 1. Get user's session credentials (contains geographic cell data)
  const session = await getSessionCredentials(userId);
  const cell = session.geographicCell;

  // 2. Build boundary subtree (all 16 district hashes)
  const boundarySubtree = buildBoundarySubtree(cell.boundaries);

  // 3. Prepare circuit inputs - proves complete geographic identity
  const circuitInputs: CircuitInputs = {
    // Public inputs
    cell_merkle_root: session.merkleRoot,
    epoch_id: session.epochId,
    campaign_id: campaignId,

    // Private inputs
    cell_id: poseidonHash(cell.cellId),
    boundary_subtree: boundarySubtree,
    cell_merkle_path: session.merklePath,
    cell_index: session.leafIndex,
    user_secret: session.userSecret,
    identity_commitment: session.identityCommitment,
  };

  // 4. Generate ZK proof - outputs geographic identity (nullifier + all districts)
  return await prover.prove(circuitInputs);
}

function buildBoundarySubtree(boundaries: BoundaryMap): Field[] {
  const EMPTY_BOUNDARY = poseidonHash("EMPTY_BOUNDARY");

  return [
    boundaries.congressional ? poseidonHash(boundaries.congressional) : EMPTY_BOUNDARY,       // 0
    boundaries.senateFederal ? poseidonHash(boundaries.senateFederal) : EMPTY_BOUNDARY,       // 1
    boundaries.stateSenate ? poseidonHash(boundaries.stateSenate) : EMPTY_BOUNDARY,           // 2
    boundaries.stateHouse ? poseidonHash(boundaries.stateHouse) : EMPTY_BOUNDARY,             // 3
    boundaries.county ? poseidonHash(boundaries.county) : EMPTY_BOUNDARY,                     // 4
    boundaries.city ? poseidonHash(boundaries.city) : EMPTY_BOUNDARY,                         // 5
    boundaries.cityCouncil ? poseidonHash(boundaries.cityCouncil) : EMPTY_BOUNDARY,           // 6
    boundaries.schoolUnified ? poseidonHash(boundaries.schoolUnified) : EMPTY_BOUNDARY,       // 7
    boundaries.schoolElementary ? poseidonHash(boundaries.schoolElementary) : EMPTY_BOUNDARY, // 8
    boundaries.schoolSecondary ? poseidonHash(boundaries.schoolSecondary) : EMPTY_BOUNDARY,   // 9
    boundaries.waterDistrict ? poseidonHash(boundaries.waterDistrict) : EMPTY_BOUNDARY,       // 10
    boundaries.fireDistrict ? poseidonHash(boundaries.fireDistrict) : EMPTY_BOUNDARY,         // 11
    boundaries.transitDistrict ? poseidonHash(boundaries.transitDistrict) : EMPTY_BOUNDARY,   // 12
    boundaries.hospitalDistrict ? poseidonHash(boundaries.hospitalDistrict) : EMPTY_BOUNDARY, // 13 (v2.2)
    boundaries.communityCollege ? poseidonHash(boundaries.communityCollege) : EMPTY_BOUNDARY, // 14 (v2.2)
    boundaries.votingPrecinct ? poseidonHash(boundaries.votingPrecinct) : EMPTY_BOUNDARY,     // 15
  ];
}
```

### 4.3 Example: Communique Routing (Application Concern)

Message routing is a Communique-specific concern, handled AFTER proof verification. The proof provides geographic identity; Communique uses it for delivery.

```typescript
// This is Communique application code, NOT part of the proof system
async function communiqueRouteToRepresentatives(
  proof: ProofData,
  campaignId: string
): Promise<RoutingResult[]> {
  // 1. Verify proof
  const verificationResult = await verifier.verify(proof);
  if (!verificationResult.valid) {
    throw new Error("Invalid proof");
  }

  // 2. Extract geographic identity from public outputs
  const { nullifier, district_hashes } = verificationResult.publicOutputs;

  // 3. Check nullifier (sybil resistance - has user already proven identity for this campaign?)
  if (await nullifierUsed(nullifier, campaignId)) {
    throw new Error("User already submitted identity proof for this campaign");
  }

  // 4. Get Communique's campaign configuration (routing is Communique's concern)
  const campaign = await getCampaign(campaignId);

  // 5. Communique uses geographic identity for message routing
  const routingResults = await Promise.all(
    campaign.targetDistricts.map(async (districtType) => {
      // Extract relevant district from user's geographic identity
      const districtHash = district_hashes[districtType];

      // Skip if user has no membership in this district type (e.g., unincorporated area)
      if (districtHash === EMPTY_BOUNDARY) {
        return { districtType, status: "skipped", reason: "no_district_membership" };
      }

      // Communique looks up representative for routing (Communique's responsibility)
      const representative = await lookupRepresentative(districtType, districtHash);
      if (!representative) {
        return { districtType, status: "skipped", reason: "no_rep_found" };
      }

      // Communique delivers message (Communique's responsibility)
      await deliverMessage(representative, campaign, proof);
      return { districtType, status: "delivered", representative };
    })
  );

  // 6. Mark nullifier as used (sybil resistance)
  await markNullifierUsed(nullifier, campaignId);

  return routingResults;
}
```

### 4.4 Key Differences from Old Model

| Aspect | Old Model | New Model |
|--------|-----------|-----------|
| What proof proves | Single district membership | Complete geographic identity (all 16 districts) |
| Nullifier scope | (user, campaign, authority, epoch) | (user, campaign, epoch) |
| Districts revealed | Single selected district | All 16 districts (full identity) |
| Proofs per campaign | Multiple (one per district type) | One (proves entire identity) |
| Circuit inputs | `authority_selector`, `boundary_merkle_path` | None needed |
| Application flexibility | Must regenerate proof per use case | One proof serves all applications |

---

## 5. Migration Path

### 5.1 From v1 to v2

**Phase 1: Parallel Circuits**
- Deploy `geographic_cell_membership` alongside `district_membership`
- New templates use v2, existing templates continue on v1
- Dual verifier contract accepts both proof formats

**Phase 2: Data Migration**
- Build geographic cell database from Census TIGER relationship files
- Re-register users in cell-based tree (requires re-verification or migration API)
- Update session credentials with cell data

**Phase 3: Deprecation**
- Migrate remaining v1 templates to v2
- Archive v1 trees
- Remove v1 verifier after grace period

### 5.2 Smart Contract Updates

```solidity
contract ShadowAtlasVerifierV2 {
    // Support both v1 (single district) and v2 (all districts) proofs

    enum ProofVersion { V1_SINGLE_DISTRICT, V2_ALL_DISTRICTS }

    // v2 public outputs structure
    struct V2PublicOutputs {
        bytes32 nullifier;
        bytes32[16] districtHashes;  // All 16 district hashes
    }

    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs,
        ProofVersion version
    ) external view returns (bool) {
        if (version == ProofVersion.V1_SINGLE_DISTRICT) {
            // 5 public inputs: [merkle_root, nullifier, authority_hash, epoch_id, campaign_id]
            require(publicInputs.length == 5, "Invalid v1 input count");
            return v1Verifier.verify(proof, publicInputs);
        } else {
            // v2 public inputs: [cell_merkle_root, epoch_id, campaign_id]
            // v2 public outputs: [nullifier, district_hashes[16]]
            // Total: 3 inputs + 15 outputs = 18 fields
            require(publicInputs.length == 18, "Invalid v2 input count");
            return v2Verifier.verify(proof, publicInputs);
        }
    }

    // Helper to extract district hash by authority level from v2 proof
    function getDistrictHash(
        bytes32[] calldata publicOutputs,
        uint8 authorityLevel
    ) external pure returns (bytes32) {
        require(authorityLevel < 16, "Invalid authority level");
        // publicOutputs[0] = nullifier
        // publicOutputs[1..16] = district hashes
        return publicOutputs[1 + authorityLevel];
    }
}
```

---

## 6. Data Sources

### 6.1 Census TIGER Relationship Files

The geographic cell database is built from Census Bureau data that already maps blocks to districts:

| File | Content | URL |
|------|---------|-----|
| Block Assignment Files (BAF) | Block → Congressional, State Legislature | census.gov/geo/maps-data/data/baf |
| TIGER/Line Relationship Files | Block Group → All geographies | census.gov/geo/tiger |

**Example relationship record:**
```csv
GEOID_BG,GEOID_CD,GEOID_SLDU,GEOID_SLDL,GEOID_COUNTY,GEOID_PLACE
060750171001,0612,0611,0617,06075,0667000
```

This maps Census Block Group `060750171001` to:
- Congressional District 12 (CA-12)
- State Senate District 11 (CA-SD-11)
- State Assembly District 17 (CA-AD-17)
- San Francisco County (06075)
- San Francisco City (0667000)

### 6.2 Missing: City Council Districts

Census does NOT provide city council district mappings. These must be acquired from:
- Municipal GIS portals (free downloads)
- Geocodio API ($0.03/lookup)
- Point-in-polygon against municipal boundary files

---

## 7. Open Questions

1. **~~Boundary subtree depth:~~** *(Resolved)* No longer using boundary Merkle tree. All 16 districts stored as flat array and fully revealed.

2. **Empty boundary handling:** How should the backend handle district hashes that are `EMPTY_BOUNDARY`? Current approach: skip routing to that authority level, log for analytics.

3. **~~Multi-authority nullifier policy:~~** *(Resolved)* Single nullifier per (user, campaign, epoch). One proof routes to all authorities. Users cannot submit multiple times to different authorities in the same campaign.

4. **Proof caching:** With proving times of ~15-18s, caching proofs per (user, campaign, epoch) is recommended. Cache key: `H(user_id, campaign_id, epoch_id)`. Cache invalidates on epoch rollover.

5. **Privacy implications of revealing all districts:** While anonymity set (600-3000 people) provides strong privacy, some district combinations may be unique. Should we analyze the entropy of district combinations across the population?

6. **On-chain vs off-chain routing:** Current design routes off-chain. Should district hash lookups be on-chain for trustless verification of representative mapping?

---

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/voter-protocol
