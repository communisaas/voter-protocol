> [!NOTE]
> **HISTORICAL ANALYSIS — Alternative Design (Not Implemented)**
>
> This document analyzes a proposed "cell-commitment model" where redistricting invalidates
> all user credentials. The implemented **two-tree architecture** uses a different approach:
> Tree 1 (user identity, stable) is separated from Tree 2 (cell→district mappings, updatable).
>
> This analysis informed the two-tree design decision but does not describe the current system.
> See `specs/TWO-TREE-ARCHITECTURE-SPEC.md` for the implemented architecture.

---

# Redistricting Impact Analysis: Cell-Commitment Model

> **Analysis ID:** ANALYSIS-REDISTRICT-001
> **Version:** 1.0.0
> **Status:** Complete
> **Date:** 2026-02-02
> **Author:** Voter Protocol Analysis Team

---

## Executive Summary

This analysis compares redistricting implications between the **per-district model** (current) and the **cell-commitment model** (proposed) described in GLOBAL_MERKLE_SPEC.md. The cell-commitment model represents a fundamental architectural shift where geographic cells (Census Block Groups) replace individual districts as Merkle tree leaves.

**Key Finding:** The cell-commitment model **significantly amplifies redistricting complexity** compared to the per-district model, affecting 100-1000x more data structures during boundary updates while providing a more complete "geographic identity" primitive.

**Critical Trade-off:**
- **Per-District:** Surgical updates (50-200 district trees)
- **Cell-Commitment:** Cascade updates (~50,000-200,000 cells per congressional redistricting)

---

## 1. Architecture Comparison

### 1.1 Per-District Model (Current)

**Tree Structure:**
```
Separate Merkle tree per district type
├── Congressional District 1 Tree
│   ├── Address A (leaf)
│   ├── Address B (leaf)
│   └── ... (~760K addresses)
├── Congressional District 2 Tree
│   └── ... (~760K addresses)
└── ... (435 congressional trees total)
```

**Leaf Structure:**
```typescript
// One leaf = one address in one district
leaf_hash = Poseidon2(address_hash)
```

**Proof Reveals:**
- Single district membership
- Merkle root identifies which district
- User generates separate proof per district type

### 1.2 Cell-Commitment Model (Proposed)

**Tree Structure:**
```
Single global Merkle tree with cell leaves
├── Cell 060370001001 (Leaf)
│   ├── identity_commitment: H(user_secret, cell_id)
│   ├── district_commitment: H(districts[0..13])
│   └── districts[14]: All district hashes (PUBLIC)
├── Cell 060370001002 (Leaf)
│   └── ... (14 districts)
└── ... (~242K cells for US)
```

**Leaf Structure:**
```typescript
// One leaf = one cell with ALL district assignments
interface CellLeaf {
  cell_id: string;                    // Census Block Group GEOID
  identity_commitment: Field;         // H(user_secret, cell_id)
  boundary_commitment: Field;         // H(district_hashes[14])
  district_hashes: [Field; 14];       // All 14 districts (PUBLIC)
}

leaf_hash = Poseidon2([
  cell_id,
  identity_commitment,
  boundary_commitment
])
```

**Proof Reveals:**
- ALL 14 district memberships simultaneously
- User's complete "district profile"
- Single proof for entire geographic identity

---

## 2. Redistricting Scope Comparison

### 2.1 Congressional Redistricting (2030 Example)

**Scenario:** Decennial redistricting affecting all 435 congressional districts

#### Per-District Model Impact:

| Metric | Value | Notes |
|--------|-------|-------|
| **Districts Affected** | 435 | All congressional districts |
| **Trees to Rebuild** | 435 | One tree per district |
| **Users Impacted** | ~330M | All US population |
| **Addresses to Re-hash** | ~140M | All residential addresses |
| **Average Tree Size** | ~760K addresses | CD-specific |
| **Tree Depth** | 20 levels | 2^20 = ~1M capacity |
| **Rebuild Time (Sequential)** | ~58 minutes | 435 × 8s per tree |
| **Rebuild Time (Parallel)** | ~2-3 minutes | 50 workers × 8s batches |
| **IPFS Upload** | ~22GB | 435 trees × ~50MB each |
| **Contract Updates** | 435 transactions | One per district root |

**Isolation:** Other district types (state senate, county, etc.) **UNAFFECTED**

#### Cell-Commitment Model Impact:

| Metric | Value | Notes |
|--------|-------|-------|
| **Cells Containing CD Slot** | ~242,000 | ALL US cells |
| **Cells with Changed CD** | ~242,000 | Entire nation |
| **Cell Updates Required** | ~242,000 | Every cell leaf must change |
| **district_commitment Updates** | ~242,000 | H(districts[0..13]) changes |
| **Addresses Impacted** | ~330M | All US population |
| **Single Tree to Rebuild** | 1 | Global tree |
| **Tree Depth** | 18 levels | 2^18 = ~262K capacity |
| **Rebuild Time** | ~8 seconds | Single tree |
| **IPFS Upload** | ~5GB | Full tree replacement |
| **Contract Updates** | 1 transaction | Global root update |
| **Cascade Effect** | 100% cells | ANY slot change affects entire cell |

**Key Difference:**
- Per-district: **435 trees × 8s = 58 minutes** (parallelizable to ~3 min)
- Cell-commitment: **1 tree × 8s = 8 seconds** (BUT 242K cells changed)

---

### 2.2 State Legislative Redistricting

**Scenario:** California state senate redistricting (40 districts)

#### Per-District Model:

- **Trees to Rebuild:** 40 (CA state senate districts only)
- **Users Impacted:** ~39M (CA population)
- **Other States:** UNAFFECTED
- **Other CA Districts:** UNAFFECTED (congress, assembly, county, etc.)
- **Rebuild Time:** 40 × 8s = ~5 minutes (or ~10s with parallelism)

#### Cell-Commitment Model:

- **Cells to Update:** ~23,000 (all CA cells)
- **district_commitment Changes:** ~23,000 (slot 1 = state_senate)
- **Users Impacted:** ~39M (CA population)
- **Other States:** UNAFFECTED (country-level sharding helps here)
- **Rebuild Time:** ~8 seconds (CA subtree only)
- **But:** Every CA user needs new proof (district_commitment changed)

---

### 2.3 Local Redistricting (Single City)

**Scenario:** Los Angeles City Council redistricting (15 districts)

#### Per-District Model:

- **Trees to Rebuild:** 15 (LA city council districts)
- **Users Impacted:** ~4M (LA city population)
- **Other Cities:** UNAFFECTED
- **Other LA Districts:** UNAFFECTED
- **Rebuild Time:** 15 × 8s = ~2 minutes

#### Cell-Commitment Model:

- **Cells to Update:** ~3,000 (LA metro area cells)
- **district_commitment Changes:** ~3,000 (slot 4 = city_council)
- **Users Impacted:** ~4M (LA city population)
- **Rebuild Time:** ~8 seconds (rebuild CA subtree)
- **Cascade:** ANY slot change invalidates entire cell commitment

---

## 3. district_commitment Invalidation Analysis

### 3.1 The Cascade Problem

In the cell-commitment model, a cell's `district_commitment` is computed as:

```typescript
boundary_commitment = H(districts[0] || districts[1] || ... || districts[13])
```

**Critical Property:** Changing ANY district slot invalidates the ENTIRE commitment.

**Concrete Example (Congressional Redistricting):**

```typescript
// BEFORE redistricting
Cell 060370001001 districts:
[0] congressional: "US-CA-CD12" → hash: 0xabcd...
[1] state_senate: "US-CA-SD11" → hash: 0x1234...
[2] state_assembly: "US-CA-AD17" → hash: 0x5678...
... (11 more slots)

boundary_commitment_OLD = H([0xabcd, 0x1234, 0x5678, ...])  // 14 hashes
leaf_hash_OLD = H(cell_id, identity_commitment, boundary_commitment_OLD)

// AFTER redistricting (CD12 → CD14)
Cell 060370001001 districts:
[0] congressional: "US-CA-CD14" → hash: 0x9999...  ← CHANGED
[1] state_senate: "US-CA-SD11" → hash: 0x1234...   ← UNCHANGED
[2] state_assembly: "US-CA-AD17" → hash: 0x5678... ← UNCHANGED
... (11 more slots, all unchanged)

boundary_commitment_NEW = H([0x9999, 0x1234, 0x5678, ...])  // Different!
leaf_hash_NEW = H(cell_id, identity_commitment, boundary_commitment_NEW)
```

**Result:** User's old proof references `boundary_commitment_OLD`, but Merkle tree now contains `leaf_hash_NEW`. **Proof verification FAILS.**

**Scale:** This happens to ~242K cells for congressional redistricting.

---

### 3.2 Comparison: district_commitment vs Per-District Roots

| Aspect | Per-District Model | Cell-Commitment Model |
|--------|-------------------|----------------------|
| **Invalidation Scope** | ONLY affected districts | ALL cells in affected area |
| **Example: CD Redistricting** | 435 district roots change | 242K cell commitments change |
| **User Re-registration** | Only if user's CD changed | ALL users (commitment changed for everyone) |
| **Proof Validity** | Old CD proofs work during grace period | Old proofs FAIL (commitment mismatch) |
| **Isolation** | Other district types unaffected | Any slot change cascades to all slots |
| **Grace Period Complexity** | Multiple valid roots (old + new) | Multiple valid commitments per cell? |

---

## 4. Versioning Strategy Analysis

### 4.1 Per-District Model Versioning

**Current Approach (DESIGN-003):**

```typescript
interface DualValidityWindow {
  oldEpoch: {
    epochNumber: 42;
    districtRoots: {
      "US-CA-CD12": "0xabcd...",  // Old root
      "US-CA-CD13": "0xdef0...",
      // ... 435 roots
    }
  };
  newEpoch: {
    epochNumber: 43;
    districtRoots: {
      "US-CA-CD12": "0x9999...",  // New root
      "US-CA-CD13": "0x8888...",
      // ... 435 roots
    }
  };
  windowDuration: 30 days;
}
```

**Proof Verification:**
```solidity
function verify(proof, districtId, claimedRoot) {
  // Check if claimed root matches current epoch
  if (claimedRoot == currentEpoch.districtRoots[districtId]) {
    return true;  // Current epoch
  }

  // Check dual-validity window
  if (dualWindow.active && claimedRoot == dualWindow.oldEpoch.districtRoots[districtId]) {
    return true;  // Old epoch still valid during grace period
  }

  return false;
}
```

**Complexity:** O(1) per district (simple root lookup)

### 4.2 Cell-Commitment Model Versioning

**Option A: Multiple Cell Roots (Per-Cell Versioning)**

```typescript
interface CellVersioning {
  cellId: "060370001001";
  currentVersion: {
    version: 2;
    boundary_commitment: "0x9999...";  // New commitment
    district_hashes: [...];             // New districts
  };
  previousVersions: [
    {
      version: 1;
      boundary_commitment: "0xabcd...";  // Old commitment
      district_hashes: [...];             // Old districts
      validUntil: "2030-07-31";          // Grace period end
    }
  ];
}
```

**Merkle Tree Impact:**
- Tree must contain BOTH old and new leaf hashes during grace period
- Tree doubles in size (242K cells × 2 = 484K leaves)
- Depth increases (18 → 19 levels)
- OR: Maintain two separate trees (old epoch, new epoch)

**Storage Overhead:** 2× during grace period

**Option B: Global Version with Cell-Level Diffs**

```typescript
interface GlobalVersioning {
  globalVersion: 2;
  changedCells: {
    "060370001001": {
      oldCommitment: "0xabcd...",
      newCommitment: "0x9999...",
    },
    // ... 242K changed cells
  };
  dualValidityWindow: {
    openedAt: "2030-01-01";
    closesAt: "2030-01-31";
  };
}
```

**Verification Logic:**
```solidity
function verifyCellProof(proof, cellId, claimedCommitment) {
  // Check current tree
  if (merkleVerify(proof, globalRoot)) {
    return true;
  }

  // Check if dual-validity applies to this cell
  if (dualWindow.active && changedCells[cellId].exists) {
    // Try old commitment
    if (claimedCommitment == changedCells[cellId].oldCommitment) {
      // Re-verify with old commitment
      return merkleVerifyWithOldLeaf(proof, oldGlobalRoot, cellId);
    }
  }

  return false;
}
```

**Complexity:** O(log n) + O(1) lookup per cell

**Option C: Temporal Epochs (Snapshot Trees)**

```typescript
interface EpochSnapshot {
  epochNumber: 43;
  globalRoot: "0x1111...";
  treeSnapshot: IPFSCid;           // Full tree at this epoch
  previousEpoch: {
    epochNumber: 42;
    globalRoot: "0x0000...";
    treeSnapshot: IPFSCid;         // Old tree
    validUntil: "2030-01-31";      // Grace period
  };
}
```

**Verification:**
```solidity
function verify(proof, claimedRoot) {
  // Check current epoch
  if (claimedRoot == currentEpoch.globalRoot) {
    return verifyProof(proof, claimedRoot);
  }

  // Check previous epoch (during grace period)
  if (claimedRoot == previousEpoch.globalRoot && !previousEpoch.expired()) {
    return verifyProof(proof, claimedRoot);
  }

  return false;
}
```

**Storage:** 2 full trees (current + previous epoch) = ~10GB during grace period

---

### 4.3 Versioning Strategy Recommendation

**For Per-District Model:**
- ✅ **Current approach works well:** Multiple district roots coexist
- ✅ **Surgical updates:** Only affected districts versioned
- ✅ **Low complexity:** O(1) root lookup per district

**For Cell-Commitment Model:**
- ⚠️ **Recommend Option C (Temporal Epochs):**
  - Simpler verification logic (just compare global roots)
  - Clean separation between epochs
  - Users download epoch-specific tree from IPFS
  - Dual-validity = accept proofs from two global roots
- ❌ **Avoid Option A:** Per-cell versioning is too complex at 242K cells
- ❌ **Avoid Option B:** Requires storing 242K cell diffs during redistricting

---

## 5. Grace Period Implementation

### 5.1 Per-District Model Grace Period

**Current Design (DESIGN-003):**

```typescript
interface DualValidityWindow {
  emergencyEventId: string;
  state: "US-CA";
  districtType: "congressional";

  oldEpoch: {
    epochNumber: 42;
    roots: Map<DistrictId, Root>;  // 435 roots
  };
  newEpoch: {
    epochNumber: 43;
    roots: Map<DistrictId, Root>;  // 435 new roots
  };

  windowOpenedAt: "2030-01-01";
  windowDuration: 30;  // days
  windowClosesAt: "2030-01-31";
}
```

**User Impact:**
- User's old proof: Uses `oldEpoch.roots["US-CA-CD12"]` = "0xabcd..."
- Verifier: Checks both `oldEpoch.roots` and `newEpoch.roots`
- **Result:** Proof still works (grace period active)

**At Window Close:**
- `oldEpoch.roots` invalidated
- Only `newEpoch.roots` accepted
- Users with old proofs MUST regenerate

**Complexity:** O(D) where D = number of affected districts (e.g., 435 for congressional)

### 5.2 Cell-Commitment Model Grace Period

**Proposed Design (Temporal Epochs):**

```typescript
interface CellModelDualValidity {
  emergencyEventId: string;
  affectedRegion: "US";  // Or "US-CA" for state-level

  oldEpoch: {
    epochNumber: 42;
    globalRoot: "0x0000...";
    ipfsCid: "Qm...OldTree";
  };
  newEpoch: {
    epochNumber: 43;
    globalRoot: "0x1111...";
    ipfsCid: "Qm...NewTree";
    emergencyFlag: true;
  };

  windowOpenedAt: "2030-01-01";
  windowDuration: 30;  // days
  windowClosesAt: "2030-01-31";
}
```

**User Impact:**
- User's old proof: References `globalRoot = 0x0000...` (old epoch)
- Verifier: Checks if `0x0000...` is valid (in dual-validity window)
- **Result:** Proof still works (grace period active)

**At Window Close:**
- Only `newEpoch.globalRoot` accepted
- ALL users with old proofs MUST regenerate

**Key Difference from Per-District:**
- **Per-District:** Only users in CHANGED districts need new proofs
- **Cell-Commitment:** ALL users need new proofs (even if their districts didn't change)

**Why?** Because `boundary_commitment` changed for ALL cells (any slot change cascades).

---

### 5.3 Grace Period Duration Trade-offs

| Duration | Per-District Model | Cell-Commitment Model |
|----------|-------------------|----------------------|
| **30 days (default)** | Reasonable for affected districts | Tight for 242K cell updates |
| **60 days** | Ample time | Better for mass re-registration |
| **90 days (max)** | Too long (litigation risk) | Appropriate for nationwide cascade |

**Recommendation:**
- Per-District: 30 days (surgical updates)
- Cell-Commitment: 60-90 days (mass re-registration required)

---

## 6. Client Sync Protocol Changes

### 6.1 Per-District Model Sync

**Current Flow:**

1. **Detection:** User detects district root changed (poll registry contract)
2. **Download:** User downloads affected district tree from IPFS
   - Example: `ipfs://Qm...CD12Tree` (~50MB)
3. **Merkle Path:** User regenerates Merkle path for their address in new tree
4. **Proof:** User generates new ZK proof with new root
5. **Submit:** User submits proof on-chain

**Bandwidth:**
- User in 3 district types (congress, senate, assembly): 3 × 50MB = ~150MB
- Incremental: Only download changed districts

**Time:**
- Download: ~30 seconds (50MB at 1.5MB/s)
- Proof generation: ~10-16 seconds
- Total: ~1 minute per district type

### 6.2 Cell-Commitment Model Sync

**Proposed Flow:**

1. **Detection:** User detects global root changed
2. **Download:** User downloads ENTIRE tree from IPFS
   - Full US tree: `ipfs://Qm...GlobalTree` (~5GB)
   - OR: Country-specific shard: `ipfs://Qm...USTree` (~5GB)
3. **Cell Lookup:** User finds their cell in new tree
4. **Merkle Path:** User regenerates Merkle path (cell → global root)
5. **Proof:** User generates new ZK proof with new global root and ALL 14 districts
6. **Submit:** User submits proof on-chain

**Bandwidth:**
- Full tree download: ~5GB (one-time, then cached)
- Incremental delta (during redistricting): Still ~5GB (most cells changed)

**Time:**
- Download: ~1 hour (5GB at 1.5MB/s)
- Proof generation: ~10-16 seconds
- Total: ~1 hour (first sync), then ~15 seconds (regenerate proof)

---

### 6.3 Incremental Sync Optimization

**Per-District Model:**
- ✅ **Efficient:** Only download changed district trees
- ✅ **Surgical:** 50-200 trees × 50MB = 2.5-10GB total
- ✅ **Parallelizable:** Download multiple districts concurrently

**Cell-Commitment Model:**
- ⚠️ **Bulk:** Download entire tree (~5GB) or nothing
- ⚠️ **Cascade Effect:** Most cells changed, so delta is ~5GB anyway
- ✅ **One-time:** After initial sync, only update global root

**Delta Optimization (Cell Model):**

```typescript
interface CellTreeDelta {
  oldRoot: "0x0000...";
  newRoot: "0x1111...";
  changedCells: {
    cellId: string;
    oldLeaf: bigint;
    newLeaf: bigint;
    newDistricts: bigint[14];
  }[];  // ~242K changed cells for CD redistricting
}
```

**Compression:** Changed cells delta = ~242K × 600 bytes = ~145MB compressed

**Verdict:** Delta optimization helps (145MB vs 5GB), but still 3× larger than per-district incremental (50MB per district).

---

## 7. SLA Impact Assessment

### 7.1 Current SLA (Per-District Model)

From DESIGN-003-REDISTRICTING-PROTOCOL.md:

| Metric | Target | Notes |
|--------|--------|-------|
| **Detection Latency** | <4 hours | PACER polling frequency |
| **Ingestion Time** | <24 hours | Validation + approval |
| **Notification Delivery** | <48 hours | All affected users |
| **Tree Rebuild** | <5 minutes | 435 trees × 8s = 58 min, parallelized to ~3 min |
| **IPFS Upload** | <30 minutes | 22GB @ 10MB/s |
| **Contract Update** | <2 minutes | 435 transactions |
| **Total SLA** | **48 hours** | Detection → all users notified |

**Achievable:** ✅ Yes, with parallel tree building

### 7.2 Cell-Commitment Model SLA

| Metric | Target | Reality |
|--------|--------|---------|
| **Detection Latency** | <4 hours | Same as per-district |
| **Ingestion Time** | <24 hours | Same (validation + approval) |
| **Tree Rebuild** | <1 minute | Single tree (8 seconds) |
| **IPFS Upload** | <5 minutes | 5GB @ 15MB/s |
| **Contract Update** | <1 minute | Single transaction |
| **Notification Delivery** | <48 hours | ALL users (vs only affected) |
| **User Sync Time** | **1-4 hours** | 5GB download @ 1-5MB/s |
| **Total SLA** | **48 hours** | BUT: users need hours to sync |

**Key Difference:**
- Per-District: Users download ~50MB, sync in ~1 minute
- Cell-Commitment: Users download ~5GB, sync in ~1 hour (or 145MB delta in ~2 minutes)

**SLA Achievability:**
- ✅ **Server-side:** Faster (single tree rebuild)
- ⚠️ **Client-side:** Slower (bulk download required)
- ❓ **User experience:** 1-hour sync during redistricting acceptable?

---

### 7.3 Emergency Redistricting SLA

**Scenario:** Court-ordered redistricting with immediate effect (e.g., Alabama 2023)

**Per-District Model:**
- Court order (Day 0) → Data ingestion (Day 1) → Trees rebuilt (Day 1) → Users notified (Day 2)
- Users in affected districts: Download ~50MB, regenerate proof (~1 min)
- **Critical path:** 48 hours (server) + 1 minute (client)

**Cell-Commitment Model:**
- Court order (Day 0) → Data ingestion (Day 1) → Tree rebuilt (Day 1) → Users notified (Day 2)
- ALL users: Download ~5GB (or 145MB delta), regenerate proof (~1 min)
- **Critical path:** 48 hours (server) + 1 hour (client full download) OR 2 minutes (delta)

**Verdict:** Cell-commitment model is acceptable IF delta optimization implemented (145MB download).

---

## 8. Annual Update Frequency Impact

### 8.1 Redistricting Frequency by Type

| District Type | Update Frequency | Typical Scale | Affected Users |
|--------------|------------------|---------------|----------------|
| **Congressional** | 10 years (+ court orders) | 435 districts | 330M (all US) |
| **State Senate** | 10 years (+ court orders) | ~2,000 districts | State-level |
| **State Assembly** | 10 years (+ court orders) | ~5,000 districts | State-level |
| **County** | Rare (annexation) | ~3,200 counties | County-level |
| **City Council** | 10 years (some annual) | ~19,000 municipalities | City-level |
| **School Board** | 10 years | ~13,000 districts | District-level |
| **Special Districts** | Rare | ~39,000 districts | District-level |

### 8.2 Per-District Model: Isolated Updates

**Example: Los Angeles City Council (annual ward adjustments)**

- **Trees to Rebuild:** 15 (LA city council districts)
- **Users Impacted:** ~4M (LA population)
- **Other Districts:** UNAFFECTED (congress, state, county, etc. unchanged)
- **Rebuild Time:** 15 × 8s = ~2 minutes
- **User Sync:** ~50MB download, ~1 minute

**Isolation Benefit:** Frequent local updates don't trigger nationwide cascades.

### 8.3 Cell-Commitment Model: Amplified Updates

**Same Example: LA City Council (annual ward adjustments)**

- **Cells to Update:** ~3,000 (LA metro area)
- **Users Impacted:** ~4M (LA population)
- **Other Districts:** UNAFFECTED (other slots unchanged)
- **BUT:** `district_commitment` changes for ALL ~3,000 LA cells
- **Rebuild Time:** ~8 seconds (rebuild CA subtree)
- **User Sync:** ~145MB delta (if delta optimization), OR ~5GB full tree

**Amplification:**
- Per-District: 15 trees, 50MB per user
- Cell-Commitment: 3,000 cells changed, 145MB delta per user

**Frequency Impact:**
- If LA does annual adjustments: Per-district users download 50MB/year
- Cell-commitment users: Download 145MB/year (3× more bandwidth)

**Scaling to Multiple Cities:**
- 50 large cities doing annual adjustments
- Per-district: Users only download their city's tree (50MB)
- Cell-commitment: Accumulates to ~7GB/year (50 × 145MB)

---

### 8.4 Update Amplification Factor

| Redistricting Event | Per-District Updates | Cell-Commitment Updates | Amplification Factor |
|---------------------|---------------------|------------------------|---------------------|
| **Congressional (all 435)** | 435 trees | 242,000 cells | **556×** |
| **Single State Senate (40)** | 40 trees | ~23,000 cells | **575×** |
| **Single City Council (15)** | 15 trees | ~3,000 cells | **200×** |
| **Special District (1)** | 1 tree | ~500 cells | **500×** |

**Key Insight:** Cell-commitment model amplifies updates by **100-1000× in terms of data structures changed**.

However, because it's a single global tree, **rebuild time is faster** (8s vs 58 min for 435 trees).

**Trade-off:**
- Per-District: Slower rebuild (minutes), surgical updates (only affected districts)
- Cell-Commitment: Faster rebuild (seconds), cascade updates (all cells in region)

---

## 9. SLA Comparison Matrix

### 9.1 Congressional Redistricting (435 Districts)

| Metric | Per-District Model | Cell-Commitment Model | Winner |
|--------|-------------------|----------------------|--------|
| **Detection** | 4 hours | 4 hours | Tie |
| **Data Ingestion** | 24 hours | 24 hours | Tie |
| **Tree Rebuild** | 3 minutes (parallel) | 8 seconds | Cell ✅ |
| **IPFS Upload** | 30 minutes (22GB) | 5 minutes (5GB) | Cell ✅ |
| **Contract Updates** | 2 minutes (435 txns) | 1 minute (1 txn) | Cell ✅ |
| **User Notification** | 48 hours | 48 hours | Tie |
| **User Sync Time** | 1 minute (50MB) | 1 hour (5GB) OR 2 min (145MB delta) | Per-District ✅ |
| **Total Server SLA** | ~48 hours | ~48 hours | Tie |
| **Total Client SLA** | ~1 minute | ~2 minutes (delta) OR 1 hour (full) | Per-District ✅ (full), Tie (delta) |

### 9.2 State Legislative Redistricting (40 Districts)

| Metric | Per-District Model | Cell-Commitment Model | Winner |
|--------|-------------------|----------------------|--------|
| **Tree Rebuild** | 10 seconds (40 trees, parallel) | 8 seconds (CA subtree) | Cell ✅ |
| **IPFS Upload** | 2 minutes (2GB) | 5 minutes (5GB full) | Per-District ✅ |
| **Contract Updates** | 1 minute (40 txns) | 1 minute (1 txn) | Tie |
| **User Sync Time** | 1 minute (50MB) | 2 minutes (145MB delta) | Per-District ✅ |
| **Users Impacted** | ~39M (CA only) | ~39M (CA only) | Tie |
| **Other States Impacted** | 0 | 0 | Tie |

### 9.3 Local Redistricting (15 Districts)

| Metric | Per-District Model | Cell-Commitment Model | Winner |
|--------|-------------------|----------------------|--------|
| **Tree Rebuild** | 2 minutes (15 trees) | 8 seconds (rebuild subtree) | Cell ✅ |
| **IPFS Upload** | 1 minute (750MB) | 5 minutes (5GB full) | Per-District ✅ |
| **User Sync Time** | 1 minute (50MB) | 2 minutes (145MB delta) | Per-District ✅ |
| **Users Impacted** | ~4M (LA only) | ~4M (LA only) | Tie |
| **Other Cities Impacted** | 0 | 0 (but cells changed) | Per-District ✅ |

---

### 9.4 Overall SLA Assessment

**Server-Side (Shadow Atlas):**
- ✅ **Cell-Commitment Wins:** Faster tree rebuild (8s vs minutes)
- ✅ **Cell-Commitment Wins:** Simpler contract updates (1 txn vs hundreds)
- ❌ **Cell-Commitment Loses:** Larger IPFS uploads (5GB vs surgical 50MB-2GB)

**Client-Side (User Experience):**
- ❌ **Cell-Commitment Loses:** Bulk downloads required (5GB OR 145MB delta)
- ✅ **Per-District Wins:** Surgical downloads (only affected districts, ~50MB)
- ⚠️ **Cell-Commitment Conditional:** IF delta optimization implemented (145MB), competitive

**Verdict:**
- **Per-District Model:** Better for **frequent, localized updates** (city councils, special districts)
- **Cell-Commitment Model:** Better for **infrequent, large-scale updates** (congressional redistricting every 10 years)

**Recommendation:**
- If redistricting is **infrequent** (<1x per year): Cell-commitment acceptable with delta optimization
- If redistricting is **frequent** (annual local adjustments): Per-district model preferred

---

## 10. Grace Period Comparison

### 10.1 Per-District Grace Period

**Design:**
- Multiple district roots coexist (old epoch + new epoch)
- Verifier checks: "Is this root valid for this district?"
- Clean separation: District A's grace period doesn't affect District B

**User Flow:**
1. User has proof for `US-CA-CD12` with `root_old`
2. Redistricting: `US-CA-CD12` gets `root_new`
3. Grace period: BOTH `root_old` and `root_new` accepted
4. User can use old proof during grace period (30 days)
5. After grace: Only `root_new` accepted, user MUST regenerate

**Isolation:**
- User in `US-CA-CD12`: Must regenerate after grace period
- User in `US-CA-CD13`: UNAFFECTED (unless CD13 also redistricted)
- User's state senate proof: UNAFFECTED (different district type)

### 10.2 Cell-Commitment Grace Period

**Design (Temporal Epochs Approach):**
- Two global roots coexist: `global_root_old` and `global_root_new`
- Verifier checks: "Is this global root valid?"
- No per-cell granularity: Global epoch covers ALL cells

**User Flow:**
1. User has proof with `global_root_old`
2. Redistricting: ANY district slot changes → new `global_root_new`
3. Grace period: BOTH `global_root_old` and `global_root_new` accepted
4. User can use old proof during grace period (60-90 days)
5. After grace: Only `global_root_new` accepted, ALL users MUST regenerate

**Cascade:**
- Congressional redistricting (slot 0 changes) → ALL 242K cells have new leaf hashes
- Even if user's congress, senate, assembly, county, city ALL unchanged individually
- User STILL needs new proof (because `boundary_commitment` changed)

**Why?** Because `boundary_commitment = H(districts[0..13])`, and districts[0] changed.

---

### 10.3 Grace Period Duration Recommendations

| Model | Default Duration | Justification |
|-------|-----------------|---------------|
| **Per-District** | 30 days | Only affected users need to re-register; surgical |
| **Cell-Commitment** | 60-90 days | ALL users need to re-register; mass migration |

**Extended Duration for Cell-Commitment:**
- ~330M US users need to download 145MB delta and regenerate proof
- Staggered notifications to avoid IPFS gateway overload
- Need time buffer for users who are offline/traveling

---

## 11. Client Sync Protocol: Incremental Update Strategies

### 11.1 Per-District Incremental Sync

**Scenario:** User has proofs for 3 district types (congress, state senate, city council)

**Before Redistricting:**
```typescript
userProofs = {
  congressional: { districtId: "US-CA-CD12", root: "0xaaaa...", proof: [...] },
  state_senate: { districtId: "US-CA-SD11", root: "0xbbbb...", proof: [...] },
  city_council: { districtId: "US-CA-LA-CD01", root: "0xcccc...", proof: [...] },
}
```

**After Congressional Redistricting:**
```typescript
// User detects: congressional root changed
changedDistricts = ["congressional"];  // Only 1 out of 3 affected

// Incremental sync:
1. Download congressional tree: ipfs://Qm...CD12 (~50MB)
2. Regenerate congressional proof (~10s)
3. Keep state_senate and city_council proofs (UNCHANGED)

// Result: 50MB download, ~15 seconds total
```

**Key Benefit:** Surgical updates, only download what changed.

### 11.2 Cell-Commitment Incremental Sync

**Scenario:** Same user, same redistricting event

**Before Redistricting:**
```typescript
userProof = {
  cellId: "060370001001",
  globalRoot: "0x1111...",
  districtHashes: [
    "0xaaaa...",  // [0] congressional
    "0xbbbb...",  // [1] state_senate
    "0xcccc...",  // [2] city_council
    ...           // [3-13] other districts
  ],
  proof: [...]
}
```

**After Congressional Redistricting:**
```typescript
// User detects: globalRoot changed (0x1111... → 0x2222...)
// Reason: districts[0] changed → boundary_commitment changed → ALL cells changed

// Incremental sync:
1. Download delta: 242K changed cells (~145MB compressed)
2. Find user's cell: "060370001001" with new districts[0] = "0xdddd..."
3. Regenerate proof with new districtHashes array (~10s)

// Result: 145MB download, ~15 seconds total
```

**Key Difference:**
- Per-District: 50MB (only affected district tree)
- Cell-Commitment: 145MB (delta includes all changed cells, even though user only cares about 1)

**Why More Data?** Because ALL cells changed, delta must include all 242K cells.

---

### 11.3 Delta Optimization Techniques

**Per-District Model:**
- ✅ Already optimal: Only download affected district trees
- ✅ Parallelizable: Download multiple district trees concurrently
- ✅ Cacheable: Unaffected trees remain cached

**Cell-Commitment Model (Delta Compression):**

**Technique 1: Selective Cell Download**
```typescript
// Instead of downloading ALL 242K changed cells,
// only download cells in user's region (e.g., California)

userState = "CA";
delta = {
  changedCells: {
    cellsInCA: 23000,  // Only CA cells, not entire US
    dataSize: "6MB compressed"  // Much smaller!
  }
}

// User downloads: 6MB (CA only) instead of 145MB (entire US)
```

**Verdict:** ✅ This helps significantly! Reduces to 6MB for CA users.

**Technique 2: Sparse Updates**
```typescript
// Store only CHANGED district slots per cell
delta = {
  "060370001001": {
    changedSlots: [0],  // Only congressional changed
    districts: {
      [0]: "0xdddd..."  // New congress hash
    }
    // Other 13 slots: UNCHANGED, not transmitted
  }
}

// Result: 242K cells × 50 bytes/cell = ~12MB
```

**Verdict:** ✅ This also helps! Reduces to ~12MB for sparse updates.

**Technique 3: Geometric Hashing (Bloom Filter)**
```typescript
// Client has Bloom filter of cell IDs in user's region
bloomFilter = createBloomFilter(cellsInCA);

// Server sends: Only cells matching Bloom filter
// Result: ~23K cells × 600 bytes = ~14MB
// With false positives: ~20MB
```

**Verdict:** ✅ Efficient for region-specific updates.

---

### 11.4 Final Sync Protocol Recommendation

**Per-District Model:**
- ✅ **Keep current approach:** Download only affected district trees
- ✅ **No optimization needed:** Already surgical

**Cell-Commitment Model:**
- ✅ **Implement Technique 1 (Region-Based Delta):** Only download cells in user's country/state
- ✅ **Implement Technique 2 (Sparse Slot Updates):** Only transmit changed slots
- ⚠️ **Result:** ~6-12MB per user (competitive with per-district's 50MB)

**With Optimizations:**
- Per-District: 50MB (single district tree)
- Cell-Commitment: 6-12MB (region-specific delta with sparse slots)
- **Winner:** Cell-Commitment (if optimizations implemented)

---

## 12. Emergency Redistricting: Court-Ordered Changes

### 12.1 Scenario: Alabama Congressional Districts (2023)

**Background:**
- SCOTUS: Alabama violated VRA, must create 2nd majority-Black district
- Timeline: Court order (Oct 2023) → TIGER release (July 2024) = 9-month gap
- Impact: 7 congressional districts affected, ~5M residents

### 12.2 Per-District Model Response

**Day 0: Court Order**
- Detection: PACER monitor detects order
- Classification: Priority 1 (immediate implementation required)

**Day 1: Data Request**
- Request shapefiles from Alabama Secretary of State
- Validation: Cross-check against court order boundary descriptions

**Day 2: Emergency Epoch**
- Build 7 new district trees (Alabama CDs 1-7)
- Compute new roots: `AL-CD1: 0x1111...`, `AL-CD2: 0x2222...`, etc.
- Open dual-validity window: Old roots + new roots both valid for 30 days
- Publish to IPFS: 7 trees × 50MB = 350MB

**Day 3: User Notification**
- Email/push: "Your district boundaries have changed (court order)"
- Banner: "Regenerate your proof for Alabama CD-2"
- ~5M Alabama residents notified

**Days 4-30: Grace Period**
- Users with old AL-CD2 proofs: Still valid (dual-validity window)
- Users who regenerate: Use new AL-CD2 root
- Other states: UNAFFECTED

**Day 31: Convergence**
- Dual-validity window closes
- Only new roots accepted
- Users must regenerate (or proof fails)

**Timeline:** 30 days (adequate for 5M users to regenerate)

### 12.3 Cell-Commitment Model Response

**Day 0: Court Order**
- Detection: PACER monitor detects order
- Classification: Priority 1

**Day 1: Data Request**
- Request court-approved boundaries
- Validation: Cross-check against court order

**Day 2: Emergency Epoch**
- Identify affected cells: ~12,000 cells in Alabama
- Recompute district_commitment for ALL 12,000 cells (slot 0 = congressional changed)
- Rebuild Alabama subtree (12,000 cells)
- Recompute US root (Alabama subtree changed)
- Recompute global root
- Open dual-validity window: `global_root_old` and `global_root_new` both valid for 60 days
- Publish to IPFS: Full US tree (5GB) OR Alabama delta (3MB)

**Day 3: User Notification**
- Email/push: "Your district boundaries have changed (court order)"
- Banner: "Download updated tree and regenerate proof"
- ~5M Alabama residents notified

**Days 4-60: Grace Period**
- Users with old `global_root_old` proofs: Still valid
- Users who regenerate: Use new `global_root_new`
- Download: Alabama delta (3MB) OR full US tree (5GB)

**Day 61: Convergence**
- Dual-validity window closes
- Only `global_root_new` accepted
- Users must regenerate

**Timeline:** 60 days (more time needed due to bulk download)

---

### 12.4 Emergency Redistricting Comparison

| Metric | Per-District Model | Cell-Commitment Model | Winner |
|--------|-------------------|----------------------|--------|
| **Affected Data Structures** | 7 district trees | 12,000 cells | Per-District ✅ |
| **Tree Rebuild Time** | 7 × 8s = 56 seconds | 8 seconds | Cell ✅ |
| **IPFS Upload Size** | 350MB | 3MB (delta) OR 5GB (full) | Per-District ✅ (delta), Cell ✅ (full) |
| **User Download Size** | 50MB (single district) | 3MB (delta) OR 5GB (full) | Cell ✅ (delta) |
| **Grace Period Duration** | 30 days | 60 days | Per-District ✅ (faster) |
| **Other States Impacted** | 0 | 0 | Tie |
| **Surgical vs Cascade** | 7 trees (surgical) | 12K cells (cascade) | Per-District ✅ |

**Verdict:**
- **With delta optimization:** Cell-commitment is competitive (3MB download)
- **Without delta:** Per-district is better (50MB vs 5GB)
- **Cascade effect:** Per-district wins (surgical updates, no cascade)

---

## 13. Recommendations

### 13.1 Architectural Decision: Per-District vs Cell-Commitment

**Use Cell-Commitment Model IF:**
- ✅ Redistricting is **infrequent** (<1× per year on average)
- ✅ **Full geographic identity disclosure** is valuable (all 14 districts per proof)
- ✅ **Delta optimization** is implemented (region-specific + sparse slot updates)
- ✅ Users have **reliable broadband** (6-12MB downloads acceptable)
- ✅ **Grace periods can be 60-90 days** (time for mass re-registration)
- ✅ **Global tree rebuild speed** is critical (8s vs minutes)

**Use Per-District Model IF:**
- ✅ Redistricting is **frequent** (annual local adjustments)
- ✅ **Surgical updates** are important (only affected districts change)
- ✅ **Minimal user bandwidth** is required (~50MB per district)
- ✅ **30-day grace periods** are sufficient (faster convergence)
- ✅ **Isolation** between district types is critical
- ✅ **Granular rollback** is needed (per-district, not global)

---

### 13.2 Versioning Strategy Recommendation

**Per-District Model:**
- ✅ **Continue current approach:** Multiple roots per district type
- ✅ **Dual-validity:** Old root + new root coexist during grace period
- ✅ **Per-district granularity:** Unaffected districts remain unchanged

**Cell-Commitment Model:**
- ✅ **Temporal Epochs (Option C):** Global snapshots (old epoch + new epoch)
- ✅ **Dual-validity:** Two global roots accepted during grace period
- ✅ **Country sharding:** Users download country-specific deltas
- ✅ **Delta optimization:** Implement region-specific + sparse slot updates

---

### 13.3 Grace Period Recommendations

| Model | Duration | Rationale |
|-------|----------|-----------|
| **Per-District** | 30 days (default), 60 days (extended) | Surgical updates, only affected users re-register |
| **Cell-Commitment** | 60 days (default), 90 days (extended) | Mass re-registration, 6-12MB downloads for all users |

**Extension Triggers:**
- Court appeals pending
- State non-compliance
- IPFS gateway issues
- User adoption lag (>20% still on old epoch at Day 25/55)

---

### 13.4 Client Sync Protocol Recommendations

**Per-District Model:**
- ✅ **No changes needed:** Current incremental sync is efficient
- ✅ **Parallel downloads:** Users can download multiple district trees concurrently

**Cell-Commitment Model:**
- ✅ **Implement delta optimization:**
  - Region-based filtering (user's country/state only)
  - Sparse slot updates (only changed district slots transmitted)
  - Result: ~6-12MB per user
- ✅ **Push notifications:** Alert users immediately when global root changes
- ✅ **Background sync:** Download delta in background, auto-regenerate proof
- ✅ **Fallback:** If delta unavailable, download full tree (5GB) as fallback

---

### 13.5 SLA Recommendations

**Per-District Model:**
- ✅ **Maintain 48-hour server SLA:** Detection → user notification
- ✅ **1-minute client SLA:** User download → proof regeneration
- ✅ **Total:** 48 hours + 1 minute

**Cell-Commitment Model:**
- ✅ **Maintain 48-hour server SLA:** Detection → user notification
- ✅ **2-minute client SLA:** User delta download → proof regeneration (with optimization)
- ⚠️ **1-hour fallback:** If delta unavailable, full tree download
- ✅ **Total:** 48 hours + 2 minutes (optimized) OR 48 hours + 1 hour (fallback)

---

### 13.6 Hybrid Approach: Best of Both Worlds?

**Proposal:** Use **per-district trees for frequent updates, cell-commitment for geographic identity proofs**

**Architecture:**
```typescript
// Separate trees for each use case
interface HybridArchitecture {
  // Per-district trees (for surgical updates)
  districtTrees: {
    congressional: Map<DistrictId, MerkleTree>;
    state_senate: Map<DistrictId, MerkleTree>;
    // ... other district types
  };

  // Cell-commitment tree (for full geographic identity)
  cellTree: {
    globalRoot: bigint;
    cells: Map<CellId, CellLeaf>;  // 242K cells
  };
}
```

**Use Cases:**
- **Voting/Nullifiers:** Use per-district trees (surgical updates, minimal sync)
- **Identity Verification:** Use cell-commitment tree (full 14-district disclosure)
- **Messaging Routing:** Use cell-commitment tree (need all 14 districts)

**Trade-offs:**
- ➕ **Flexibility:** Choose model per use case
- ➖ **Complexity:** Maintain two separate tree architectures
- ➖ **Storage:** 2× storage overhead (per-district + cell trees)

**Verdict:** ⚠️ **NOT RECOMMENDED** unless use cases truly diverge (likely over-engineering).

---

## 14. Conclusion

### 14.1 Key Findings

1. **Redistricting Scope:**
   - Per-District: **Surgical** (50-200 trees for congressional redistricting)
   - Cell-Commitment: **Cascade** (242,000 cells for congressional redistricting)
   - **Amplification Factor:** 100-1000× more data structures affected

2. **Update Complexity:**
   - Per-District: **O(D)** where D = affected districts (e.g., 435)
   - Cell-Commitment: **O(C)** where C = cells in region (e.g., 242,000)
   - **Tree Rebuild Time:** Cell-commitment is FASTER (8s vs 3 min), but MORE cells change

3. **User Impact:**
   - Per-District: Only users in **changed districts** need new proofs
   - Cell-Commitment: **ALL users** need new proofs (boundary_commitment cascade)
   - **Grace Period:** Cell-commitment needs 2-3× longer (60-90 days vs 30 days)

4. **Client Sync:**
   - Per-District: **50MB download** per district (surgical)
   - Cell-Commitment: **6-12MB download** (with delta optimization) OR **5GB** (full tree)
   - **With Optimization:** Cell-commitment is competitive

5. **SLA Achievement:**
   - Per-District: **48 hours + 1 minute** (achievable)
   - Cell-Commitment: **48 hours + 2 minutes** (achievable with delta optimization)
   - **Without Optimization:** 48 hours + 1 hour (fallback to full tree)

### 14.2 Final Recommendation

**Context-Dependent Decision:**

**Choose Per-District Model IF:**
- Redistricting is **frequent** (annual local adjustments)
- **Surgical updates** and **isolation** are critical
- **Minimal grace periods** (30 days) are acceptable
- **Bandwidth efficiency** is paramount (~50MB per district)

**Choose Cell-Commitment Model IF:**
- Redistricting is **infrequent** (<1× per year)
- **Full geographic identity disclosure** is valuable (14 districts per proof)
- **Delta optimization is implemented** (6-12MB downloads)
- **60-90 day grace periods** are acceptable (mass re-registration time)
- **Fast tree rebuilds** are critical (8s vs minutes)

### 14.3 Risk Mitigation for Cell-Commitment Model

If choosing cell-commitment model, **MUST implement:**

1. ✅ **Delta Optimization:**
   - Region-based filtering (country/state-specific deltas)
   - Sparse slot updates (only changed district slots)
   - Target: 6-12MB downloads (competitive with per-district)

2. ✅ **Extended Grace Periods:**
   - Default: 60 days (vs 30 for per-district)
   - Extended: 90 days for large-scale redistricting
   - Staggered notifications to avoid IPFS overload

3. ✅ **Country Sharding:**
   - Users download country-specific trees (not global)
   - Example: US users download 5GB US tree, not 50GB global tree
   - IPFS pinning per country for locality

4. ✅ **Background Sync:**
   - Automatic delta downloads when global root changes
   - Silent proof regeneration (user doesn't need to take action)
   - Notification only if user interaction required

5. ✅ **Fallback Strategy:**
   - If delta unavailable: Download full tree (5GB)
   - If IPFS gateway down: Fallback to secondary gateway
   - If proof generation fails: Retry with exponential backoff

### 14.4 Open Questions for Further Investigation

1. **User Behavior:** What percentage of users will regenerate proofs within 30/60/90 days?
2. **IPFS Gateway Capacity:** Can IPFS gateways handle 330M users downloading 6-12MB simultaneously?
3. **Delta Compression:** What is the actual compression ratio for sparse slot updates?
4. **Cross-District Correlation:** Do users need proofs for multiple district types simultaneously?
5. **Mobile Data Costs:** Is 6-12MB acceptable for users on metered mobile data?

### 14.5 Next Steps

1. **Prototype Cell-Commitment Model:**
   - Implement single-country prototype (e.g., UK with 42K cells)
   - Test delta optimization techniques
   - Measure actual download sizes and proving times

2. **Benchmark Redistricting Scenarios:**
   - Simulate congressional redistricting (242K cells)
   - Measure tree rebuild time, IPFS upload time, delta size
   - Compare against per-district model in production

3. **User Testing:**
   - A/B test: Per-district sync vs cell-commitment delta sync
   - Measure: Download time, proof generation success rate, user completion rate
   - Optimize grace period duration based on empirical data

4. **Architecture Decision Review:**
   - After benchmarks: Make final decision on per-district vs cell-commitment
   - Document trade-offs and rationale
   - Update DESIGN-003 and GLOBAL_MERKLE_SPEC accordingly

---

**End of Analysis**

*This analysis provides a comprehensive comparison of redistricting implications for per-district vs cell-commitment models. The final architectural decision should be based on empirical benchmarks, user testing, and specific use case requirements.*
