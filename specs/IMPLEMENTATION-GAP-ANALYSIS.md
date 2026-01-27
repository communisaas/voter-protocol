# Implementation Gap Analysis: Unified Proof Architecture

> **Date:** 2026-01-26
> **Status:** CRITICAL VULNERABILITIES IDENTIFIED - REVISION 3
> **Related:** UNIFIED-PROOF-ARCHITECTURE.md, CROSS-REPO-IDENTITY-ARCHITECTURE.md
> **Security Review:** Multi-expert adversarial analysis completed 2026-01-26
> **Expert Reviewers:** Identity Systems Architect, ZK Cryptography Expert, Civic Tech Architect

---

## 🔴 CRITICAL: Security Vulnerabilities (Pre-Launch Blockers)

**Red team analysis identified fundamental flaws that must be fixed before any deployment.**

### CVE-VOTER-001: Opaque Leaf Vulnerability
**Severity:** CRITICAL | **Exploitability:** Trivial

The circuit accepts any leaf from the Merkle tree without verifying it contains the claimed `authority_hash`. An attacker can:
1. Use any valid Tier 1 leaf from the public Shadow Atlas
2. Pass `authority_hash = TIER_5` as a public input
3. Contract accepts the proof as "Tier 5 verified"

```noir
// CURRENT (BROKEN):
fn main(..., authority_hash: Field, leaf: Field, ...) {
    assert(compute_merkle_root(leaf, ...) == merkle_root);  // ✓ leaf exists
    assert(compute_nullifier(..., authority_hash, ...) == nullifier);  // ✓ nullifier matches
    // ❌ NEVER VERIFIED: leaf actually contains authority_hash
}
```

### CVE-VOTER-002: Nullifier Domain Bypass
**Severity:** CRITICAL | **Exploitability:** Trivial

`epoch_id` and `campaign_id` are user-supplied inputs. Attackers vary these to generate unlimited unique nullifiers from a single key:
```
nullifier = H(user_secret, campaign_id, authority_hash, epoch_id)
           ^^^^^^^^^^^^   ^^^^^^^^^^^                  ^^^^^^^^
           attacker       attacker                     attacker
           controls       controls                     controls
```
One proof → unlimited "unique constituents" by cycling inputs.

### CVE-VOTER-003: No Leaf Ownership Binding
**Severity:** CRITICAL | **Exploitability:** Trivial

Nothing cryptographically binds the prover's key to the Merkle leaf. Anyone who can read the Shadow Atlas IPFS export can generate valid proofs for ANY leaf. Pure impersonation at scale.

### CVE-VOTER-004: Hash Library Mismatch
**Severity:** HIGH | **Exploitability:** Automatic (system fails on launch)

```
Shadow Atlas core:     Poseidon2Hasher (Noir stdlib)     ✓
Client SDK:            circomlibjs 'poseidon'            ✗ DIFFERENT ALGORITHM

circomlibjs Poseidon ≠ Aztec Poseidon2 (different S-boxes, constants)
→ Client-generated proofs will FAIL verification on-chain
```

### CVE-VOTER-005: TIGER Data Integrity
**Severity:** HIGH | **Exploitability:** Network-level (DNS/MITM)

Census TIGER downloads have no cryptographic verification:
- No checksums validated
- No signatures checked
- No TLS certificate pinning
- DNS hijack → poisoned district boundaries → targeted disenfranchisement

### CVE-VOTER-006: Missing Cross-Language Test Vectors
**Severity:** MEDIUM | **Exploitability:** Silent divergence

No hardcoded test vectors verify TypeScript and Noir produce identical Poseidon2 outputs. Current "golden vector" test only checks `typeof hash === 'bigint'`.

---

## 🟡 HIGH PRIORITY: Expert-Identified Issues

**Multi-expert review identified additional gaps requiring attention.**

### ISSUE-001: Cross-Provider Identity Deduplication
**Severity:** HIGH | **Category:** Sybil Resistance

User can create 5 accounts via 5 different OAuth providers (Google, Facebook, LinkedIn, Twitter, Discord) with different email addresses.

**Current State:** No cross-provider uniqueness enforcement.

**Recommendation:** After OAuth, require linking to unique identifier:
- Option A: Phone number via SMS OTP (most providers support)
- Option B: Identity commitment binding (ties OAuth to ZK identity)

### ISSUE-002: Twitter Synthetic Email Vulnerability
**Severity:** HIGH | **Category:** Sybil Resistance

```typescript
// communique/src/lib/core/auth/oauth-providers.ts line 508
email: rawUser.data.email || `${rawUser.data.username}@twitter.local`
```

Twitter accounts without verified email get synthetic email, weakening Sybil layer.

**Recommendation:** Either require verified email scope or treat Twitter as lower-trust.

### ISSUE-003: Redistricting Emergency Protocol
**Severity:** HIGH | **Category:** Data Integrity

Court-ordered redistricting (NC-2022, AL-2023, LA-2024) can invalidate proofs mid-term. TIGER update lag is 2-4 months after court decisions.

**Current State:** No emergency update protocol. Users in new districts cannot participate during lag.

**Recommendation:**
1. Monitor court dockets (PACER) for redistricting decisions
2. Use precinct-level data from state election officials (faster than TIGER)
3. Implement dual-validity period: Accept proofs from old OR new district for 30 days
4. Push notifications to affected constituents

### ISSUE-004: Session Credential Security
**Severity:** MEDIUM | **Category:** Client Security

IndexedDB stores plaintext credential data (merkle_path, leaf_index, etc.). No encryption at rest.

**Current State:** Malicious browser extension or XSS could extract credentials.

**Recommendation:**
- Encrypt IndexedDB with Web Crypto API device-bound key
- Add credential signature verification before use
- Implement hourly revocation check ping

### ISSUE-005: Stale District Credential Attack
**Severity:** MEDIUM | **Category:** Data Integrity

6-month TTL on cached credentials allows constituent to use old district after moving.

**Current State:** ~2% of US population moves annually. Some will message wrong representative.

**Recommendation:**
- Shorten TTL for high-stakes actions (30 days for constituent messages)
- Prompt re-verification after 30 days: "Still living at same address?"
- Add IP geolocation shift detection

### ISSUE-006: Circuit Authority Range Check
**Severity:** LOW | **Category:** Input Validation

Circuit doesn't validate authority_level is within expected range (1-5).

**Recommendation:**
```noir
assert(authority_level >= 1);
assert(authority_level <= 5);
```

### ISSUE-007: String-to-Field Encoding Specification
**Severity:** LOW | **Category:** Interoperability

The 31-byte chunking for strings in Poseidon2Hasher `hashString()` is not explicitly documented. Potential divergence if circuit expects different chunking.

**Recommendation:** Document string encoding as part of protocol specification. Add test vectors for string hashing.

---

## Executive Summary

This document maps the delta between current implementation and the unified proof architecture. **Six critical vulnerabilities + seven expert-identified issues must be addressed.**

**Key Design Principle:** Identity verification is a *trust modifier*, not a requirement. The system supports tiered authority levels (1-5), with self-attestation as the permissionless default.

| Tier | Source | MVP Required |
|------|--------|--------------|
| 1 | Self-claimed | ✅ Yes (default path) |
| 2-3 | Location/Social | ❌ Future |
| 4-5 | Identity verified | ❌ Optional upgrade |

**TEE Address Handling:** Address is sent to decision-makers (Congress, healthcare, corporations, HOAs) via TEE. Address is never stored by the platform.

**Estimated Effort:** 4-5 weeks (security fixes + expert issues)

---

## Cross-Repository Integration Status

**Repositories:** `voter-protocol` + `communique`

| Component | Status | Blocker |
|-----------|--------|---------|
| Package dependencies (`@voter-protocol/*`) | ✅ Working | - |
| Poseidon2 hash compatibility | ❌ BROKEN | communique uses SHA-256 mock |
| Shadow Atlas API connection | ❌ NOT CONNECTED | communique has local mock |
| Noir prover integration | ✅ Imported | Needs end-to-end test |
| self.xyz SDK | ❌ STUB | Interface only |
| Didit.me SDK | ❌ STUB | Interface only |

**Critical:** communique's `/api/shadow-atlas/register` uses mock hash functions. Must replace with `@voter-protocol/crypto` Poseidon2.

---

## Current State

### 1. Noir Circuit (`packages/crypto/noir/district_membership/src/main.nr`)

```
CURRENT CAPABILITIES:
✅ Poseidon2 hashing (poseidon2_permutation)
✅ Merkle root computation (generic depth via DEPTH global)
✅ Nullifier computation (user_secret + campaign + authority + epoch)
✅ Multi-depth support (18/20/22/24 via build pipeline)

MISSING:
❌ EdDSA signature verification
❌ Attestation struct parsing
❌ Provider public key input
❌ Expiration timestamp check
❌ District ID matching constraint
```

**Current Circuit Interface:**
```noir
fn main(
    merkle_root: Field,        // Public
    nullifier: Field,          // Public
    authority_hash: Field,     // Public
    epoch_id: Field,           // Public
    campaign_id: Field,        // Public
    leaf: Field,               // Private
    merkle_path: [Field; DEPTH], // Private
    leaf_index: u32,           // Private
    user_secret: Field,        // Private
) -> pub (Field, Field, Field, Field, Field)
```

### 2. Noir Prover (`packages/noir-prover/src/`)

```
CURRENT CAPABILITIES:
✅ Lazy circuit loading per depth
✅ UltraHonk backend (UltraHonkBackend)
✅ Multi-threaded proving (Web Workers)
✅ Depth-aware singleton pattern
✅ Warmup/init/prove/verify lifecycle

MISSING:
❌ Attestation input types
❌ Provider pubkey handling
❌ Current time parameter
❌ EdDSA field formatting
```

**Current Type Interface:**
```typescript
interface CircuitInputs {
    merkleRoot: string;
    nullifier: string;
    authorityHash: string;
    epochId: string;
    campaignId: string;
    leaf: string;
    merklePath: string[];
    leafIndex: number;
    userSecret: string;
}
```

### 3. Shadow Atlas (`packages/shadow-atlas/`)

```
CURRENT CAPABILITIES:
✅ District-based hierarchical tree
✅ Poseidon2 leaf computation
✅ TIGER data ingestion pipeline
✅ Field mapping for non-standard schemas
✅ Authority levels (1-5)
✅ SQLite persistence + IPFS export

MISSING:
❌ /v1/proof endpoint (returns Merkle path for district)
❌ Leaf computation matching new circuit expectations
❌ District ID → GEOID mapping service
```

### 4. Identity Integration (`communique/src/lib/core/identity/`)

```
CURRENT CAPABILITIES:
✅ self.xyz / Didit.me verification flows
✅ Address extraction from credentials
✅ District extraction (congressional, state)
✅ Shadow Atlas handler structure

MISSING:
❌ Poseidon2 address commitment (uses SHA-256)
❌ EdDSA signature generation
❌ Attestation struct construction
❌ Provider key management
```

### 5. Smart Contracts (`packages/contracts/`)

```
CURRENT CAPABILITIES:
✅ UltraHonk verifier integration
✅ Nullifier tracking

MISSING:
❌ Provider pubkey registry
❌ New public input structure
❌ Merkle root governance
```

---

## Gap Analysis by Workstream

### WS-1: Circuit Upgrade (main.nr)

**Priority:** P0 (SECURITY CRITICAL)
**Dependencies:** None
**Fixes:** CVE-VOTER-001, CVE-VOTER-002, CVE-VOTER-003

---

#### 🔴 FIX 1: Leaf Ownership Binding (CVE-VOTER-003)

**Problem:** Anyone can use any leaf from the public Merkle tree.

**Solution:** Bind user_secret into the leaf preimage. The leaf IS the user's commitment.

```noir
// NEW: Leaf is computed FROM user_secret, not independent of it
fn compute_owned_leaf(
    user_secret: Field,
    district_id: Field,
    authority_level: Field,
    registration_salt: Field,  // Random salt set at registration
) -> Field {
    poseidon2_hash4(user_secret, district_id, authority_level, registration_salt)
}

// In main():
let expected_leaf = compute_owned_leaf(
    user_secret,
    attestation.district_id,
    attestation.authority_level,
    attestation.registration_salt
);
assert(expected_leaf == leaf);  // User MUST know secret to compute valid leaf
```

**Why this works:** An attacker who reads a leaf from IPFS cannot use it because they don't know the `user_secret` that was hashed into it. Only the original registrant can generate a valid proof.

---

#### 🔴 FIX 2: Authority Level Binding (CVE-VOTER-001)

**Problem:** Circuit accepts any authority_hash without verifying leaf contains it.

**Solution:** Decompose leaf inside circuit and verify authority matches.

```noir
// Leaf structure is now explicit:
// leaf = H(user_secret, district_id, authority_level, salt)

// In main():
// 1. Recompute leaf from components
let recomputed_leaf = compute_owned_leaf(
    user_secret,
    attestation.district_id,
    attestation.authority_level,
    attestation.registration_salt
);

// 2. Verify Merkle inclusion of recomputed leaf
let computed_root = compute_merkle_root(recomputed_leaf, merkle_path, leaf_index);
assert(computed_root == merkle_root);

// 3. Authority is now PROVEN, not just claimed
// Public output includes authority_level which is constrained by leaf membership
```

---

#### 🔴 FIX 3: Nullifier Domain Control (CVE-VOTER-002)

**Problem:** User controls epoch_id and campaign_id, enabling unlimited nullifiers.

**Solution:** Remove user control. Use contract-provided action_id hash.

```noir
// OLD (BROKEN):
// nullifier = H(user_secret, campaign_id, authority_hash, epoch_id)
//             user picks campaign_id and epoch_id → unlimited nullifiers

// NEW (FIXED):
// nullifier = H(user_secret, action_domain)
// where action_domain is a SINGLE field derived on-chain from:
//   action_domain = H(contract_address, action_type, epoch_number)
// User cannot vary it.

fn compute_nullifier(user_secret: Field, action_domain: Field) -> Field {
    poseidon2_hash2(user_secret, action_domain)
}

// action_domain is PUBLIC INPUT set by contract, not user
```

**Contract side:**
```solidity
function getActionDomain(bytes32 actionType) public view returns (bytes32) {
    uint256 epoch = block.timestamp / EPOCH_DURATION;
    return keccak256(abi.encodePacked(address(this), actionType, epoch));
}

// User MUST use this value; circuit will reject mismatches
```

---

#### Additional Circuit Changes

4. **Add EdDSA verification** (for Tier 4-5 attestations)
   ```noir
   use dep::std::signature::eddsa::{verify_signature_slice};
   // Verify attestation.signature against provider_pubkey
   // Only enforced when authority_level >= 4
   ```

5. **Add expiration check**
   ```noir
   assert(attestation.expires_at > current_time);
   ```

6. **Add district matching**
   ```noir
   assert(attestation.district_id == pub_inputs.district_id);
   ```

---

#### New Circuit Interface (Security-Hardened)

```noir
fn main(
    // === PUBLIC INPUTS (verifier provides) ===
    merkle_root: Field,
    nullifier: Field,
    district_id: Field,
    action_domain: Field,        // FIXED: Contract-controlled, replaces epoch+campaign
    authority_level: Field,      // FIXED: Now constrained by leaf, not free input
    provider_pubkey: [Field; 2], // For Tier 4-5 verification

    // === PRIVATE INPUTS (prover provides) ===
    user_secret: Field,
    registration_salt: Field,    // NEW: Part of leaf preimage
    attestation: Attestation,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    current_time: Field,
) -> pub (Field, Field, Field, Field, Field, [Field; 2]) {

    // === CONSTRAINT 1: Leaf ownership ===
    let owned_leaf = compute_owned_leaf(
        user_secret,
        attestation.district_id,
        attestation.authority_level,
        registration_salt
    );

    // === CONSTRAINT 2: Merkle inclusion ===
    let computed_root = compute_merkle_root(owned_leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    // === CONSTRAINT 3: Authority binding ===
    assert(attestation.authority_level == authority_level);
    assert(attestation.district_id == district_id);

    // === CONSTRAINT 4: Nullifier (domain-controlled) ===
    let computed_nullifier = compute_nullifier(user_secret, action_domain);
    assert(computed_nullifier == nullifier);

    // === CONSTRAINT 5: Expiration ===
    assert(attestation.expires_at > current_time);

    // === CONSTRAINT 6: EdDSA (Tier 4-5 only) ===
    if authority_level >= 4 {
        let sig_valid = verify_eddsa(provider_pubkey, attestation.signature, ...);
        assert(sig_valid);
    }

    (merkle_root, nullifier, district_id, action_domain, authority_level, provider_pubkey)
}
```

---

#### Registration Flow Change

**OLD:** User picks any district, generates proof immediately.

**NEW:** User must register leaf on-chain first:
```
1. User generates: user_secret, registration_salt
2. User computes: leaf = H(user_secret, district_id, authority_level, salt)
3. User submits leaf to RegistrationContract
4. Governance includes leaf in next Merkle tree update
5. NOW user can generate proofs (because their leaf is in the tree)
```

This creates a one-time registration cost but prevents instant Sybil attacks.

---

**Files to Modify:**
- `packages/crypto/noir/district_membership/src/main.nr` (complete rewrite)
- `packages/crypto/noir/district_membership/Nargo.toml`
- NEW: `packages/contracts/src/LeafRegistry.sol`

**Verification:**
```bash
cd packages/crypto/noir/district_membership
nargo compile
nargo test

# Security tests:
# - Test: Cannot use someone else's leaf (ownership binding)
# - Test: Cannot claim higher authority than registered (authority binding)
# - Test: Cannot generate multiple nullifiers for same action (domain control)
```

---

### WS-2: Prover Types & Interface

**Priority:** P0 (Blocking)
**Dependencies:** WS-1

**Changes Required:**

1. **Update types.ts**
   ```typescript
   interface EdDSASignature {
       r: [string, string];  // R point (x, y)
       s: string;            // s scalar
   }

   interface Attestation {
       addressCommitment: string;
       districtId: string;
       authorityLevel: number;
       issuedAt: number;
       expiresAt: number;
       signature: EdDSASignature;
   }

   interface CircuitInputs {
       // Public
       merkleRoot: string;
       nullifier: string;
       districtId: string;        // NEW
       epochId: string;
       campaignId: string;
       providerPubkey: [string, string];  // NEW

       // Private
       attestation: Attestation;   // NEW
       merklePath: string[];
       leafIndex: number;
       userSecret: string;
       currentTime: number;        // NEW
   }
   ```

2. **Update prover.ts prove()**
   ```typescript
   async prove(inputs: CircuitInputs): Promise<ProofResult> {
       const noirInputs = {
           merkle_root: inputs.merkleRoot,
           nullifier: inputs.nullifier,
           district_id: inputs.districtId,
           epoch_id: inputs.epochId,
           campaign_id: inputs.campaignId,
           provider_pubkey: inputs.providerPubkey,
           attestation: {
               address_commitment: inputs.attestation.addressCommitment,
               district_id: inputs.attestation.districtId,
               authority_level: inputs.attestation.authorityLevel,
               issued_at: inputs.attestation.issuedAt,
               expires_at: inputs.attestation.expiresAt,
               signature_r: inputs.attestation.signature.r,
               signature_s: inputs.attestation.signature.s,
           },
           merkle_path: inputs.merklePath,
           leaf_index: inputs.leafIndex,
           user_secret: inputs.userSecret,
           current_time: inputs.currentTime,
       };
       // ... rest unchanged
   }
   ```

**Files to Modify:**
- `packages/noir-prover/src/types.ts`
- `packages/noir-prover/src/prover.ts`

**Verification:**
```bash
cd packages/noir-prover
npm run build
npm run test
```

---

### WS-3: Shadow Atlas Proof Endpoint

**Priority:** P1 (Enabling)
**Dependencies:** None (can parallel with WS-1/2)

**Changes Required:**

1. **Add proof endpoint** (`src/api/routes/proof.ts`)
   ```typescript
   // GET /v1/proof?district={district_id}
   router.get('/proof', async (req, res) => {
       const { district } = req.query;
       const proof = await generateMerkleProof(district);
       res.json({
           leaf: proof.leaf,
           siblings: proof.siblings,
           pathIndices: proof.pathIndices,
           root: proof.root,
           depth: proof.depth,
       });
   });
   ```

2. **Update leaf computation to match circuit**
   ```typescript
   // Current: complex geometry hash
   // New: simplified for circuit compatibility
   function computeLeaf(district: District): bigint {
       return poseidon2Hash([
           hashString(district.id),       // district_id
           BigInt(district.authority),    // authority_level
           0n,                            // placeholder
       ]);
   }
   ```

3. **Add district lookup service**
   ```typescript
   // Maps human-readable "CO-06" to internal GEOID
   async function lookupDistrict(districtId: string): Promise<DistrictRecord> {
       return db.districts.findByCanonicalId(districtId);
   }
   ```

**Files to Create/Modify:**
- `packages/shadow-atlas/src/api/routes/proof.ts` (NEW)
- `packages/shadow-atlas/src/api/routes/index.ts` (add route)
- `packages/shadow-atlas/src/core/merkle-tree.ts` (update leaf computation)

**Verification:**
```bash
curl http://localhost:3000/v1/proof?district=CO-06
# Should return { leaf, siblings, pathIndices, root, depth }
```

---

### WS-4: Attestation Service (Optional - For Higher Trust Tiers)

**Priority:** P2 (Enhancement)
**Dependencies:** None (can parallel)

**Purpose:** Enable higher authority tiers (4-5) by wrapping identity provider responses.

**Note:** Self-attestation (tier 1) works without this service. Users generate their own attestations signed with their own keys. This service is only needed for identity-verified attestations.

**Components:**

1. **Census Geocoder Integration**
   ```typescript
   // Use existing packages/crypto/services/census-geocoder.ts
   async function geocodeAddress(address: Address): Promise<GeocodingResult> {
       const { lat, lon, matchScore, fips } = await censusGeocode(address);
       return { lat, lon, matchScore, fips };
   }
   ```

2. **District Lookup**
   ```typescript
   // Use Shadow Atlas boundary resolver
   async function getDistricts(lat: number, lon: number): Promise<Districts> {
       return boundaryResolver.resolve({ lat, lon });
   }
   ```

3. **Poseidon2 Address Commitment**
   ```typescript
   // Compute commitment in Node.js (same algo as circuit)
   function computeAddressCommitment(address: Address): bigint {
       return poseidon2([
           hashString(address.street),
           hashString(address.city),
           hashString(address.state),
           hashString(address.zip),
       ]);
   }
   ```

4. **EdDSA Signing**
   ```typescript
   import { buildEddsa } from 'circomlibjs';

   async function signAttestation(attestation: AttestationData): Promise<Signature> {
       const eddsa = await buildEddsa();
       const message = poseidon2Hash(attestation);
       const signature = eddsa.signPoseidon(privateKey, message);
       return {
           r: [signature.R8[0].toString(), signature.R8[1].toString()],
           s: signature.S.toString(),
       };
   }
   ```

5. **Service Endpoint**
   ```typescript
   // POST /attest
   // Input: { verificationToken, address } (from identity provider)
   // Output: signed Attestation struct
   router.post('/attest', async (req, res) => {
       const { verificationToken, address } = req.body;

       // 1. Validate identity provider token
       const verified = await validateIdProvider(verificationToken);
       if (!verified) return res.status(401).json({ error: 'Invalid token' });

       // 2. Geocode address → districts
       const geo = await geocodeAddress(address);
       const districts = await getDistricts(geo.lat, geo.lon);

       // 3. Compute address commitment
       const addressCommitment = computeAddressCommitment(address);

       // 4. Build attestation
       const attestation = {
           addressCommitment,
           districtId: hashString(districts.congressional),
           authorityLevel: 4,  // government_id verification
           issuedAt: Math.floor(Date.now() / 1000),
           expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
       };

       // 5. Sign with EdDSA
       const signature = await signAttestation(attestation);

       res.json({ ...attestation, signature });
   });
   ```

**Files to Create:**
- `packages/attestation-service/` (NEW package)
  - `src/index.ts`
  - `src/geocoding.ts`
  - `src/signing.ts`
  - `src/routes/attest.ts`

**Dependencies:**
- `circomlibjs` (EdDSA, Poseidon)
- `@voter-protocol/crypto` (Census geocoder)

---

### WS-5: Contract Upgrade

**Priority:** P0 (SECURITY CRITICAL)
**Dependencies:** WS-1 (verifier bytecode)
**Fixes:** CVE-VOTER-002 (nullifier domain control)

---

#### 🔴 FIX: Contract-Controlled Action Domain (CVE-VOTER-002)

**Problem:** User-supplied epoch_id/campaign_id enables unlimited nullifiers.

**Solution:** Contract computes action_domain; user cannot vary it.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DistrictGateV3 {

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    uint256 public constant EPOCH_DURATION = 1 days;  // Nullifiers reset daily

    // =========================================================================
    // STATE
    // =========================================================================

    bytes32 public currentMerkleRoot;
    mapping(bytes32 => bool) public usedNullifiers;
    mapping(bytes32 => bool) public trustedProviders;
    mapping(bytes32 => uint8) public actionMinAuthority;

    // =========================================================================
    // ACTION DOMAIN (CVE-VOTER-002 FIX)
    // =========================================================================

    /// @notice Compute action domain deterministically
    /// @dev User CANNOT vary this - it's derived from contract state
    /// @param actionType The type of action (e.g., keccak256("CONSTITUENT_MESSAGE"))
    /// @return Domain hash that must be used in proof
    function getActionDomain(bytes32 actionType) public view returns (bytes32) {
        uint256 epoch = block.timestamp / EPOCH_DURATION;
        return keccak256(abi.encodePacked(
            address(this),      // Contract address (prevents cross-contract replay)
            actionType,         // Action type (prevents cross-action replay)
            epoch,              // Epoch (time-bounds the nullifier)
            block.chainid       // Chain ID (prevents cross-chain replay)
        ));
    }

    /// @notice Get current epoch number
    function getCurrentEpoch() public view returns (uint256) {
        return block.timestamp / EPOCH_DURATION;
    }

    // =========================================================================
    // VERIFICATION (Security Hardened)
    // =========================================================================

    function verifyMembership(
        bytes calldata proof,
        bytes32 merkleRoot,
        bytes32 nullifier,
        bytes32 districtId,
        bytes32 actionDomain,        // MUST match getActionDomain()
        uint8 authorityLevel,
        bytes32 providerPubkeyHash,
        bytes32 actionType
    ) external returns (bool) {

        // =====================================================================
        // SECURITY CHECK 1: Action domain is contract-controlled
        // =====================================================================
        bytes32 expectedDomain = getActionDomain(actionType);
        require(actionDomain == expectedDomain, "Invalid action domain");

        // =====================================================================
        // SECURITY CHECK 2: Authority meets action requirement
        // =====================================================================
        uint8 minAuth = actionMinAuthority[actionType];
        require(authorityLevel >= minAuth, "Insufficient authority");

        // =====================================================================
        // SECURITY CHECK 3: Provider trusted for high-authority proofs
        // =====================================================================
        if (authorityLevel >= 4) {
            require(trustedProviders[providerPubkeyHash], "Untrusted provider");
        }

        // =====================================================================
        // SECURITY CHECK 4: Merkle root is current
        // =====================================================================
        require(merkleRoot == currentMerkleRoot, "Stale merkle root");

        // =====================================================================
        // SECURITY CHECK 5: Nullifier not already used
        // =====================================================================
        require(!usedNullifiers[nullifier], "Double action");

        // =====================================================================
        // SECURITY CHECK 6: Verify ZK proof
        // =====================================================================
        bytes32[] memory publicInputs = new bytes32[](6);
        publicInputs[0] = merkleRoot;
        publicInputs[1] = nullifier;
        publicInputs[2] = districtId;
        publicInputs[3] = actionDomain;
        publicInputs[4] = bytes32(uint256(authorityLevel));
        publicInputs[5] = providerPubkeyHash;

        bool valid = verifier.verify(proof, publicInputs);
        require(valid, "Invalid proof");

        // =====================================================================
        // STATE UPDATE: Record nullifier
        // =====================================================================
        usedNullifiers[nullifier] = true;

        emit ActionRecorded(districtId, actionType, authorityLevel, getCurrentEpoch());
        return true;
    }

    // =========================================================================
    // LEAF REGISTRY (CVE-VOTER-003 FIX)
    // =========================================================================

    mapping(bytes32 => bool) public registeredLeaves;
    mapping(bytes32 => bytes32) public leafToDistrict;

    /// @notice Register a new leaf commitment
    /// @dev User must register before they can generate proofs
    /// @param leaf The Poseidon2 hash commitment (user_secret, district, authority, salt)
    /// @param districtId The claimed district
    function registerLeaf(bytes32 leaf, bytes32 districtId) external {
        require(!registeredLeaves[leaf], "Leaf already registered");

        registeredLeaves[leaf] = true;
        leafToDistrict[leaf] = districtId;

        emit LeafRegistered(leaf, districtId, msg.sender, block.timestamp);
    }

    /// @notice Check if a leaf is registered
    function isLeafRegistered(bytes32 leaf) external view returns (bool) {
        return registeredLeaves[leaf];
    }

    // =========================================================================
    // EVENTS
    // =========================================================================

    event ActionRecorded(bytes32 indexed districtId, bytes32 actionType, uint8 authority, uint256 epoch);
    event LeafRegistered(bytes32 indexed leaf, bytes32 districtId, address registrant, uint256 timestamp);
    event MerkleRootUpdated(bytes32 newRoot, uint256 timestamp);
}
```

---

#### Governance & Root Management

```solidity
// Separate governance contract for root updates
contract MerkleRootGovernance {

    uint256 public constant UPDATE_DELAY = 1 days;

    struct PendingRoot {
        bytes32 root;
        uint256 activationTime;
        bytes32 tigerManifestHash;  // CVE-VOTER-005: Link to verified TIGER data
    }

    PendingRoot public pendingRoot;

    /// @notice Propose a new Merkle root (requires timelock)
    function proposeRoot(bytes32 newRoot, bytes32 manifestHash) external onlyGovernance {
        pendingRoot = PendingRoot({
            root: newRoot,
            activationTime: block.timestamp + UPDATE_DELAY,
            tigerManifestHash: manifestHash
        });

        emit RootProposed(newRoot, manifestHash, pendingRoot.activationTime);
    }

    /// @notice Activate pending root after timelock
    function activateRoot() external {
        require(block.timestamp >= pendingRoot.activationTime, "Timelock active");
        require(pendingRoot.root != bytes32(0), "No pending root");

        districtGate.updateMerkleRoot(pendingRoot.root);

        emit RootActivated(pendingRoot.root, pendingRoot.tigerManifestHash);
        delete pendingRoot;
    }

    event RootProposed(bytes32 root, bytes32 manifestHash, uint256 activationTime);
    event RootActivated(bytes32 root, bytes32 manifestHash);
}
```

---

**Files to Create/Modify:**
- `packages/contracts/src/DistrictGateV3.sol` (NEW - security hardened)
- `packages/contracts/src/LeafRegistry.sol` (NEW - registration)
- `packages/contracts/src/MerkleRootGovernance.sol` (NEW - timelocked updates)
- Generate new verifier from WS-1 circuit

**Security Tests Required:**
```solidity
// test/DistrictGateV3.t.sol

function test_cannotUseArbitraryActionDomain() public {
    bytes32 fakeActionDomain = keccak256("attacker_controlled");
    vm.expectRevert("Invalid action domain");
    gate.verifyMembership(proof, root, nullifier, district, fakeActionDomain, ...);
}

function test_cannotReuseNullifierAcrossEpochs() public {
    // Nullifier includes epoch, so same user_secret in different epoch = different nullifier
    // This is expected behavior, not a bypass
}

function test_cannotUseUnregisteredLeaf() public {
    // Proof for leaf not in registeredLeaves mapping should fail Merkle check
}
```

---

## Dependency Graph

```
┌───────────────────────────────────────────────────────────┐
│                     PARALLEL TRACK                        │
├────────────────────┬────────────────────┬────────────────┤
│                    │                    │                │
│   WS-1: Circuit    │  WS-3: Shadow      │  WS-4: Attest  │
│   (Noir + EdDSA)   │  Atlas Endpoint    │  Service       │
│                    │                    │                │
│   main.nr changes  │  /v1/proof API     │  Geocode +     │
│   EdDSA verify     │  Leaf computation  │  Sign wrapper  │
│                    │                    │                │
└────────┬───────────┴────────────────────┴────────┬───────┘
         │                                         │
         │                                         │
         ▼                                         ▼
┌────────────────────┐                  ┌─────────────────────┐
│   WS-2: Prover     │                  │   Integration       │
│   (types.ts)       │                  │   (communique)      │
│                    │                  │                     │
│   CircuitInputs    │◄─────────────────│   Use attestation   │
│   Attestation      │                  │   Call Shadow Atlas │
└────────┬───────────┘                  └─────────────────────┘
         │
         ▼
┌────────────────────┐
│   WS-5: Contract   │
│                    │
│   Provider registry│
│   New verifier     │
└────────────────────┘
```

---

## Approved Remediation Approaches

> **Source:** Merged from SYSTEMATIC-REMEDIATION-PLAN.md (2026-01-26)
> **Author:** Distinguished Engineer
> **Status:** APPROVED APPROACHES

### Guiding Principles

1. Minimal invasive changes - leverage existing infrastructure
2. Security without UX degradation
3. Incremental deployment - can ship fixes independently
4. No new dependencies where possible

---

### CVE-VOTER-004: Hash Algorithm Mismatch

**Problem:** communique uses mock SHA-256; voter-protocol uses Poseidon2.

**Solution:** Import voter-protocol's Poseidon2Hasher directly.

```typescript
// Replace in communique:
import { Poseidon2Hasher } from '@voter-protocol/crypto';

let hasher: Poseidon2Hasher | null = null;

async function getHasher(): Promise<Poseidon2Hasher> {
  if (!hasher) {
    hasher = await Poseidon2Hasher.getInstance();
  }
  return hasher;
}
```

**Files to Modify:**
- `communique/src/routes/api/shadow-atlas/register/+server.ts`
- `communique/package.json`

**Effort:** 2 hours | **Risk:** Low

---

### CVE-VOTER-001, 002, 003: Circuit Vulnerabilities

**Solution:** Unified circuit rewrite with leaf ownership binding, contract-controlled nullifier domain.

See WS-1 specification above for implementation details.

**Deployment Strategy:**
1. Week 1: Implement circuit changes, compile, run nargo test
2. Week 2: Generate new verifier contract, deploy to testnet
3. Week 2: Update noir-prover TypeScript types
4. Week 3: Integration testing with communique
5. Week 4: Security audit, mainnet deployment

**Effort:** 2 weeks | **Risk:** High (cryptographic changes)

---

### CVE-VOTER-005: TIGER Data Integrity

**Solution:** Checksum verification + multi-source confirmation.

```typescript
const TIGER_MIRRORS = [
  'https://www2.census.gov/geo/tiger/',
  'https://archive.org/download/census-tiger-2024/',
  'ipfs://...',
];

async function verifyFromMultipleSources(file: string, hash: string): Promise<boolean> {
  let confirmations = 0;
  for (const mirror of TIGER_MIRRORS) {
    const manifest = await fetchManifest(mirror);
    if (manifest.files[file]?.sha256 === hash) confirmations++;
  }
  return confirmations >= 2;
}
```

**Effort:** 4 hours | **Risk:** Low

---

### CVE-VOTER-006: Missing Test Vectors

**Solution:** Generate golden vectors from Noir, hardcode in TypeScript.

```typescript
export const GOLDEN_VECTORS = [
  { inputs: [1n, 2n], expected: 0x...n },  // From Noir execution
  { inputs: [0n, 0n], expected: 0x...n },
] as const;
```

**Effort:** 3 hours | **Risk:** None

---

### ISSUE-001: Cross-Provider Identity Deduplication

**Solution:** Identity commitment binding - after identity verification, bind `identity_commitment` to account.

```prisma
model User {
  identity_commitment    String?  @unique
  identity_commitment_at DateTime?
}
```

**Effort:** 4 hours | **Risk:** Medium (database migration)

---

### ISSUE-002: Twitter Synthetic Email Vulnerability

**Solution:** Lower trust tier for unverified email accounts.

```typescript
const hasVerifiedEmail = !!rawUser.data.email;
const baseAuthority = hasVerifiedEmail ? 3 : 2;
```

**Effort:** 2 hours | **Risk:** Low

---

### ISSUE-003: Redistricting Emergency Protocol

**Solution:** Dual-validity period during transitions + manual override.

```solidity
mapping(bytes32 => bytes32) public previousRoots;
mapping(bytes32 => uint256) public dualValidityExpiry;

function verifyMembership(...) external {
  bool currentValid = merkleRoot == currentMerkleRoot;
  bool previousValid = previousRoots[state] == merkleRoot
    && block.timestamp < dualValidityExpiry[state];
  require(currentValid || previousValid, "Invalid merkle root");
}
```

**Effort:** 1 week | **Risk:** Medium (contract changes)

---

### ISSUE-004: Session Credential Security

**Solution:** Web Crypto API encryption for IndexedDB.

```typescript
const key = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false,  // NOT extractable (device-bound)
  ['encrypt', 'decrypt']
);
```

**Effort:** 4 hours | **Risk:** Medium (cryptographic code)

---

### ISSUE-005: Stale District Credential Attack

**Solution:** Action-based TTL + re-verification prompt.

```typescript
export const CREDENTIAL_TTL = {
  view_content: 180 * 24 * 60 * 60 * 1000,       // 6 months
  community_discussion: 90 * 24 * 60 * 60 * 1000, // 3 months
  constituent_message: 30 * 24 * 60 * 60 * 1000,  // 30 days
  official_petition: 7 * 24 * 60 * 60 * 1000,     // 7 days
} as const;
```

**Effort:** 4 hours | **Risk:** Low

---

### ISSUE-006 & ISSUE-007: Circuit Input Validation

**Solution:**
- Add authority level range check: `assert(authority_level >= 1 && authority_level <= 5)`
- Document string-to-field encoding in protocol specification

**Effort:** 1 hour | **Risk:** None

---

### Implementation Priority Matrix

| Issue | Priority | Effort | Week |
|-------|----------|--------|------|
| CVE-VOTER-004 | P0 | 2 hours | 1 |
| CVE-VOTER-006 | P0 | 3 hours | 1 |
| CVE-VOTER-001/002/003 | P0 | 2 weeks | 1-2 |
| CVE-VOTER-005 | P1 | 4 hours | 2 |
| ISSUE-006 | P1 | 10 min | 2 |
| ISSUE-007 | P1 | 1 hour | 2 |
| ISSUE-002 | P1 | 2 hours | 2 |
| ISSUE-001 | P2 | 4 hours | 3 |
| ISSUE-004 | P2 | 4 hours | 3 |
| ISSUE-005 | P2 | 4 hours | 3 |
| ISSUE-003 | P2 | 1 week | 4 |

---

## Risk Assessment

### Security Risks (Post-Hardening)

| Risk | Impact | Likelihood | Mitigation | Status |
|------|--------|------------|------------|--------|
| **CVE-VOTER-001: Opaque leaf** | Critical | Was: Certain | Leaf ownership binding | 🔴 Fix designed |
| **CVE-VOTER-002: Nullifier bypass** | Critical | Was: Certain | Contract-controlled domain | 🔴 Fix designed |
| **CVE-VOTER-003: No ownership** | Critical | Was: Certain | user_secret in leaf preimage | 🔴 Fix designed |
| **CVE-VOTER-004: Hash mismatch** | High | Was: Certain | Remove circomlibjs | 🔴 Fix designed |
| **CVE-VOTER-005: TIGER integrity** | High | Medium | Multi-source verification | 🟡 Fix designed |
| **CVE-VOTER-006: No test vectors** | Medium | High | Hardcoded Noir outputs | 🟡 Fix designed |

### Implementation Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| EdDSA not in Noir stdlib | High | Low | Use external lib or implement manually |
| Circuit constraint explosion | Medium | Medium | Profile, optimize, consider depth tradeoffs |
| Registration UX friction | Medium | High | Clear onboarding, batch registration |
| Governance centralization | High | Medium | Timelock, multi-sig, transparent proposals |
| Provider key compromise | High | Low | HSM storage, rotation procedure, revocation |
| Tree leaf mismatch | High | Low | Hardened by CVE-VOTER-006 fix |

---

## Testing Strategy

### Unit Tests
- Circuit constraint verification (Nargo test)
- Poseidon2 hash consistency (TypeScript vs Noir)
- EdDSA signature generation/verification
- Merkle proof construction

### Integration Tests
- End-to-end proof generation with mock attestation
- Shadow Atlas → Prover → Contract flow
- Multi-depth circuit selection

### Security Tests
- Invalid signature rejection
- Expired attestation rejection
- Nullifier replay prevention
- Malformed input handling

---

## Migration Checklist

### Phase 0: Security Fixes (Week 1-2) 🔴 BLOCKING

**CVE Remediation - No deployment without these:**

- [ ] **CVE-VOTER-001:** Implement leaf ownership binding in circuit
- [ ] **CVE-VOTER-002:** Implement contract-controlled action_domain
- [ ] **CVE-VOTER-003:** Add user_secret to leaf preimage computation
- [ ] **CVE-VOTER-004:** Remove circomlibjs, use `@voter-protocol/crypto` Poseidon2
- [ ] **CVE-VOTER-005:** Add TIGER checksum verification
- [ ] **CVE-VOTER-006:** Create hardcoded cross-language test vectors
- [ ] Security review of fixes by independent auditor

**Cross-Repository Integration:**

- [ ] Replace mock hash in communique with `@voter-protocol/crypto`
- [ ] Connect communique to voter-protocol Shadow Atlas API
- [ ] Remove 500 lines of mock Merkle tree code in communique

### Phase 1: Foundation (Week 2-3)

- [ ] Implement WS-1 circuit (security-hardened version)
- [ ] Compile for all depths (18, 20, 22, 24)
- [ ] Generate new verifier contracts
- [ ] Update WS-2 prover types
- [ ] Implement LeafRegistry contract
- [ ] **ISSUE-006:** Add authority_level range check (1-5)
- [ ] **ISSUE-007:** Document string-to-field encoding

### Phase 2: Services (Week 3-4)

- [ ] Implement WS-3 proof endpoint
- [ ] Implement registration flow in client
- [ ] Deploy WS-4 attestation service (Tier 4-5)
- [ ] Test end-to-end flow locally
- [ ] Penetration testing against CVE fixes
- [ ] **ISSUE-001:** Implement cross-provider identity deduplication
- [ ] **ISSUE-002:** Fix Twitter synthetic email vulnerability

### Phase 3: Integration (Week 4-5)

- [ ] Update communique to use new registration flow
- [ ] Deploy WS-5 contract upgrade (DistrictGateV3)
- [ ] Integration testing on testnet
- [ ] Bug bounty program launch
- [ ] **ISSUE-004:** Add IndexedDB encryption
- [ ] **ISSUE-005:** Implement stale credential re-verification prompt

### Phase 4: Launch + Operations

- [ ] External security audit completion
- [ ] Mainnet deployment
- [ ] Monitor + incident response ready
- [ ] **ISSUE-003:** Implement redistricting emergency protocol (PACER monitoring)

### Timeline Summary

| Phase | Duration | Focus |
|-------|----------|-------|
| Phase 0 | Week 1-2 | CVE fixes, cross-repo integration |
| Phase 1 | Week 2-3 | Circuit, contracts |
| Phase 2 | Week 3-4 | Services, identity |
| Phase 3 | Week 4-5 | Integration, testing |
| Phase 4 | Ongoing | Launch, operations |

**Total: ~5 weeks to production-ready**

---

## Appendix A: Poseidon2 Compatibility (CVE-VOTER-004, CVE-VOTER-006)

### 🔴 CRITICAL: Hash Library Mismatch

**DO NOT USE `circomlibjs` for Poseidon hashing.**

```
circomlibjs 'poseidon'  →  Original Poseidon (SNARK-friendly, 2019)
Noir stdlib 'poseidon2' →  Poseidon2 (improved, 2023)

THESE ARE DIFFERENT ALGORITHMS. Different S-boxes, different round constants.
A hash computed with circomlibjs WILL NOT match Noir's poseidon2_permutation.
```

### Required Fix

**Remove circomlibjs entirely. Implement Poseidon2 in TypeScript matching Noir's stdlib.**

```typescript
// packages/crypto/src/poseidon2.ts

// MUST match Noir's poseidon2_permutation EXACTLY
// Reference: https://github.com/noir-lang/noir/blob/master/noir_stdlib/src/hash/poseidon2.nr

const BN254_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Round constants from Noir stdlib (MUST be identical)
const ROUND_CONSTANTS: bigint[][] = [/* ... extract from Noir source ... */];

export function poseidon2Permutation(state: bigint[], width: number): bigint[] {
    // Implement EXACT algorithm from Noir stdlib
    // - External rounds with full S-box layer
    // - Internal rounds with partial S-box
    // - MDS matrix multiplication
    // ...
}

export function poseidon2Hash2(a: bigint, b: bigint): bigint {
    const state = [a, b, 0n, 0n];
    const out = poseidon2Permutation(state, 4);
    return out[0];
}
```

### Required Test Vectors (CVE-VOTER-006)

**Create hardcoded test vectors verified against Noir output:**

```typescript
// packages/crypto/src/__tests__/poseidon2-vectors.test.ts

describe('Poseidon2 Cross-Language Compatibility', () => {
    // These values MUST be generated by running Noir and capturing output
    const GOLDEN_VECTORS = [
        {
            inputs: [1n, 2n],
            expected: 0x1234567890abcdef...n,  // ACTUAL Noir output
        },
        {
            inputs: [0n, 0n],
            expected: 0xfedcba0987654321...n,
        },
        // Edge cases:
        {
            inputs: [BN254_PRIME - 1n, 0n],  // Max field element
            expected: 0x...n,
        },
        {
            inputs: [2n ** 248n, 2n ** 248n],  // Large but valid
            expected: 0x...n,
        },
    ];

    for (const vector of GOLDEN_VECTORS) {
        it(`should match Noir for inputs ${vector.inputs}`, () => {
            const result = poseidon2Hash2(vector.inputs[0], vector.inputs[1]);
            expect(result).toBe(vector.expected);  // EXACT match required
        });
    }
});
```

### Verification Process

```bash
# Step 1: Generate vectors from Noir
cd packages/crypto/noir/test_vectors
nargo execute  # Outputs known hashes

# Step 2: Hardcode into TypeScript tests
# Step 3: Run TypeScript tests
npm test -- poseidon2-vectors

# Step 4: CI MUST fail if any vector mismatches
```

---

## Appendix B: TIGER Data Integrity (CVE-VOTER-005)

### Required Fix

Add cryptographic verification to TIGER downloads:

```typescript
// packages/shadow-atlas/src/providers/tiger-ingestion.ts

interface TIGERManifest {
    vintage: string;
    files: {
        path: string;
        sha256: string;
        size: number;
    }[];
    signature: string;  // Ed25519 signature over file list
}

async function downloadWithVerification(url: string, expectedHash: string): Promise<Buffer> {
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const buffer = Buffer.from(data);

    // Verify SHA-256
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== expectedHash) {
        throw new Error(`TIGER integrity check failed: expected ${expectedHash}, got ${actualHash}`);
    }

    return buffer;
}
```

### Secondary Source Verification

```typescript
// Cross-check against independent source
const TIGER_HASH_SOURCES = [
    'https://census.gov/checksums/tiger2024.json',      // Primary
    'https://archive.org/metadata/tiger2024',           // Archive.org mirror
    'ipfs://Qm.../tiger2024-manifest.json',            // IPFS pinned manifest
];

async function verifyFromMultipleSources(file: string, hash: string): Promise<boolean> {
    let confirmations = 0;
    for (const source of TIGER_HASH_SOURCES) {
        const manifest = await fetchManifest(source);
        if (manifest.files[file]?.sha256 === hash) {
            confirmations++;
        }
    }
    return confirmations >= 2;  // Require 2-of-3 confirmation
}
```

---

## Appendix C: Registration Flow

### New User Registration (Required for Leaf Ownership)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     USER REGISTRATION FLOW                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. USER GENERATES SECRETS (client-side)                           │
│     ├─ user_secret = random_field()                                │
│     ├─ registration_salt = random_field()                          │
│     └─ Store encrypted in browser/device                           │
│                                                                     │
│  2. USER CLAIMS DISTRICT                                           │
│     ├─ Tier 1: Self-claim (user picks district_id)                │
│     ├─ Tier 4+: KYC provider returns verified district_id         │
│     └─ authority_level set based on verification tier              │
│                                                                     │
│  3. USER COMPUTES LEAF                                             │
│     leaf = Poseidon2(user_secret, district_id, authority, salt)    │
│     (This binds user's secret to their claimed district)           │
│                                                                     │
│  4. USER SUBMITS LEAF TO REGISTRY                                  │
│     ├─ On-chain: LeafRegistry.register(leaf, district_id)          │
│     ├─ Cost: ~50k gas on L2                                        │
│     └─ Emits: LeafRegistered(leaf, district_id, timestamp)         │
│                                                                     │
│  5. GOVERNANCE INCLUDES LEAF IN TREE                               │
│     ├─ Batch: Collect leaves from registry                         │
│     ├─ Build: Update Shadow Atlas Merkle tree                      │
│     ├─ Publish: New root on-chain                                  │
│     └─ Frequency: Daily or on-demand                               │
│                                                                     │
│  6. USER CAN NOW PROVE                                             │
│     └─ Proof requires: user_secret + salt + merkle_path            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Registration Prevents Sybil

| Attack | Without Registration | With Registration |
|--------|---------------------|-------------------|
| Claim any district | ✅ Trivial | ❌ Must register leaf first |
| Use someone else's leaf | ✅ Trivial (public tree) | ❌ Don't know their user_secret |
| Create 10k identities | ✅ Instant, free | ⚠️ 10k on-chain txs, gas costs |
| Claim higher authority | ✅ Just change input | ❌ Authority baked into leaf |

---

## Expert Review Summary

**Reviewers:** Identity Systems Architect, ZK Cryptography Expert, Civic Tech Architect

| Dimension | Assessment |
|-----------|------------|
| **Cryptographic Design** | SOUND - District-based proofs, nullifier schemes match Zcash/Semaphore patterns |
| **Identity Architecture** | SOUND - OAuth Sybil layer + tiered verification is correct design |
| **Privacy Model** | SOUND - Selective disclosure, large anonymity sets (10K-800K) |
| **Implementation Status** | 35% complete - Hash mismatch blocks all functionality |

**Key Expert Validations:**
- Leaf ownership binding (CVE-VOTER-003 fix): Cryptographically sound
- Contract-controlled action_domain (CVE-VOTER-002 fix): Matches proven patterns
- Authority binding in circuit (CVE-VOTER-001 fix): Correctly constrains claims
- District-based vs cell-based decision: Superior privacy (26x larger anonymity sets)

**Key Expert Concerns (Now Addressed):**
- Cross-provider deduplication → ISSUE-001
- Twitter synthetic email → ISSUE-002
- Redistricting handling → ISSUE-003
- Session credential security → ISSUE-004, ISSUE-005
- Circuit input validation → ISSUE-006, ISSUE-007

---

## Appendix D: Historical Gap Analysis (December 2025)

> **Note:** This section preserves the original Phase 1 gap analysis from December 2025. Many of these gaps have since been addressed or superseded by the security-focused analysis above.

### Original Executive Summary (Dec 2025)

The codebase showed **intentional Phase 1/Phase 2 separation**:
- **Phase 1 (Active):** Smart contracts, Noir circuits, ZK proving infrastructure, basic client SDK
- **Phase 2 (Documented, Not Implemented):** Token economics, challenge markets, outcome markets, multi-agent treasury

The critical path was **blockaded** at the ZK proving layer: Noir circuit existed but client SDK could not invoke it yet.

### Smart Contracts (Dec 2025 Status)

| Contract | Status | Notes |
|----------|--------|-------|
| **DistrictRegistry.sol** | COMPLETE | Maps district Merkle roots to country codes |
| **DistrictGate.sol** | COMPLETE | Master verification orchestrator |
| **NullifierRegistry.sol** | COMPLETE | Tracks used nullifiers per action |
| **TimelockGovernance.sol** | COMPLETE | 7-day governance transfer timelock |
| **GuardianShield.sol** | Phase 2 | Multi-jurisdiction veto (deferred) |

**Gap Identified:** Real Halo2Verifier bytecode was missing; used MockHalo2Verifier.

### Client SDK Gaps (Dec 2025)

```typescript
// Critical Problem Identified:
this.halo2Prover = new Halo2Prover();  // CLASS DIDN'T EXIST
```

**Missing Classes:**
1. `Halo2Prover` - Should wrap NoirProver
2. `ShadowAtlas` - Should connect to proof server
3. `Halo2Signer` - Should sign proofs for MEV protection

### Shadow Atlas Integration (Dec 2025)

| Component | Status | Gap |
|-----------|--------|-----|
| Data sources | TIGER PLACE only | Need Census API + Cicero |
| Merkle tree | Implemented | None |
| IPFS distribution | STUBBED | ipfsCID = '' |
| Quarterly updates | STUBBED | No scheduler |
| Proof serving API | PARTIAL | Not integrated with client |

### Original Blocking Issues (Dec 2025)

| Issue | Priority | Status as of Jan 2026 |
|-------|----------|----------------------|
| Missing `Halo2Prover` client class | CRITICAL | RESOLVED - NoirProver integrated |
| ShadowAtlas client integration | CRITICAL | RESOLVED - API connected |
| MockHalo2Verifier in contracts | CRITICAL | RESOLVED - Real verifiers generated |
| Noir circuit outputs misaligned | CRITICAL | ADDRESSED - See CVE fixes above |
| Geocoding Census API stub | HIGH | IN PROGRESS |
| IPFS CID stubbed | HIGH | IN PROGRESS |

### Phase 1 Readiness (Dec 2025 Estimate)

| Component | Dec 2025 Status | Jan 2026 Status |
|-----------|----------------|-----------------|
| Smart Contracts | 95% | 100% (verifiers deployed) |
| Noir Circuit | 80% | 100% (multi-depth compiled) |
| Client SDK | 40% | 75% (prover integrated) |
| Shadow Atlas | 70% | 85% (API operational) |
| Tests | 60% | 80% (e2e passing) |

**Original MVP Timeline:** 40-60 hours critical path estimated
**Actual:** Circuit and contract work completed; security gaps identified

---

**Document Status:** REVISION 3 - Expert-reviewed
**Next Action:** Implement Phase 0 fixes (hash compatibility, CVEs)
**Security Review Required:** Before any testnet deployment
