# Unified Proof Architecture: Residency + District Authenticity

> **Version:** 1.0.0-draft
> **Date:** 2026-01-26
> **Status:** PROPOSED
> **Author:** Cypherpunk Engineering

---

## Executive Summary

A single ZK proof that simultaneously proves:
1. **Residency:** "I have a verified address credential"
2. **District Membership:** "My address maps to district D"
3. **Data Authenticity:** "District D's boundary is in the certified Shadow Atlas"

No registration required. No address database. Pure cryptographic binding.

---

## The Cypherpunk Insight

**What's actually private?**
- User's street address
- User's exact location
- Which specific credential they hold

**What's public (and should stay public)?**
- District boundaries (anyone can look up)
- District IDs (CO-06, CA-12, etc.)
- Shadow Atlas Merkle root (published on-chain)
- Verification provider's public key (self.xyz, Didit.me)

**The key realization:** We don't prove geocoding in ZK. We bind to a SIGNED attestation from the identity provider that includes the district.

---

## Architecture: Three-Layer Binding

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         UNIFIED PROOF                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  LAYER 1: IDENTITY ATTESTATION (from self.xyz / Didit.me)               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  {                                                                │  │
│  │    address_commitment: Poseidon2(street, city, state, zip),      │  │
│  │    congressional_district: "CO-06",                               │  │
│  │    state_districts: { senate: "SD-23", house: "HD-45" },         │  │
│  │    verification_level: "government_id",                           │  │
│  │    issued_at: 1706000000,                                        │  │
│  │    expires_at: 1737600000,                                       │  │
│  │    provider_signature: EdDSA(provider_sk, above)                 │  │
│  │  }                                                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  LAYER 2: SHADOW ATLAS TREE (district authenticity)                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Merkle Tree Leaves:                                              │  │
│  │    leaf[i] = Poseidon2(district_id, geometry_hash, authority)     │  │
│  │                                                                    │  │
│  │  Example:                                                         │  │
│  │    leaf[42] = Poseidon2("CO-06", 0x7a8b9c..., 4)                  │  │
│  │                         ^^^^^^  ^^^^^^^^^^  ^                     │  │
│  │                         district  boundary   state-gis            │  │
│  │                         ID        hash       authority            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│  LAYER 3: ZK CIRCUIT (binding + nullifier)                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Public Inputs:                                                   │  │
│  │    - merkle_root (Shadow Atlas commitment)                        │  │
│  │    - nullifier (prevents double-action)                           │  │
│  │    - district_id (the district being proven)                      │  │
│  │    - epoch_id (time period)                                       │  │
│  │    - campaign_id (action context)                                 │  │
│  │    - provider_pubkey (self.xyz or Didit.me)                      │  │
│  │                                                                    │  │
│  │  Private Inputs:                                                  │  │
│  │    - attestation (full credential from provider)                  │  │
│  │    - merkle_path (siblings proving district in tree)              │  │
│  │    - leaf_index (position in tree)                                │  │
│  │    - user_secret (for nullifier)                                  │  │
│  │                                                                    │  │
│  │  Constraints:                                                     │  │
│  │    1. VERIFY attestation.signature against provider_pubkey        │  │
│  │    2. VERIFY attestation.district_id == public district_id        │  │
│  │    3. VERIFY attestation.expires_at > current_time                │  │
│  │    4. COMPUTE leaf = Poseidon2(district_id, ?, authority)         │  │
│  │    5. VERIFY merkle_root == compute_root(leaf, merkle_path)       │  │
│  │    6. COMPUTE nullifier = Poseidon2(user_secret, campaign, epoch) │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## What Gets Proven (in Plain English)

1. **"I have a valid identity credential"**
   - Provider signature verifies against known public key
   - Credential hasn't expired

2. **"My credential says I live in district D"**
   - The district_id in my credential matches the public claim
   - I'm not lying about which district I'm claiming

3. **"District D is authentic"**
   - District D's commitment exists in Shadow Atlas tree
   - The geometry/authority data is certified

4. **"I haven't done this action before"**
   - Nullifier is unique per (user_secret, campaign, epoch)
   - Prevents double-voting/double-signing

---

## Trust Model

### Tiered Authority (Identity Verification Optional)

**Core principle:** Identity verification is a *trust modifier*, not a requirement. Users can participate at any tier. This preserves permissionless access while enabling higher-trust actions when needed.

| Authority | Source | Trust Basis | Example Use Cases |
|-----------|--------|-------------|-------------------|
| **1** | Self-claimed | None (Sybil-risk) | View content, low-stakes polls |
| **2** | Location-hinted | IP/GPS signal | Soft geographic filtering |
| **3** | Socially vouched | Peer attestations | Community discussions |
| **4** | Document-verified | self.xyz / Didit.me | Constituent messaging |
| **5** | Government-issued | State ID + liveness | Official elections |

**How it works:**
```
User chooses authority level → Generates attestation → Circuit accepts any valid attestation
                                                              ↓
                                              Authority level is PUBLIC OUTPUT
                                                              ↓
                                              Application decides: "I need level ≥ X"
```

### Trust Components

| Component | Who Trusts | What They Trust | Verification |
|-----------|------------|-----------------|--------------|
| **Self-Attestation** | Application | User's claim (accept Sybil risk) | Signature only |
| **Identity Provider** | Circuit | Registered public key | EdDSA signature check |
| **Shadow Atlas Tree** | On-chain contract | Published Merkle root | Merkle proof in circuit |
| **Geometry Hash** | Shadow Atlas builder | Census/state GIS data | Provenance chain |

**Design rationale:**
- **Permissionless by default** - No KYC gate to participate
- **Progressive trust** - Upgrade authority when stakes require it
- **Application flexibility** - Each app sets its own minimum
- **Future-proof** - New attestation sources slot into the tier system

---

## Implementation: Modified Circuit

```noir
// unified_residency_proof.nr

use dep::std::hash::poseidon2_permutation;
use dep::std::eddsa::verify_eddsa;

global DEPTH: u32 = 20;

// Public inputs
struct PublicInputs {
    merkle_root: Field,
    nullifier: Field,
    district_id: Field,           // Hash of district string (e.g., "CO-06")
    epoch_id: Field,
    campaign_id: Field,
    provider_pubkey: [Field; 2],  // EdDSA public key (x, y)
}

// Attestation from identity provider
struct Attestation {
    address_commitment: Field,    // Poseidon2(street, city, state, zip)
    district_id: Field,           // Hash of district string
    authority_level: Field,       // 1-5 (for tree leaf computation)
    issued_at: Field,
    expires_at: Field,
    signature_r: [Field; 2],      // EdDSA signature R point
    signature_s: Field,           // EdDSA signature s scalar
}

fn main(
    // Public
    pub_inputs: PublicInputs,

    // Private
    attestation: Attestation,
    merkle_path: [Field; DEPTH],
    leaf_index: u32,
    user_secret: Field,
    current_time: Field,          // Passed by verifier (could be on-chain timestamp)
) -> pub (Field, Field, Field, Field, Field) {

    // =========================================================================
    // CONSTRAINT 1: Verify attestation signature
    // =========================================================================
    let message_hash = poseidon2_hash5(
        attestation.address_commitment,
        attestation.district_id,
        attestation.authority_level,
        attestation.issued_at,
        attestation.expires_at
    );

    let sig_valid = verify_eddsa(
        pub_inputs.provider_pubkey,
        attestation.signature_r,
        attestation.signature_s,
        message_hash
    );
    assert(sig_valid);

    // =========================================================================
    // CONSTRAINT 2: Attestation district matches claimed district
    // =========================================================================
    assert(attestation.district_id == pub_inputs.district_id);

    // =========================================================================
    // CONSTRAINT 3: Attestation hasn't expired
    // =========================================================================
    assert(attestation.expires_at > current_time);

    // =========================================================================
    // CONSTRAINT 4: Compute tree leaf and verify Merkle inclusion
    // =========================================================================
    // Leaf format matches Shadow Atlas tree construction
    let leaf = poseidon2_hash3(
        attestation.district_id,
        attestation.authority_level,  // Simplified: could include geometry_hash
        0  // Placeholder for geometry - see note below
    );

    let computed_root = compute_merkle_root(leaf, merkle_path, leaf_index);
    assert(computed_root == pub_inputs.merkle_root);

    // =========================================================================
    // CONSTRAINT 5: Compute nullifier
    // =========================================================================
    let computed_nullifier = poseidon2_hash4(
        user_secret,
        pub_inputs.campaign_id,
        pub_inputs.district_id,  // Include district in nullifier
        pub_inputs.epoch_id
    );
    assert(computed_nullifier == pub_inputs.nullifier);

    // Return public outputs
    (
        pub_inputs.merkle_root,
        pub_inputs.nullifier,
        pub_inputs.district_id,
        pub_inputs.epoch_id,
        pub_inputs.campaign_id
    )
}
```

---

## Implementation: Shadow Atlas Tree Modification

Current tree builds leaves from full district data:
```typescript
// Current: MerkleLeafInput
{
  id: string;               // GEOID
  boundaryType: BoundaryType;
  geometryHash: bigint;
  authority: number;
}
```

New tree builds leaves that match circuit expectations:
```typescript
// New: UnifiedLeafInput
{
  districtId: string;       // "CO-06" format
  authorityLevel: number;   // 1-5
  geometryHash: bigint;     // For verification, not in circuit
}

// Leaf computation (must match circuit)
leaf = Poseidon2(
  Hash(districtId),
  authorityLevel,
  0  // Or include geometryHash if we add it to circuit
);
```

---

## Implementation: Attestation Sources

### Tier 1: Self-Attestation (Default, No KYC)

User claims their own district. No external verification. Sybil-vulnerable but permissionless.

```typescript
// User generates their own attestation
const selfAttestation = {
  address_commitment: 0n,           // No address binding
  district_id: hashString("CO-06"), // User's claimed district
  authority_level: 1,               // Self-claimed = lowest tier
  issued_at: now,
  expires_at: now + 86400,          // 24h validity
};

// Sign with user's own key (user IS the provider)
const signature = signWithUserKey(selfAttestation);
```

**Trust model:** Application accepts Sybil risk. Useful for:
- Low-stakes actions (viewing, commenting)
- Rate-limited actions (1 per nullifier regardless of Sybils)
- Community-moderated spaces

---

### Tier 4-5: Identity Provider Integration (Optional Upgrade)

For high-stakes actions, users can upgrade to verified attestation.

**Required from self.xyz / Didit.me:**

Current response:
```typescript
{
  verified: boolean,
  address: { street, city, state, zip },
  // NO district data currently
}
```

Required response:
```typescript
{
  verified: boolean,
  address_commitment: Field,  // Poseidon2(street, city, state, zip)
  districts: {
    congressional: "CO-06",
    state_senate: "SD-23",
    state_house: "HD-45",
  },
  authority_level: 4,         // government_id = 4
  issued_at: number,
  expires_at: number,
  signature: {
    r: [Field, Field],
    s: Field,
  }
}
```

**Integration options:**
1. **Native:** Request self.xyz/Didit.me add district lookup + Poseidon hashing
2. **Wrapper:** Our backend wraps their response, adds district, signs with our key
3. **Hybrid:** They provide address commitment, we attest district separately

---

## Flow: End-to-End

```
USER JOURNEY
============

1. USER STARTS VERIFICATION
   └─→ Opens communique app
   └─→ Clicks "Verify Identity"

2. IDENTITY PROVIDER FLOW (self.xyz / Didit.me)
   └─→ Scans passport/ID
   └─→ Provider extracts address
   └─→ Provider geocodes address → district
   └─→ Provider computes: address_commitment = Poseidon2(address)
   └─→ Provider signs attestation with EdDSA
   └─→ Returns signed attestation to browser

3. SHADOW ATLAS LOOKUP
   └─→ Browser calls: GET /v1/proof?district=CO-06
   └─→ Shadow Atlas returns:
       {
         leaf: "0x...",
         siblings: ["0x...", ...],
         pathIndices: [0, 1, 0, ...],
         root: "0x...",
         depth: 20
       }

4. ZK PROOF GENERATION (browser, 8-12 seconds)
   └─→ Load circuit for depth 20
   └─→ Construct witness:
       - attestation: from provider
       - merkle_path: from Shadow Atlas
       - user_secret: from secure storage
       - current_time: Date.now()
   └─→ Generate UltraHonk proof

5. ON-CHAIN SUBMISSION (Scroll L2)
   └─→ Submit proof + public inputs to contract
   └─→ Contract verifies:
       - Merkle root matches registered root
       - Provider pubkey is whitelisted
       - Nullifier not used
       - Epoch is current
   └─→ Record action (vote, sign, etc.)

6. DONE
   └─→ User has proven residency in CO-06
   └─→ No one knows their actual address
   └─→ They can't prove again this epoch (nullifier)
```

---

## Comparison: Old vs New

| Aspect | Old (Separate Proofs) | New (Unified Proof) |
|--------|----------------------|---------------------|
| **Proofs needed** | 2 (registration + action) | 1 |
| **Registration required** | Yes | No |
| **Address database** | Yes (encrypted) | No |
| **Trust model** | Platform stores data | Provider attests, circuit verifies |
| **Privacy** | Address encrypted at rest | Address never leaves device |
| **Proof time** | 8-12s each = 16-24s | 8-12s total |
| **Gas cost** | 2 verifications | 1 verification |
| **Complexity** | Higher | Lower |

---

## Implementation Gaps

### Must Build

1. **Modified Circuit** (`unified_residency_proof.nr`)
   - Add EdDSA signature verification
   - Add attestation struct parsing
   - Modify leaf computation to match tree

2. **Shadow Atlas API Endpoint**
   - `GET /v1/proof?district={district_id}`
   - Returns Merkle proof for district

3. **Identity Provider Wrapper** (if they don't support natively)
   - Adds district lookup via Census API
   - Computes Poseidon2 address commitment
   - Signs with our attestation key

4. **Prover Update** (`district-prover.ts`)
   - Accept attestation as input
   - Handle new public input structure

5. **Contract Update** (`DistrictGateV2.sol`)
   - Add provider pubkey registry
   - Update verifier interface

### Nice to Have

1. **Multi-district proof** - Prove residency in multiple districts at once
2. **Provider aggregation** - Accept attestations from multiple providers
3. **Offline mode** - Cache attestation for offline proof generation

---

## Security Considerations

### Attack: Forged Attestation
**Mitigation:** EdDSA signature verification in circuit. Provider private key never exposed.

### Attack: Stale Attestation
**Mitigation:** `expires_at` field checked against current time in circuit.

### Attack: Provider Collusion
**Mitigation:** Multiple provider support. Require N-of-M attestations for high-stakes actions.

### Attack: Merkle Root Manipulation
**Mitigation:** Root published on-chain with governance update process.

### Attack: Nullifier Reuse
**Mitigation:** Nullifier includes district, so changing district claim = new nullifier.

---

## Migration Path

### Phase 1: Wrapper Mode (Week 1-2)
- Build attestation wrapper service
- Use existing identity providers, add district + signature
- No changes to identity providers needed

### Phase 2: Circuit Update (Week 2-3)
- Implement new circuit with EdDSA verification
- Compile for all depths (18, 20, 22, 24)
- Generate new verifier contracts

### Phase 3: Integration (Week 3-4)
- Update Shadow Atlas API with `/v1/proof` endpoint
- Update client library
- Update communique integration

### Phase 4: Native Provider Support (Future)
- Work with self.xyz / Didit.me for native support
- Remove wrapper service when available

---

## Conclusion

**Yes, we can have both trust in districting AND proof of residency in one proof.**

The key insight: Don't try to do geocoding in ZK. Bind to a signed attestation from a trusted identity provider. The circuit verifies:
1. Attestation signature (proves provider vouched for this data)
2. District match (proves claimed district matches attestation)
3. Merkle inclusion (proves district is in certified tree)
4. Nullifier uniqueness (proves no double-action)

**Result:** Single proof, ~10 seconds, maximum privacy, no registration database.

---

## Related Specifications

- [STRING-ENCODING-SPEC.md](./STRING-ENCODING-SPEC.md) - String-to-field encoding for Poseidon2 hashing
- [SHADOW-ATLAS-SPEC.md](./SHADOW-ATLAS-SPEC.md) - Shadow Atlas Merkle tree specification
- [DATA-INTEGRITY-SPEC.md](./DATA-INTEGRITY-SPEC.md) - Data integrity, provenance, and freshness

---

**Authors:** Voter Protocol Engineering
**License:** MIT
