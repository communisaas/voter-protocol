# Public Input Field Reference

Canonical naming reference for the 29 public inputs in the two-tree district membership circuit.

## Public Input Layout

| Index | Noir (Circuit) | TypeScript Interface | TypeScript Constant | Solidity Local Var | Description |
|-------|----------------|----------------------|---------------------|-------------------|-------------|
| 0 | `user_root` | `userRoot` | `USER_ROOT` | `userRoot` | Tree 1 Merkle root |
| 1 | `cell_map_root` | `cellMapRoot` | `CELL_MAP_ROOT` | `cellMapRoot` | Tree 2 SMT root |
| 2-25 | `districts[0..23]` | `districts` | — | — | 24 district IDs |
| 26 | `nullifier` | `nullifier` | `NULLIFIER` | `nullifier` | Anti-double-vote token |
| 27 | `action_domain` | `actionDomain` | `ACTION_DOMAIN` | `actionDomain` | Contract-controlled scope |
| 28 | `authority_level` | `authorityLevel` | `AUTHORITY_LEVEL` | `authorityLevel` | User voting tier (1-5) |

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
| Circuit | `packages/crypto/noir/two_tree_membership/src/main.nr` |
| Prover | `packages/noir-prover/src/two-tree-prover.ts` |
| Contract | `contracts/src/DistrictGate.sol` |
| Client (contract) | `communique: src/lib/core/blockchain/district-gate-client.ts` |
| Client (prover) | `communique: src/lib/core/zkp/prover-client.ts` |
| Spec | `specs/COMMUNIQUE-INTEGRATION-SPEC.md` Section 2.1 |
