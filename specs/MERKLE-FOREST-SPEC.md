# Merkle Forest Specification

**Version:** 1.0.0
**Date:** 2025-12-12
**Status:** Draft Specification
**Scope:** Multi-boundary proof architecture for global civic infrastructure

---

## 1. Executive Summary

Shadow Atlas is not a single Merkle tree—it's a **forest of trees**, one per governance boundary worldwide. A single address simultaneously belongs to 12-25+ boundaries (congressional district, state legislature, county, city council, school board, water district, etc.). Users need proofs for any subset of these memberships.

**Core Innovation:** Composite proofs that attest to membership in multiple boundaries with a single ZK proof, while maintaining the privacy guarantees of single-boundary proofs.

**Design Principle:** Governance structures are configuration, not code. The same architecture handles US congressional districts, UK parliamentary constituencies, German Gemeinden, and Japanese prefectures.

---

## 2. Problem Statement

### 2.1 Current Limitation

The existing circuit (`district_membership/src/main.nr`) proves membership in **one** boundary:

```noir
fn main(
    merkle_root: Field,      // Single root
    nullifier: Field,
    authority_hash: Field,
    epoch_id: Field,
    campaign_id: Field,
    leaf: Field,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    user_secret: Field,
) -> pub (Field, Field, Field, Field, Field)
```

### 2.2 Real-World Requirements

A US resident needs to prove membership in:

| Layer | Boundary Type | Example | Use Case |
|-------|--------------|---------|----------|
| Federal | Congressional District | CA-12 | Contact House representative |
| State Upper | State Senate | CA SD-11 | Contact state senator |
| State Lower | State Assembly | CA AD-17 | Contact assemblymember |
| County | County | San Francisco | County services, supervisor |
| Municipal | City | San Francisco | City services |
| Council | City Council District | SF D5 | Contact supervisor |
| School | Unified School District | SFUSD | School board elections |
| Voting | Precinct | PCT 3521 | Polling location |
| Special | Water District | SFPUC | Utility governance |

**Total: 9-15 simultaneous memberships per US resident.**

### 2.3 Global Scale

| Country | Typical Layers | Est. Boundaries |
|---------|---------------|-----------------|
| United States | 6-15 | ~300,000 |
| United Kingdom | 4-6 | ~50,000 |
| Germany | 3-5 | ~15,000 |
| France | 4-6 | ~40,000 |
| Japan | 3-4 | ~5,000 |
| India | 5-8 | ~800,000 |
| Brazil | 4-6 | ~10,000 |
| **Global (190 countries)** | 3-15 | **~2,000,000** |

---

## 3. Merkle Forest Architecture

### 3.1 Forest Structure

```
Shadow Atlas Forest
│
├── registry/                          # On-chain root registry
│   ├── epoch_roots.sol                # Epoch → global commitment
│   └── boundary_roots.sol             # BoundaryID → MerkleRoot
│
├── trees/                             # Per-boundary Merkle trees
│   ├── US/
│   │   ├── federal/
│   │   │   └── congress/
│   │   │       ├── cd119-ca-12.tree   # CA-12 (depth 14)
│   │   │       ├── cd119-ca-13.tree
│   │   │       └── ... (435 trees)
│   │   ├── state/
│   │   │   ├── CA/
│   │   │   │   ├── senate/
│   │   │   │   │   ├── sd-01.tree
│   │   │   │   │   └── ... (40 trees)
│   │   │   │   └── assembly/
│   │   │   │       ├── ad-01.tree
│   │   │   │       └── ... (80 trees)
│   │   │   └── ... (50 states)
│   │   ├── county/
│   │   │   └── ... (3,143 trees)
│   │   ├── municipal/
│   │   │   ├── place/
│   │   │   │   └── ... (32,041 trees)
│   │   │   └── council/
│   │   │       └── ... (~50,000 trees)
│   │   ├── school/
│   │   │   ├── unified/
│   │   │   │   └── ... (10,526 trees)
│   │   │   ├── elementary/
│   │   │   │   └── ... (4,631 trees)
│   │   │   └── secondary/
│   │   │       └── ... (469 trees)
│   │   ├── voting/
│   │   │   └── precinct/
│   │   │       └── ... (~178,000 trees)
│   │   └── special/
│   │       ├── water/
│   │       ├── fire/
│   │       ├── transit/
│   │       └── ... (~15,000 trees)
│   │
│   ├── GB/                            # United Kingdom
│   │   ├── westminster/               # Parliamentary constituencies
│   │   ├── council/                   # Local authority wards
│   │   └── ...
│   │
│   ├── DE/                            # Germany
│   │   ├── bundestag/                 # Wahlkreise
│   │   ├── landtag/                   # State parliament
│   │   └── gemeinde/                  # Municipal
│   │
│   └── ... (190 countries)
│
└── indices/                           # Lookup optimization
    ├── geocode_index.cbor             # (lat,lon) → boundary_ids[]
    └── address_index.cbor             # normalized_address → leaf_positions[]
```

### 3.2 Boundary Identifier Schema

```typescript
/**
 * Globally unique boundary identifier
 *
 * Format: {country}-{layer}-{jurisdiction}-{id}
 *
 * Examples:
 *   US-congress-119-ca-12        (CA 12th Congressional District, 119th Congress)
 *   US-state-senate-ca-11        (CA State Senate District 11)
 *   US-council-sf-5              (San Francisco Supervisor District 5)
 *   GB-westminster-cities-london (Cities of London constituency)
 *   DE-bundestag-2025-089        (Bundestag Wahlkreis 89, 2025)
 *   JP-prefecture-tokyo          (Tokyo Prefecture)
 */
export interface BoundaryId {
  readonly country: string;      // ISO 3166-1 alpha-2
  readonly layer: BoundaryLayer;
  readonly jurisdiction?: string; // State/region code (if applicable)
  readonly id: string;           // District/ward/precinct ID
  readonly epoch?: string;       // Optional: congress number, election year
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

### 3.3 Tree Parameters by Layer

The circuit supports three depth tiers, selected at build time:

| Depth Class | Depth | Capacity | Use Cases |
|-------------|-------|----------|-----------|
| City Council | 14 | ~16K | Council/ward, voting precinct, small special districts |
| Congressional | 20 | ~1M | Congressional districts, state legislature, counties |
| State (mega) | 22 | ~4M | Large states (CA, TX, FL), national boundaries |

**Layer-to-Depth Mapping:**

| Layer | Depth | Capacity | Rationale |
|-------|-------|----------|-----------|
| Federal (congress, parliament) | 20 | ~1M | Large districts, ~700k people |
| State Legislature (mega states) | 22 | ~4M | CA, TX, FL, NY with 10M+ residents |
| State Legislature (standard) | 20 | ~1M | Medium states |
| County | 20 | ~1M | Varies widely, need headroom |
| Municipal (city/place) | 14 | ~16K | Most cities < 100k |
| Council/Ward | 14 | ~16K | Small districts, ~10k people |
| School District | 20 | ~1M | Can span multiple cities |
| Voting Precinct | 14 | ~16K | Small, ~1k voters |
| Special Districts | 14 | ~16K | Varies |

**Build Pipeline Integration:**

The circuit depth is NOT hardcoded—the build pipeline (`scripts/build-bbjs.sh`) generates verifiers for each depth class:

```bash
DEPTHS=(14 20 22)  # City council, Congressional, State mega
```

See `NOIR-PROVING-INFRASTRUCTURE.md` for depth class documentation.

**Depth Selection Algorithm:**
```typescript
type DepthClass = 14 | 20 | 22;

function selectTreeDepth(boundaryPopulation: number): DepthClass {
  // Target: 10x capacity over max expected registrations
  // Assumption: 10% of population registers
  const expectedRegistrations = boundaryPopulation * 0.1;
  const targetCapacity = expectedRegistrations * 10;

  // Select from available depth classes
  if (targetCapacity <= 16_384) return 14;      // ~16K capacity
  if (targetCapacity <= 1_048_576) return 20;   // ~1M capacity
  return 22;                                     // ~4M capacity
}
```

---

## 4. Composite Proof Architecture

### 4.1 Single-Boundary Proof (Current)

```
Public Inputs:  [merkle_root, nullifier, authority_hash, epoch_id, campaign_id]
Private Inputs: [leaf, merkle_path[DEPTH], leaf_index, user_secret]
Constraints:    ~4,000 (depth 14)
Proof Size:     ~2 KB
Verify Gas:     ~300k
```

### 4.2 Multi-Boundary Proof (New)

For actions requiring proof of multiple memberships (e.g., "I live in SF AND my congressional district is CA-12"), we have two options:

#### Option A: Batched Single Proofs

Generate N independent proofs, verify on-chain as batch.

```solidity
function verifyBatch(
    bytes[] calldata proofs,
    bytes32[] calldata merkleRoots,
    bytes32[] calldata nullifiers,
    bytes32 sharedAuthorityHash,
    uint256 sharedEpochId,
    bytes32 sharedCampaignId
) external returns (bool) {
    require(proofs.length == merkleRoots.length);
    require(proofs.length == nullifiers.length);

    for (uint i = 0; i < proofs.length; i++) {
        require(
            verifier.verify(proofs[i], merkleRoots[i], nullifiers[i], ...),
            "Proof verification failed"
        );
        require(
            districtRegistry.isValidRoot(merkleRoots[i]),
            "Unknown merkle root"
        );
    }
    return true;
}
```

**Cost:** N × 300k gas = 900k gas for 3 boundaries

#### Option B: Composite Circuit (Recommended)

Single circuit proving membership in up to K boundaries simultaneously.

```noir
// composite_membership/src/main.nr

global MAX_BOUNDARIES: u32 = 4;  // Prove up to 4 memberships
global MAX_DEPTH: u32 = 22;      // Support largest depth class (mega states)

fn main(
    // Public inputs
    merkle_roots: [Field; MAX_BOUNDARIES],
    nullifier: Field,                        // Single nullifier (campaign-scoped)
    authority_hash: Field,
    epoch_id: Field,
    campaign_id: Field,
    boundary_mask: Field,                    // Bitmask: which boundaries are active

    // Private inputs
    leaves: [Field; MAX_BOUNDARIES],
    merkle_paths: [[Field; MAX_DEPTH]; MAX_BOUNDARIES],
    leaf_indices: [u32; MAX_BOUNDARIES],
    user_secret: Field,
) -> pub (
    [Field; MAX_BOUNDARIES],  // merkle_roots
    Field,                    // nullifier
    Field,                    // authority_hash
    Field,                    // epoch_id
    Field,                    // campaign_id
    Field,                    // boundary_mask
) {
    // Verify each active boundary
    for i in 0..MAX_BOUNDARIES {
        let is_active = ((boundary_mask >> i) & 1) == 1;

        if is_active {
            let computed_root = compute_merkle_root(
                leaves[i],
                merkle_paths[i],
                leaf_indices[i]
            );
            assert(computed_root == merkle_roots[i]);
        }
    }

    // Single nullifier for all boundaries (prevents proof reuse)
    let computed_nullifier = compute_nullifier(
        user_secret,
        campaign_id,
        authority_hash,
        epoch_id
    );
    assert(computed_nullifier == nullifier);

    (merkle_roots, nullifier, authority_hash, epoch_id, campaign_id, boundary_mask)
}
```

**Cost:** ~400k gas (33% premium over single proof, but 4× the boundaries)

### 4.3 Proof Selection Strategy

```typescript
interface ProofStrategy {
  /**
   * Select optimal proof strategy based on requirements
   */
  selectStrategy(requirements: {
    boundaries: BoundaryId[];
    gasOptimize: boolean;
    latencyOptimize: boolean;
  }): 'single' | 'batched' | 'composite';
}

function selectProofStrategy(
  boundaryCount: number,
  gasOptimize: boolean
): 'single' | 'batched' | 'composite' {
  if (boundaryCount === 1) {
    return 'single';
  }

  if (boundaryCount <= 4 && gasOptimize) {
    return 'composite';  // 400k gas for 4 boundaries
  }

  if (boundaryCount > 4) {
    return 'batched';    // Multiple proofs, can parallelize generation
  }

  return 'composite';
}
```

---

## 5. On-Chain Registry Architecture

### 5.1 Epoch-Based Root Management

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ShadowAtlasRegistry
 * @notice Manages Merkle roots for the Shadow Atlas forest
 * @dev Epoch-based versioning with governance timelocks
 */
contract ShadowAtlasRegistry {

    // ============ State ============

    /// @notice Current epoch (increments on major boundary updates)
    uint256 public currentEpoch;

    /// @notice Epoch metadata
    struct EpochInfo {
        uint256 activatedAt;
        bytes32 globalCommitment;  // H(all boundary roots)
        string ipfsCid;            // Full forest data
        uint256 boundaryCount;
    }
    mapping(uint256 => EpochInfo) public epochs;

    /// @notice Boundary roots: boundaryId => merkleRoot
    /// @dev boundaryId = keccak256(abi.encodePacked(country, layer, jurisdiction, id))
    mapping(bytes32 => bytes32) public boundaryRoots;

    /// @notice Boundary metadata
    struct BoundaryInfo {
        bytes3 country;          // ISO 3166-1 alpha-3
        bytes32 layer;           // keccak256("congress"), etc.
        uint256 population;      // Estimated population
        uint256 lastUpdated;
        bool isActive;
    }
    mapping(bytes32 => BoundaryInfo) public boundaries;

    /// @notice Layer configuration
    struct LayerConfig {
        uint8 treeDepth;         // Merkle tree depth
        uint256 maxCapacity;     // Max leaves (2^depth)
        bool requiresEpochSync;  // Must update with epoch
    }
    mapping(bytes32 => LayerConfig) public layerConfigs;

    // ============ Events ============

    event EpochAdvanced(
        uint256 indexed epoch,
        bytes32 globalCommitment,
        string ipfsCid,
        uint256 boundaryCount
    );

    event BoundaryUpdated(
        bytes32 indexed boundaryId,
        bytes32 oldRoot,
        bytes32 newRoot,
        uint256 indexed epoch
    );

    event BoundaryRegistered(
        bytes32 indexed boundaryId,
        bytes3 country,
        bytes32 layer,
        uint256 population
    );

    // ============ Views ============

    /**
     * @notice Check if a merkle root is valid for a boundary
     * @param boundaryId Boundary identifier
     * @param merkleRoot Root to validate
     */
    function isValidRoot(
        bytes32 boundaryId,
        bytes32 merkleRoot
    ) external view returns (bool) {
        return boundaryRoots[boundaryId] == merkleRoot &&
               boundaries[boundaryId].isActive;
    }

    /**
     * @notice Batch validate multiple roots
     * @param boundaryIds Array of boundary identifiers
     * @param merkleRoots Array of roots to validate
     */
    function isValidRootBatch(
        bytes32[] calldata boundaryIds,
        bytes32[] calldata merkleRoots
    ) external view returns (bool) {
        require(boundaryIds.length == merkleRoots.length, "Length mismatch");

        for (uint i = 0; i < boundaryIds.length; i++) {
            if (boundaryRoots[boundaryIds[i]] != merkleRoots[i]) {
                return false;
            }
            if (!boundaries[boundaryIds[i]].isActive) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Get tree depth for a boundary layer
     * @param layer Layer identifier (e.g., keccak256("congress"))
     */
    function getTreeDepth(bytes32 layer) external view returns (uint8) {
        return layerConfigs[layer].treeDepth;
    }

    // ============ Governance Functions ============

    /**
     * @notice Advance to new epoch (batch update)
     * @dev Requires governance timelock
     */
    function advanceEpoch(
        bytes32 globalCommitment,
        string calldata ipfsCid,
        bytes32[] calldata boundaryIds,
        bytes32[] calldata newRoots
    ) external onlyGovernance {
        require(boundaryIds.length == newRoots.length, "Length mismatch");

        currentEpoch++;

        // Update all boundary roots
        for (uint i = 0; i < boundaryIds.length; i++) {
            bytes32 oldRoot = boundaryRoots[boundaryIds[i]];
            boundaryRoots[boundaryIds[i]] = newRoots[i];

            emit BoundaryUpdated(
                boundaryIds[i],
                oldRoot,
                newRoots[i],
                currentEpoch
            );
        }

        // Store epoch metadata
        epochs[currentEpoch] = EpochInfo({
            activatedAt: block.timestamp,
            globalCommitment: globalCommitment,
            ipfsCid: ipfsCid,
            boundaryCount: boundaryIds.length
        });

        emit EpochAdvanced(
            currentEpoch,
            globalCommitment,
            ipfsCid,
            boundaryIds.length
        );
    }

    /**
     * @notice Register a new boundary type
     */
    function registerBoundary(
        bytes32 boundaryId,
        bytes3 country,
        bytes32 layer,
        uint256 population,
        bytes32 initialRoot
    ) external onlyGovernance {
        require(!boundaries[boundaryId].isActive, "Already registered");

        boundaries[boundaryId] = BoundaryInfo({
            country: country,
            layer: layer,
            population: population,
            lastUpdated: block.timestamp,
            isActive: true
        });

        boundaryRoots[boundaryId] = initialRoot;

        emit BoundaryRegistered(boundaryId, country, layer, population);
    }

    /**
     * @notice Configure layer parameters
     */
    function configureLayer(
        bytes32 layer,
        uint8 treeDepth,
        bool requiresEpochSync
    ) external onlyGovernance {
        layerConfigs[layer] = LayerConfig({
            treeDepth: treeDepth,
            maxCapacity: uint256(1) << treeDepth,
            requiresEpochSync: requiresEpochSync
        });
    }
}
```

### 5.2 Global Commitment Scheme

Each epoch has a global commitment that summarizes the entire forest:

```typescript
/**
 * Compute global commitment for an epoch
 *
 * This enables efficient verification that a set of boundary roots
 * are consistent with the published epoch.
 */
function computeGlobalCommitment(
  boundaryRoots: Map<BoundaryId, Field>
): Field {
  // Sort boundary IDs for deterministic ordering
  const sortedIds = Array.from(boundaryRoots.keys()).sort();

  // Build sparse Merkle tree of all roots
  const leaves: Field[] = sortedIds.map(id => {
    const idHash = poseidon2Hash(serializeBoundaryId(id));
    const root = boundaryRoots.get(id)!;
    return poseidon2Hash(idHash, root);
  });

  // Compute root of roots
  return buildMerkleTree(leaves).root;
}
```

---

## 6. Data Distribution Architecture

### 6.1 IPFS Pinning Strategy

```
Shadow Atlas IPFS Structure
│
├── /epoch-{N}/                        # Epoch root directory
│   ├── manifest.json                  # Epoch metadata + boundary index
│   ├── global-commitment.bin          # Single field element
│   │
│   ├── /US/                           # Country shard
│   │   ├── manifest.json              # Country-level index
│   │   ├── /congress/
│   │   │   ├── index.json             # District list + roots
│   │   │   ├── cd119-ca-12.bin        # Serialized tree (CBOR)
│   │   │   └── ...
│   │   ├── /state-senate/
│   │   ├── /state-house/
│   │   ├── /county/
│   │   ├── /municipal/
│   │   ├── /school/
│   │   └── /special/
│   │
│   ├── /GB/
│   ├── /DE/
│   └── ... (190 countries)
│
└── /latest -> /epoch-{N}              # Symlink to current epoch
```

### 6.2 Client Fetching Strategy

```typescript
interface ShadowAtlasClient {
  /**
   * Fetch boundary data on-demand
   *
   * Strategy:
   * 1. Check IndexedDB cache
   * 2. Fetch from IPFS gateway if miss
   * 3. Verify against on-chain root
   * 4. Cache for future use
   */
  async getBoundary(boundaryId: BoundaryId): Promise<BoundaryTree>;

  /**
   * Prefetch boundaries for an address
   *
   * Given coordinates, predict which boundaries the user
   * likely belongs to and prefetch them.
   */
  async prefetchForLocation(
    coords: Coordinates,
    layers?: BoundaryLayer[]
  ): Promise<void>;

  /**
   * Generate proof for boundary membership
   */
  async generateProof(
    address: NormalizedAddress,
    boundaryId: BoundaryId,
    campaignId: Field,
    userSecret: Field
  ): Promise<Proof>;

  /**
   * Generate composite proof for multiple boundaries
   */
  async generateCompositeProof(
    address: NormalizedAddress,
    boundaryIds: BoundaryId[],  // Max 4
    campaignId: Field,
    userSecret: Field
  ): Promise<CompositeProof>;
}
```

### 6.3 Storage Estimates

**Per Depth Class (leaf size = 32 bytes):**

| Depth Class | Leaves | Tree Size | Notes |
|-------------|--------|-----------|-------|
| City Council (14) | ~16K | ~500 KB | Council, precinct, small special |
| Congressional (20) | ~1M | ~32 MB | Congress, state legislature, county |
| State Mega (22) | ~4M | ~128 MB | CA, TX, FL, national boundaries |

**Aggregate Storage:**

| Layer | Count | Depth | Storage |
|-------|-------|-------|---------|
| US Congressional | 435 | 20 | ~14 GB |
| US State Legislature | ~7,400 | 20 | ~237 GB |
| US Counties | 3,143 | 20 | ~100 GB |
| US Municipal | 32,041 | 14 | ~16 GB |
| US Council/Ward | ~50,000 | 14 | ~25 GB |
| US Voting Precincts | ~178,000 | 14 | ~89 GB |
| US Special Districts | ~15,000 | 14 | ~8 GB |
| **US Total** | ~300,000 | mixed | **~500 GB** |

**Global Estimate:**

| Region | Boundaries | Storage |
|--------|------------|---------|
| United States | ~300,000 | ~500 GB |
| European Union | ~150,000 | ~250 GB |
| Other OECD | ~100,000 | ~150 GB |
| Rest of World | ~1.5M | ~600 GB |
| **Global Total** | ~2M | **~1.5 TB** |

**IPFS Pinning Cost:**
- Pinata 2 TB plan: $350/month (global coverage)
- NFT.storage (Filecoin): $0 (free perpetual storage, slower retrieval)
- Self-hosted IPFS: Server cost only (~$200/month for 2TB SSD)

---

## 7. International Scaling

### 7.1 Country Provider Interface

```typescript
/**
 * Country-specific boundary provider
 *
 * Each country implements this interface to normalize
 * their governance structure to the Shadow Atlas schema.
 */
export interface CountryBoundaryProvider {
  readonly countryCode: string;  // ISO 3166-1 alpha-2
  readonly countryName: string;

  /**
   * Layer mapping: country-specific names → standard layers
   *
   * Examples:
   *   US: { "congressional_district" → "congress" }
   *   UK: { "parliamentary_constituency" → "parliament" }
   *   DE: { "wahlkreis" → "bundestag" }
   */
  readonly layerMapping: Map<string, BoundaryLayer>;

  /**
   * Available layers for this country
   */
  readonly availableLayers: BoundaryLayer[];

  /**
   * Data sources for each layer
   */
  readonly dataSources: Map<BoundaryLayer, DataSource>;

  /**
   * Resolve boundaries for an address
   */
  resolveBoundaries(
    address: Address,
    coords: Coordinates
  ): Promise<ResolvedBoundary[]>;

  /**
   * Download all boundaries for a layer
   */
  downloadLayer(
    layer: BoundaryLayer,
    options?: DownloadOptions
  ): Promise<BoundaryCollection>;

  /**
   * Build Merkle trees for all boundaries
   */
  buildTrees(
    boundaries: BoundaryCollection
  ): Promise<Map<BoundaryId, MerkleTree>>;
}
```

### 7.2 Governance Structure Templates

```typescript
// US Federal System
const US_GOVERNANCE: GovernanceStructure = {
  type: 'federal',
  layers: [
    { name: 'congress', level: 'federal', count: 435 },
    { name: 'state-senate', level: 'state', count: 1972 },
    { name: 'state-house', level: 'state', count: 5411 },
    { name: 'county', level: 'county', count: 3143 },
    { name: 'municipal', level: 'municipal', count: 32041 },
    { name: 'council', level: 'municipal', count: 50000 },
    { name: 'school-unified', level: 'special', count: 10526 },
    { name: 'voting-precinct', level: 'electoral', count: 178000 },
  ],
};

// UK Parliamentary System
const UK_GOVERNANCE: GovernanceStructure = {
  type: 'parliamentary',
  layers: [
    { name: 'parliament', level: 'federal', count: 650 },  // Westminster
    { name: 'council', level: 'local', count: 8000 },      // Wards
    { name: 'parish', level: 'local', count: 10000 },      // Civil parishes
  ],
  devolved: {
    scotland: [
      { name: 'scottish-parliament', level: 'regional', count: 129 },
    ],
    wales: [
      { name: 'senedd', level: 'regional', count: 60 },
    ],
    northern_ireland: [
      { name: 'assembly', level: 'regional', count: 90 },
    ],
  },
};

// German Federal System
const DE_GOVERNANCE: GovernanceStructure = {
  type: 'federal',
  layers: [
    { name: 'bundestag', level: 'federal', count: 299 },   // Wahlkreise
    { name: 'landtag', level: 'state', count: 1800 },      // State parliaments
    { name: 'kreis', level: 'county', count: 401 },        // Districts
    { name: 'gemeinde', level: 'municipal', count: 10800 }, // Municipalities
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

## 8. Cost Model (Public Data Only)

### 8.1 Data Acquisition Costs

| Source Type | Count | Cost | Notes |
|-------------|-------|------|-------|
| Census TIGER (US) | 300k boundaries | $0 | Public domain |
| Ordnance Survey (UK) | 50k boundaries | $0 | Open Government License |
| BKG (Germany) | 15k boundaries | $0 | Open data |
| IGN (France) | 40k boundaries | $0 | Open data |
| Statistics Canada | 10k boundaries | $0 | Open data |
| OpenStreetMap | 2M boundaries | $0 | ODbL |
| **Total Data** | ~2M boundaries | **$0** | |

### 8.2 Infrastructure Costs

| Component | Specification | Monthly Cost |
|-----------|--------------|--------------|
| IPFS Pinning (Pinata) | 2 TB (global) | $350 |
| CDN (Cloudflare R2) | 5 TB bandwidth | $50 |
| Build Pipeline (GitHub Actions) | 50k minutes | $40 |
| Monitoring (Grafana Cloud) | Basic | $0 (free tier) |
| **Total Infrastructure** | | **$440/month** |

*Note: US-only deployment (Phase 1) requires ~500 GB, reducing to ~$150/month.*

### 8.3 Engineering Costs (One-Time)

| Phase | Scope | Hours | Cost @ $150/hr |
|-------|-------|-------|----------------|
| Phase 1 | US Foundation (complete) | 400 | $60k |
| Phase 2 | G7 Countries (6) | 240 | $36k |
| Phase 3 | OECD + BRICS (30) | 300 | $45k |
| Phase 4 | Global (150) | 200 | $30k |
| **Total Engineering** | | **1,140 hrs** | **$171k** |

### 8.4 Comparison to Commercial APIs

| Provider | Cost per Lookup | 1M Lookups/month | Shadow Atlas |
|----------|----------------|------------------|--------------|
| Google Civic | $0.007 | $7,000 | $0 |
| Mapbox Boundaries | $0.005 | $5,000 | $0 |
| Cicero | $0.03 | $30,000 | $0 |
| **Shadow Atlas (US)** | **$0** | **$0** | **$150** (infra) |
| **Shadow Atlas (Global)** | **$0** | **$0** | **$440** (infra) |

**Break-even:** ~21,000 lookups/month vs Google Civic (US-only), ~63,000 for global

---

## 9. Migration Path

### 9.1 From Current Single-Tree Architecture

1. **Phase 1 (Current):** Single `district_membership` circuit, US congressional only
2. **Phase 2:** Add layer-specific trees (state legislature, county, municipal)
3. **Phase 3:** Implement `composite_membership` circuit
4. **Phase 4:** Add international countries (UK, DE, FR, CA)
5. **Phase 5:** Global rollout with OSM fallback

### 9.2 Circuit Evolution

```
v1.0 (current):  district_membership     → 1 boundary proof
v2.0 (next):     composite_membership_4  → 4 boundary proofs
v3.0 (future):   composite_membership_8  → 8 boundary proofs
```

### 9.3 Smart Contract Evolution

```solidity
// v1: Simple root mapping
mapping(bytes32 => bool) public shadowAtlasRoots;

// v2: Layered registry with metadata
ShadowAtlasRegistry public registry;

// v3: Multi-epoch support with historical proofs
ShadowAtlasRegistryV2 public registry;  // Supports epoch-pinned proofs
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

- **Merkle commitments:** Every tree root is cryptographically bound to its leaves
- **Global commitment:** Epoch commitment binds all boundary roots together
- **IPFS CID:** Content-addressed storage ensures data integrity
- **On-chain registry:** Smart contract provides tamper-evident root storage

### 10.3 Privacy Guarantees

- **Zero-knowledge:** Proof reveals only membership, not specific address
- **Nullifier unlinkability:** Different campaigns produce unlinkable nullifiers
- **Multi-boundary privacy:** Composite proof doesn't reveal which specific boundaries

---

## 11. Implementation Checklist

### Phase 1: Foundation (Current)
- [x] Single-boundary circuit (`district_membership`)
- [x] US TIGER PLACE provider
- [x] Multi-layer coordinator
- [x] Geographic validation pipeline

### Phase 2: Multi-Boundary (Next)
- [ ] `composite_membership` circuit (4 boundaries)
- [ ] `ShadowAtlasRegistry` contract
- [ ] Layer-specific tree generation
- [ ] IPFS forest structure

### Phase 3: International
- [ ] UK provider (Ordnance Survey)
- [ ] Germany provider (BKG)
- [ ] France provider (IGN)
- [ ] Canada provider (StatCan)

### Phase 4: Global
- [ ] OpenStreetMap universal provider
- [ ] 190-country coverage
- [ ] Community contribution system

---

**Authors:** Claude Code
**License:** MIT
**Repository:** https://github.com/communisaas/voter-protocol
