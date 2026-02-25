# Public Input Field Reference

Canonical naming reference for the public inputs in the district membership circuits.

- **Three-tree circuit (production):** 31 public inputs (indices 0-30)
- **Two-tree circuit (legacy):** 29 public inputs (indices 0-28)

## Public Input Layout (Three-Tree — 31 Inputs)

| Index | Noir (Circuit) | TypeScript Interface | TypeScript Constant | Solidity Local Var | Description |
|-------|----------------|----------------------|---------------------|-------------------|-------------|
| 0 | `user_root` | `userRoot` | `USER_ROOT` | `userRoot` | Tree 1 Merkle root |
| 1 | `cell_map_root` | `cellMapRoot` | `CELL_MAP_ROOT` | `cellMapRoot` | Tree 2 SMT root |
| 2-25 | `districts[0..23]` | `districts` | — | — | 24 district IDs |
| 26 | `nullifier` | `nullifier` | `NULLIFIER` | `nullifier` | Anti-double-vote token |
| 27 | `action_domain` | `actionDomain` | `ACTION_DOMAIN` | `actionDomain` | Contract-controlled scope |
| 28 | `authority_level` | `authorityLevel` | `AUTHORITY_LEVEL` | `authorityLevel` | User voting tier (1-5) |
| 29 | `engagement_root` | `engagementRoot` | `ENGAGEMENT_ROOT` | `engagementRoot` | Tree 3 Merkle root |
| 30 | `engagement_tier` | `engagementTier` | `ENGAGEMENT_TIER` | `engagementTierRaw` | Engagement tier (0-4) |

> **Legacy two-tree circuit:** Uses indices 0-28 only (no engagement data). See `DistrictGate.verifyTwoTreeProof()` for the deprecated verification path.

## Private Inputs (Witnesses)

| Noir (Circuit) | TypeScript Interface | Description |
|----------------|----------------------|-------------|
| `user_secret` | `userSecret` | User's private key material |
| `cell_id` | `cellId` | Census tract identifier |
| `registration_salt` | `registrationSalt` | Random salt from registration |
| `user_path` | `userPath` | Tree 1 Merkle siblings (depth elements) |
| `user_index` | `userIndex` | Leaf position in Tree 1 |
| `cell_map_path` | `cellMapPath` | Tree 2 SMT siblings (depth elements) |
| `cell_map_path_bits` | `cellMapPathBits` | Tree 2 SMT direction bits (0=left, 1=right) |
| `identity_commitment` | `identityCommitment` | Identity commitment for nullifier derivation (H2(IC, actionDomain)) |

### Three-Tree Additional Witnesses

| Noir (Circuit) | TypeScript Interface | Description |
|----------------|----------------------|-------------|
| `engagement_path` | `engagementPath` | Tree 3 Merkle siblings (depth elements) |
| `engagement_index` | `engagementIndex` | Leaf position in Tree 3 |
| `action_count` | `actionCount` | Total nullifier consumption events (private) |
| `diversity_score` | `diversityScore` | Shannon diversity index floor(H*1000) (private) |

## Naming Convention

| Component | Convention | Rationale |
|-----------|-----------|-----------|
| Noir Circuit | `snake_case` | Noir language convention |
| Solidity Code | `camelCase` | Solidity style guide |
| Solidity NatSpec | `snake_case` | Match circuit for traceability |
| TypeScript Interfaces | `camelCase` | TypeScript convention |
| TypeScript Constants | `SCREAMING_SNAKE_CASE` | Constant naming convention |

## Translation Layer

The `formatInputs()` method in `packages/noir-prover/src/two-tree-prover.ts` is the canonical mapping between TypeScript camelCase and Noir snake_case. All new code should follow this pattern rather than introducing ad-hoc field name translations.

## Source Files

| Component | File |
|-----------|------|
| Three-tree circuit | `packages/crypto/noir/three_tree_membership/src/main.nr` |
| Three-tree prover | `packages/noir-prover/src/three-tree-prover.ts` |
| Two-tree circuit (legacy) | `packages/crypto/noir/two_tree_membership/src/main.nr` |
| Two-tree prover (legacy) | `packages/noir-prover/src/two-tree-prover.ts` |
| Contract | `contracts/src/DistrictGate.sol` |
| Client (contract) | `communique: src/lib/core/blockchain/district-gate-client.ts` |
| Client (prover) | `communique: src/lib/core/zkp/prover-client.ts` |
| Spec | `specs/COMMUNIQUE-INTEGRATION-SPEC.md` Section 2.1 |
