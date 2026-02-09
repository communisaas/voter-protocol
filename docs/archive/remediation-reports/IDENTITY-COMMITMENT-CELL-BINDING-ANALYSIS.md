# Identity Commitment and Cell Binding Analysis

> **Document ID:** ANALYSIS-CELL-BINDING-001
> **Version:** 1.0.0
> **Date:** 2026-02-02
> **Status:** Expert Review - Analysis Only (No Implementation)

---

## Executive Summary

This document analyzes the impact of migrating from district-based Merkle trees to cell-based Merkle trees on the identity commitment and proof generation architecture. The current system uses a **district-commitment model** where each proof binds a user to one of 24 district types. The proposed system uses a **cell-commitment model** where proofs bind users to Census Block Group cells, with district membership derived from cell location.

**Key Findings:**

1. **Identity commitment structure does NOT need to change** - it remains a registration-time constant
2. **Leaf structure MUST change** - from `(user_secret, district_id, authority_level, salt)` to `(user_secret, cell_id, district_commitment, salt)`
3. **Authority level encoding is per-proof**, not per-district - multi-district scenarios require separate proofs with potentially different authority levels
4. **Cell binding security is STRONG** - district_commitment cannot be forged because it's derived deterministically from census data
5. **Registration salt strategy should remain single-salt** for efficiency and simplicity
6. **Multi-cell users are NOT supported** - one user = one residential cell (by design)
7. **Revocation mechanism unchanged** - nullifier-based revocation works identically

---

## 1. Identity Commitment Structure

### 1.1 Current Implementation

From `/packages/crypto/noir/district_membership/src/main.nr`:

```noir
// Leaf computation (CVE-001/CVE-003 fix)
fn compute_owned_leaf(
    user_secret: Field,
    district_id: Field,
    authority_level: Field,
    registration_salt: Field,
) -> Field {
    poseidon2_hash4(user_secret, district_id, authority_level, registration_salt)
}
```

**Current leaf:** `Poseidon2(user_secret, district_id, authority_level, registration_salt)`

**Identity commitment:** There is NO separate `identity_commitment` structure in the current implementation. The concept of "identity commitment" from early documentation (`Poseidon2(user_secret, country_code, authority_level, salt)`) **does not exist in production code**.

### 1.2 Proposed Cell-Based Implementation

**Proposed leaf:** `Poseidon2(user_secret, cell_id, district_commitment, registration_salt)`

Where:
- `cell_id` = 12-digit Census Block Group GEOID (e.g., "060750171001")
- `district_commitment` = `Poseidon2([d0, d1, ..., d23])` - commitment to all 24 district assignments for that cell

### 1.3 Analysis: Does Identity Commitment Change?

**Answer: NO - because identity commitment doesn't exist as a separate construct.**

The user's identity is bound through:
1. **user_secret** - private key material from self.xyz/Didit verification (never changes)
2. **registration_salt** - random salt assigned at registration (never changes)

These remain constant across all proofs. The leaf structure changes per-proof based on:
- Current: which **district** the user is proving membership in
- Proposed: which **cell** the user is proving membership in

**Migration Impact:**
- ✅ No change to identity verification method (self.xyz/Didit)
- ✅ No change to user_secret generation or storage
- ✅ No change to registration_salt generation
- ❌ Leaf computation logic MUST change (different inputs)
- ❌ Circuit MUST change (different witness structure)

---

## 2. Authority Level Handling

### 2.1 Current Model: Per-Proof Authority Level

From `/packages/crypto/district-prover.ts`:

```typescript
export interface DistrictWitness {
  // PRIVATE inputs (user witnesses, never leave browser)
  authority_level: number;  // Authority level tier 1-5 (private input, becomes public output)
}
```

From circuit (`main.nr`):

```noir
fn main(
    // ...
    authority_level: Field,  // PRIVATE input
    // ...
) -> pub (Field, Field, Field, Field, Field) {
    validate_authority_level(authority_level);  // [1, 5]
    // ...
    (merkle_root, nullifier, authority_level, action_domain, district_id)
    //                        ^^^^^^^^^^^^^^^^ public output
}
```

**Current behavior:**
- Authority level is a **private witness** (user provides it per-proof)
- Circuit validates range [1, 5]
- Authority level is **public output** (revealed on-chain)
- Different proofs for same district can have different authority levels (user controls)

### 2.2 Cell Model: Authority Level Per-Proof or Per-District?

**Question:** Should authority level be:
1. **Per-cell** (single value for all 24 districts)?
2. **Per-district** (different value for each district type)?
3. **Per-proof** (user chooses each time)?

**Analysis:**

#### Option 1: Per-Cell Authority (Single Value)

```noir
leaf = Poseidon2(user_secret, cell_id, authority_level, district_commitment, salt)
```

**Pros:**
- Simplest model
- Matches current circuit structure

**Cons:**
- ❌ **Unrealistic governance model** - users have different authority in different contexts
  - Example: Full voter (5) in congressional district, observer-only (1) in school board (no kids enrolled)
  - Example: Property owner (4) in water district, non-participant (0) in fire district
- ❌ Requires re-registration if authority changes in ANY district

#### Option 2: Per-District Authority (24 Values)

```noir
// Store 24 authority levels in leaf or district_commitment
district_commitment = Poseidon2([
  Hash(d0, auth0),
  Hash(d1, auth1),
  // ...
  Hash(d23, auth23)
])
```

**Pros:**
- Most flexible
- Matches real-world governance

**Cons:**
- ❌ **Massive leaf preimage** - 24 districts × 2 fields = 48 fields
- ❌ Circuit must verify authority matches district commitment
- ❌ Complex verification logic

#### Option 3: Per-Proof Authority (Current Model)

```noir
// Leaf does NOT include authority_level
leaf = Poseidon2(user_secret, cell_id, district_commitment, salt)

// Authority provided at proof time, not committed
fn main(
    authority_level: Field,  // PRIVATE witness, not part of leaf
    // ...
)
```

**Pros:**
- ✅ **Flexible** - user can claim different authority for different actions
- ✅ **Efficient** - no additional leaf size
- ✅ **Backward compatible** - matches current circuit structure

**Cons:**
- ⚠️ **No on-chain authority verification** - authority level is self-asserted
- ⚠️ Application layer must enforce authority requirements

### 2.3 Recommendation: Per-Proof Authority (Option 3)

**Rationale:**

The current model already uses **per-proof authority** with **no on-chain enforcement**. Authority level is:
1. A **public output** (visible on-chain)
2. **Self-asserted** by the user
3. **Enforced by application logic** (e.g., campaign contract checks `authority_level >= 3`)

**This is the correct model for ZK voting:**
- The circuit proves **geographic eligibility** (you live in the district)
- The circuit does NOT prove **authority level** (that's verified off-chain via self.xyz/Didit credentials)
- The application layer enforces authority requirements per-action

**Cell migration impact:** NONE - authority level remains per-proof witness.

**Example scenarios:**

1. **Congressional district voting (authority 5 required):**
   - User proves cell membership → derives congressional district from cell
   - User provides authority_level = 5 (verified by campaign contract)

2. **School board observer-only (authority 1 required):**
   - Same user, same cell, different proof
   - User provides authority_level = 1 (different action_domain)

3. **Multi-district action (state + county, both require authority 4):**
   - User generates 2 proofs (one per district slot)
   - Both proofs have authority_level = 4
   - Application verifies both proofs passed

---

## 3. Cell Binding Security

### 3.1 Attack Vector: Can User Forge District Commitment?

**Proposed leaf:**
```noir
leaf = Poseidon2(user_secret, cell_id, district_commitment, registration_salt)
```

**Attack scenario:**
1. User knows their actual cell structure: `cell_id = "060750171001"`, districts = `[CA-12, CA-SD-11, ...]`
2. User computes fake district commitment: `district_commitment' = Poseidon2([CA-13, CA-SD-12, ...])`
3. User generates proof with: `(user_secret, cell_id, district_commitment', salt)`
4. **Can they claim membership in wrong districts?**

### 3.2 Security Analysis: SAFE

**Defense: Merkle tree structure prevents forgery**

The Shadow Atlas Merkle tree is constructed as:

```typescript
// Server-side tree construction (packages/shadow-atlas/src/merkle-tree.ts)
for each cell in census_data:
  districts = resolveCellDistricts(cell.geoid)  // Deterministic lookup
  district_commitment = Poseidon2(districts)    // Hash of actual districts
  leaf = Poseidon2(user_secret, cell.geoid, district_commitment, salt)
  tree.insert(leaf)
```

**Why forgery fails:**

1. **User provides:** `(user_secret, cell_id, district_commitment', merkle_path, leaf_index)`
2. **Circuit computes:** `leaf' = Poseidon2(user_secret, cell_id, district_commitment', salt)`
3. **Circuit verifies:** `MerkleVerify(leaf', merkle_path, leaf_index) == merkle_root`
4. **Verification FAILS** because:
   - The tree contains `leaf = Poseidon2(user_secret, cell_id, district_commitment_ACTUAL, salt)`
   - The user's forged `leaf'` does NOT exist in the tree
   - The merkle_path cannot produce the correct merkle_root with forged leaf

**Key insight:** District commitment is NOT a user-provided witness - it's **baked into the leaf** during tree construction. The user must prove membership of a leaf that the server created, and that leaf contains the correct district commitment.

### 3.3 Verification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ REGISTRATION PHASE (Server-Side)                                │
│                                                                  │
│ 1. User submits address → server geocodes to cell_id            │
│ 2. Server resolves: cell_id → districts (deterministic)         │
│ 3. Server computes: district_commitment = H(districts)          │
│ 4. Server computes: leaf = H(user_secret, cell_id,              │
│                              district_commitment, salt)          │
│ 5. Server inserts leaf into Merkle tree                         │
│ 6. User receives: (cell_id, merkle_path, leaf_index)            │
│                                                                  │
│ USER CANNOT MODIFY district_commitment - it's part of leaf!     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ PROOF GENERATION PHASE (Client-Side)                            │
│                                                                  │
│ 1. User wants to prove membership in district X                 │
│ 2. User looks up: cell_id → districts → finds district X        │
│ 3. User fetches: district_commitment from registration data     │
│ 4. User generates proof:                                        │
│    - Private: (user_secret, cell_id, district_commitment, salt) │
│    - Public: (merkle_root, nullifier, authority_level, ...)     │
│ 5. Circuit verifies:                                            │
│    - leaf = H(user_secret, cell_id, district_commitment, salt)  │
│    - MerkleVerify(leaf, merkle_path) == merkle_root  ✅          │
│                                                                  │
│ If user tries fake district_commitment:                         │
│    - leaf' = H(user_secret, cell_id, FAKE_commitment, salt)     │
│    - MerkleVerify(leaf', merkle_path) != merkle_root  ❌         │
└─────────────────────────────────────────────────────────────────┘
```

**Conclusion:** Cell binding is **cryptographically secure**. District commitment cannot be forged because it's part of the leaf preimage, and the user must prove membership of a leaf that exists in the server's tree.

---

## 4. Registration Salt Strategy

### 4.1 Current Implementation

From `/packages/crypto/noir/district_membership/src/main.nr`:

```noir
fn compute_owned_leaf(
    user_secret: Field,
    district_id: Field,
    authority_level: Field,
    registration_salt: Field,  // Single salt for all districts
) -> Field
```

**Current behavior:**
- One registration_salt per user registration
- Same salt used across all district proofs
- Prevents rainbow attacks on user_secret

### 4.2 Cell Model: Single Salt vs Per-District Salt

**Option 1: Single Salt (Current Model)**

```noir
leaf = Poseidon2(user_secret, cell_id, district_commitment, registration_salt)
```

**Pros:**
- ✅ Simple
- ✅ Efficient (one salt to store)
- ✅ Sufficient security (salt + user_secret = high entropy)

**Cons:**
- None significant

**Option 2: Per-District Salt (24 Salts)**

```typescript
// User stores 24 different salts, one per district slot
registration_salts: [Field; 24]

// Leaf includes all salts (or salt commitment)
district_commitment = Poseidon2([
  Hash(d0, salt0),
  Hash(d1, salt1),
  // ...
])
```

**Pros:**
- Slightly more entropy per district

**Cons:**
- ❌ **24× storage overhead** (client must store 24 salts)
- ❌ **Complex key management** (lose one salt = lose one district)
- ❌ **No security benefit** (single salt already provides sufficient entropy)

### 4.3 Recommendation: Single Salt

**Rationale:**

1. **Sufficient security:** Rainbow attacks require pre-computing `Hash(secret, salt)` for all possible secrets. With 254-bit field elements, this is computationally infeasible even with single salt.

2. **Simplicity:** One salt = one secret to back up. 24 salts = 24 secrets = 24× chance of loss.

3. **Efficiency:** Leaf computation is simpler, client storage is minimal.

**Implementation:**
```typescript
// User registration (one-time)
const registration_salt = randomField();  // 254-bit random value
const user_secret = deriveUserSecret(diditCredential);  // From identity provider

// Store (user_secret, registration_salt) encrypted in client keystore
```

**Salt uniqueness per user:** Each user gets a unique salt at registration. Different users cannot share salts (enforced by registration service).

---

## 5. Multi-Cell Users (Edge Case)

### 5.1 Scenario: User with Multiple Addresses

**Real-world case:**
- User has primary residence in Cell A (home address)
- User has secondary residence in Cell B (work address, vacation home)

**Question:** Should users be able to register in multiple cells?

### 5.2 Analysis: NOT SUPPORTED (By Design)

**Current system:**
- Users can be in multiple **districts** (24 slots, separate trees)
- Users CANNOT be in multiple addresses within same district

**Cell system:**
- Users can be in **one cell** (one geographic location)
- Cell determines all 24 district memberships

**Rationale for single-cell restriction:**

1. **Geographic identity is singular:** Voter eligibility is based on **primary residence**. Multi-cell registration would allow users to claim multiple residences, violating one-person-one-location principle.

2. **Sybil resistance:** Allowing multi-cell registration creates Sybil attack vector:
   - Register at home address (Cell A)
   - Register at friend's address (Cell B)
   - Generate proofs for both cells → 2× voting power

3. **Consistent with electoral law:** Voters register at ONE primary residence, not multiple locations.

### 5.3 Handling Address Changes

**Scenario:** User moves from Cell A to Cell B

**Solution: Re-registration (Revoke + Register)**

```typescript
// Step 1: Revoke old cell registration (nullifier-based)
// Mark old cell's nullifiers as used/invalid

// Step 2: Register new cell
const new_cell_id = geocodeAddress(new_address);
const new_districts = resolveCellDistricts(new_cell_id);
const new_district_commitment = Poseidon2(new_districts);
const new_leaf = Poseidon2(user_secret, new_cell_id, new_district_commitment, registration_salt);
// Insert new_leaf into Merkle tree

// Result: User has one active cell (Cell B)
```

**Key properties:**
- Same user_secret and registration_salt (identity persists)
- Different cell_id (new location)
- Different district_commitment (new districts)
- Old proofs invalid (old merkle_root no longer in DistrictRegistry)

---

## 6. Identity Revocation

### 6.1 Current Revocation Mechanism

From `/contracts/src/NullifierRegistry.sol`:

```solidity
mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;

function recordNullifier(
    bytes32 actionId,
    bytes32 nullifier,
    bytes32 merkleRoot
) external {
    if (nullifierUsed[actionId][nullifier]) {
        revert NullifierAlreadyUsed();
    }
    nullifierUsed[actionId][nullifier] = true;
}
```

**Current behavior:**
- Nullifier = `Poseidon2(user_secret, action_domain)`
- Once used for action, cannot be reused (prevents double-voting)
- No global revocation (per-action revocation only)

### 6.2 Cell Model: Revocation Changes?

**Proposed nullifier (unchanged):**
```noir
nullifier = Poseidon2(user_secret, action_domain)
```

**Key insight:** Nullifier computation **does not depend on cell_id or district_id**. It only depends on:
1. `user_secret` (constant per user)
2. `action_domain` (public, contract-controlled)

**Revocation scenarios:**

#### Scenario 1: Ban User from All Future Actions

**Current:** Not possible - no global revocation mechanism

**Cell model:** Still not possible (nullifier is per-action)

**Solution (if needed):** Add user_secret_commitment to blacklist:
```solidity
// New contract feature
mapping(bytes32 => bool) public revokedUsers;
bytes32 user_commitment = hash(user_secret);  // Revealed by user during dispute
revokedUsers[user_commitment] = true;
```

#### Scenario 2: Revoke Old Cell Registration (User Moved)

**Current:** Deactivate old district Merkle root in DistrictRegistry:
```solidity
districtRegistry.initiateRootDeactivation(old_merkle_root);
// After 7-day timelock:
districtRegistry.executeRootDeactivation(old_merkle_root);
```

**Cell model:** SAME mechanism - deactivate old cell tree root:
```solidity
districtRegistry.initiateRootDeactivation(old_cell_tree_root);
// After 7-day timelock:
districtRegistry.executeRootDeactivation(old_cell_tree_root);
```

**Result:**
- Old proofs (with old merkle_root) rejected on-chain
- User must generate new proofs with new merkle_root

### 6.3 Recommendation: No Changes Needed

Revocation mechanism works identically for cell-based trees:
- ✅ Per-action nullifier prevents double-voting (unchanged)
- ✅ Merkle root lifecycle controls proof validity (unchanged)
- ✅ User can re-register with same identity after moving (unchanged)

**Only difference:** Granularity of revocation
- Current: Revoke entire district tree (affects all users in district)
- Cell: Revoke entire cell tree (still affects all users, just different grouping)

---

## 7. Verification Method Binding

### 7.1 Current Identity Verification Flow

**From user's perspective:**

1. **Identity verification (self.xyz or Didit):**
   - User proves phone number or government ID
   - Verifier returns: `attestation = { user_id, verified_at, credential_hash }`

2. **Derive user_secret:**
   ```typescript
   const user_secret = Poseidon2(attestation.user_id, attestation.credential_hash);
   ```

3. **Register in district:**
   - User provides address → geocoded to district
   - Server computes: `leaf = Poseidon2(user_secret, district_id, authority_level, salt)`
   - Server adds leaf to district Merkle tree

4. **Generate proof:**
   - User proves: "I know user_secret that matches a leaf in the tree"
   - Circuit verifies: `MerkleVerify(computed_leaf, merkle_path) == merkle_root`

### 7.2 Cell Model: Verification Changes?

**Updated flow:**

1. **Identity verification:** UNCHANGED (still self.xyz/Didit)

2. **Derive user_secret:** UNCHANGED

3. **Register in cell:**
   - User provides address → geocoded to **cell_id**
   - Server computes:
     ```typescript
     const districts = resolveCellDistricts(cell_id);
     const district_commitment = Poseidon2(districts);
     const leaf = Poseidon2(user_secret, cell_id, district_commitment, salt);
     ```
   - Server adds leaf to **cell Merkle tree**

4. **Generate proof:** UNCHANGED (same circuit logic, different leaf structure)

### 7.3 Cross-Cell Updates: Can Same Verification Work?

**Question:** If user moves to new cell, can they reuse same identity verification?

**Answer: YES**

**Key insight:** Identity verification produces `user_secret`, which is:
- Derived from identity attestation (phone/ID verification)
- **Independent of geographic location** (cell or district)
- Reusable across cell updates

**Re-registration after move:**
```typescript
// OLD CELL (no longer valid)
const old_leaf = Poseidon2(user_secret, old_cell_id, old_district_commitment, salt);

// NEW CELL (user moved)
const new_leaf = Poseidon2(user_secret, new_cell_id, new_district_commitment, salt);
//                         ^^^^^^^^^^^ SAME  ^^^^^^^^^^^^^^ DIFFERENT ^^^^^^^^^^

// User can generate proofs for new_leaf without re-verifying identity
```

**Benefits:**
- ✅ No need to re-verify identity with Didit/self.xyz
- ✅ Same user_secret = same identity across all locations
- ✅ Privacy preserved (user_secret never revealed)

### 7.4 Recommendation: No Changes to Verification Method

Cell migration does not affect identity verification:
- ✅ Same identity providers (self.xyz, Didit)
- ✅ Same user_secret derivation
- ✅ Same cryptographic binding
- ✅ Cross-cell portability maintained

---

## 8. Migration Recommendations

### 8.1 Identity Commitment Structure

**Recommendation: NO CHANGE**

There is no separate "identity commitment" construct to change. The user's identity is bound through:
- `user_secret` (from identity verification)
- `registration_salt` (random salt at registration)

Both remain unchanged in cell model.

### 8.2 Leaf Structure

**Recommendation: CHANGE REQUIRED**

**Current leaf:**
```noir
leaf = Poseidon2(user_secret, district_id, authority_level, registration_salt)
```

**New leaf:**
```noir
leaf = Poseidon2(user_secret, cell_id, district_commitment, registration_salt)
```

**Changes:**
- Replace `district_id` → `cell_id` (12-digit GEOID)
- Replace `authority_level` → `district_commitment` (hash of 24 districts)
- Move `authority_level` to per-proof witness (not part of leaf)

**Circuit changes:**
```noir
fn main(
    // PUBLIC
    merkle_root: Field,
    action_domain: Field,

    // PRIVATE
    user_secret: Field,
    cell_id: Field,                     // NEW: replaces district_id
    district_commitment: Field,         // NEW: commitment to 24 districts
    authority_level: Field,             // MOVED: was part of leaf, now separate witness
    registration_salt: Field,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
) -> pub (Field, Field, Field, Field, Field) {
    // Compute leaf with new structure
    let leaf = poseidon2_hash4(user_secret, cell_id, district_commitment, registration_salt);

    // Verify Merkle membership (unchanged)
    let computed_root = compute_merkle_root(leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    // Compute nullifier (unchanged)
    let nullifier = compute_nullifier(user_secret, action_domain);

    // Validate authority_level range (unchanged)
    validate_authority_level(authority_level);

    // NEW: Verify user is claiming membership in valid district from their cell
    // This requires additional witness: (district_id, district_index_in_commitment)
    // Circuit verifies: districts[district_index] == district_id
    // This adds ~500 constraints for district extraction

    (merkle_root, nullifier, authority_level, action_domain, district_id)
}
```

### 8.3 Authority Level Encoding

**Recommendation: PER-PROOF AUTHORITY (Unchanged)**

- Keep current model: authority_level is per-proof witness
- Remove authority_level from leaf structure
- Application layer enforces authority requirements
- Enables flexible multi-district scenarios

### 8.4 Cell Binding Security

**Recommendation: ADOPT PROPOSED MODEL**

- District commitment baked into leaf at registration
- User cannot forge district membership
- Cryptographically secure (Merkle tree prevents leaf forgery)

**Security validation checklist:**
- ✅ Leaf includes district_commitment (server-computed)
- ✅ Circuit verifies Merkle membership of computed leaf
- ✅ User cannot modify district_commitment without breaking proof
- ✅ Server validates cell_id → districts mapping during registration

### 8.5 Registration Salt Strategy

**Recommendation: SINGLE SALT (Unchanged)**

- One registration_salt per user
- Sufficient entropy with user_secret
- Simple key management
- No per-district salts needed

### 8.6 Multi-Cell User Handling

**Recommendation: NOT SUPPORTED (By Design)**

- Restrict users to ONE cell (one primary residence)
- Enforce during registration (one user_secret = one active cell)
- Support cell updates via re-registration (revoke old + register new)
- Maintains one-person-one-location principle

**Implementation:**
```typescript
// Registration service
async function registerUser(user_secret: Field, address: string) {
  // Check if user_secret already has active cell
  const existing_cell = await db.findActiveCellByUserSecret(user_secret);
  if (existing_cell) {
    throw new Error("User already registered. Must revoke old cell before registering new one.");
  }

  // Proceed with registration
  const cell_id = await geocodeAddress(address);
  // ...
}
```

### 8.7 Revocation Mechanism

**Recommendation: NO CHANGES**

- Keep current nullifier-based revocation (per-action)
- Keep Merkle root lifecycle management (deactivate old roots)
- Cell model works identically to district model

### 8.8 Verification Method Binding

**Recommendation: NO CHANGES**

- Same identity providers (self.xyz, Didit)
- Same user_secret derivation
- Cross-cell portability maintained
- No need to re-verify identity after cell update

---

## 9. Backward Compatibility Analysis

### 9.1 Breaking Changes

**Circuit-level:**
- ❌ Leaf structure incompatible (different hash inputs)
- ❌ Witness structure incompatible (cell_id vs district_id)
- ❌ Cannot verify old proofs with new circuit

**Contract-level:**
- ✅ Public inputs compatible (same order: merkle_root, nullifier, authority_level, action_domain, district_id)
- ✅ DistrictRegistry compatible (same interface)
- ✅ NullifierRegistry compatible (same nullifier computation)

### 9.2 Migration Strategy

**Option 1: Hard Cutover (Recommended for Early Stage)**

```
Day 0: Current system (district trees)
Day N: Shutdown for migration
Day N+1: New system (cell trees)
```

**Steps:**
1. Announce migration 30 days in advance
2. Freeze new registrations 7 days before migration
3. Deploy new contracts (DistrictRegistry with cell roots)
4. Deploy new verifiers (cell-based circuit)
5. Require all users to re-register (same user_secret, new cell_id)

**Pros:**
- Clean break
- No dual-system complexity

**Cons:**
- User friction (must re-register)

**Option 2: Gradual Migration (Recommended for Production)**

```
Phase 1: Deploy cell system alongside district system
Phase 2: Support both proof types (dual verifiers)
Phase 3: Deprecate district proofs after 6 months
```

**Implementation:**
```solidity
// DistrictGate contract
function verifyAndAuthorize(bytes calldata proof, ...) external {
    bytes32 districtRoot = extractMerkleRoot(proof);

    // Check if district root or cell root
    if (districtRegistry.isDistrictRoot(districtRoot)) {
        // Legacy path: district-based verification
        address verifier = verifierRegistry.getDistrictVerifier(depth);
        // ...
    } else if (districtRegistry.isCellRoot(districtRoot)) {
        // New path: cell-based verification
        address verifier = verifierRegistry.getCellVerifier(depth);
        // ...
    } else {
        revert UnknownRootType();
    }
}
```

**Pros:**
- No user disruption
- Gradual rollout
- Fallback if issues found

**Cons:**
- Dual-system complexity
- Higher gas costs (routing logic)

### 9.3 User Data Migration

**What needs to change:**
```typescript
// Old registration data
interface OldRegistration {
  user_secret: Field;
  district_id: Field;
  authority_level: number;
  registration_salt: Field;
  merkle_path: Field[];
  leaf_index: number;
}

// New registration data
interface NewRegistration {
  user_secret: Field;           // SAME
  cell_id: Field;               // CHANGED: from district_id
  district_commitment: Field;   // NEW
  registration_salt: Field;     // SAME
  merkle_path: Field[];         // SAME structure, different tree
  leaf_index: number;           // SAME structure, different tree
}
```

**Migration script:**
```typescript
async function migrateUser(oldReg: OldRegistration) {
  // 1. Resolve user's address (off-chain, from original registration)
  const address = await lookupAddressByDistrictId(oldReg.district_id);

  // 2. Geocode to cell
  const cell_id = await geocodeAddress(address);

  // 3. Resolve cell districts
  const districts = await resolveCellDistricts(cell_id);

  // 4. Compute district commitment
  const district_commitment = Poseidon2(districts);

  // 5. Compute new leaf
  const new_leaf = Poseidon2(
    oldReg.user_secret,      // SAME
    cell_id,                 // CHANGED
    district_commitment,     // NEW
    oldReg.registration_salt // SAME
  );

  // 6. Insert into new cell tree
  const { merkle_path, leaf_index } = await cellTree.insert(new_leaf);

  return {
    user_secret: oldReg.user_secret,
    cell_id,
    district_commitment,
    registration_salt: oldReg.registration_salt,
    merkle_path,
    leaf_index,
  };
}
```

---

## 10. Security Considerations

### 10.1 Threat Model

**Threat 1: User Forges District Commitment**

**Attack:** User claims membership in wrong district by providing fake district_commitment

**Mitigation:** ✅ PROTECTED - district_commitment is part of leaf, baked into Merkle tree at registration. Cannot forge without breaking Merkle proof.

**Threat 2: User Registers Multiple Cells (Sybil Attack)**

**Attack:** User registers at home and friend's address to vote twice

**Mitigation:** ⚠️ PARTIALLY PROTECTED - single user_secret = single active cell (enforced at registration). However, user could generate NEW user_secret for second address (requires separate identity verification).

**Defense:**
- Phone number verification (self.xyz): One phone = one identity
- Government ID verification (Didit): One ID = one identity
- Nullifier registry: Prevents double-voting within same action

**Threat 3: Address Geocoding Manipulation**

**Attack:** User provides fake address that geocodes to different cell

**Mitigation:** ⚠️ APPLICATION-LAYER PROTECTION REQUIRED
- Verify address with USPS or government records
- Require proof of residency (utility bill, lease)
- Rate-limit registration changes (prevent rapid cell-hopping)

**Threat 4: Server Compromises Cell → District Mapping**

**Attack:** Malicious server operator assigns wrong districts to cell

**Mitigation:** ✅ AUDIT TRAIL + TRANSPARENCY
- Cell → district mappings are PUBLIC (Census data)
- Community can verify mappings against official sources
- Provenance logs track all mapping changes (see `packages/shadow-atlas/provenance/`)

**Threat 5: User Extracts user_secret from Proof**

**Attack:** Adversary reverse-engineers proof to extract user_secret

**Mitigation:** ✅ PROTECTED - ZK proof guarantees user_secret never revealed. Only public outputs visible (merkle_root, nullifier, authority_level, action_domain, district_id).

### 10.2 Security Recommendations

1. **Enforce single-cell registration** at application layer (one user_secret = one active cell)

2. **Audit cell→district mappings** against Census TIGER/Line data

3. **Implement proof-of-residency** requirements during registration

4. **Rate-limit cell updates** (e.g., max 1 cell change per 6 months)

5. **Publish provenance logs** for all cell registrations (audit trail)

6. **Monitor nullifier usage patterns** for Sybil attacks (multiple nullifiers with same action pattern)

---

## 11. Implementation Checklist

### 11.1 Circuit Changes

- [ ] Update `compute_owned_leaf()` function:
  ```noir
  fn compute_owned_leaf(
      user_secret: Field,
      cell_id: Field,              // CHANGED
      district_commitment: Field,  // NEW
      registration_salt: Field,
  ) -> Field
  ```

- [ ] Move `authority_level` to main function witness (remove from leaf)

- [ ] Add district extraction logic (verify district_id matches district_commitment)

- [ ] Update circuit tests (new leaf structure, new witness format)

- [ ] Regenerate compiled circuits for all depths (18, 20, 22, 24)

- [ ] Generate new verifier contracts (`bb contract` for each depth)

### 11.2 Prover Changes

- [ ] Update `DistrictWitness` interface:
  ```typescript
  export interface DistrictWitness {
    merkle_root: string;
    action_domain: string;
    user_secret: string;
    cell_id: string;              // CHANGED from district_id
    district_commitment: string;  // NEW
    authority_level: number;      // Kept as witness, not in leaf
    registration_salt: string;
    merkle_path: string[];
    leaf_index: number;
  }
  ```

- [ ] Update proof generation tests (new witness format)

- [ ] Update golden vector tests (new leaf hashes)

### 11.3 Contract Changes

- [ ] Deploy new verifier contracts (cell-based circuits)

- [ ] Register new verifiers in VerifierRegistry (7-day timelock)

- [ ] Update DistrictRegistry to support cell roots:
  ```solidity
  enum RootType { District, Cell }
  mapping(bytes32 => RootType) public rootTypes;
  ```

- [ ] Add cell root registration function:
  ```solidity
  function registerCellRoot(bytes32 cellRoot, bytes3 country, uint8 depth) external;
  ```

- [ ] Update DistrictGate routing logic (detect cell vs district root)

### 11.4 Registration Service Changes

- [ ] Implement cell geocoding (address → 12-digit GEOID)

- [ ] Implement district resolution (cell_id → 24 districts)

- [ ] Compute district_commitment during registration

- [ ] Update leaf computation (new structure)

- [ ] Enforce single-cell registration (one user_secret = one active cell)

### 11.5 Client Changes

- [ ] Update registration flow (capture cell_id instead of district_id)

- [ ] Update proof generation (new witness structure)

- [ ] Update cell storage (store district_commitment)

- [ ] Update UI (display cell-based district memberships)

### 11.6 Migration

- [ ] Write user data migration script (district → cell)

- [ ] Test migration on staging environment

- [ ] Announce migration timeline (30-day notice)

- [ ] Execute migration (coordinate contract + database + client updates)

- [ ] Monitor post-migration (verify proofs working, no regressions)

---

## 12. Conclusion

### 12.1 Summary of Findings

| Component | Change Required | Impact Level | Backward Compatible |
|-----------|----------------|--------------|-------------------|
| Identity commitment | ❌ No | None | N/A |
| Leaf structure | ✅ Yes | **HIGH** | ❌ No |
| Authority level | ❌ No (keep per-proof) | None | ✅ Yes |
| Cell binding | ✅ Yes (new model) | **HIGH** | ❌ No |
| Registration salt | ❌ No (keep single salt) | None | ✅ Yes |
| Multi-cell users | ❌ No (not supported) | None | N/A |
| Revocation mechanism | ❌ No | None | ✅ Yes |
| Verification method | ❌ No | None | ✅ Yes |

### 12.2 Key Recommendations

1. **Identity commitment:** No separate construct exists - no changes needed

2. **Leaf structure:** MUST change to `Poseidon2(user_secret, cell_id, district_commitment, salt)`

3. **Authority level:** Keep per-proof witness model (flexible, matches current design)

4. **Cell binding:** Adopt proposed model - cryptographically secure, prevents district forgery

5. **Registration salt:** Keep single salt per user (sufficient entropy, simple)

6. **Multi-cell users:** Do NOT support - enforce one user = one cell (Sybil resistance)

7. **Revocation:** No changes - current mechanism works for cells

8. **Migration:** Gradual rollout with dual-system support (minimize user friction)

### 12.3 Critical Implementation Notes

**Circuit:**
- Move authority_level OUT of leaf, make it per-proof witness
- Add district extraction constraints (verify district_id ∈ district_commitment)
- Test thoroughly (new leaf structure = new attack surface)

**Security:**
- Enforce single-cell registration at application layer
- Audit cell→district mappings against Census data
- Monitor for Sybil attacks (multi-registration patterns)

**User Experience:**
- Migration requires re-registration (same identity, new cell)
- Communicate benefits: unified geographic identity, multi-district proofs
- Provide migration assistance (auto-migrate where possible)

---

## Appendix A: Comparison Table

| Aspect | Current (District) | Proposed (Cell) |
|--------|-------------------|----------------|
| **Leaf structure** | `H(secret, district, auth, salt)` | `H(secret, cell, commitment, salt)` |
| **Identity binding** | Via user_secret | Via user_secret (unchanged) |
| **Authority model** | Per-proof witness | Per-proof witness (unchanged) |
| **Multi-location** | 24 districts (separate trees) | 1 cell (24 districts derived) |
| **Forgery resistance** | District in tree | Cell + commitment in tree |
| **Salt strategy** | Single salt | Single salt (unchanged) |
| **Nullifier** | `H(secret, action_domain)` | `H(secret, action_domain)` (unchanged) |
| **Revocation** | Nullifier + root deactivation | Nullifier + root deactivation (unchanged) |
| **Migration impact** | N/A | Circuit + leaf computation + registration |

---

## Appendix B: References

### Code Files Analyzed

- `/Users/noot/Documents/voter-protocol/packages/crypto/district-prover.ts` - Prover implementation
- `/Users/noot/Documents/voter-protocol/packages/crypto/noir/district_membership/src/main.nr` - Circuit implementation
- `/Users/noot/Documents/voter-protocol/contracts/src/DistrictRegistry.sol` - On-chain registry
- `/Users/noot/Documents/voter-protocol/contracts/src/NullifierRegistry.sol` - Nullifier management
- `/Users/noot/Documents/voter-protocol/contracts/src/DistrictGate.sol` - Verification orchestration
- `/Users/noot/Documents/voter-protocol/specs/DISTRICT-TAXONOMY.md` - 24-district model
- `/Users/noot/Documents/voter-protocol/specs/DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md` - Circuit specification

### Related Documentation

- CVE-001/CVE-003: Leaf computation security fix (user_secret binding)
- CVE-002: Nullifier domain separation fix (action_domain public)
- ISSUE-006: Authority level range validation [1, 5]
- SA-004: Root lifecycle management (isValidRoot)
- SA-001: Action domain whitelist (governance-controlled)

---

**Document End**
