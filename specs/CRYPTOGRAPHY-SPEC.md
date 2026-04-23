# Commons Cryptographic Protocol Specification

> **Spec ID:** CRYPTO-SPEC-001
> **Version:** 1.0.0
> **Status:** CANONICAL
> **Date:** 2026-04-21
> **Audience:** Cryptographers, protocol reviewers, independent implementers
> **Scope:** ZK circuit topology, hash construction, nullifier scheme, trusted setup, threat model

This document is the single authoritative cryptographic specification for the Commons protocol. Prior documents (`ZK-PRODUCTION-ARCHITECTURE.md`, `NOIR-PROVING-INFRASTRUCTURE.md`, `DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md`, `TWO-TREE-ARCHITECTURE-SPEC.md`) are superseded. Companion documents retain authority over their specific domains:

| Document | Authority |
|---|---|
| `REPUTATION-ARCHITECTURE-SPEC.md` | Engagement tree semantics, tier derivation, Shannon diversity |
| `SHADOW-ATLAS-SPEC.md` | Geographic data acquisition, district registry, TIGER pipeline |
| `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` | Operator surface area, walkaway roadmap, MACI parallel |
| `DEBATE-MARKET-SPEC.md` | Market mechanics, LMSR pricing, resolution logic |
| `STRING-ENCODING-SPEC.md` | UTF-8 → BN254 chunking (31-byte invariant) |

Everything here is falsifiable. Claims dependent on cryptographic assumptions are stated as such. Claims dependent on operator honesty are stated as such. The protocol does not claim to be trustless where it is not.

---

## Table of Contents

1. [Threat Model and Trust Stack](#1-threat-model-and-trust-stack)
2. [Cryptographic Primitives](#2-cryptographic-primitives)
3. [Domain Separation](#3-domain-separation)
4. [Data Structures](#4-data-structures)
5. [Circuits](#5-circuits)
6. [Nullifier Scheme](#6-nullifier-scheme)
7. [Trusted Setup](#7-trusted-setup)
8. [On-Chain Integration](#8-on-chain-integration)
9. [Cross-Language Parity](#9-cross-language-parity)
10. [Known Limitations](#10-known-limitations)
11. [Legacy and Deprecated Components](#11-legacy-and-deprecated-components)
12. [Reference Implementation](#12-reference-implementation)

---

## 1. Threat Model and Trust Stack

The protocol has four trust layers. The integrity ceiling is set by the weakest one.

### Layer 4: ZK Proof Verification (Trustless)

UltraHonk on BN254 provides computational soundness under the algebraic group model and the hardness of discrete log on BN254. If a proof verifies against the on-chain verifier contract, the prover demonstrably knows a witness satisfying every constraint in the circuit. No off-chain component is trusted at this layer.

### Layer 3: Root Registries (Observable)

`UserRootRegistry`, `CellMapRegistry`, and `EngagementRootRegistry` are immutable contracts on Scroll L2. Roots are append-only. Lifecycle transitions (deprecation, expiry, reactivation) require 7-day timelocks. Verifier upgrades require 14-day timelocks. The guarantee is **transparency with exit rights**, not trustlessness: a malicious governance action is visible on-chain before execution, giving the community a detection window.

### Layer 2: Tree Construction (Trusted — Operator)

The Shadow Atlas operator downloads TIGER data from the U.S. Census Bureau, computes cell-to-district mappings, and builds Merkle trees with Poseidon2 hashing. Users trust that registered roots correspond to correct mappings derived from authoritative data. The operator **cannot forge proofs** (user secrets are client-side only) but **can poison the tree** (map an address to the wrong district) or **censor** (omit a user).

Mitigations (current):
- Census TIGER data is public and deterministically hashable.
- Build pipeline is open source (`packages/shadow-atlas/src/core/`).
- IPFS replication provides an alternative data source.
- Verifiable Solo Operator: hash-chained, Ed25519-signed insertion log with attestation binding.

Residual gap: no reproducible-build pipeline (Docker/Nix) published yet. See §10.

### Layer 1: Data Acquisition (Verifiable)

Census TIGER/Line boundary data is public, free, and published with SHA-256 checksums. Anyone can download the same shapefiles and verify them. The trust assumption at this layer is that the Census Bureau publishes accurate boundaries — a reasonable assumption for federal civil data, reviewed before each redistricting cycle.

### MACI Parallel

The structure is identical to MACI (Minimal Anti-Collusion Infrastructure), the most widely deployed ZK voting system. MACI's coordinator processes encrypted votes and produces a tally proof; Commons' operator processes public Census data and produces tree roots. Both can manipulate inputs but cannot forge downstream proofs.

The key difference: MACI's coordinator sees votes in cleartext (privacy violation); Commons' operator never sees user secrets. MACI's inputs are opaque (encrypted votes); Commons' inputs are public (TIGER data). Commons is therefore **strictly less trusted** than MACI at the operator layer, though both share the unresolved problem of operator decentralization.

As of April 2026, MACI has not shipped coordinator decentralization (research in progress via MPC, threshold encryption, and TEEs). Commons is at the state of the art, not behind it. The walkaway roadmap to eliminate operator trust is documented in `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` §7.

---

## 2. Cryptographic Primitives

### 2.1 Field: BN254 Scalar Field

```
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
|p| = 254 bits
```

All field elements are elements of `F_p`. All hash outputs are elements of `F_p`.

**Validation invariant:** Every external field input (user secrets, randomness, cell IDs, district IDs) must satisfy `x < p` before circuit execution. TypeScript: `packages/crypto/poseidon2.ts` exports `BN254_MODULUS` and `validateFieldElement()`.

### 2.2 Hash Function: Poseidon2 over BN254

Parameters:

| Parameter | Value |
|---|---|
| State width | `t = 4` |
| Rate | `3` |
| Capacity | `1` |
| Full rounds (`R_F`) | `8` |
| Partial rounds (`R_P`) | `56` |
| Implementation | Noir stdlib `std::hash::poseidon2_permutation` |
| Backend | Barretenberg via `@aztec/bb.js` |

Why Poseidon2 (not Poseidon, not Keccak, not SHA-256):
- ~160 constraints per hash in the PLONKish constraint system (vs. ~25,000 for SHA-256).
- Identical implementation available in Noir and in the TypeScript prover (same circuit, not two reimplementations — see §9).
- Field-native: operates directly on `F_p` elements, no bit decomposition.

### 2.3 String-to-Field Encoding

UTF-8 bytes are chunked into 31-byte segments (guaranteed `< 2^248 < p`) and interpreted big-endian. Each chunk becomes one field element; multi-chunk strings are hashed with the sponge (§4.6). Full spec: `STRING-ENCODING-SPEC.md`.

### 2.4 Sponge Construction (24-Element Absorption)

The 24-district commitment uses a Poseidon2 sponge with `rate=3, capacity=1`:

```
state ← [DOMAIN_SPONGE_24, 0, 0, 0]
for i in 0..8:
    state[1] ← state[1] + inputs[3i + 0]     # ADD, not overwrite
    state[2] ← state[2] + inputs[3i + 1]
    state[3] ← state[3] + inputs[3i + 2]
    state ← Poseidon2_permute(state)
return state[0]
```

**Critical construction note:** Inputs are **added** to rate elements, not assigned. Early drafts had `state[i] = inputs[...]` (overwrite), which discards previous state and breaks the cryptographic chaining; this was the v0.1 bug documented in `sponge.nr`. Both Noir and TypeScript implementations use addition.

### 2.5 Validation Against Golden Vectors

A cross-language golden vector is enforced in both `sponge.nr` and the TypeScript test suite:

```
sponge([1, 2, ..., 24]) = 13897144223796711226515669182413786178697447221339740051025074265447026549851
```

Divergence of this vector between Noir and TypeScript would break Merkle root compatibility and is a mandatory CI check.

---

## 3. Domain Separation

Every hash output carries a domain tag occupying a fixed position in the Poseidon2 state. Domain separation prevents cross-arity and cross-purpose collisions that would otherwise allow a hash output from one use to be substituted into another.

### 3.1 Domain Tag Registry

| Tag | Hex Value | ASCII | Arity | State Layout | Use |
|---|---|---|---|---|---|
| `DOMAIN_HASH1` | `0x48314d` | `H1M` | 1 | `[x, H1M, 0, 0]` | Single-input hash |
| `DOMAIN_HASH2` | `0x48324d` | `H2M` | 2 | `[a, b, H2M, 0]` | Pair hash, Merkle node, nullifier, engagement leaf, cell-map leaf |
| `DOMAIN_HASH3` | `0x48334d` | `H3M` | 3 | `[a, b, c, H3M]` | Engagement data commitment, debate note commitment |
| `DOMAIN_HASH4` | `0x48344d` | `H4M` | 4 | 2-round sponge (§3.2) | User leaf commitment |
| `DOMAIN_POS_COMMIT` | `0x50434d` | `PCM` | 3 | `[arg, wt, rand, PCM]` | Debate position commitment |
| `DOMAIN_POS_NUL` | `0x504e4c` | `PNL` | 3 | `[key, c, dbt, PNL]` | Debate position nullifier |
| `DOMAIN_SPONGE_24` | `0x534f4e47455f24` | `SONGE_24` | 24 | capacity init | District commitment (24-slot sponge) |

**FROZEN post-launch.** Any change requires a protocol-wide re-hash and is a hard fork. These tags are committed in Commons memory (`crypto_primitives_map.md`) and mirrored in the TypeScript `poseidon2.ts` and every circuit `main.nr`.

### 3.2 The H4 Construction

Poseidon2 width-4 cannot absorb 4 inputs plus a domain tag in a single permutation. The 4-input hash uses a 2-round sponge:

```
Round 1: state ← [DOMAIN_HASH4, a, b, c]
         state ← Poseidon2_permute(state)
Round 2: state[1] ← state[1] + d
         state ← Poseidon2_permute(state)
return state[0]
```

The domain tag occupies the capacity slot throughout, guaranteeing non-collision with `H2(a, b)` padded to 4 elements or `H3(a, b, c)` padded to 4 elements, even for the special case of trailing zeros.

### 3.3 Non-Collision Tests (Enforced In-Circuit)

Each circuit includes Noir tests asserting the following non-collisions for arbitrary non-zero inputs:

```
H2(a, b)       ≠ H3(a, b, 0)
H2(a, b)       ≠ H4(a, b, 0, 0)
H3(a, b, c)    ≠ H4(a, b, c, 0)
H_PCM(a, b, c) ≠ H3(a, b, c)            # PCM vs H3M domain distinct
H_PCM(a, b, c) ≠ H_PNL(a, b, c)         # Commitment vs nullifier distinct
```

See `three_tree_membership/src/main.nr::test_hash*_domain_separation` and `position_note/src/main.nr::test_pos_commit_domain_separation_*`.

---

## 4. Data Structures

### 4.1 Tree 1 — User Identity Tree

| Property | Value |
|---|---|
| Type | Standard binary Merkle tree |
| Depth | Configurable: 18 / 20 / 22 / 24 (compile-time variants) |
| Default | 20 (~1M leaves) |
| Node hash | `H2(left, right)` with `DOMAIN_HASH2` |
| Leaf hash | `H4(user_secret, cell_id, registration_salt, authority_level)` |
| Lifecycle | Stable — user re-registers only on physical move |

**Security properties bound in the leaf:**
- `CVE-001/CVE-003`: Leaf is recomputed **inside** the circuit from `user_secret`, preventing an attacker from claiming an existing leaf without knowing its secret.
- `BR5-001`: `authority_level` is a circuit input to H4, cryptographically binding tier to identity. An attacker cannot upgrade tier without re-registration.
- `SA-011`: `user_secret ≠ 0` asserted in-circuit to prevent predictable leaves.

### 4.2 Tree 2 — Cell-to-District Mapping (Sparse Merkle)

| Property | Value |
|---|---|
| Type | Sparse Merkle Tree (key-derived path) |
| Depth | 20 |
| Node hash | `H2(left, right)` |
| Leaf hash | `H2(cell_id, district_commitment)` where `district_commitment = sponge(districts[0..24])` |
| Lifecycle | Dynamic — rebuilt on redistricting |

**Why SMT not standard Merkle:** A cell-keyed map requires O(1) leaf lookup by key, not O(N) index-to-key translation. Path direction bits are **private witnesses** (pre-computed from the key), not derived from a numeric index. Redistricting updates Tree 2 without affecting Tree 1 — users do not re-register when districts change.

### 4.3 Tree 3 — Engagement Tree

| Property | Value |
|---|---|
| Type | Standard Merkle tree |
| Depth | 20 |
| Node hash | `H2(left, right)` |
| Leaf hash | `H2(identity_commitment, engagement_data_commitment)` |
| `engagement_data_commitment` | `H3(engagement_tier, action_count, diversity_score)` |
| Lifecycle | Updated after each verified civic action |

**Cross-tree identity binding** (the non-obvious property): the `identity_commitment` used to construct the Tree 3 leaf is the **same** private input that derives the nullifier in the circuit (§6). A single private input feeds both computations. The circuit asserts consistency without revealing the commitment. This prevents engagement data from being claimed by a different identity — the engagement leaf and the nullifier are cryptographically linked.

### 4.4 Position Tree (Debate Market)

| Property | Value |
|---|---|
| Type | Standard binary Merkle tree |
| Depth | 20 (~1M positions) |
| Node hash | `H2(left, right)` |
| Leaf hash | `H_PCM(argument_index, weighted_amount, randomness)` |
| Lifecycle | Per-debate, pruned on settlement |

Position commitments use `DOMAIN_POS_COMMIT` (PCM), not `DOMAIN_HASH3`, to prevent cross-circuit aliasing between engagement data commitments and position commitments even when inputs happen to match.

---

## 5. Circuits

Four live circuits and one legacy. All compile to UltraHonk via `nargo` + `@aztec/bb.js`.

### 5.1 `three_tree_membership` — Canonical Civic Action Proof

**31 public inputs. This is the live circuit on commons.email.**

Proves:
1. User is in Tree 1 at a specific cell with a specific authority tier.
2. That cell maps to 24 specific districts in Tree 2.
3. User's identity has an engagement leaf in Tree 3 with a public tier.
4. Nullifier is correctly derived from identity and action scope.

**Public inputs:**

| Index | Field | Meaning |
|---|---|---|
| 0 | `user_root` | Tree 1 root (contract-verified) |
| 1 | `cell_map_root` | Tree 2 SMT root |
| 2–25 | `districts[24]` | 24-slot district ID array |
| 26 | `nullifier` | `H2(identity_commitment, action_domain)` |
| 27 | `action_domain` | Contract-controlled scope |
| 28 | `authority_level` | User verification tier `[1..5]` |
| 29 | `engagement_root` | Tree 3 root |
| 30 | `engagement_tier` | User engagement bucket `[0..4]` |

**Private inputs:**

`user_secret, cell_id, registration_salt, identity_commitment, user_path[20], user_index, cell_map_path[20], cell_map_path_bits[20], engagement_path[20], engagement_index, action_count, diversity_score`

**Constraint count:** ~19,500 gates at depth 20. Under the 2^19 browser WASM ceiling at all supported depths.

**Proving time targets:** <5s on Apple M1/M2, <10s on mid-range Android, <30s on low-end mobile.

Source: `packages/crypto/noir/three_tree_membership/src/main.nr`.

### 5.2 `position_note` — Debate Market Settlement

**5 public inputs.** Proves a debater owns a position commitment in the position Merkle tree, that the position is on the winning argument, and generates a unique settlement nullifier. All without revealing which leaf is theirs or which identity owns it.

**Public inputs:** `position_root, nullifier, debate_id, winning_argument_index, claimed_weighted_amount`

**Private inputs:** `argument_index, weighted_amount, randomness, nullifier_key, position_path[20], position_index`

**Nullifier:** `H_PNL(nullifier_key, commitment, debate_id)` — binds settlement to exact commitment + debate, preventing cross-debate replay.

Source: `packages/crypto/noir/position_note/src/main.nr`.

### 5.3 `debate_weight` — Quadratic Stake Commitment

**2 public inputs.** Proves that a debater's weighted influence is correctly derived from private stake and engagement tier:

```
weighted_amount = floor(sqrt(stake)) × 2^tier
```

**Public inputs:** `weighted_amount, note_commitment`

**Private inputs:** `stake, sqrt_stake, tier, randomness`

**In-circuit sqrt verification:** The prover supplies `sqrt_stake` as a witness; the circuit enforces `sqrt_stake^2 ≤ stake < (sqrt_stake+1)^2` using u64 arithmetic (safe because stake is capped at $100 = 100,000,000 USDC units << 2^64).

**Note commitment:** `H3(stake, tier, randomness)` — binds the position to exact stake and tier without revealing them.

Source: `packages/crypto/noir/debate_weight/src/main.nr`.

### 5.4 `bubble_membership` — Community Field (Phase 2)

**Phase 2 circuit for geographic bubble aggregation.** Proves a verified user commits to a set of up to 16 H3 hexagonal cells representing their geographic bubble, with Sybil-resistant per-epoch nullifiers.

**Identity binding:** `identity_commitment` must be in Tree 3 (operator-controlled), preventing fabricated commitments from bypassing epoch nullifier Sybil resistance.

**Epoch nullifier:** `H2(identity_commitment, epoch_domain)` where `epoch_domain` encodes field tag + date ordinal.

**Cell count bound:** `MAX_CELLS = 16` limits how many cells one identity can contribute. Cells must be sorted ascending to prevent duplicate claims within a single proof.

Trust model: the client computes H3 cells from bubble geometry (cannot be verified in-circuit without leaking coordinates); the operator acts as trusted aggregator. Statistical aggregation with differential privacy dilutes individual misrepresentation at scale.

Source: `packages/crypto/noir/bubble_membership/src/main.nr`.

### 5.5 Depth Variants

Each live circuit compiles to four depth variants (18 / 20 / 22 / 24):

| Depth | Capacity | Use case |
|---|---|---|
| 18 | 262K leaves | Municipal (city council, school boards) |
| 20 | 1M leaves | **Default.** Congressional districts, medium countries |
| 22 | 4M leaves | Federal-scale, large countries |
| 24 | 16M leaves | Mega-regional (EU, India-scale) |

The build pipeline rewrites `TREE_DEPTH: u32 = 20` per variant and emits four `.json` circuits per source.

---

## 6. Nullifier Scheme

### 6.1 Construction

All nullifiers use `H2` with `DOMAIN_HASH2`:

```
nullifier = H2(identity_commitment, action_domain)
```

Except `position_note` which uses `H_PNL` with `DOMAIN_POS_NUL` for per-debate isolation.

### 6.2 Identity Commitment

`identity_commitment` is a BN254 field element deterministically derived from a user's verified identity credential (Digital Credentials API / mDL). It is **stable across re-registrations**: a user who re-registers with new `user_secret`, new `registration_salt`, and in a new cell still produces the **same** `identity_commitment`.

This is the crux of the Sybil resistance: the nullifier cannot be escaped by rotating keys.

### 6.3 The NUL-001 Evolution

The original single-tree circuit (`district_membership`, now legacy — §11.1) derived the nullifier from `user_secret`:

```
nullifier_old = H2(user_secret, action_domain)      ← vulnerable
```

An attacker could re-register with a fresh `user_secret` and generate a **new** nullifier for the same action, defeating Sybil resistance. The three-tree circuit fixes this:

```
nullifier_new = H2(identity_commitment, action_domain)   ← deterministic per person
```

Both a PII-free identity commitment and a hidden user secret are now required. The secret proves tree membership; the identity commitment anchors the nullifier to a specific verified person.

### 6.4 Action Domain (Contract-Controlled)

`action_domain` is a **public** circuit input set by the verifying contract. It is derived deterministically as:

```
action_domain = keccak256(abi.encodePacked(
  protocol_version,       // "commons.v1"
  country,                // ISO 3166-1 alpha-2 (e.g., "US")
  jurisdictionType,       // "federal" | "state" | "local" | "international"
  recipientSubdivision,   // ISO 3166-2 or "{state}-{locality}"
  templateId,             // the user-created campaign / message template
  legislativeSessionId    // e.g., "119th-congress"
)) mod BN254_MODULUS
```

Reference implementation: [`commons/src/lib/core/zkp/action-domain-builder.ts`](https://github.com/communisaas/commons/blob/main/src/lib/core/zkp/action-domain-builder.ts).

Whitelisting is enforced by `DistrictGate.allowedActionDomains` — governance must approve each domain through a 7-day timelock before proofs bound to it can verify. Users cannot manipulate `action_domain` and cannot even submit proofs for novel (non-whitelisted) domains. This fixes `CVE-002`: in an earlier design sketch, epoch/campaign were private inputs the user could rotate, generating multiple valid proofs for the same action.

### 6.5 Cross-Tree Identity Binding (The Clever Part)

A single private input `identity_commitment` feeds **both**:

```
nullifier       = H2(identity_commitment, action_domain)         ← Step 4 of circuit
engagement_leaf = H2(identity_commitment, engagement_data_commit) ← Step 6 of circuit
```

The Tree 3 Merkle verification (Step 7) asserts that `engagement_leaf` is in the engagement tree, which binds the engagement data to this specific identity. The nullifier binds the action to this same identity. **Both derivations use the same private input, so they are cryptographically linked.** An attacker cannot claim engagement data belonging to a different identity.

Formal property: for any accepted proof, there exists a unique `identity_commitment` such that:
- `(identity_commitment, engagement_data_commitment, engagement_path, engagement_index)` is a valid Merkle proof against `engagement_root`
- `nullifier = H2(identity_commitment, action_domain)`

Extracting `identity_commitment` from the proof is hard by zero-knowledge; rotating it between the two derivations is hard by the cross-tree binding assertion.

---

## 7. Trusted Setup

### 7.1 Proving System: UltraHonk

The protocol uses UltraHonk (KZG commitments over BN254) via Barretenberg. UltraHonk is a polynomial IOP compiled to a SNARK with a universal structured reference string.

### 7.2 Aztec Ignition SRS

**No per-circuit ceremony.** The protocol consumes the Aztec Ignition SRS, a reusable structured reference string produced by the Aztec Ignition multi-party computation (Oct 2019 – Jan 2020) with **176 participants** on the BN254 curve. The ceremony output is a 100.8M-point transcript — the size of the SRS, not of the participant pool.

The SRS is fetched at prover init time from Aztec's CDN (`crs.aztec-cdn.foundation/g1.dat`, `g2.dat`) by Barretenberg's `bb.js` toolchain. See `@aztec/bb.js` source at `dest/node/crs/net_crs.js`.

Security model: **1-of-176 honesty** (generalized 1-of-N). If any one of the 176 ceremony participants was honest and destroyed their toxic waste, the SRS is secure. Compromise requires collusion of all 176 contributors, with all contributors having retained their secrets.

The SRS is shared across all protocols that use Aztec's Barretenberg backend:
- **More eyeballs:** more protocols have scrutinized the ceremony than any single-protocol setup.
- **Shared risk:** SRS compromise would affect every protocol using it, not just Commons.

Ceremony provenance: <https://github.com/AztecProtocol/ignition-verification>. Transcript, participant list, and independent verification tooling are public.

### 7.3 What Would Break If the SRS Were Compromised

A compromised SRS would allow proof forgery for all UltraHonk-BN254 circuits using it. A single compromised prover could:
- Generate valid proofs for users not in any tree.
- Bypass all Merkle-membership constraints.
- Forge arbitrary nullifiers.

The protocol inherits the Aztec community's SRS security posture. A post-quantum migration plan is anticipated (10-year horizon) but outside the current spec.

### 7.4 Verifier Contract Upgrades

Each depth variant has its own verifier contract (4 verifiers per circuit × 4 live circuits = 16 verifier contracts, with `three_tree_membership` having 4 live and `two_tree_membership`/`district_membership` retired).

Verifier upgrades require a **14-day timelock** — the longest in the system. A malicious verifier that returned `true` unconditionally would forge the entire protocol. The 14-day window allows:
- Download proposed bytecode from Scroll.
- Independently compile the Noir circuit with matching `nargo` version.
- Compare bytecode byte-for-byte.
- Alert the community to pressure cancellation if mismatched.

A reproducible-build procedure for independent bytecode verification is a known gap (§10).

---

## 8. On-Chain Integration

### 8.1 Contract Topology (Scroll L2)

| Contract | Purpose |
|---|---|
| `DistrictGate` | Verifies three-tree proofs; records nullifiers |
| `UserRootRegistry` | Append-only Tree 1 roots with lifecycle |
| `CellMapRegistry` | Append-only Tree 2 roots with lifecycle |
| `EngagementRootRegistry` | Append-only Tree 3 roots with lifecycle |
| `NullifierRegistry` | Per-action-domain nullifier tracking, rate limiting |
| `DistrictRegistry` | District ID metadata |
| `DebateMarket` | Position trading, resolution, settlement |
| `TimelockGovernance` | 7-day/14-day governance operations |
| `VerifierRegistry` | 14-day verifier upgrades |
| `SnapshotAnchor` | Quarterly root anchor (on-chain audit trail) |

### 8.2 Timelock Asymmetry

| Operation | Delay | Reasoning |
|---|---|---|
| Register new root | Immediate | Users should not wait 7 days to register |
| Deactivate root | 7 days + 30-90 day grace | Existing users need migration time |
| Verifier upgrade | 14 days | Severity of undetected malicious verifier |
| Pause | Immediate | Defensive; stops active exploits |

The immediate root registration is a known gap (§10). A compromised governance key can instantly register a poisoned root, though the poisoning itself is cryptographically verifiable against public Census data given a reproducible-build pipeline.

### 8.3 Rate Limiting

`NullifierRegistry` enforces per-user-nullifier 60-second rate limits. This is a soft anti-spam measure, not a cryptographic guarantee. Sybil resistance comes from nullifier uniqueness + identity binding.

---

## 9. Cross-Language Parity

The TypeScript prover (`packages/crypto/poseidon2.ts`) does **not** reimplement Poseidon2. Instead, it wraps the Noir `fixtures` circuit via `@noir-lang/noir_js`:

```ts
const hasher = await Poseidon2Hasher.getInstance();
const h = await hasher.hashPair(left, right);
// Under the hood: executes the Noir circuit that calls poseidon2_permutation()
```

**Implication:** the TypeScript and Noir sides cannot diverge on the permutation itself — they share the same compiled circuit. Divergence would require the Noir stdlib to produce different outputs in different execution contexts, which is a bug in Noir, not in Commons.

What could still diverge: input serialization, domain tag values, sponge construction. These are enforced by the golden vector CI check (§2.5) and by shared constant definitions (every circuit declares `DOMAIN_HASH* = 0x...` as a global, and `poseidon2.ts` declares the same hex values).

---

## 10. Known Limitations

This is the honest list. None of these are show-stoppers; all are load-bearing for the walkaway roadmap (`TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` §7).

### 10.1 Professional Security Audit

**Status:** Planned, not complete.

Three internal review waves have occurred (Waves 42R, 43R, 44R on the debate market; prior waves on three-tree). Findings documented in `docs/wave-4xR-*-review.md`. No external firm has audited the circuits or contracts.

### 10.2 Formal Verification

**Status:** Planned, not complete.

No circuits are currently formally verified. Domain separation non-collision is asserted by property tests, not by a formal proof. This is a common state of the art (most production ZK systems are not formally verified), but a target for maturity.

### 10.3 Reproducible Build Pipeline

**Status:** Open gap.

A cryptographer cannot today reproduce the exact verifier contract bytecode from the `nargo` source without insider knowledge of toolchain versions and flags. This undermines the 14-day verifier upgrade timelock's community-verification property.

Remediation: pin `nargo`, `bb`, and `barretenberg` versions in a Docker image or Nix flake; publish expected bytecode hashes.

### 10.4 Immediate Root Registration

**Status:** Design trade-off, acknowledged.

New roots are registered without timelock (fast UX). A compromised governance key can register a poisoned root instantly. Mitigation: the poisoned root must pass independent Census-based verification for any sophisticated user or watcher to consider it valid; in practice, root registration events are monitored.

Long-term: oracle-based root registration where TIGER data attestation comes from a decentralized source.

### 10.5 Operator Tree Construction Trust

**Status:** Core gap, walkaway-roadmap target.

The Shadow Atlas operator can poison or censor tree construction. See §1 Layer 2 and `TRUST-MODEL-AND-OPERATOR-INTEGRITY.md` §5 for the full accounting.

### 10.6 Phase 2 / Unfinished Components

- **On-chain DistrictRegistry** replacing self-referential root validation: planned.
- **GuardianShield** multi-jurisdiction guardians with 2-of-N veto: planned (Phase 2).
- **Chainlink oracle integration** for data-acquisition verification: planned.

---

## 11. Legacy and Deprecated Components

### 11.1 `district_membership` (Single-Tree, Legacy)

**Status:** Dead code. Retained for historical continuity; not on any live path.

The original single-tree circuit with 2 public inputs (`merkle_root`, `action_domain`) and a 5-tuple return (`merkle_root`, `nullifier`, `authority_level`, `action_domain`, `district_id`). See `packages/crypto/noir/district_membership/src/main.nr:128-174`. Superseded by `two_tree_membership` (which split identity from district mapping) and then by `three_tree_membership` (which added engagement).

Indicators it is not live:
- Nullifier uses `user_secret`, vulnerable to Sybil via re-registration (pre-NUL-001).
- `DistrictProver` test suite gates all proof generation/verification behind `SKIP_HASH4_MISMATCH = true`: the single-tree H4 uses plain `poseidon2_permutation([a,b,c,d])` without `DOMAIN_HASH4`, which is incompatible with the three-tree H4 2-round sponge.
- Commons (`commons/src`) imports no district-prover code. Only `packages/shadow-atlas/src/serving/proof-generator.ts` references it for offline fixture generation.

Disposition: source retained but scheduled for deletion. Any new deployment must use `three_tree_membership`.

### 11.2 `two_tree_membership` (Pre-Engagement)

**Status:** Retired. All live verifiers point at `three_tree_membership`.

The 29-public-input predecessor to the three-tree. Introduced the separation of Tree 1 (identity) from Tree 2 (cell-district mapping), eliminating re-registration on redistricting. Three-tree extends this by adding Tree 3 (engagement).

### 11.3 Legacy Documents (Superseded by This Spec)

| Document | Status | Disposition |
|---|---|---|
| `docs/ZK-PRODUCTION-ARCHITECTURE.md` | Archived content duplicated at root | Deleted from root, retained in `docs/archive/` |
| `docs/NOIR-PROVING-INFRASTRUCTURE.md` | Archived content duplicated at root | Deleted from root, retained in `docs/archive/` |
| `specs/DISTRICT-MEMBERSHIP-CIRCUIT-SPEC.md` | Single-tree historical | Moved to `specs/archive/`, redirect stub at original path |
| `specs/TWO-TREE-ARCHITECTURE-SPEC.md` | Two-tree historical (registration/recovery flows still useful) | Moved to `specs/archive/`, redirect stub at original path |
| `commons/docs/cryptography.md` | Commons-side integration notes | Rewritten as thin pointer to this spec |

---

## 12. Reference Implementation

### 12.1 Repository Layout

```
voter-protocol/
├── packages/
│   ├── crypto/                         # Core crypto primitives
│   │   ├── poseidon2.ts                # TS hasher (wraps Noir fixtures circuit)
│   │   ├── sparse-merkle-tree.ts       # SMT impl for Tree 2
│   │   ├── engagement.ts               # Engagement tier derivation
│   │   ├── district-prover.ts          # Legacy single-tree (deprecated)
│   │   └── noir/
│   │       ├── three_tree_membership/  # Canonical live circuit
│   │       ├── position_note/          # Debate settlement
│   │       ├── debate_weight/          # Quadratic stake
│   │       ├── bubble_membership/      # Community field (Phase 2)
│   │       ├── district_membership/    # Legacy single-tree
│   │       ├── two_tree_membership/    # Legacy pre-engagement
│   │       ├── fixtures/               # Primitive hash circuit used by TS
│   │       └── sponge_helper/          # Sponge hash circuit used by TS
│   ├── noir-prover/                    # Browser prover, ACIR artifacts
│   └── shadow-atlas/                   # Tree builder, IPFS pipeline, HTTP API
├── contracts/                          # Solidity: DistrictGate, registries, timelocks
└── specs/                              # This document + companion specs

commons/                                # SvelteKit app consuming voter-protocol
├── src/lib/core/crypto/                # BN254, Poseidon2 imports
├── src/lib/core/zkp/                   # Prover client, community-field client
└── src/lib/core/identity/              # Shadow-atlas-handler, mDL verification
```

### 12.2 Key Entry Points

| Purpose | File |
|---|---|
| TS Poseidon2 hasher | `voter-protocol/packages/crypto/poseidon2.ts` |
| Three-tree prover | `voter-protocol/packages/noir-prover/src/three-tree-prover.ts` |
| Commons prover client | `commons/src/lib/core/zkp/prover-client.ts` |
| Identity commitment derivation | `commons/src/lib/core/identity/mdl-verification.ts` |
| Tree 1 registration | `commons/src/lib/core/identity/shadow-atlas-handler.ts` |
| Field validation | `commons/src/lib/core/crypto/bn254.ts` |

### 12.3 Build and Verify (Circuits)

```bash
cd voter-protocol/packages/crypto/noir/three_tree_membership
nargo test                    # Run property tests including domain separation
nargo compile                 # Produce ACIR
../../../../scripts/build-circuits.ts   # Build all 4 depth variants
```

### 12.4 Golden Vector Regression

```bash
cd voter-protocol/packages/crypto
pnpm test sponge-vectors      # Cross-language golden vector check
pnpm test district-prover     # Includes H_PCM/H_PNL domain separation tests
```

---

## Changelog

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-04-21 | Consolidation | Initial canonical spec; supersedes ZK-PRODUCTION-ARCHITECTURE, NOIR-PROVING-INFRASTRUCTURE, DISTRICT-MEMBERSHIP-CIRCUIT-SPEC, TWO-TREE-ARCHITECTURE-SPEC |

---

## Contact and Review

Questions, findings, and pull requests: <https://github.com/voter-protocol> (voter-protocol), <https://github.com/commons> (commons-side integration).

This specification is designed to be falsifiable. If a claim here does not match the code, that is a bug in the spec or in the code, and it should be reported.
