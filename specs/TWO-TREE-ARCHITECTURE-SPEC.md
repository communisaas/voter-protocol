# Two-Tree Architecture Specification

> **Spec ID:** TWO-TREE-ARCH-001
> **Version:** 0.7.0
> **Status:** Implementation Complete — circuit rework (H4 leaf + identity-bound nullifier), leaf replacement plumbing, IPFS persistence all verified in code (2026-02-11 4-agent audit). **NUL-001 wiring gap:** identityCommitment uses placeholder in communique registration path. v0.7.0: Added Section 4.4 (Action Domain Construction) with targetType field. v0.6.0: Added Section 17 (Three-Tree Extension design reference).
> **Date:** 2026-02-20
> **Authors:** Architecture Review
> **Revision:** v0.7 — Added targetType to ActionDomainParams (Section 4.4), documenting nullifier implications and backward compatibility. v0.5 — 4-agent cross-validation audit confirmed: Wave 24 circuit rework IMPLEMENTED (H4 leaf main.nr:308, identity-bound nullifier main.nr:336-337, DOMAIN_HASH4 0x48344d). Waves 30-31 leaf replacement IMPLEMENTED (replaceLeaf, POST /v1/register/replace, recoverTwoTree). IPFS persistence IMPLEMENTED (InsertionLog + SyncService + Lighthouse). NUL-001 identityCommitment wiring gap identified — shadow-atlas-handler.ts:136 uses request.leaf placeholder. v0.4: Added Section 8.4-8.8: Credential Recovery. v0.3: Synced Section 4 (Circuit) with actual main.nr.

---

## Executive Summary

This specification defines a **two-tree architecture** for the Voter Protocol that separates stable user identity from dynamic district mappings. This design eliminates the need for user re-registration when redistricting occurs.

### Key Innovation

```
CURRENT (Single-Tree):
  leaf = H(user_secret, cell_id, district_commitment, salt)
  → Redistricting changes district_commitment
  → User must re-register

PROPOSED (Two-Tree):
  Tree 1 (User Identity):  leaf = H(user_secret, cell_id, salt)
  Tree 2 (Cell Mapping):   SMT[cell_id] = district_commitment
  → Redistricting only updates Tree 2
  → User identity in Tree 1 is UNCHANGED
  → NO re-registration required
```

### Design Goals

1. **No re-registration on redistricting** - Users only re-register when they move
2. **All 24 districts revealed** - Single proof discloses full district set
3. **Cell ID remains private** - Geographic precision not leaked
4. **Data minimization** - Address never leaves client; cell_id stored encrypted, never transmitted in proofs
5. **Natural migration** - Existing credentials expire on their 6-month cycle; renewal generates two-tree credential automatically
6. **Mobile-feasible proving** - Target <30s on mid-range devices
7. **Gas-efficient verification** - Single on-chain verification call

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Tree 1: User Identity Tree](#2-tree-1-user-identity-tree)
3. [Tree 2: Cell-District Mapping Tree](#3-tree-2-cell-district-mapping-tree)
4. [Circuit Specification](#4-circuit-specification)
5. [Registration Flow](#5-registration-flow)
6. [Proof Generation Flow](#6-proof-generation-flow)
7. [Verification Flow](#7-verification-flow)
8. [Redistricting & Recovery Handling](#8-redistricting-handling)
9. [Smart Contract Changes](#9-smart-contract-changes)
10. [Shadow Atlas Changes](#10-shadow-atlas-changes)
11. [Client (Communique) Changes](#11-client-communique-changes)
12. [Crypto Package Changes](#12-crypto-package-changes)
13. [Migration Strategy](#13-migration-strategy)
14. [Security Analysis](#14-security-analysis)
15. [Performance Analysis](#15-performance-analysis)
16. [Open Questions](#16-open-questions)

---

## 1. Architecture Overview

### 1.1 Conceptual Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TWO-TREE ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────┐    ┌─────────────────────────────┐    │
│  │   TREE 1: User Identity     │    │   TREE 2: Cell Mapping      │    │
│  │   ══════════════════════    │    │   ══════════════════════    │    │
│  │                             │    │                             │    │
│  │   Type: Standard Merkle     │    │   Type: Sparse Merkle (SMT) │    │
│  │   Depth: 20-24              │    │   Depth: 20 (1M cells)      │    │
│  │   Leaves: User commitments  │    │   Leaves: Cell→Districts    │    │
│  │                             │    │                             │    │
│  │   leaf = H4(                │    │   key = cell_id             │    │
│  │     user_secret,            │    │   value = H(                │    │
│  │     cell_id,                │    │     cell_id,                │    │
│  │     registration_salt,      │    │     district_commitment     │    │
│  │     authority_level         │    │   )                         │    │
│  │   )                         │    │                             │    │
│  │                             │    │                             │    │
│  │   STABLE                    │    │   DYNAMIC                   │    │
│  │   Changes: User moves       │    │   Changes: Redistricting    │    │
│  │   Frequency: Rare           │    │   Frequency: Annual         │    │
│  └─────────────────────────────┘    └─────────────────────────────┘    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        ZK CIRCUIT                                │   │
│  │   ════════════════════════════════════════════════════════════   │   │
│  │                                                                  │   │
│  │   PUBLIC OUTPUTS:                                                │   │
│  │     • user_root          (Tree 1 root)                          │   │
│  │     • cell_map_root      (Tree 2 root)                          │   │
│  │     • districts[24]      (All 24 district IDs)                  │   │
│  │     • nullifier          (Action-scoped)                        │   │
│  │     • action_domain      (Contract-controlled)                  │   │
│  │     • authority_level    (1-5)                                  │   │
│  │                                                                  │   │
│  │   PRIVATE INPUTS:                                                │   │
│  │     • user_secret        (From identity verification)           │   │
│  │     • cell_id            (Geographic binding - NEVER REVEALED)  │   │
│  │     • salt               (Registration salt)                    │   │
│  │     • user_merkle_path   (Tree 1 proof)                         │   │
│  │     • user_leaf_index    (Tree 1 position)                      │   │
│  │     • cell_map_path      (Tree 2 SMT proof)                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow

```
REGISTRATION:
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  User    │────►│  Communique  │────►│ Shadow Atlas │────►│  Trees   │
│  Address │     │  Client      │     │  API         │     │  (IPFS)  │
└──────────┘     └──────────────┘     └──────────────┘     └──────────┘
     │                  │                    │                   │
     │   1. Enter       │   2. Geocode       │   3. Lookup       │
     │   address        │   + lookup         │   cell + dists    │
     │                  │                    │                   │
     │                  │   4. Compute       │   5. Insert       │
     │                  │   user_leaf        │   into Tree 1     │
     │                  │                    │                   │
     │                  │   6. Store         │   7. Publish      │
     │                  │   credentials      │   new roots       │
     │                  │   (IndexedDB)      │   (IPFS + chain)  │

PROVING:
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  User    │────►│  Communique  │────►│ Shadow Atlas │────►│ Contract │
│  Action  │     │  Prover      │     │  (paths)     │     │ Verifier │
└──────────┘     └──────────────┘     └──────────────┘     └──────────┘
     │                  │                    │                   │
     │   1. Initiate    │   2. Fetch         │                   │
     │   action         │   Merkle paths     │                   │
     │                  │                    │                   │
     │                  │   3. Generate      │                   │
     │                  │   ZK proof         │                   │
     │                  │   (WASM)           │                   │
     │                  │                    │                   │
     │                  │   4. Submit        │   5. Verify       │
     │                  │   proof + data     │   on-chain        │
```

---

## 2. Tree 1: User Identity Tree

### 2.1 Purpose

Tree 1 stores **user identity commitments** that bind a user's secret to their geographic cell. This tree is **stable** and only changes when:
- A new user registers
- A user moves to a new address (re-registration)
- Census redefines cell boundaries (every 10 years)

### 2.2 Leaf Structure

```
user_leaf = Poseidon2_Hash4(
    user_secret,      // 254-bit field element from identity verification
    cell_id,          // Census Tract FIPS code (e.g., 06075061200)
    registration_salt, // Random 254-bit field element
    authority_level   // Integer in [1, 5] indicating credential authority
)
```

**Field Definitions:**

| Field | Size | Source | Description |
|-------|------|--------|-------------|
| `user_secret` | 254 bits | Didit/self.xyz | Derived from identity verification |
| `cell_id` | 37 bits | Client geocoding | Census Tract FIPS (11 digits, ~4K people per tract) |
| `registration_salt` | 254 bits | Client RNG | Prevents rainbow table attacks |
| `authority_level` | 8 bits | Credential issuer | Integer in [1, 5] indicating credential authority |

**Why Census Tract (not Block Group):**

| Property | Census Tract | Block Group |
|----------|-------------|-------------|
| Digits | 11 | 12 |
| US count | ~85,000 | ~242,000 |
| Population | ~4,000 avg | ~1,500 avg |
| Stability | Decennial census | Decennial census |
| Privacy (k-anonymity) | k ≈ 4,000 | k ≈ 1,500 |

Census Tract is the stronger privacy default. Tracts that straddle a district boundary (~5%) are assigned the majority district by Shadow Atlas. The cell_id is a private circuit input — never revealed in proofs.

### 2.3 Tree Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Type** | Standard Merkle | Simple, well-understood |
| **Depth** | 20-24 (configurable) | 1M-16M users per tree |
| **Hash Function** | Poseidon2 | ZK-friendly, Noir-native |
| **Leaf Insertion** | Append-only | Sequential index assignment |

### 2.4 Root Lifecycle

```
user_root lifecycle:
  1. PROPOSED  → Governance proposes new root (7-day timelock)
  2. ACTIVE    → Root is valid for proving
  3. SUNSET    → Grace period (30 days) before expiry
  4. EXPIRED   → Root no longer accepted
```

Multiple user_roots can be ACTIVE simultaneously to support:
- Batch registration (new users added)
- Grace periods during transitions

---

## 3. Tree 2: Cell-District Mapping Tree

### 3.1 Purpose

Tree 2 stores **cell-to-district mappings** that associate each geographic cell with its 24 district slots. This tree is **dynamic** and updated when:
- Congressional redistricting (every 10 years)
- State legislative redistricting (every 10 years)
- City council/school district adjustments (annually)

### 3.2 Tree Type: Sparse Merkle Tree (SMT)

We use a Sparse Merkle Tree because:
- **Deterministic positioning**: cell_id directly determines leaf position
- **Efficient updates**: Only changed cells need path recalculation
- **Proof of absence**: Can prove a cell is NOT in the tree
- **No index management**: Position = hash(cell_id)

### 3.3 Leaf Structure

```
cell_map_key = cell_id  // Used to determine SMT position

cell_map_value = Poseidon2_Hash2(
    cell_id,
    district_commitment
)

where:
    district_commitment = Poseidon2_Sponge(districts[0..24])
```

**District Commitment Computation (Sequential Sponge):**

```
// 24 districts → single commitment using sponge construction
// Domain separation tag prevents cross-context collisions
DOMAIN_SPONGE_24 = 0x534f4e47455f24  // "SONGE_24" in hex

state = [DOMAIN_SPONGE_24, 0, 0, 0]  // Initial state with domain tag

// Absorb 3 districts at a time (ADD to state, not overwrite)
for i in 0..8:
    state = Poseidon2_Permutation([
        state[0],
        state[1] + districts[i*3 + 0],  // ADD, not replace
        state[2] + districts[i*3 + 1],
        state[3] + districts[i*3 + 2]
    ])

district_commitment = state[0]
```

**SECURITY NOTE:** The sponge construction MUST add inputs to existing state, not overwrite. Overwriting would create collision vulnerabilities.

### 3.4 SMT Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Type** | Sparse Merkle Tree | Deterministic, efficient updates |
| **Depth** | 20 | 1M capacity (US has ~85K tracts; 12× headroom) |
| **Hash Function** | Poseidon2 | ZK-friendly |
| **Empty Value** | H("EMPTY_CELL") | Distinguishes absent from zero |

### 3.5 SMT Position Calculation

```
// Cell position in SMT is deterministic
function getCellPosition(cell_id: Field, attempt: u32 = 0) -> u32 {
    // Take lower 20 bits of hash for depth-20 tree
    let hash = Poseidon2_Hash2(cell_id, attempt);
    return (hash as u32) & 0xFFFFF;  // 20-bit mask
}
```

**COLLISION HANDLING:**

With ~85K Census Tracts mapped to 2^20 (1M) positions, collision probability is low (~0.34% per insertion by birthday paradox) but nonzero. We use overflow chaining:

```
// During tree construction
function insertCell(cell_id: Field, value: Field) {
    let attempt = 0;
    let position = getCellPosition(cell_id, attempt);

    while (occupied[position] && stored_cell[position] != cell_id) {
        attempt += 1;
        if (attempt > 10) revert("Collision overflow");
        position = getCellPosition(cell_id, attempt);
    }

    occupied[position] = true;
    stored_cell[position] = cell_id;
    tree[position] = value;
}
```

**Circuit verification must use same attempt value** (provided as witness input).

### 3.6 Root Lifecycle

```
cell_map_root lifecycle:
  1. PROPOSED  → Shadow Atlas proposes after redistricting
  2. ACTIVE    → Root is valid for proving
  3. DEPRECATED → Old root still valid (90-day grace period)
  4. EXPIRED   → Root no longer accepted
```

**Grace Period Rationale:**
- 90 days allows users to update cached district data
- Old proofs remain valid during transition
- No user action required (client auto-updates)

---

## 4. Circuit Specification

### 4.1 Circuit Interface

> **NOTE:** The following matches the actual implementation in
> `packages/crypto/noir/two_tree_membership/src/main.nr` as of 2026-02-20.
> The sponge construction lives in `src/sponge.nr` and is imported via `mod sponge`.

```noir
// File: packages/crypto/noir/two_tree_membership/src/main.nr

use dep::std::hash::poseidon2_permutation;

// Sponge module (src/sponge.nr) provides poseidon2_sponge_24
mod sponge;
use sponge::poseidon2_sponge_24;

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

// Default depth; build pipeline rewrites per variant (18/20/22/24).
global TREE_DEPTH: u32 = 20;

global MIN_AUTHORITY_LEVEL: Field = 1;
global MAX_AUTHORITY_LEVEL: Field = 5;

global DOMAIN_HASH2: Field = 0x48324d;   // "H2M" - matches poseidon2.ts
global DOMAIN_HASH3: Field = 0x48334d;   // "H3M" - matches poseidon2.ts

// ═══════════════════════════════════════════════════════════════════════
// HASH FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

fn poseidon2_hash2(left: Field, right: Field) -> Field {
    let state: [Field; 4] = [left, right, DOMAIN_HASH2, 0];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

fn poseidon2_hash3(a: Field, b: Field, c: Field) -> Field {
    let state: [Field; 4] = [a, b, c, DOMAIN_HASH3];
    let out = poseidon2_permutation(state, 4);
    out[0]
}

// poseidon2_sponge_24 is defined in src/sponge.nr with:
//   DOMAIN_SPONGE_24 = 0x534f4e47455f24  ("SONGE_24")
//   Rate = 3, Capacity = 1, 8 absorption rounds
//   Inputs are ADDED to state (not overwritten) per correct sponge construction

// ═══════════════════════════════════════════════════════════════════════
// LEAF & NULLIFIER COMPUTATION
// ═══════════════════════════════════════════════════════════════════════

fn compute_user_leaf(user_secret: Field, cell_id: Field, registration_salt: Field, authority_level: Field) -> Field {
    poseidon2_hash4(user_secret, cell_id, registration_salt, authority_level)
}

fn compute_cell_map_leaf(cell_id: Field, district_commitment: Field) -> Field {
    poseidon2_hash2(cell_id, district_commitment)
}

fn compute_nullifier(identity_commitment: Field, action_domain: Field) -> Field {
    poseidon2_hash2(identity_commitment, action_domain)
}

// ═══════════════════════════════════════════════════════════════════════
// MERKLE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════

fn compute_merkle_root(leaf: Field, path: [Field; TREE_DEPTH], index: u32) -> Field {
    assert(index < (1u32 << TREE_DEPTH), "Leaf index out of range");
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let bit: bool = ((index >> i) & 1u32) == 1u32;
        let sibling = path[i];
        node = if bit {
            poseidon2_hash2(sibling, node)
        } else {
            poseidon2_hash2(node, sibling)
        };
    }
    node
}

fn compute_smt_root(
    leaf: Field,
    path: [Field; TREE_DEPTH],
    path_bits: [u1; TREE_DEPTH],
) -> Field {
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let sibling = path[i];
        node = if path_bits[i] == 0 {
            poseidon2_hash2(node, sibling)
        } else {
            poseidon2_hash2(sibling, node)
        };
    }
    node
}

// ═══════════════════════════════════════════════════════════════════════
// AUTHORITY VALIDATION (ISSUE-006 + BA-007)
// ═══════════════════════════════════════════════════════════════════════

fn validate_authority_level(authority_level: Field) {
    // BA-007: Cast through u64 first to detect values >= 256 that would
    // silently truncate when cast to u8 (e.g., 261 -> 5).
    assert(authority_level as u64 < 256, "Authority level exceeds u8 range");
    let level_u8 = authority_level as u8;
    assert(level_u8 >= MIN_AUTHORITY_LEVEL as u8, "Authority level below minimum (1)");
    assert(level_u8 <= MAX_AUTHORITY_LEVEL as u8, "Authority level above maximum (5)");
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN CIRCUIT
// ═══════════════════════════════════════════════════════════════════════

fn main(
    // ═══════════════════════════════════════════════════════════════════
    // PUBLIC INPUTS
    // ═══════════════════════════════════════════════════════════════════
    user_root: pub Field,
    cell_map_root: pub Field,
    districts: pub [Field; 24],
    nullifier: pub Field,
    action_domain: pub Field,
    authority_level: pub Field,

    // ═══════════════════════════════════════════════════════════════════
    // PRIVATE INPUTS (witnesses)
    // ═══════════════════════════════════════════════════════════════════
    user_secret: Field,
    cell_id: Field,
    registration_salt: Field,
    identity_commitment: Field,

    // Tree 1: Standard Merkle proof
    user_path: [Field; TREE_DEPTH],
    user_index: u32,

    // Tree 2: SMT proof
    cell_map_path: [Field; TREE_DEPTH],
    cell_map_path_bits: [u1; TREE_DEPTH],
) {
    // PRE-CHECKS
    // SA-011: Reject zero user_secret (prevents predictable nullifiers)
    assert(user_secret != 0, "user_secret cannot be zero");
    // ISSUE-006 + BA-007: Validate authority_level in [1, 5] with overflow guard
    validate_authority_level(authority_level);

    // STEP 1: Verify user identity (Tree 1)
    let user_leaf = compute_user_leaf(user_secret, cell_id, registration_salt, authority_level);
    let computed_user_root = compute_merkle_root(user_leaf, user_path, user_index);
    assert(computed_user_root == user_root, "Tree 1: Merkle proof verification failed");

    // STEP 2: Compute district commitment
    let district_commitment = poseidon2_sponge_24(districts);

    // STEP 3: Verify cell mapping (Tree 2)
    let cell_map_leaf = compute_cell_map_leaf(cell_id, district_commitment);
    let computed_map_root = compute_smt_root(
        cell_map_leaf,
        cell_map_path,
        cell_map_path_bits,
    );
    assert(computed_map_root == cell_map_root, "Tree 2: SMT proof verification failed");

    // STEP 4: Verify nullifier
    let computed_nullifier = compute_nullifier(identity_commitment, action_domain);
    assert(computed_nullifier == nullifier, "Nullifier verification failed");
}
```

### 4.2 Constraint Analysis

The current single-tree circuit measures ~500 constraints per Poseidon2 permutation
(documented in DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md §3.1). Using that baseline:

```
Component                              Hashes    Constraints (est.)
──────────────────────────────────────────────────────────────────────
User leaf (H4)                            1            500
User Merkle path (depth 20)              20         10,000
District commitment (sponge, 8 rounds)    8          4,000
Cell map leaf (H2)                        1            500
Cell map SMT path (depth 20)             20         10,000
Nullifier (H2)                            1            500
Authority range checks                    -             32
──────────────────────────────────────────────────────────────────────
TOTAL                                    51        ~25,532
```

**Comparison:** Single-tree at depth 20 is ~11,032 constraints. Two-tree is ~25,532 — a **2.3× increase**, not an order-of-magnitude jump. This significantly improves the mobile proving time outlook.

### 4.3 Public Outputs

| Output | Size | Description |
|--------|------|-------------|
| `user_root` | 1 Field | Tree 1 Merkle root |
| `cell_map_root` | 1 Field | Tree 2 SMT root |
| `districts[24]` | 24 Fields | All 24 district IDs |
| `nullifier` | 1 Field | Action-scoped nullifier |
| `action_domain` | 1 Field | Contract-controlled domain |
| `authority_level` | 1 Field | User's authority (1-5) |

**Total Public Outputs:** 29 field elements

### 4.4 Action Domain Construction

The `action_domain` public input is a keccak256 hash of structured parameters that scope each civic action. Different action domains produce different nullifiers, enforcing one-action-per-scope Sybil resistance.

**ActionDomainParams:**

```typescript
interface ActionDomainParams {
  actionType: string;        // e.g. "congressional_contact", "template_create"
  targetId: string;          // Decision-maker or body identifier
  targetType: 'body' | 'individual' | 'both';  // NEW — target classification
  campaignId?: string;       // Optional campaign scope
  epoch?: string;            // Optional time scope (e.g. "119th-congress")
}

// action_domain = keccak256(abi.encodePacked(actionType, targetId, targetType, ...))
```

**`targetType` Field (added 2026-02-20):**

| Value | Meaning | Example |
|-------|---------|---------|
| `'body'` | Targeting a legislature as an institution | Contact entire House committee |
| `'individual'` | Targeting a specific decision-maker | Contact Rep. Smith |
| `'both'` | Targeting both body and individual | Contact Rep. Smith as member of committee |

**Nullifier implications:** Since `targetType` is included in the keccak256 hash, different target types produce different `action_domain` values and therefore different nullifiers. A user who contacts a committee as a body (`targetType: 'body'`) and also contacts a specific committee member (`targetType: 'individual'`) will consume two separate nullifiers. This is by design -- these are distinct civic actions.

**Engagement scoring:** Within-category variation (body vs individual) does NOT increase `diversity_score` in the engagement pipeline. Both are category 1 (Congressional contact). The `diversityScore` metric measures how many of the 5 action categories a user has participated in, not how many variations within a single category.

**Backward compatibility:** Existing action domains that predate the `targetType` field default to `'individual'` semantics. No migration required -- old nullifiers remain valid in the NullifierRegistry.

**Graduated trust:** Action domains are tracked at all three trust levels (see REPUTATION-ARCHITECTURE-SPEC.md Section 4.7). At Level 1 (unverified), anonymous counters increment per action domain when a user initiates contact. At Level 3 (ZK-verified), the same action domain feeds the nullifier `H2(identityCommitment, actionDomain)` and the resulting on-chain event drives engagement metrics. The ratio of Level 3 to Level 1 actions per domain is the coordination authenticity index.

---

## 5. Registration Flow

### 5.1 Sequence Diagram

**Privacy invariant:** The user's address NEVER leaves the client. Geocoding happens in the browser via Census Bureau API (existing `CensusAPIClient`). Only the derived `cell_id` (an opaque 11-digit Census Tract code) is sent to Shadow Atlas.

```
┌───────┐          ┌───────────┐          ┌─────────────┐          ┌──────┐
│ User  │          │ Communique│          │Shadow Atlas │          │ IPFS │
└───┬───┘          └─────┬─────┘          └──────┬──────┘          └──┬───┘
    │                    │                       │                    │
    │ 1. Enter address   │                       │                    │
    │───────────────────>│                       │                    │
    │                    │                       │                    │
    │                    │ 2. CLIENT-SIDE:       │                    │
    │                    │    Geocode via Census  │                    │
    │                    │    API (browser JSONP) │                    │
    │                    │    → Census Tract      │                    │
    │                    │    → DISCARD address   │                    │
    │                    │                       │                    │
    │                    │ 3. POST /v2/register  │                    │
    │                    │   { cell_id,          │                    │
    │                    │     identity_commit,  │                    │
    │                    │     salt }            │                    │
    │                    │   (NO address sent)   │                    │
    │                    │──────────────────────>│                    │
    │                    │                       │                    │
    │                    │                       │ 4. Lookup cell's   │
    │                    │                       │    districts[24]   │
    │                    │                       │                    │
    │                    │                       │ 5. Compute         │
    │                    │                       │    user_leaf       │
    │                    │                       │                    │
    │                    │                       │ 6. Insert user_leaf│
    │                    │                       │    into Tree 1     │
    │                    │                       │                    │
    │                    │                       │ 7. Ensure cell in  │
    │                    │                       │    Tree 2 (or add) │
    │                    │                       │                    │
    │                    │ 8. Response:          │                    │
    │                    │    { districts[24],   │                    │
    │                    │      user_leaf_index, │                    │
    │                    │      user_path,       │                    │
    │                    │      cell_map_path }  │                    │
    │                    │<──────────────────────│                    │
    │                    │                       │                    │
    │                    │ 9. Store in IndexedDB │                    │
    │                    │    (AES-256-GCM)      │                    │
    │                    │                       │                    │
    │ 10. Confirmation   │                       │                    │
    │<───────────────────│                       │                    │
    │                    │                       │                    │
    │                    │                       │ 11. Batch publish  │
    │                    │                       │     new roots      │
    │                    │                       │────────────────────>
    │                    │                       │                    │
```

**Data flow at each boundary:**

| Boundary | Data Crossing | NOT Crossing |
|----------|---------------|--------------|
| User → Client | Address (typed) | — |
| Client → Census API | lat/lon (JSONP, ephemeral) | Address |
| Client → Shadow Atlas | cell_id, identity_commit, salt | Address, lat/lon |
| Shadow Atlas → Client | districts, paths, roots | — |
| Client → IndexedDB | cell_id, salt, paths (encrypted) | Address, lat/lon |

### 5.2 Client Storage Schema

```typescript
// IndexedDB: communique-credentials
// Entire record encrypted with device-bound AES-256-GCM key (non-extractable)

interface TwoTreeCredential {
  // User identity
  userId: string;
  registrationSalt: string;

  // Tree 1 (User Identity)
  userLeafIndex: number;
  userMerklePath: string[];     // 20 siblings
  userRoot: string;

  // Tree 2 (Cell Mapping)
  cellId: string;               // Census Tract (11-digit FIPS code, opaque identifier)
  districts: string[];          // 24 district IDs
  cellMapPath: string[];        // 20 SMT siblings
  cellMapPathBits: number[];    // 20 direction bits
  cellMapRoot: string;

  // Metadata
  identityProvider: 'didit' | 'self.xyz';
  createdAt: Date;
  expiresAt: Date;              // 6 months from creation (credential renewal)
  updatedAt: Date;              // Last sync
  rootsValidUntil: Date;        // Grace period end
}
```

**What is NOT stored (ephemeral, in-memory only):**

| Data | Lifetime | Rationale |
|------|----------|-----------|
| `address` | Discarded after geocoding | Never leaves browser tab |
| `lat/lon` | Discarded after Census API call | Ephemeral JSONP, not persisted |
| `user_secret` | In-memory during proof gen | Derived from identity provider, held only during session |

**What IS stored (encrypted at rest):**

| Data | Privacy | k-anonymity |
|------|---------|-------------|
| `cellId` | 11-digit opaque code | ~4,000 people share same tract |
| `districts[24]` | Public per design | Disclosed in proof output |
| `merklePaths` | Tree-structural | No geographic information |
| `salt` | Random | No information content |

**Cell ID is stored because it is needed for credential sync** (Section 8.2). Without it, the client cannot request updated cell_map_path after redistricting. It is never transmitted in proofs — it is a private circuit input.

---

## 6. Proof Generation Flow

### 6.1 Sequence Diagram

```
┌───────┐          ┌───────────┐          ┌─────────────┐
│ User  │          │ Communique│          │Shadow Atlas │
└───┬───┘          └─────┬─────┘          └──────┬──────┘
    │                    │                       │
    │ 1. Initiate action │                       │
    │   (e.g., sign      │                       │
    │    petition)       │                       │
    │───────────────────>│                       │
    │                    │                       │
    │                    │ 2. Check local roots  │
    │                    │    vs current roots   │
    │                    │──────────────────────>│
    │                    │                       │
    │                    │ 3. If stale, fetch    │
    │                    │    updated paths      │
    │                    │<──────────────────────│
    │                    │                       │
    │                    │ 4. Load WASM prover   │
    │                    │                       │
    │                    │ 5. Prepare inputs:    │
    │                    │    - user_secret      │
    │                    │    - cell_id          │
    │                    │    - districts[24]    │
    │                    │    - merkle paths     │
    │                    │    - action_domain    │
    │                    │                       │
    │                    │ 6. Generate proof     │
    │ 7. Progress UI     │    (~10-25s)          │
    │<───────────────────│                       │
    │                    │                       │
    │                    │ 8. Proof complete     │
    │ 9. Confirmation    │                       │
    │<───────────────────│                       │
    │                    │                       │
```

### 6.2 Input Preparation

```typescript
interface TwoTreeProofInputs {
  // PUBLIC (will be verified on-chain)
  userRoot: string;
  cellMapRoot: string;
  districts: string[];        // 24 elements
  nullifier: string;          // Computed client-side for preview
  actionDomain: string;
  authorityLevel: number;

  // PRIVATE (never leave client)
  userSecret: string;
  cellId: string;
  registrationSalt: string;
  userPath: string[];         // 20 elements
  userIndex: number;
  cellMapPath: string[];      // 20 elements
  cellMapPathBits: number[];  // 20 elements
}
```

---

## 7. Verification Flow

### 7.1 On-Chain Verification

```solidity
// DistrictGate.sol — verifyTwoTreeProof (actual implementation)

function verifyTwoTreeProof(
    address signer,
    bytes calldata proof,
    uint256[29] calldata publicInputs,
    uint8 verifierDepth,
    uint256 deadline,
    bytes calldata signature
) external whenNotPaused {
    // Step 0: Verify EIP-712 signature (nonce, deadline, parameter binding)
    if (signer == address(0)) revert ZeroAddress();
    if (block.timestamp > deadline) revert SignatureExpired();

    bytes32 proofHash = keccak256(proof);
    bytes32 publicInputsHash = keccak256(abi.encodePacked(publicInputs));
    bytes32 structHash = keccak256(
        abi.encode(
            SUBMIT_TWO_TREE_PROOF_TYPEHASH,
            proofHash, publicInputsHash, verifierDepth,
            nonces[signer], deadline
        )
    );
    bytes32 digest = keccak256(
        abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
    );
    address recoveredSigner = ECDSA.recover(digest, signature);
    if (recoveredSigner != signer) revert InvalidSignature();
    nonces[signer]++;

    // Extract key fields from public inputs
    bytes32 userRoot = bytes32(publicInputs[0]);
    bytes32 cellMapRoot = bytes32(publicInputs[1]);
    // publicInputs[2..25] = districts[24]
    bytes32 nullifier = bytes32(publicInputs[26]);
    bytes32 actionDomain = bytes32(publicInputs[27]);
    bytes32 authorityLevel = bytes32(publicInputs[28]);

    // Step 1: Validate user_root via UserRootRegistry
    if (!userRootRegistry.isValidUserRoot(userRoot)) revert InvalidUserRoot();

    // Step 2: Validate cell_map_root via CellMapRegistry
    if (!cellMapRegistry.isValidCellMapRoot(cellMapRoot)) revert InvalidCellMapRoot();

    // BR3-004: Cross-check country between both trees
    (bytes3 userCountry, uint8 userDepth) = userRootRegistry.getCountryAndDepth(userRoot);
    (bytes3 cellMapCountry,) = cellMapRegistry.getCountryAndDepth(cellMapRoot);
    if (userCountry != cellMapCountry) revert CountryMismatch();

    // BR3-009: Validate verifierDepth matches registry metadata
    if (userDepth != verifierDepth) revert DepthMismatch();

    // Step 3: Validate action_domain via whitelist (SA-001)
    if (!allowedActionDomains[actionDomain]) revert ActionDomainNotAllowed();

    // Step 4: Get depth-specific verifier and verify proof
    address verifier = verifierRegistry.getVerifier(verifierDepth);
    if (verifier == address(0)) revert VerifierNotFound();

    bytes32[] memory honkInputs = new bytes32[](29);
    for (uint256 i = 0; i < 29; i++) {
        honkInputs[i] = bytes32(publicInputs[i]);
    }
    (bool success, bytes memory result) = verifier.call(
        abi.encodeWithSignature("verify(bytes,bytes32[])", proof, honkInputs)
    );
    if (!success || result.length == 0 || !abi.decode(result, (bool))) {
        revert TwoTreeVerificationFailed();
    }

    // Step 5: Record nullifier via NullifierRegistry
    nullifierRegistry.recordNullifier(actionDomain, nullifier, userRoot);

    // Step 6: Record campaign participation (if registry is set)
    if (address(campaignRegistry) != address(0)) {
        try campaignRegistry.recordParticipation(actionDomain, userRoot) {} catch {}
    }

    // Step 7: Emit event
    emit TwoTreeProofVerified(
        signer, msg.sender, userRoot, cellMapRoot,
        nullifier, actionDomain, authorityLevel, verifierDepth
    );
}
```

### 7.2 Gas Analysis

Measured on Scroll Sepolia (TX `0xc6ef86a3...`, 2026-02-20):

```
Component                          Gas (measured)
─────────────────────────────────────────────────
Total L2 gas consumed              2,200,522
  ZK proof verification            ~1,900,000  (HonkVerifier pairing)
  Public input handling (29 fields)     5,800
  District containment check (24×N)     7,200  (N=3 required)
  Nullifier SLOAD + SSTORE            22,100
  Event emission                        3,500
  Calldata + overhead                 ~261,922
─────────────────────────────────────────────────
TOTAL L2 gas                      ~2,200,000
```

**Cost at current Scroll rates (2026-02-20):**
- L2 gas price: 0.00012 Gwei → L2 execution: ~0.000034 ETH
- L1 data fee: ~0.000126 ETH (dominates — 7,328 bytes proof calldata)
- Total: ~0.000161 ETH (~$0.32 at $1,965/ETH)
- At mainnet congestion (10x L1): ~$0.01-0.03/proof

---

## 8. Redistricting Handling

### 8.1 Redistricting Scenarios

| Scenario | Tree 1 Impact | Tree 2 Impact | User Action |
|----------|---------------|---------------|-------------|
| Congressional redistricting | NONE | UPDATE | Auto-sync |
| State leg redistricting | NONE | UPDATE | Auto-sync |
| City council change | NONE | UPDATE | Auto-sync |
| School district change | NONE | UPDATE | Auto-sync |
| Census boundary revision | UPDATE | UPDATE | Re-register |
| User moves | UPDATE | - | Re-register |

### 8.2 Auto-Sync Protocol

```typescript
// Client-side sync (Communique)

async function syncCredentials(): Promise<void> {
  const credential = await getStoredCredential();

  // 1. Fetch current roots from Shadow Atlas
  const { currentUserRoot, currentCellMapRoot } = await fetchCurrentRoots();

  // 2. Check if user root changed (rare - only on new registrations)
  if (credential.userRoot !== currentUserRoot) {
    // User's leaf position might have changed
    const { path, index } = await fetchUserPath(credential.userLeafIndex);
    credential.userPath = path;
    credential.userIndex = index;
    credential.userRoot = currentUserRoot;
  }

  // 3. Check if cell map root changed (common - redistricting)
  if (credential.cellMapRoot !== currentCellMapRoot) {
    // Fetch updated districts and path for user's cell
    const { districts, path, pathBits } = await fetchCellMapping(credential.cellId);
    credential.districts = districts;
    credential.cellMapPath = path;
    credential.cellMapPathBits = pathBits;
    credential.cellMapRoot = currentCellMapRoot;
  }

  // 4. Update local storage
  await storeCredential(credential);
}
```

### 8.3 Grace Periods

```
Timeline for cell_map_root transition:

Day 0:    New cell_map_root proposed (redistricting complete)
Day 1-7:  Timelock period (governance review)
Day 7:    New root becomes ACTIVE
Day 7-97: Both old and new roots ACTIVE (grace period)
Day 97:   Old root becomes DEPRECATED (warning)
Day 127:  Old root EXPIRED (proofs fail)

Total grace period: 90 days for users to sync
```

### 8.4 Credential Recovery (Leaf Replacement Protocol)

**Problem:** Private circuit inputs (`user_secret`, `registration_salt`, `cell_id`) exist only in the browser's encrypted IndexedDB. A browser clear, device loss, or storage corruption causes total credential loss. Without a recovery path, the user must start over — which, with the pre-Wave-24 nullifier formula `H2(user_secret, action_domain)`, would produce a new nullifier and create a Sybil opening.

**Solution:** Leaf replacement — zero the old leaf in Tree 1, insert a new leaf with fresh random inputs at the next available position. The user's `identityCommitment` (derived from their OAuth credential, stable across sessions) is already stored server-side from first registration.

**Prerequisite:** Wave 24 (NUL-001) circuit rework. The identity-bound nullifier formula `H2(identityCommitment, actionDomain)` is what makes leaf replacement safe. Since `identityCommitment` is stable across re-registrations, the nullifier is preserved regardless of `user_secret` or `registration_salt` changes. Without NUL-001, recovery would produce a different nullifier and break Sybil resistance.

**Design philosophy:** The hard thing (identity verification) happens once. Recovery should feel like logging in, not starting over. The system already knows the user's identity — don't make them re-prove it.

### 8.5 Recovery Protocol

```
Recovery trigger: User logs in (OAuth), system detects no IndexedDB credential,
but finds existing registration in Postgres via user_id.

User-facing steps: 1 (re-enter address OR confirm "still same address?")
Wall-clock time: ~15 seconds

                Client                    Communique Server              Shadow Atlas
                  │                              │                            │
  1. OAuth login  │──────────────────────────────>│                            │
                  │                               │  2. Lookup user_id         │
                  │                               │     → found registration   │
                  │<── "Welcome back" ────────────│     (has identityCommit,   │
                  │    credential missing         │      leafIndex, but NO     │
                  │    detected                   │      private inputs)       │
                  │                               │                            │
  3. User re-enters address                       │                            │
     (or confirms "same address?")                │                            │
                  │                               │                            │
  4. Client:                                      │                            │
     cellId = deriveCellId(address)               │                            │
     newUserSecret = crypto.random()              │                            │
     newSalt = crypto.random()                    │                            │
     newLeaf = H4(newUserSecret, cellId,          │                            │
                  newSalt, authorityLevel)         │                            │
                  │                               │                            │
  5. POST /api/shadow-atlas/register              │                            │
     { leaf: newLeaf, replace: true }             │                            │
                  │──────────────────────────────>│                            │
                  │                               │  6. Find existing record   │
                  │                               │     oldLeafIndex = record  │
                  │                               │     .leaf_index            │
                  │                               │                            │
                  │                               │  7. POST /v1/register/     │
                  │                               │     replace                │
                  │                               │     { newLeaf,             │
                  │                               │       oldLeafIndex }       │
                  │                               │──────────────────────────>│
                  │                               │                            │
                  │                               │  8. Shadow Atlas:          │
                  │                               │     a. Zero leaf at        │
                  │                               │        oldLeafIndex        │
                  │                               │     b. Insert newLeaf at   │
                  │                               │        nextLeafIndex       │
                  │                               │     c. Recompute root      │
                  │                               │     d. Return proof        │
                  │                               │<──────────────────────────│
                  │                               │                            │
                  │                               │  9. Update Postgres:       │
                  │                               │     leaf_index = new       │
                  │                               │     merkle_root = new      │
                  │                               │     merkle_path = new      │
                  │                               │                            │
                  │<── { leafIndex, userRoot,     │                            │
                  │      userPath, pathIndices }  │                            │
                  │                               │                            │
 10. Client stores SessionCredential              │                            │
     in encrypted IndexedDB                       │                            │
                  │                               │                            │
 11. "You're ready to participate."               │                            │
```

### 8.6 Leaf Replacement Tree Mechanics

```
Before recovery (Tree 1 state):

         root_old
        /        \
      ...        ...
     /              \
   [...]    leaf_old @ index 7    [empty] @ index 12    [...]
            ^^^^^^^^                ^^^^^^^
            user's old leaf         next available slot

After replaceLeaf(oldIndex=7, newLeaf):

         root_new
        /        \
      ...        ...
     /              \
   [...]    padding @ index 7     leaf_new @ index 12   [...]
            ^^^^^^^               ^^^^^^^^
            zeroed (= empty       fresh leaf at
             subtree hash)         next position
```

**Tree operations (O(depth) each):**
1. Set `nodeMap["0:7"] = emptyHashes[0]` (zero the old leaf)
2. Recompute path from index 7 to root (depth hashes)
3. Set `nodeMap["0:12"] = newLeaf` (insert at next position)
4. Recompute path from index 12 to root (depth hashes)
5. New root reflects both mutations

**Insertion log entry (BR5-007 compatible):**
```json
{ "type": "replace", "oldIndex": 7, "newLeaf": "0xabc...", "newIndex": 12, "ts": 1707500000 }
```

The log remains append-only. Replay applies zeroing + insertion in order.

### 8.7 Recovery Security Invariants

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| **Sybil resistance** | Same user → same nullifier after recovery | `nullifier = H2(identityCommitment, actionDomain)` — identityCommitment is stable (NUL-001) |
| **No double-voting** | Already-used nullifiers remain on-chain | NullifierRegistry rejects re-submission; new leaf doesn't change this |
| **Old proofs invalidated** | Old leaf zeroed → old root invalid | Any proof against old root fails after root transition |
| **New proofs valid** | Fresh leaf with valid inputs | Circuit verifies new leaf membership in current Tree 1 root |
| **No credential theft** | Can't replace someone else's leaf | Replace requires authenticated session (OAuth) matching the user_id that owns the registration |
| **Privacy preserved** | Server never sees private inputs | Only the new leaf hash is transmitted; userSecret and salt remain client-side |
| **Operator can't forge** | Leaf replacement is logged + roots are on-chain | IPFS insertion log (BR5-007) auditable; on-chain root must match |

**Attack: Operator replaces leaf without user consent?**
The insertion log (IPFS-pinned) records every mutation. Anyone replaying the log can verify that every replace corresponds to an authenticated request. Phase 2 TEE attestation eliminates this trust assumption entirely.

**Attack: User claims browser clear to get a second identity?**
Impossible. `identityCommitment` hasn't changed, so `nullifier = H2(identityCommitment, actionDomain)` is identical. The on-chain NullifierRegistry catches the duplicate.

**Attack: Attacker compromises OAuth account?**
Same threat model as initial registration — OAuth account compromise is out of scope for the ZK layer. Mitigation is at the identity provider level (MFA, etc.).

### 8.8 Address Re-Entry UX Optimization

The only user-facing friction in recovery is re-entering their residential address (to derive `cell_id`). This is necessary because the system deliberately does not store the address (privacy by design).

**Optimization for returning users who haven't moved:**

If the communique server stores a `cell_id_hash = H(cell_id)` alongside the registration record (not the cell_id itself), the recovery flow can offer:

```
"Welcome back. Still at the same address?"

[Yes, same address]     [No, I've moved]
```

On "Yes": client re-enters address, derives `cell_id`, communique verifies `H(cell_id) == stored cell_id_hash`, proceeds. This prevents a misremembered address from silently producing wrong district mappings.

On "No, I've moved": client enters new address, derives new `cell_id`, new leaf reflects new location. Districts change accordingly.

**Why hash, not plaintext:** Storing `cell_id` directly would let the server operator enumerate user neighborhoods. Storing `H(cell_id)` reveals nothing — census tract IDs are not enumerable from hashes (the space is sparse and the hash is one-way). But it allows the server to verify consistency on the "same address" fast path.

---

## 9. Smart Contract Changes

### 9.1 Contract Layout (Implemented)

```
contracts/
├── src/
│   ├── DistrictGate.sol           # verifyTwoTreeProof() added for two-tree
│   ├── UserRootRegistry.sol       # Tree 1 roots (lifecycle: PROPOSED->ACTIVE->SUNSET->EXPIRED)
│   ├── CellMapRegistry.sol        # Tree 2 roots (lifecycle: PROPOSED->ACTIVE->DEPRECATED->EXPIRED)
│   ├── DistrictRegistry.sol       # Legacy single-tree roots (parallel operation during migration)
│   ├── NullifierRegistry.sol      # Nullifier tracking (shared by single-tree and two-tree)
│   ├── VerifierRegistry.sol       # Manages UltraHonk verifier instances per depth
│   ├── TimelockGovernance.sol     # Base: 7-day timelock for all governance operations
│   └── CampaignRegistry.sol       # Action/campaign management
```

> **Note:** There is no separate `TwoTreeVerifier.sol`. The two-tree verification
> logic is integrated directly into `DistrictGate.verifyTwoTreeProof()`, which
> dispatches to the appropriate `VerifierRegistry` verifier based on proof format.

### 9.2 UserRootRegistry

```solidity
// contracts/src/UserRootRegistry.sol

contract UserRootRegistry {
    struct RootMetadata {
        bytes3 country;
        uint8 depth;
        uint64 registeredAt;
        uint64 expiresAt;
        bool isActive;
    }

    mapping(bytes32 => RootMetadata) public userRoots;

    uint256 public constant ROOT_TIMELOCK = 7 days;
    uint256 public constant GRACE_PERIOD = 30 days;

    function registerRoot(bytes32 root, bytes3 country, uint8 depth) external;
    function deprecateRoot(bytes32 root) external;
    function isValidRoot(bytes32 root) external view returns (bool);
}
```

### 9.3 CellMapRegistry

```solidity
// contracts/src/CellMapRegistry.sol

contract CellMapRegistry {
    struct MapMetadata {
        bytes3 country;
        uint64 updatedAt;
        uint64 expiresAt;
        bool isActive;
        string ipfsCid;  // Points to full SMT data
    }

    mapping(bytes32 => MapMetadata) public cellMapRoots;

    uint256 public constant MAP_TIMELOCK = 7 days;
    uint256 public constant GRACE_PERIOD = 90 days;  // Longer for redistricting

    function registerMapRoot(bytes32 root, bytes3 country, string calldata cid) external;
    function deprecateMapRoot(bytes32 root) external;
    function isValidMapRoot(bytes32 root) external view returns (bool);
}
```

---

## 10. Shadow Atlas Changes

### 10.1 New Data Structures

```typescript
// packages/shadow-atlas/src/core/types/two-tree.ts

interface UserLeaf {
  userSecret: bigint;      // From identity verification
  cellId: string;          // Census Tract (11-digit FIPS)
  salt: bigint;            // Registration salt
  leafHash: bigint;        // H(userSecret, cellId, salt)
  index: number;           // Position in Tree 1
}

interface CellMapping {
  cellId: string;                  // Census Tract (11-digit FIPS)
  districts: string[];             // 24 district IDs
  districtCommitment: bigint;      // sponge(districts)
  leafHash: bigint;                // H(cellId, districtCommitment)
}

interface TwoTreeSnapshot {
  userTree: {
    root: bigint;
    depth: number;
    leafCount: number;
    ipfsCid: string;
  };
  cellMapTree: {
    root: bigint;
    depth: number;
    cellCount: number;
    ipfsCid: string;
  };
  timestamp: Date;
  version: string;
}
```

### 10.2 New API Endpoints

```yaml
# packages/shadow-atlas/openapi.yaml additions

/v2/register:
  post:
    summary: Register user in two-tree system
    description: |
      Accepts cell_id (Census Tract) and identity commitment.
      Address geocoding is performed CLIENT-SIDE — the address is never sent to this endpoint.
    requestBody:
      content:
        application/json:
          schema:
            type: object
            required: [identityCommitment, cellId, salt]
            properties:
              identityCommitment:
                type: string
                description: H(user_secret)
              cellId:
                type: string
                description: Census Tract FIPS code (11 digits, derived client-side)
              salt:
                type: string
                description: Registration salt
    responses:
      200:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TwoTreeRegistration'

/v2/sync:
  get:
    summary: Get updated paths for user
    parameters:
      - name: userLeafIndex
        in: query
        schema:
          type: integer
      - name: cellId
        in: query
        schema:
          type: string
    responses:
      200:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TwoTreeSync'

/v2/roots:
  get:
    summary: Get current valid roots
    responses:
      200:
        content:
          application/json:
            schema:
              type: object
              properties:
                userRoot:
                  type: string
                cellMapRoot:
                  type: string
                userRootExpires:
                  type: string
                  format: date-time
                cellMapRootExpires:
                  type: string
                  format: date-time
```

### 10.3 Tree Builder Changes

```typescript
// packages/shadow-atlas/src/core/two-tree-builder.ts

export class TwoTreeBuilder {
  private userTree: MerkleTree;
  private cellMapTree: SparseMerkleTree;

  constructor(config: TwoTreeConfig) {
    this.userTree = new MerkleTree(config.userTreeDepth);
    this.cellMapTree = new SparseMerkleTree(config.cellMapDepth);
  }

  async registerUser(
    userSecret: bigint,
    cellId: string,
    salt: bigint,
    authorityLevel: bigint
  ): Promise<UserRegistration> {
    // 1. Compute user leaf
    const userLeaf = poseidon2Hash4(userSecret, BigInt(cellId), salt, authorityLevel);

    // 2. Insert into user tree
    const index = await this.userTree.insert(userLeaf);

    // 3. Ensure cell is in cell map
    await this.ensureCellMapping(cellId);

    // 4. Return registration data
    return {
      leafIndex: index,
      userPath: await this.userTree.getPath(index),
      userRoot: this.userTree.root,
      cellId,
      districts: await this.getCellDistricts(cellId),
      cellMapPath: await this.cellMapTree.getPath(cellId),
      cellMapRoot: this.cellMapTree.root,
    };
  }

  async updateCellMapping(cellId: string, districts: string[]): Promise<void> {
    const districtCommitment = poseidon2Sponge24(districts.map(BigInt));
    const leafValue = poseidon2Hash2(BigInt(cellId), districtCommitment);
    await this.cellMapTree.update(cellId, leafValue);
  }
}
```

---

## 11. Client (Communique) Changes

### 11.1 New Prover Interface

```typescript
// packages/client/src/zk/two-tree-prover.ts

export interface TwoTreeProofInputs {
  // Public
  userRoot: string;
  cellMapRoot: string;
  districts: string[];
  actionDomain: string;
  authorityLevel: number;

  // Private
  userSecret: string;
  cellId: string;
  registrationSalt: string;
  userPath: string[];
  userIndex: number;
  cellMapPath: string[];
  cellMapPathBits: number[];
}

export interface TwoTreeProofResult {
  proof: Uint8Array;
  publicInputs: {
    userRoot: string;
    cellMapRoot: string;
    districts: string[];
    nullifier: string;
    actionDomain: string;
    authorityLevel: number;
  };
}

export class TwoTreeProver {
  private circuit: CompiledCircuit;
  private backend: UltraHonkBackend;

  async generateProof(inputs: TwoTreeProofInputs): Promise<TwoTreeProofResult> {
    // 1. Compute nullifier locally (for UI preview)
    const nullifier = poseidon2Hash2(
      BigInt(inputs.identityCommitment),
      BigInt(inputs.actionDomain)
    );

    // 2. Prepare witness
    const witness = this.prepareWitness(inputs, nullifier);

    // 3. Generate proof
    const proof = await this.backend.prove(this.circuit, witness);

    return {
      proof,
      publicInputs: {
        userRoot: inputs.userRoot,
        cellMapRoot: inputs.cellMapRoot,
        districts: inputs.districts,
        nullifier: nullifier.toString(),
        actionDomain: inputs.actionDomain,
        authorityLevel: inputs.authorityLevel,
      },
    };
  }
}
```

### 11.2 Credential Sync Service

```typescript
// packages/client/src/services/credential-sync.ts

export class CredentialSyncService {
  private shadowAtlasClient: ShadowAtlasClient;
  private credentialStore: CredentialStore;

  async syncIfNeeded(): Promise<SyncResult> {
    const credential = await this.credentialStore.get();
    const currentRoots = await this.shadowAtlasClient.getRoots();

    const needsUserSync = credential.userRoot !== currentRoots.userRoot;
    const needsCellSync = credential.cellMapRoot !== currentRoots.cellMapRoot;

    if (!needsUserSync && !needsCellSync) {
      return { synced: false, reason: 'up-to-date' };
    }

    const syncData = await this.shadowAtlasClient.sync({
      userLeafIndex: credential.userLeafIndex,
      cellId: credential.cellId,
    });

    await this.credentialStore.update({
      ...credential,
      userPath: syncData.userPath,
      userRoot: syncData.userRoot,
      districts: syncData.districts,
      cellMapPath: syncData.cellMapPath,
      cellMapPathBits: syncData.cellMapPathBits,
      cellMapRoot: syncData.cellMapRoot,
      updatedAt: new Date(),
    });

    return {
      synced: true,
      userRootChanged: needsUserSync,
      cellMapRootChanged: needsCellSync,
    };
  }
}
```

---

## 12. Crypto Package Changes

### 12.1 New Circuit Artifacts

```
packages/crypto/noir/
├── district_membership/       # EXISTING (single-tree)
│   └── src/main.nr
└── two_tree_membership/       # NEW
    ├── Nargo.toml
    ├── src/
    │   └── main.nr
    └── target/
        ├── two_tree_20.json   # Depth 20
        ├── two_tree_22.json   # Depth 22
        └── two_tree_24.json   # Depth 24
```

### 12.2 SMT Implementation

```typescript
// packages/crypto/src/smt.ts

export class SparseMerkleTree {
  private depth: number;
  private nodes: Map<string, bigint>;
  private emptyHashes: bigint[];

  constructor(depth: number) {
    this.depth = depth;
    this.nodes = new Map();
    this.emptyHashes = this.computeEmptyHashes();
  }

  private computeEmptyHashes(): bigint[] {
    const hashes: bigint[] = new Array(this.depth + 1);
    hashes[0] = EMPTY_LEAF_HASH;
    for (let i = 1; i <= this.depth; i++) {
      hashes[i] = poseidon2Hash2(hashes[i - 1], hashes[i - 1]);
    }
    return hashes;
  }

  getPath(key: string): { path: bigint[]; pathBits: number[] } {
    const keyHash = poseidon2Hash1(BigInt(key));
    const path: bigint[] = [];
    const pathBits: number[] = [];

    let currentKey = keyHash;
    for (let i = 0; i < this.depth; i++) {
      const bit = Number((currentKey >> BigInt(i)) & 1n);
      pathBits.push(bit);

      const siblingKey = this.getSiblingKey(currentKey, i);
      const sibling = this.nodes.get(siblingKey) ?? this.emptyHashes[i];
      path.push(sibling);

      currentKey = currentKey >> 1n;
    }

    return { path, pathBits };
  }

  update(key: string, value: bigint): void {
    // Update leaf and all ancestor nodes
    const keyHash = poseidon2Hash1(BigInt(key));
    this.updatePath(keyHash, value);
  }
}
```

---

## 13. Migration Strategy

### 13.1 Core Principle: Natural Credential Expiry IS the Migration

Existing credentials expire every 6 months (`session-credentials.ts:expiresAt`). At expiry, users re-enter their address and re-verify — this is the existing flow. The migration changes what happens during that renewal: the system generates a two-tree credential instead of a single-tree one.

**No forced re-registration.** No mass migration campaign. No storing extra location data. No `lookupFromExistingDistrict()`. The 6-month credential cycle rolls users over naturally.

```
Timeline:
─────────────────────────────────────────────────────────────────

Day 0:    Deploy two-tree infrastructure + both verifiers
          New registrations → two-tree credentials
          Existing credentials → continue using single-tree verifier

Month 1:  ~17% of users renew naturally → two-tree
Month 3:  ~50% of users renew naturally → two-tree
Month 6:  ~100% of users renew naturally → two-tree

Month 7:  Deprecate single-tree verifier (announce 30-day sunset)
Month 8:  Decommission single-tree verifier
```

### 13.2 Phased Infrastructure Rollout

```
Phase 1: Foundations
─────────────────────────────────
- Implement SMT in @voter-protocol/crypto
- Create two_tree_membership circuit
- Golden vector tests against Noir + TypeScript

Phase 2: Contracts + Shadow Atlas
─────────────────────────────────
- Deploy UserRootRegistry + CellMapRegistry
- Deploy TwoTreeVerifier alongside existing verifier
- Implement TwoTreeBuilder in Shadow Atlas
- Build cell→district mapping from existing TIGER data
- Add /v2/ API endpoints
- Generate + publish initial cell_map_root

Phase 3: Client Integration
─────────────────────────────────
- Client-side geocoding: Census API → Census Tract
- Implement TwoTreeProver (WASM)
- Add CredentialSyncService
- Update registration flow to /v2/register
- Proof generation uses two-tree when credential supports it

Phase 4: Parallel Operation
─────────────────────────────────
- Both single-tree and two-tree verifiers accept proofs
- DistrictGate dispatches to correct verifier based on proof format
- New registrations → two-tree only
- Existing credentials → single-tree until natural expiry
```

### 13.3 Credential Renewal Flow

When an existing single-tree credential expires:

```typescript
// This is the EXISTING renewal flow with one code path change

async function renewCredential(userId: string): Promise<void> {
  // 1. User enters address (same as current flow)
  const address = await promptForAddress();

  // 2. Client-side geocoding → Census Tract (NEW: was server-side)
  const censusTract = await geocodeToTract(address);
  // address is discarded here — never transmitted

  // 3. Register via /v2/register (NEW endpoint, same user action)
  const credential = await shadowAtlas.registerTwoTree({
    cellId: censusTract,
    identityCommitment: deriveCommitment(userId),
    salt: crypto.getRandomValues(new Uint8Array(32)),
  });

  // 4. Store encrypted credential (same as before)
  await storeSessionCredential(credential);
}
```

**From the user's perspective, nothing changes.** They enter their address, wait for verification, and get a confirmation. The credential structure is an implementation detail.

### 13.4 Dual Verifier Dispatch

```solidity
// DistrictGate.sol — route to correct verifier during transition

function verifyProof(
    bytes calldata proof,
    uint256[] calldata publicInputs
) external returns (bool) {
    if (publicInputs.length == 5) {
        // Single-tree proof (legacy)
        return singleTreeVerifier.verify(proof, publicInputs);
    } else if (publicInputs.length == 29) {
        // Two-tree proof
        return twoTreeVerifier.verify(proof, publicInputs);
    }
    revert("Unknown proof format");
}
```

### 13.5 What About Users Who Don't Return?

Users who never renew (churned) simply expire. Their old credentials become invalid after 6 months regardless. No action needed — this is identical to current behavior.

---

## 14. Security Analysis

### 14.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| User claims wrong cell | ZK proof fails (cell not in user tree) |
| User claims wrong districts | ZK proof fails (districts don't match cell map) |
| User generates multiple identities | Same identityCommitment produces same nullifier (NUL-001) |
| User loses browser data | Leaf replacement protocol (Section 8.4-8.8) — same nullifier preserved |
| Malicious Shadow Atlas | Roots are on-chain, verifiable by anyone |
| Cell map tampering | SMT proofs cryptographically bound |
| Redistricting race condition | 90-day grace period |

### 14.2 Privacy Analysis

**Data lifecycle:**

| Data | Created | Transmitted | Stored | Revealed in Proof |
|------|---------|-------------|--------|-------------------|
| Address | User types in browser | Census API (JSONP, ephemeral) | NEVER | NEVER |
| lat/lon | Census API response | Census API only | NEVER | NEVER |
| cell_id | Derived from Census Tract | Shadow Atlas (registration) | Encrypted IndexedDB | NEVER (private input) |
| districts[24] | Shadow Atlas lookup | Shadow Atlas → Client | Encrypted IndexedDB | YES (public output) |
| user_secret | Identity provider | NEVER | In-memory only | NEVER (private input) |
| salt | Client RNG | Shadow Atlas (registration) | Encrypted IndexedDB | NEVER (private input) |
| identityCommitment | Derived from OAuth credential | Communique server (registration) | Communique Postgres | NEVER (private circuit input; public via nullifier indirectly) |
| cell_id_hash | H(cell_id) at registration | Communique server | Communique Postgres | NEVER (recovery consistency check only) |

**Anonymity sets:**

| If adversary knows... | Anonymity set | Source |
|----------------------|---------------|--------|
| cell_id (Census Tract) | ~4,000 people | Would require device compromise |
| districts[24] (proof output) | ~5,000-50,000 people | Public, by design |
| Single district (e.g., congressional) | ~760,000 people | Subset of proof output |

**cell_id is strictly more private than the proof output.** Even if an adversary compromises the device and decrypts the credential, the Census Tract reveals less than the 24-district set already disclosed publicly in every proof. The cell_id is defense-in-depth, not a privacy-critical secret.

---

## 15. Performance Analysis

### 15.1 Constraint Budget

Proving times scale roughly linearly with constraint count.
Single-tree baseline: ~11K constraints, ~14s mobile flagship (from circuit spec).

| Configuration | Constraints | Ratio | Desktop | Mobile (flagship) | Mobile (mid) |
|---------------|-------------|-------|---------|-------------------|--------------|
| Single-tree (current) | ~11K | 1.0× | 3-4s | 6-10s | 12-20s |
| Two-tree (proposed) | ~25.5K | 2.3× | 6-9s | 14-23s | 28-46s |

**Mobile mid-range is marginal** (~28-46s) but significantly better than the prior 160K-constraint estimate which projected ~40s+ on flagships. The 2.3× increase (not 14.5×) means flagship devices remain well within the 30s target.

**Mitigation for mid-range:**
- Progress UI for proofs exceeding 15s
- Timeout handling with retry
- The sponge (8 Poseidon2 rounds) is the largest new cost; if 24 slots are reduced to 12 in a "lite" mode, constraints drop to ~21.5K

### 15.2 Gas Costs

| Operation | Single-tree (estimated) | Two-tree (measured) | Notes |
|-----------|------------------------|---------------------|-------|
| UltraHonk verification | ~2.1M | ~2.1M | Dominated by pairing check |
| Public inputs | 800 | 5,800 | +5,000 |
| District check | 2,400 | 7,200 | +4,800 |
| Calldata | 5,120 | 14,848 | +9,728 |
| **Total** | **~2.1M** | **~2.2M** | Measured on Scroll Sepolia |

> **Note:** The original estimates in this table (~360k/~403k) predated actual UltraHonk deployment. On-chain measurement on Scroll Sepolia shows approximately 2.2M gas per verification (TX `0xc6ef86a3...`). The pairing check dominates, so the +12% delta from additional public inputs is negligible in practice.

### 15.3 Storage Costs

| Component | Size | Storage |
|-----------|------|---------|
| User tree (1M users) | ~32 MB | IPFS |
| Cell map tree (~85k tracts) | ~18 MB | IPFS |
| User credential | ~4 KB | IndexedDB |
| Total client storage | ~4 KB | Device |

---

## 16. Open Questions

### 16.1 Resolved

| Question | Decision | Rationale |
|----------|----------|-----------|
| SMT vs Standard Merkle for Cell Map? | **SMT** | Deterministic positions, efficient redistricting updates |
| Cell Map Depth? | **20** | 1M capacity, 12× headroom for US ~85K tracts |
| Authority Level Handling? | **Per-proof** | Flexible, enforced via actionDomain scoping |
| Cell ID Granularity? | **Census Tract (11 digits)** | k≈4K anonymity, 85K cells, adequate for district mapping |
| Migration Strategy? | **Natural credential expiry** | 6-month cycle rolls users over; no forced re-registration |
| Address Storage? | **Never** | Client-side geocoding; address discarded after Census API call |

### 16.2 Resolved Since v0.2

| Question | Decision | Rationale |
|----------|----------|-----------|
| Noir SMT support? | **Implemented** | `compute_smt_root()` in `main.nr` uses `path_bits: [u1; TREE_DEPTH]` for SMT verification |
| user_secret = 0 rejection? | **SA-011 implemented** | Circuit: `assert(user_secret != 0)`. TypeScript: hash functions accept zero but circuit rejects |
| Authority level overflow? | **BA-007 implemented** | `validate_authority_level()` casts through u64 before u8 to prevent truncation attacks |

### 16.3 Open

1. **WASM prover memory?**
   - ~25.5K constraints (2.3x single-tree), est. ~28-46s on mid-range mobile
   - Progress UI implemented for 15s+ proving
   - Recommend prototype testing on target devices before full commitment

2. **Tract boundary straddling?**
   - ~5% of Census Tracts straddle a district boundary
   - Shadow Atlas assigns majority district; edge case users may have one incorrect slot
   - Acceptable tradeoff vs Block Group complexity

---

## Appendix A: Hash Function Specifications

```
Poseidon2_Hash2(a, b):
  DOMAIN_HASH2 = 0x48324d              // "H2M" (Hash-2 Marker)
  state = [a, b, DOMAIN_HASH2, 0]
  state = Poseidon2_Permutation(state)
  return state[0]

Poseidon2_Hash3(a, b, c):
  DOMAIN_HASH3 = 0x48334d              // "H3M" (Hash-3 Marker)
  state = [a, b, c, DOMAIN_HASH3]
  state = Poseidon2_Permutation(state)
  return state[0]

Poseidon2_Sponge24(inputs[24]):
  DOMAIN_SPONGE_24 = 0x534f4e47455f24    // "SONGE_24"
  state = [DOMAIN_SPONGE_24, 0, 0, 0]   // Domain separation in state[0]
  for i in 0..8:
    state[1] = state[1] + inputs[i*3]   // ADD to state, not overwrite
    state[2] = state[2] + inputs[i*3+1]
    state[3] = state[3] + inputs[i*3+2]
    state = Poseidon2_Permutation(state)
  return state[0]
```

**CRITICAL:** The sponge MUST add inputs to existing state (`state[k] + inputs[j]`), not overwrite (`state[k] = inputs[j]`). Overwriting discards chaining between rounds and creates collision vulnerabilities. See Section 4.1 for the Noir implementation.

---

## Appendix B: Cell ID Format

```
Census Tract FIPS Code (11 digits):

  06  075  061200
  ──  ───  ──────
  │   │    └────────── Census Tract (6 digits)
  │   └─────────────── County FIPS (3 digits)
  └─────────────────── State FIPS (2 digits)

Examples:
  06075061200 = California, San Francisco County, Tract 0612.00
  36061000100 = New York, New York County, Tract 0001.00
  48439123400 = Texas, Harris County, Tract 1234.00

US has ~85,000 Census Tracts (~4,000 people avg).
Tracts are stable — boundaries change only with the decennial census.
The Census Bureau already returns Tract data via the geographies API
(same JSONP call that currently resolves congressional districts).
```

**Why not Census Block Group (12 digits)?**

Block Groups subdivide tracts into ~1,500-person units. This provides more geographic precision but weaker privacy (smaller k-anonymity set). Since cell_id is a private circuit input (never revealed), the privacy difference is marginal. Census Tract is preferred because:
1. Fewer cells (85K vs 242K) → simpler SMT, fewer collisions
2. Larger k-anonymity (4K vs 1.5K) → stronger privacy default
3. Returned by the same Census API call (no additional request)
4. Boundary-straddling tracts (~5%) assigned majority district by Shadow Atlas

---

## Appendix C: Related Specifications

- `DISTRICT-TAXONOMY.md` - 24-slot district taxonomy
- `GLOBAL_MERKLE_SPEC.md` - Original global tree specification (v2.0, archived)
- `REDISTRICTING-CELL-COMMITMENT-ANALYSIS.md` - Redistricting impact analysis

## Appendix D: Test Coverage

| Layer | Test File | Count | Description |
|-------|-----------|-------|-------------|
| Circuit (Noir) | `two_tree_membership/src/main.nr` | 17 | Inline `#[test]` functions for hash determinism, domain separation, authority validation |
| Crypto (Golden) | `packages/crypto/test/golden-vectors.test.ts` | 21 | Cross-language Noir/TypeScript hash parity |
| Crypto (E2E) | `packages/crypto/test/two-tree-e2e.test.ts` | 9 | Full cross-package flow: registration, tree building, proof verification |
| SMT | `packages/crypto/test/` (sparse-merkle-tree tests) | varies | Insert, proof generation, collision handling |
| Shadow Atlas | `packages/shadow-atlas/src/dual-tree-builder.ts` | 45 | Tree construction, redistricting updates |
| Contracts | `contracts/test/DistrictGate.*.t.sol` | 461 | Verification, nullifiers, governance, EIP-712 |
| Prover | `packages/noir-prover/src/two-tree-prover.ts` | 34 | Witness preparation, proof generation |

---

## 17. Three-Tree Extension (DESIGN ONLY)

> **Status:** DESIGN — No code implemented. This section describes the planned Three-Tree Architecture that adds cryptographically verifiable engagement to the ZK proof. See `specs/REPUTATION-ARCHITECTURE-SPEC.md` for the canonical specification.

### 17.1 Overview

The three-tree architecture extends this specification with a third Merkle tree that commits engagement data into the circuit. The engagement tier becomes a public output, allowing on-chain verification that a user has genuine civic participation history — without revealing what specific actions they took.

```
Tree 1 (User Identity)     Tree 2 (Cell Mapping)      Tree 3 (Engagement)
═══════════════════════     ═════════════════════       ═══════════════════
Standard Merkle             Sparse Merkle (SMT)        Standard Merkle
Leaf = H4(secret,           Leaf = H2(cellId,          Leaf = H2(identityCommitment,
  cellId, salt, auth)         districtCommitment)        engagementDataCommitment)
STABLE (user moves)         DYNAMIC (redistricting)    UPDATED (after verified actions)
```

### 17.2 Circuit Interface Extension

Public inputs grow from 29 to 31:

| Index | Field | Status |
|-------|-------|--------|
| 0-28 | (unchanged from Section 4) | Existing |
| 29 | `engagement_root` | **NEW** — Tree 3 Merkle root |
| 30 | `engagement_tier` | **NEW** — Coarse engagement bucket [0-4] |

New private inputs: `engagement_path`, `engagement_index`, `action_count`, `diversity_score`.

### 17.3 Cross-Tree Identity Binding

The `identity_commitment` private input (already used for nullifier derivation in Section 4.6) is reused in the engagement leaf:

```
engagement_data_commitment = H3(engagement_tier, action_count, diversity_score)
engagement_leaf = H2(identity_commitment, engagement_data_commitment)
```

The circuit enforces that the SAME `identity_commitment` feeds both the nullifier (Step 4) and the engagement leaf (new Step 6). This prevents identity substitution attacks.

### 17.4 Constraint Impact

| Depth | Two-Tree | Three-Tree | Overhead |
|-------|----------|------------|----------|
| 20 | ~20,850 | ~29,700 | +42.4% |
| 24 | ~24,050 | ~33,800 | +40.5% |

Additional constraints come from: H3 engagement data commitment (~400), H2 engagement leaf (~400), Tree 3 Merkle verification (~8,000 at depth 20), engagement tier range check (~50).

### 17.5 Contract Changes

- **EngagementRootRegistry.sol**: New registry (parallel to UserRootRegistry and CellMapRegistry)
- **DistrictGate.verifyThreeTreeProof()**: New entry point accepting `uint256[31]` public inputs
- **VerifierRegistry**: Three-tree verifiers registered alongside two-tree verifiers
- Both `verifyTwoTreeProof()` and `verifyThreeTreeProof()` remain callable during migration

### 17.6 Migration

Two-tree proofs continue to work indefinitely. Three-tree proofs are available after deployment. Users upgrade naturally on next proof generation — no re-registration required. The engagement tree is backfilled from on-chain nullifier consumption events.

### 17.7 Canonical Reference

**See `specs/REPUTATION-ARCHITECTURE-SPEC.md` for complete specification** including:
- Engagement tier definitions (5 tiers with concrete thresholds)
- Token design (VOTER ERC-20 + soulbound engagement credential ERC-8004)
- Anti-pay-to-win guarantees
- Security analysis
- Performance analysis
- Implementation roadmap (Cycles 19-25)

---

*End of Specification*
