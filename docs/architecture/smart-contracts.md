# Smart Contract Architecture

**Last Updated**: February 2026
**Status**: Phase 1 operational on Scroll Sepolia. Mainnet deploy pending.
**Compiler**: solc 0.8.28 with `via_ir = true` (required for DistrictGate stack depth)
**Cross-Reference**: [ARCHITECTURE.md](../../ARCHITECTURE.md) | [CRYPTOGRAPHY-SPEC.md](../../specs/CRYPTOGRAPHY-SPEC.md) | [REPUTATION-ARCHITECTURE-SPEC.md](../../specs/REPUTATION-ARCHITECTURE-SPEC.md)

---

## Contract Stack Overview

10 contracts. 3 verification paths. Genesis deployment model.

| Contract | Purpose | Inherits | Governance |
|----------|---------|----------|------------|
| **DistrictGate** | Proof verification orchestrator (two-tree 29 inputs, three-tree 31 inputs, legacy 5 inputs) | Pausable, TimelockGovernance | Genesis + 7-day timelocks |
| **VerifierRegistry** | Maps tree depth (18/20/22/24) → HonkVerifier address, separate two-tree and three-tree mappings | TimelockGovernance | Genesis + 14-day timelocks |
| **DistrictRegistry** | District Merkle root → country/depth mapping with lifecycle (ACTIVE→SUNSET→EXPIRED) | Standalone governance | 7-day timelocks |
| **NullifierRegistry** | Action-scoped nullifier tracking, 60s rate limit, authorized caller pattern | Pausable, ReentrancyGuard, TimelockGovernance | Genesis + 7-day timelocks |
| **CampaignRegistry** | Civic campaign coordination, participation recording, template grouping | Pausable, ReentrancyGuard, TimelockGovernance | Immediate caller auth (see D4 note) |
| **UserRootRegistry** | Tree 1 (user identity) Merkle roots, 30-day sunset grace period | TimelockGovernance | 7-day timelocks |
| **CellMapRegistry** | Tree 2 (cell-district SMT) roots, 90-day deprecation grace period | TimelockGovernance | 7-day timelocks |
| **EngagementRootRegistry** | Tree 3 (engagement) Merkle roots, 7-day sunset grace period | TimelockGovernance | 7-day timelocks |
| **TimelockGovernance** | Abstract base: single-address governance with 7-day transfer timelock | — | Base contract |
| **GuardianShield** | Abstract base: multi-jurisdiction veto system (Phase 2, not yet integrated) | — | Guardian veto (immediate) |

---

## Settlement Layer

**Scroll zkEVM** (Ethereum L2). Chain ID: 534352 (mainnet), 534351 (Sepolia).

All contracts settle on Scroll. Users interact via standard Ethereum wallets (MetaMask, WalletConnect). No NEAR Chain Signatures dependency — that path was explored and dropped.

---

## Verification Paths

DistrictGate supports three proof verification paths:

### Two-Tree Path (Primary) — 29 public inputs

```
verifyTwoTreeProof(signer, proof, publicInputs[29], verifierDepth, deadline, signature)
```

Public inputs: `user_root[0]`, `cell_map_root[1]`, `districts[2-25]`, `nullifier[26]`, `action_domain[27]`, `authority_level[28]`.

EIP-712 signature binding prevents MEV theft. Proof verified against `VerifierRegistry.getVerifier(depth)`.

### Three-Tree Path — 31 public inputs

```
verifyThreeTreeProof(signer, proof, publicInputs[31], verifierDepth, deadline, signature)
```

Extends two-tree with: `engagement_root[29]`, `engagement_tier[30]`. Validated against EngagementRootRegistry. Separate verifier mapping (`getThreeTreeVerifier(depth)`).

### Legacy Single-Tree Path — 5 public inputs

```
verifyAndAuthorizeWithSignature(signer, proof, districtRoot, nullifier, actionId, expectedCountry, deadline, signature)
```

Original path. Retained for backward compatibility.

---

## Contract Details

### DistrictGate

Orchestrator. Routes proofs to depth-appropriate HonkVerifiers via VerifierRegistry. Validates roots against UserRootRegistry, CellMapRegistry, EngagementRootRegistry. Records nullifiers via NullifierRegistry. Records participation via CampaignRegistry.

**Key functions:**
- `verifyTwoTreeProof()` / `verifyThreeTreeProof()` — primary verification
- `setCampaignRegistryGenesis()` / `setTwoTreeRegistriesGenesis()` / `setEngagementRegistryGenesis()` — genesis config
- `registerActionDomainGenesis()` / `proposeActionDomain()` / `executeActionDomain()` — action domain whitelisting (7-day timelock post-genesis)
- `setActionDomainMinAuthority()` — per-domain minimum authority level
- `pause()` / `unpause()` — emergency controls (immediate)

**Gas (measured, Scroll Sepolia):** ~2,200,000 L2 gas per proof verification. Cost: ~$0.01-0.03/proof at current rates. L1 data fee dominates (7,328 bytes proof calldata).

### VerifierRegistry

Maps Merkle tree depths to HonkVerifier contract addresses. Separate mappings for two-tree and three-tree circuits. Genesis model: `registerVerifier()` is immediate during genesis, then `sealGenesis()` makes all future registrations require 14-day timelock.

**Key functions:**
- `registerVerifier()` / `registerThreeTreeVerifier()` — genesis-only (no timelock)
- `proposeVerifier()` / `executeVerifier()` — post-genesis (14-day timelock)
- `proposeVerifierUpgrade()` / `executeVerifierUpgrade()` — verifier replacement (14-day timelock)
- `sealGenesis()` — irreversible seal
- `getVerifier(depth)` / `getThreeTreeVerifier(depth)` — lookup

**Verifier interface:** `verify(bytes calldata proof, bytes32[] calldata publicInputs)`. Generated via `scripts/generate-verifier-sol.ts` using bb.js `getSolidityVerifier()` (keccak mode).

### Root Registries (UserRootRegistry, CellMapRegistry, EngagementRootRegistry)

Three parallel registries for the three Merkle trees. All follow the same lifecycle pattern:

```
REGISTERED → ACTIVE → SUNSET → EXPIRED
```

Registration is immediate (governance only). Deactivation, expiry, and reactivation use 7-day timelocks. Grace periods differ by update frequency:

| Registry | Tree | Grace Period | Rationale |
|----------|------|-------------|-----------|
| UserRootRegistry | Tree 1 (identity) | 30 days | Users need time to re-register |
| CellMapRegistry | Tree 2 (geography) | 90 days | Cached client data needs propagation |
| EngagementRootRegistry | Tree 3 (engagement) | 7 days | Roots update frequently, clients auto-sync |

**UserRootRegistry additional fields:** `country` (bytes3), `depth` (uint8).
**CellMapRegistry additional fields:** `country` (bytes3), `depth` (uint8).
**EngagementRootRegistry:** `depth` only (engagement is not country-scoped).

### DistrictRegistry

Maps district Merkle roots to country codes and depths. Append-only — roots cannot be modified after registration. Lifecycle management with 7-day timelocks. Batch registration via `registerDistrictsBatch()`.

Standalone governance (not inherited from TimelockGovernance — has its own implementation).

### NullifierRegistry

Action-scoped nullifier tracking. `recordNullifier()` is callable only by authorized contracts (DistrictGate). 60-second rate limit between actions per nullifier. Genesis model: `authorizeCallerGenesis()` + `sealGenesis()`.

### CampaignRegistry

Civic campaign coordination. Groups templates, tracks participation counts and unique districts. Rate-limited campaign creation (1/hour except whitelisted). Campaign flagging has 24-hour timelock for community visibility.

**Note (D4):** `authorizeCaller()` is immediate (no timelock), unlike other contracts. Rationale: participation records are non-critical — they cannot fabricate proofs or consume nullifiers. The blast radius of a rogue caller is limited to false participation counts. Timelocking would add operational overhead for every campaign deployment with minimal security benefit.

### TimelockGovernance

Abstract base contract. Provides single-address governance with 7-day transfer timelock. Phase 1 honest model — designed for solo founder launch. Upgradeable to GuardianShield multisig in Phase 2.

**Constant:** `GOVERNANCE_TIMELOCK = 7 days`

### GuardianShield

Abstract base contract for multi-jurisdiction guardian veto system. Not yet integrated into main contracts. Designed for defense against legal coercion — guardians in different jurisdictions can independently veto governance actions.

**Constants:** `MIN_GUARDIANS = 2`. Veto is single-party sufficient (fail-safe design).

---

## Gas Profile

Measured on Scroll Sepolia (TX `0xc6ef86a3...`, 2026-02-20):

| Operation | Gas | Cost (current rates) |
|-----------|-----|---------------------|
| Two-tree proof verification | ~2,200,000 | $0.01-0.03 |
| District registration | ~50,000 | < $0.001 |
| Root registration | ~50,000 | < $0.001 |
| Genesis seal | ~30,000 | < $0.001 |
| Full 7-contract deployment | ~12,000,000 | ~$0.01-0.10 |

**Cost breakdown:** L1 data fee (~$0.008) dominates L2 execution fee (~$0.002). Proof calldata (7,328 bytes) is the primary cost driver.

**Scale economics at 1,000 proofs/day:** ~$10-30/day ($3,650-11,000/year).

---

## Deployment

### Genesis Model

All contracts deploy with the deployer as initial governance. During genesis phase, configuration is immediate (no timelocks):

1. Deploy 7 contracts (DistrictRegistry, NullifierRegistry, VerifierRegistry, DistrictGate, CampaignRegistry, UserRootRegistry, CellMapRegistry)
2. Register HonkVerifiers for each depth (18/20/22/24)
3. Authorize DistrictGate on NullifierRegistry
4. Set CampaignRegistry + root registries on DistrictGate
5. Register default action domain
6. Seal genesis on VerifierRegistry, NullifierRegistry, DistrictGate (irreversible)
7. Transfer governance to multisig (7-day timelock)

Post-genesis, all changes require timelocks (7 or 14 days depending on operation).

**Deploy scripts:** `contracts/script/deploy.sh` (orchestrator), `DeployScrollMainnet.s.sol`, `DeployScrollSepolia.s.sol`.

### Scroll Sepolia Addresses (v4, operational)

```
HonkVerifier_20:          0x0B8adBD18C6A667f9bCC547AB0eC59D0758146c4
DistrictGate:             0x0085DFAd6DB867e7486A460579d768BD7C37181e
UserRootRegistry:         0x19318d473b07e622751Fb5047e7929833cE687c9
CellMapRegistry:          0xbe0970996F18D37F4E8d261E1d579702f74cf364
NullifierRegistry:        0x4D9060de86Adf846786E32BaFe753D944496D00e
VerifierRegistry:         0xe7B18F488E44eE33f5B7B0d73b3714716b88423d
DistrictRegistry:         0x793516Ea1f9D2845F149684Fbe84f7Bb5C938AE1
CampaignRegistry:         0xcF02ae94AF65d1f4be79F5C64Db2c4C8aEABa512
```

---

## Test Coverage

600 Solidity tests across 16 test suites. Key test files:

- `test/DistrictGate.t.sol` — two-tree verification, EIP-712, action domains
- `test/DistrictGate.ThreeTree.t.sol` — three-tree verification, engagement tiers
- `test/VerifierRegistry.t.sol` — genesis, post-genesis, upgrades, depth routing
- `test/EngagementRootRegistry.t.sol` — lifecycle, timelocks, edge cases
- `test/NullifierRegistry.t.sol` — nullifier tracking, rate limits, authorization
- `test/CampaignRegistry.t.sol` — campaigns, participation, flagging

---

## Phase 2 Contracts (Planned)

Not yet implemented. See `docs/roadmap/phase-2-design.md` and `specs/REPUTATION-ARCHITECTURE-SPEC.md` Section 7.

- **VOTER Token** (ERC-20) — transferable governance/utility token
- **Soulbound Engagement Credential** (ERC-8004) — non-transferable engagement proof
- **Challenge Market** — multi-AI dispute resolution with economic stakes

---

## Developer Resources

- **Contract source:** `contracts/src/`
- **Tests:** `contracts/test/`
- **Deploy scripts:** `contracts/script/`
- **Compiled ABIs:** `contracts/out/` (after `forge build`)
- **Foundry config:** `contracts/foundry.toml`
- **Verifier generator:** `scripts/generate-verifier-sol.ts` (bb.js, keccak mode)
- **Public input reference:** `specs/PUBLIC-INPUT-FIELD-REFERENCE.md`
