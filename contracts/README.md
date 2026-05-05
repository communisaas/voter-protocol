# VOTER Protocol — Smart Contracts

Solidity contracts for on-chain verification of browser-generated Noir/Barretenberg zero-knowledge proofs on Scroll L2.

## Contract System (10 Contracts)

### Core Verification

**DistrictGate.sol** — Main verification entry point
- Verifies UltraHonk proofs via VerifierRegistry (~2.2M gas on Scroll)
- Three-tree path (primary): 31 public inputs (user root, cell map root, districts, nullifier, action domain, authority level, engagement root, engagement tier)
- Legacy two-tree path: 29 public inputs (no engagement data)
- EIP-712 signatures for MEV protection (separate typehashes per proof path)
- Governance-whitelisted action domains with genesis + timelock model
- Delegates nullifier recording to NullifierRegistry, participation to CampaignRegistry

**VerifierRegistry.sol** — Multi-depth verifier management
- Maps circuit depth (18/20/22/24) to HonkVerifier contract address
- Genesis model: `registerVerifier()` + `sealGenesis()` for initial deploy
- Post-genesis: 14-day timelock for verifier changes
- Interface: `verify(bytes calldata proof, bytes32[] calldata publicInputs)`

### Registries

**NullifierRegistry.sol** — Double-action prevention
- Action-scoped nullifiers: `nullifierUsed[actionId][nullifier]`
- Nullifier formula: `H2(identity_commitment, action_domain)`
- Rate limiting: 60s between actions per user
- Genesis + seal + 7-day timelock for caller authorization

**UserRootRegistry.sol** — Tree 1 root management
- Stores user Merkle tree roots (Tree 1)
- Leaf: `H4(user_secret, cell_id, registration_salt, authority_level)`
- Genesis + seal + 7-day timelock model

**CellMapRegistry.sol** — Tree 2 root management
- Stores cell map SMT roots (Tree 2)
- Census-based cell-to-multi-district assignment mapping
- Genesis + seal + 7-day timelock model

**DistrictRegistry.sol** — District configuration
- Maps district roots to country codes (bytes3)
- Governance-controlled with 7-day timelock

**CampaignRegistry.sol** — Participation tracking
- Records participation counts per campaign
- Immediate caller authorization (no timelock — see NatSpec for rationale)

**EngagementRootRegistry.sol** — Tree 3 root management (three-tree)
- Stores engagement tree roots with lifecycle: REGISTERED -> ACTIVE -> SUNSET -> EXPIRED
- Timelocked deactivation (no immediate revocation)

### Infrastructure

**TimelockGovernance.sol** — Base governance contract
- 7-day governance transfer timelock
- Inherited by all registry contracts
- Community detection window for malicious changes

**HonkVerifier_{18,20,22,24}.sol** — Generated verifier contracts
- Auto-generated via `scripts/generate-verifier-sol.ts` (bb.js `getSolidityVerifier()`)
- Keccak transcript mode (non-ZK, on-chain compatible)
- One contract per supported circuit depth

## Deployed Addresses (Scroll Sepolia v4)

| Contract | Address |
|----------|---------|
| DistrictGate | `0x0085DFAd6DB867e7486A460579d768BD7C37181e` |
| VerifierRegistry | `0xe7B18F488E44eE33f5B7B0d73b3714716b88423d` |
| HonkVerifier_20 | `0x0B8adBD18C6A667f9bCC547AB0eC59D0758146c4` |
| UserRootRegistry | `0x19318d473b07e622751Fb5047e7929833cE687c9` |
| CellMapRegistry | `0xbe0970996F18D37F4E8d261E1d579702f74cf364` |
| NullifierRegistry | `0x4D9060de86Adf846786E32BaFe753D944496D00e` |
| DistrictRegistry | `0x793516Ea1f9D2845F149684Fbe84f7Bb5C938AE1` |
| CampaignRegistry | `0xcF02ae94AF65d1f4be79F5C64Db2c4C8aEABa512` |

E2E proof TX: `0xc6ef86a3cf2c3d09f52150b5fce81debc9dc3ff29b15b5958ba749f5a1a9da64` (gas: 2,200,522)

## Setup

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
cd contracts
forge install
```

## Development

```bash
# Build (requires via_ir for DistrictGate stack depth)
forge build

# Run all tests (~600 tests across 16 suites)
forge test

# Run with gas reporting
forge test --gas-report

# Run specific test suite
forge test --match-path test/DistrictGate.t.sol -vvv
```

### Compiler Configuration

- **solc 0.8.28** with `via_ir = true` (required — DistrictGate exceeds stack depth without IR)
- Verifiers compiled separately: `FOUNDRY_PROFILE=verifiers forge build --force` (via_ir=false, optimizer_runs=1)

## Deployment

### Genesis Model

Deployment follows a two-phase governance model:

1. **Genesis phase** — Deployer configures contracts directly (no timelocks)
   - Register verifiers, authorize callers, set registries, register action domains
   - Call `sealGenesis()` on each contract (irreversible)

2. **Post-genesis** — All changes require timelocks
   - 14-day for verifier changes
   - 7-day for governance transfers and caller authorization

```bash
# Deploy verifiers first
PRIVATE_KEY=0x... ./script/deploy-verifiers.sh --network sepolia --depths "20"

# Then deploy protocol contracts
forge script script/DeployScrollSepolia.s.sol:DeployScrollSepolia \
  --rpc-url scroll_sepolia --private-key $PRIVATE_KEY --broadcast --verify --slow
```

### Verifier Generation

```bash
# Generate HonkVerifier Solidity from compiled Noir circuits
npx tsx scripts/generate-verifier-sol.ts
```

Uses bb.js `UltraHonkBackend.getSolidityVerifier()` in keccak mode. Do NOT use `bb contract` CLI (incompatible proof format).

## Security

- **Proof system**: UltraHonk via @aztec/bb.js (keccak transcript for on-chain, Poseidon2 for off-chain)
- **MEV protection**: EIP-712 signatures bind proof credit to signer address
- **Reentrancy**: NullifierRegistry uses OpenZeppelin ReentrancyGuard
- **Governance**: TimelockGovernance with genesis/seal pattern prevents premature timelock overhead
- **Rate limiting**: 60s cooldown per nullifier across all actions

## References

- [CRYPTOGRAPHY-SPEC.md](../specs/CRYPTOGRAPHY-SPEC.md) — Canonical cryptographic specification (circuits, nullifier scheme, trusted setup)
- [REPUTATION-ARCHITECTURE-SPEC.md](../specs/REPUTATION-ARCHITECTURE-SPEC.md) — Three-tree engagement semantics
- [Noir Documentation](https://noir-lang.org/)
- [Foundry Book](https://book.getfoundry.sh/)
- [Scroll L2 Docs](https://docs.scroll.io/)
