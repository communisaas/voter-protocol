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
| GuardianShield | ✅ Implemented | `contracts/src/GuardianShield.sol` |
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

## C-2: Guardian Shield ✅ IMPLEMENTED

### Problem
Single governance address is a nation-state target. NSL + gag order can coerce a single entity.

### Implemented Solution

The `GuardianShield` abstract contract at `contracts/src/GuardianShield.sol` provides:

- **Multi-jurisdiction guardians**: 2+ guardians required
- **Single veto blocks**: Any guardian can veto pending governance transfers or verifier upgrades
- **Plausible deniability**: Guardians veto without explanation
- **Fail-safe default**: If no guardians act, timelock proceeds; if any veto, action blocked

```solidity
// Core veto mechanism
mapping(address => bool) public vetoed;

function veto(address target) external onlyGuardian {
    vetoed[target] = true;
    emit TargetVetoed(target, msg.sender);
}
```

### DistrictGate Integration

`DistrictGate` extends `GuardianShield` and implements:

- **14-day verifier upgrade timelock**: `VERIFIER_UPGRADE_TIMELOCK = 14 days`
- **Governance transfer timelock**: `GOVERNANCE_TIMELOCK = 14 days`
- **Veto check on execution**: Both upgrades and transfers check `vetoed[target]`

---

## C-3: Root Validation ✅ IMPLEMENTED (Basic)

### Current Implementation

`DistrictRegistry` at `contracts/src/DistrictRegistry.sol` provides:

- **Known root registration**: Only governance can register roots
- **Country code binding**: Each root associated with country
- **Active/inactive status**: Roots can be deprecated

### Future Enhancement: Oracle Quorum

Not yet implemented:
- Chainlink DON attestation
- 3-of-5 multi-sig oracle
- 48-hour timelock on root updates
- IPFS commitment layer

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
- [x] GuardianShield multi-jurisdiction veto
- [x] DistrictGate with 14-day verifier timelock
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
2. **Guardian Shield veto**: Multi-jurisdiction protection against NSL coercion
3. **14-day verifier timelock**: Community response window for malicious upgrades
4. **Crypto agility**: Upgradeable verifier for post-quantum migration
5. **Published npm packages**: Vendored bb.js fork with stateful keygen API
6. **Defense in depth**: NullifierRegistry + GuardianShield + Timelock + Rate Limiting

This is infrastructure designed to last 20 years and withstand nation-state adversaries.
