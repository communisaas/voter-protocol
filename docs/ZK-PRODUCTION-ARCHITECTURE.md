# ZK Production Architecture

**Production-grade infrastructure for zero-knowledge proof system deployment.**

**Classification**: Production Architecture  
**Threat Model**: Nation-state adversaries, 20-year cryptographic horizon  
**Last Updated**: 2025-12-11

---

## Implementation Status

| Component | Status | Package/Contract |
|-----------|--------|------------------|
| NullifierRegistry | ✅ Implemented | `contracts/src/NullifierRegistry.sol` |
| TimelockGovernance (Phase 1) | ✅ Implemented | `contracts/src/TimelockGovernance.sol` |
| GuardianShield (Phase 2) | ⏳ Planned | `contracts/src/GuardianShield.sol` |
| DistrictGate (with timelocked verifier) | ✅ Implemented | `contracts/src/DistrictGate.sol` |
| Noir Circuit | ✅ Implemented | `packages/crypto/noir/district_membership/` |
| Browser Prover | ✅ Published | `@voter-protocol/noir-prover@0.1.0` |
| BB.js Fork (stateful keygen) | ✅ Published | `@voter-protocol/bb.js@0.87.0-fork.1` |
| DistrictRegistry | ✅ Implemented | `contracts/src/DistrictRegistry.sol` |
| Chainlink Oracle Integration | ⏳ Planned | — |
| Formal Verification CI | ⏳ Planned | — |
| Professional Audit | ⏳ Planned | — |

---

## Design Principles

1. **Defense in Depth**: Multiple independent layers of protection
2. **Crypto Agility**: Migrate proof systems without user disruption
3. **Zero Trust Infrastructure**: Assume every component can be compromised
4. **Formal Verification First**: Mathematical proofs before code deployment

---

## C-1: Nullifier Registry ✅ IMPLEMENTED

### Problem
Proofs can be replayed infinitely. No mechanism prevents double-voting.

### Implemented Solution

The `NullifierRegistry` contract at `contracts/src/NullifierRegistry.sol` implements:

- **External nullifier pattern**: `actionId` serves as domain separator
- **Nested mapping**: `nullifierUsed[actionId][userNullifier] = true`
- **Rate limiting**: 60-second minimum between actions per user
- **Participant tracking**: Per-action submission counts
- **Authorization layer**: Only authorized callers (DistrictGate) can record nullifiers

```solidity
// Key mapping structure
mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;
// nullifierUsed[actionId][userNullifier] = true

// Rate limiting
mapping(bytes32 => uint256) public lastActionTime;
uint256 public constant RATE_LIMIT_SECONDS = 60;
```

### Gas Optimization (Scroll L2)

| Operation | L1 Gas | L2 Equivalent |
|-----------|--------|---------------|
| SSTORE (first write) | ~20,000 | ~200 |
| SLOAD (check) | ~2,100 | ~21 |
| Total submission | ~222,000 | ~2,220 |

---

## C-2: Governance Timelock ✅ IMPLEMENTED

### Problem
Single governance address is a nation-state target. NSL + gag order can coerce a single entity.

### Phase 1 Solution (Implemented)

`DistrictGate` extends `TimelockGovernance` at `contracts/src/TimelockGovernance.sol`:

- **7-day governance transfer timelock**: `GOVERNANCE_TIMELOCK = 7 days`
- **14-day verifier upgrade timelock**: `VERIFIER_UPGRADE_TIMELOCK = 14 days`
- **Community detection window**: Malicious governance transfers visible on-chain for 7 days before execution

```solidity
// TimelockGovernance core mechanism
mapping(address => uint256) public pendingGovernance;

function initiateGovernanceTransfer(address newGovernance) external onlyGovernance {
    pendingGovernance[newGovernance] = block.timestamp + GOVERNANCE_TIMELOCK;
    emit GovernanceTransferInitiated(newGovernance, block.timestamp + GOVERNANCE_TIMELOCK);
}
```

**Honest Acknowledgment**: Founder key compromise = governance compromise during bootstrap. This is acceptable for Phase 1 with honest communication to users.

### Phase 2 Solution (Planned)

`GuardianShield` at `contracts/src/GuardianShield.sol` will add:

- **Multi-jurisdiction guardians**: 2+ guardians required
- **Single veto blocks**: Any guardian can veto pending governance transfers or verifier upgrades
- **Plausible deniability**: Guardians veto without explanation
- **Fail-safe default**: If no guardians act, timelock proceeds; if any veto, action blocked

This requires recruiting real multi-jurisdiction human guardians, which is not feasible for solo founder bootstrap.

---

## C-3: District Poisoning (Root Validation) ⚠️ PARTIAL

### Threat Model

**Attack Vector**: Compromised governance registers a malicious Merkle root containing attacker-controlled leaves. This allows:
1. **Fake citizens**: Attacker generates arbitrary identity commitments
2. **Ballot stuffing**: Submit unlimited valid proofs from fake identities
3. **Privacy breach**: Roots could encode trackable patterns

**Attacker Profile**: Compromised governance key, bribed oracle, or nation-state coercion of single entity.

### Current Implementation (Basic)

`DistrictRegistry` at `contracts/src/DistrictRegistry.sol` provides:

- **Known root registration**: Only governance can register roots
- **Country code binding**: Each root associated with country
- **Active/inactive status**: Roots can be deprecated

```solidity
// Current: Single governance can update roots
function registerRoot(bytes32 root, bytes3 countryCode) external onlyGovernance {
    districts[root] = DistrictInfo({country: countryCode, isActive: true, ...});
}
```

### Required Mitigation: Oracle Quorum ⏳ TODO

```solidity
// Phase 2: Multi-oracle attestation
contract DistrictRegistryV2 {
    uint256 public constant ORACLE_QUORUM = 3;      // 3-of-5 required
    uint256 public constant ROOT_TIMELOCK = 48 hours;
    
    mapping(bytes32 => OracleAttestation[]) public pendingAttestations;
    
    struct OracleAttestation {
        address oracle;
        bytes32 ipfsCid;      // Full tree published to IPFS
        uint256 timestamp;
        bytes signature;
    }
    
    function proposeRoot(
        bytes32 root, 
        bytes3 countryCode,
        bytes32 ipfsCid,
        bytes calldata oracleSignature
    ) external onlyAuthorizedOracle {
        // Record attestation
        pendingAttestations[root].push(...);
        
        // Check if quorum reached
        if (pendingAttestations[root].length >= ORACLE_QUORUM) {
            // Start 48-hour timelock
            timelockExpiry[root] = block.timestamp + ROOT_TIMELOCK;
        }
    }
    
    function activateRoot(bytes32 root) external {
        require(timelockExpiry[root] != 0 && block.timestamp > timelockExpiry[root]);
        require(!vetoed[root], "Vetoed by guardian");
        districts[root].isActive = true;
    }
}
```

### Defense Layers

| Layer | Protection Against |
|-------|-------------------|
| 3-of-5 oracle quorum | Single oracle compromise |
| 48-hour timelock | Rush attacks, allows community review |
| Guardian veto | Nation-state coercion of all oracles |
| IPFS commitment | Enables public audit of tree contents |

---

## C-4: Nullifier Binding ✅ IMPLEMENTED

### Threat Model

**Attack Vector**: Weak nullifier construction allows:
1. **Cross-campaign replay**: Same proof valid in multiple campaigns
2. **Nullifier collision**: Different users produce same nullifier
3. **Nullifier prediction**: Attacker pre-computes nullifiers to deanonymize

**Security Property**: Nullifier must be:
- **Unique per user**: Derived from user secret
- **Unique per campaign**: Domain-separated by campaign_id
- **Unpredictable**: Cannot be computed without user secret

### Implemented Solution

The circuit at `packages/crypto/noir/district_membership/src/main.nr`:

```noir
fn compute_nullifier(
    user_secret: Field, 
    campaign_id: Field, 
    authority_hash: Field, 
    epoch_id: Field
) -> Field {
    poseidon2_hash4(user_secret, campaign_id, authority_hash, epoch_id)
}
```

**Security Analysis**:

| Property | Guarantee | Mechanism |
|----------|-----------|-----------|
| Uniqueness | ✅ | Poseidon2 collision resistance (~128-bit) |
| Domain separation | ✅ | `campaign_id`, `epoch_id`, `authority_hash` in preimage |
| Unpredictability | ✅ | `user_secret` is private witness |
| Binding | ✅ | Circuit asserts `nullifier == compute_nullifier(...)` |

### On-Chain Verification

`NullifierRegistry` enforces domain separation:

```solidity
// Double-indexed by actionId (external nullifier) and userNullifier
mapping(bytes32 => mapping(bytes32 => bool)) public nullifierUsed;

// Same user CAN participate in different actions
// Same user CANNOT participate twice in same action
```

**Result**: User with secret `S` participating in campaigns `A` and `B` produces:
- `nullifier_A = H(S, A, authority, epoch)` → unique to campaign A
- `nullifier_B = H(S, B, authority, epoch)` → unique to campaign B
- No linkability between nullifier_A and nullifier_B

---

## C-5: Sybil Resistance ⏳ PLANNED

### Threat Model

**Attack Vector**: Single human registers multiple identity commitments across different districts:
1. Registers in CA-12 with commitment `C1`
2. Registers in TX-18 with commitment `C2` 
3. Votes in both districts with valid proofs

**Impact**: Undermines one-person-one-vote. Attacker can:
- Vote in N districts with N separate identities
- Amplify political influence proportional to registrations

### Current State

**No on-chain sybil resistance**. Rely on:
- Off-chain identity verification during Shadow Atlas enrollment
- Social/municipal verification of residence

### Planned Mitigations

#### Option A: Cross-District Nullifier Binding (Preferred)

```noir
// Modified circuit: Nullifier derived from national identifier
fn compute_global_nullifier(
    national_id_hash: Field,  // H(SSN) or H(passport)
    campaign_id: Field
) -> Field {
    poseidon2_hash2(national_id_hash, campaign_id)
}
```

**Tradeoff**: Requires trusted identity issuance, but prevents cross-district sybil.

#### Option B: Proof of Humanity Integration

```solidity
interface IProofOfHumanity {
    function isRegistered(address addr) external view returns (bool);
}

function submitAction(...) external {
    require(proofOfHumanity.isRegistered(msg.sender), "Not verified human");
    // ... existing proof verification
}
```

**Tradeoff**: Requires on-chain identity, reduces privacy.

#### Option C: ZK-Passport Integration

Integrate with Self/zkPassport to prove:
- `country_of_citizenship == USA`
- `document_type == passport`
- `not_expired == true`

Without revealing identity. Nullifier derived from `H(passport_signature)`.

**Tradeoff**: Highest privacy, requires passport scanning infrastructure.

### Recommendation

| Phase | Approach | Privacy | Sybil Resistance |
|-------|----------|---------|------------------|
| MVP | Off-chain verification | High | Low |
| Phase 2 | Option A (national ID hash) | Medium | High |
| Phase 3 | Option C (ZK-Passport) | High | High |

---

## Noir Prover Infrastructure ✅ PUBLISHED

### Published Packages

```bash
# Install
npm install @voter-protocol/noir-prover @voter-protocol/bb.js @noir-lang/noir_js pako
```

| Package | Version | Description |
|---------|---------|-------------|
| `@voter-protocol/bb.js` | 0.87.0-fork.1 | Barretenberg fork with stateful keygen API |
| `@voter-protocol/noir-prover` | 0.1.0 | Browser-native ZK prover |

### Circuit Specification

The Noir circuit at `packages/crypto/noir/district_membership/src/main.nr`:

```
Public Inputs: [merkle_root, nullifier, authority_hash, epoch_id, campaign_id]
Private Inputs: [leaf, merkle_path[14], leaf_index, user_secret]
Hash Function: Poseidon2 (T=4)
Constraints: ~4,000 (well under 2^19 gate limit)
```

### Browser Requirements

- `crossOriginIsolated === true` (COOP + COEP headers)
- SharedArrayBuffer support
- ~14MB WASM download (gzipped: 3.1MB)

---

## Formal Verification Strategy ⏳ PLANNED

### Tooling Selection

| Tool | Purpose | Target |
|------|---------|--------|
| **Veridise Picus** | Under-constrained detection | Noir circuit |
| **Ecne** | R1CS uniqueness verification | ACIR output |
| **Halmos** | Symbolic execution | Solidity contracts |

### CI Integration

```yaml
# .github/workflows/circuit-verify.yml (to be created)
name: Circuit Formal Verification
on:
  push:
    paths: ['packages/crypto/noir/**']
jobs:
  picus-underconstraint:
    runs-on: ubuntu-latest
    steps:
      - uses: veridise/picus-action@v1
```

---

## Post-Quantum Migration Path ⏳ FUTURE

### Timeline

| Phase | Years | Action |
|-------|-------|--------|
| **Monitoring** | 0-2 | Track NIST PQC, Greyhound maturity |
| **Research** | 2-4 | Prototype lattice-based PCS |
| **Hybrid** | 4-6 | Deploy classical + PQ proofs |
| **Full Migration** | 6-10 | Deprecate classical proofs |

### Current Crypto Agility

`DistrictGate.initiateVerifierUpgrade()` with 14-day timelock allows:
- Swap proof systems without redeployment
- Guardian veto on compromised upgrades
- Emergency pause by governance

---

## Supply Chain Security ✅ ADDRESSED

### Published Packages

Both `@voter-protocol/bb.js` and `@voter-protocol/noir-prover` are:
- Published to npm with provenance
- Exact version pinning (not ranges)
- Vendored WASM included in package

### Dependencies

```json
{
  "dependencies": {
    "@voter-protocol/bb.js": "0.87.0-fork.1",
    "@voter-protocol/noir-prover": "0.1.0",
    "@noir-lang/noir_js": "1.0.0-beta.11",
    "pako": "2.1.0"
  }
}
```

---

## Audit Requirements ⏳ PLANNED

### Scope

| Component | Auditor | Timeline | Cost |
|-----------|---------|----------|------|
| Noir circuit | Veridise | 4 weeks | $60-80k |
| Solidity contracts | Trail of Bits | 4 weeks | $80-100k |
| bb.js integration | Zellic | 2 weeks | $40-60k |

### Bug Bounty (Post-Audit)

| Severity | Reward |
|----------|--------|
| Critical (proof forgery) | $500,000 |
| High (double-voting) | $100,000 |
| Medium (privacy leak) | $25,000 |
| Low (DoS) | $5,000 |

---

## Implementation Checklist

### Phase 1: Foundation ✅ COMPLETE
- [x] NullifierRegistry with rate limiting
- [x] TimelockGovernance (7-day governance, 14-day verifier timelock)
- [x] DistrictGate with timelocked verifier upgrades
- [x] Noir circuit (district_membership)
- [x] Published @voter-protocol/bb.js fork
- [x] Published @voter-protocol/noir-prover

### Phase 2: Hardening ⏳ IN PROGRESS
- [ ] Chainlink oracle quorum for root updates
- [ ] 48-hour timelock on root changes
- [ ] Integration tests for NoirProver
- [ ] Browser COOP/COEP header verification

### Phase 3: Audit ⏳ PLANNED
- [ ] Veridise circuit audit
- [ ] Trail of Bits contract audit
- [ ] Halmos symbolic execution
- [ ] Launch bug bounty

### Phase 4: Production ⏳ PLANNED
- [ ] Scroll testnet deployment
- [ ] Scroll mainnet deployment
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Post-mortem documentation

---

## What Makes This "Distinguished"

1. **Semaphore-style external nullifiers**: Action-scoped domain separation
2. **TimelockGovernance**: 7-day governance transfer + 14-day verifier upgrade timelocks
3. **Guardian Shield (Phase 2)**: Multi-jurisdiction protection against NSL coercion
4. **Crypto agility**: Upgradeable verifier for post-quantum migration
5. **Published npm packages**: Vendored bb.js fork with stateful keygen API
6. **Defense in depth**: NullifierRegistry + TimelockGovernance + Rate Limiting (Phase 1), adds GuardianShield (Phase 2)

Phase 1 infrastructure with honest threat modeling. Phase 2 adds nation-state resistance via multi-jurisdiction guardians.
