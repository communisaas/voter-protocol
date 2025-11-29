# bb.js Migration & Circuit Refactor Specification (2025-11-29)

## Goals
- Replace the Halo2 wasm prover with Barretenberg via `@aztec/bb.js`, delivering faster browser proving, built-in threaded wasm, and a maintained TS/WASM toolchain.
- Preserve Shadow Atlas semantics: ZK membership + nullifier per authority/epoch/campaign.
- Ship with security-first defaults (COOP/COEP/SRI, integrity pinning, key handling) and be stable for ~10 years until PQ migration.

## Cryptography & proving system
- Proving system: UltraPlonk/UltraHonk on BN254 (trusted setup; same curve class as current).
- Circuit size: bb.js wasm SRS historically hard-coded to 2^19; stay under that bound for browser proving.citeturn1search3
- Threads: only the threaded bb.js WASM will be used; it requires SharedArrayBuffer and cross-origin isolation (COOP+COEP).citeturn1search6turn0search0turn0search5
- Hash: Poseidon (supported natively in Barretenberg). Keep same parameters as current Halo2 circuit to avoid rehashing trees.
- Merkle trees: depth per authority stays as today (district: 12; city/county likely 14‑17; state 20‑25). Keep one tree per authority+epoch.

## Data & authority model (no change, but formalized)
- `Authority{id, kind, name, parents[], epoch, geometryRef}`.
- Leaf commitment (user-held): `leaf = Poseidon(normalized_addr || user_secret || salt)`.
- Atlas-only dedup key: `atlas_commit = Poseidon(normalized_addr || atlas_sk)` (never leaves server).
- Nullifier: `Poseidon(user_secret || campaign_id || authority_id || epoch_id)`.
- Public inputs per proof: `[merkle_root, nullifier, authority_id_hash, epoch_id, campaign_id]`.
- Private inputs: `[leaf, merkle_path, leaf_index, user_secret]`.

## Circuit mapping Halo2 → Barretenberg/Noir
| Feature | Current Halo2 | New (Noir + bb.js) |
| --- | --- | --- |
| Hash | Poseidon hash_single/hash_pair reused | Poseidon builtin gadget |
| Merkle | `verify_merkle_path_with_hasher` depth=12 | Noir Merkle gadget; parameterize depth per authority |
| Nullifier | Poseidon(identity, action_id) | Poseidon(user_secret, campaign_id, authority_id, epoch) |
| Public IO | [root, nullifier, action_id] | [root, nullifier, authority_hash, epoch_id, campaign_id] |
| K | 14 single-tier | keep gate count under wasm SRS bound (~2^19) |

## Browser execution plan (launch, no fallback)
- Require crossOriginIsolated proving surface; serve `@aztec/bb.js` threaded WASM only.
- Headers:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless` where supported)citeturn0search0turn0search5
  - CSP: `worker-src 'self'; script-src 'self'; connect-src 'self'` (expand only as needed); CORP on static assets.
- Integrity: pin WASM/JS with SRI and verify hashes at runtime before instantiate.

## Prover flow (browser)
1) Load threaded bb.js WASM (fail closed if SAB unavailable).
2) Load circuit bytecode (Noir-compiled ACIR) and proving key.
3) User presents credential blob containing leaf, path, leaf_index, user_secret (encrypted at rest).
4) Prover computes proof with bb.js; outputs proof + public inputs.
5) On-chain/off-chain verifier checks `(root, authority_id, epoch)` registry and nullifier registry.

## Security hardening
- Commitments resistant to address brute-force (salt + user secret).
- Epoch binding prevents redistricting replay.
- Authority_id_hash prevents mixed-tree substitution.
- SRI + pinned npm versions; periodic audit (socket/npm audit) of bb.js deps.
- COOP/COEP enforced on the proving surface; isolate proving UI to a dedicated origin/page to avoid header breakage elsewhere.
- Telemetry: record proving duration and SAB availability (no PII); fail closed if headers/SAB absent.

## Performance targets
- District depth (≤20): <5 s on M1, <10 s on mid-range Android (threaded).
- Memory: stay within the 4 GiB wasm linear-memory ceiling; keep gate count under the SRS bound (~2^19).citeturn1search3

## Migration steps (launch track, no fallback)
1) Circuit port: Re-implement district membership in Noir/Barretenberg with identical Poseidon params, authority/epoch/campaign-bound nullifier, and per-authority depth; enforce gate count <2^19.
2) Proving/verification: Use `@aztec/bb.js` threaded build in browser; generate Solidity verifier from the Noir circuit; replace Halo2 verifier and update the root registry keyed by (authority_hash, epoch).
3) Frontend/ops: Serve proving UI on cross-origin isolated origin with required headers; publish SRI hashes for WASM/JS; block proving if headers/SAB not present.
4) Performance validation: Bench on M1 and mid-tier Android; verify targets (<5 s / <10 s) and memory headroom; tune thread count via bb.js options if needed.
5) Security validation: Fuzz proof verification; audit dependency tree; regression-test nullifier uniqueness across authority+epoch+campaign; document operational runbooks for COOP/COEP/CSP.

## Noir circuit specification (Halo2 → Barretenberg)
- Curve / system: BN254 UltraPlonk/UltraHonk via Barretenberg.
- Poseidon params: t=3, rate=2, R_F=8, R_P=57 (Axiom spec currently used in Halo2 wasm). Keep identical constants to avoid rehashing stored Merkle paths/commitments.
- Public inputs (ordered):
  1. `merkle_root` (Fr)
  2. `nullifier` (Fr)
  3. `authority_hash` (Fr; Poseidon of authority_id string or canonical bytes)
  4. `epoch_id` (Fr; encodes redistricting epoch)
  5. `campaign_id` (Fr; domain-separates nullifiers)
- Private inputs:
  - `leaf` (Poseidon(normalized_addr || user_secret || salt))
  - `merkle_path` (array<Fr, DEPTH>)
  - `leaf_index` (felt, bit-constrained to DEPTH bits)
  - `user_secret` (felt)
- Constraints:
  1) Recompute root with Poseidon Merkle gadget at configured `DEPTH` (per authority type: district=12; city/county 14–17; state 20–25). 
  2) `nullifier' = Poseidon(user_secret, campaign_id, authority_hash, epoch_id)`; constrain equal to public `nullifier`.
  3) Constrain `leaf` equals Poseidon(normalized_addr || user_secret || salt) iff we embed normalization; otherwise treat `leaf` as witness and add offline check in ingestion.
  4) Range/bit constrain `leaf_index` to DEPTH bits to prevent sibling reordering.
- Gate sizing: Merkle hashing dominates. With Poseidon (~250–300 constraints per hash) × DEPTH(≤25) ≈ ≤7.5k constraints; plus nullifier + glue <2k; total well below 2^19 gate cap.
- Outputs: emit public array `[merkle_root, nullifier, authority_hash, epoch_id, campaign_id]` for bb.js/Noir verifier compatibility.

## Tooling and build prerequisites (threaded-only bb.js)
- NPM deps: add `@aztec/bb.js` (threaded build), `@noir-lang/noir_wasm` for compiling Noir → ACIR (if we keep Noir source in-repo), and `@aztec/noir-protocol-circuits` only if leveraging existing gadgets.
- Build: add `scripts/build-bbjs.sh` to (a) compile Noir to ACIR/bytecode, (b) run `bb.js` to generate proving & verification keys, (c) emit threaded WASM artifacts and SRI hashes.
- Headers: enforce COOP/COEP on proving page; add lint/check in CI that hits a local dev server and asserts `window.crossOriginIsolated === true` before running integration tests.
- CI: add browser-based integration that runs `pnpm test:bbjs-prove` under Playwright with SAB enabled; skip/FAIL if SAB missing.
- Contracts: swap Halo2 verifier with Barretenberg-generated Solidity; update root registry to use `(authority_hash, epoch_id)` keying.

## Open questions to resolve
- Exact Poseidon parameterization match (t, rounds) between Halo2 and Barretenberg to avoid rehashing existing trees.
- Whether to store/verifiy transcript hash for long-lived integrity.
- Circuit upgrade policy when epochs change or when moving to PQ curves (e.g., BLS12‑377 / Stark-friendly hash).

## Immediate implementation checklist (threaded-only launch track)
- [ ] Add dependencies: `@aztec/bb.js`, `@noir-lang/noir_wasm`, `noir` compiler (pinned), and `@aztec/noir-protocol-circuits` if we reuse gadgets.
- [ ] Create `packages/crypto/noir/` with Noir circuit mirroring current Halo2 logic; include Poseidon params and Merkle gadgets; expose ACIR/bytecode artifact.
- [ ] Add `scripts/build-bbjs.sh` to compile Noir, generate proving/verification keys, and emit threaded WASM + SRI manifest under `dist/bbjs/`.
- [ ] Wire frontend worker to load bb.js threaded WASM; fail closed when `!window.crossOriginIsolated`.
- [ ] Serve proving UI on isolated origin with COOP/COEP and CSP; add Playwright check that headers yield `crossOriginIsolated === true`.
- [ ] Replace Halo2 Solidity verifier with Barretenberg-generated verifier; update root registry keyed by `(authority_hash, epoch_id)`.
- [ ] Regression tests: nullifier uniqueness across `(authority, epoch, campaign)`; Merkle path verification against stored roots; SRI hash verification for bb.js assets.

## Pre-tree optimization decisions (we can still change without rehashing)
- **Depth per authority (performance vs anonymity):** U.S. launch defaults: congressional & large-city depth 18–20; county/city-council 14–17; state 20–21. Reserved “mega” depth 22 (off by default) for exceptional cases; all remain under the bb.js 2^19 wasm SRS gate bound. citeturn1search3
- **Hash constants:** Freeze Poseidon to Barretenberg defaults t=3, rate=2, R_F=8, R_P=57 (matches our Halo2 Axiom spec) to avoid any future leaf rehash. citeturn1search6
- **Leaf definition (hardened):** `leaf = Poseidon(normalized_addr || user_secret || salt)`; optional server-only `atlas_commit = Poseidon(normalized_addr || atlas_sk)` for dedup. Finalize now to prevent re-generation later.
- **Nullifier domain separation:** `nullifier = Poseidon(user_secret, campaign_id, authority_hash, epoch_id)` and publish `[root, nullifier, authority_hash, epoch_id, campaign_id]` as public inputs to block cross-authority/epoch replay. (No tree rewrite needed.)
- **Tree shape:** Keep arity-2; Lean IMT-style Merkle gadget is acceptable and trims constraints ~20–30% at depths 14–20; adopt before data ingestion. citeturn1search6
- **Index strategy:** Choose append-only leaf indices (simpler, faster) unless we later require PRF-based indices; deciding now avoids reindexing.

## Browser/threading requirements (launch hard requirements)
- Only ship threaded bb.js WASM; require `SharedArrayBuffer` with `COOP: same-origin` + `COEP: require-corp` (or credentialless). Proving must fail closed if `!window.crossOriginIsolated`. citeturn0search0turn0search5
- Pin WASM/JS with SRI and verify before instantiate; keep a manifest in `dist/bbjs/sri.json`.

## U.S. scope guardrails (launch focus)
- Largest expected authority: U.S. House district (~760k people; depth ~20). Depth plan (18–21) covers this with headroom; depth 22 remains reserved and disabled for U.S. ingest.
- CI perf check: generate synthetic trees at depths 18, 20, and 22; fail build if gate count, memory, or threaded prove time exceed thresholds (<=5s M1 baseline).
- Authority config validator: reject new authority entries whose estimated leaves exceed the locked depth class; prevents silent under-provisioning when ingesting updated census or redistricting data.

## Multi-depth deployment plan (keep ops manageable)
- Ship 3 depth classes with pinned artifacts and SRI: `14/20/22`. Layout: `dist/bbjs/{depth}/(acir|pk|vk|wasm|sri.json)`.
- Single manifest consumed by ingestion + prover: maps `authority_id → depth_class`; validator refuses oversubscribed authorities.
- Loader picks artifacts by depth class; no user/runtime choice.
- CI proves synthetic trees at 14, 20, 22; fail if time/memory exceed thresholds. If we need zero ops complexity, fallback is a single depth-22 circuit (performance cost accepted).

## Implementation progress (live)
- [x] Add deps: `@aztec/bb.js`, `@noir-lang/noir_wasm`, pinned `noir` compiler; consider `@aztec/noir-protocol-circuits` gadgets.
- [x] Scaffold Noir circuit repo: `packages/crypto/noir/` with `district_membership.nr`, shared Poseidon params, depth config (14/20/22), fixtures.
- [ ] Build pipeline: `scripts/build-bbjs.sh` + `scripts/internal/gen-bbjs-artifacts.js` to compile Noir→ACIR, generate PK/VK, emit threaded WASM + SRI into `dist/bbjs/{depth}/`. (ACIR now produced via noir_wasm; bb.js (2.1.8) lacks keygen API → PK/VK/WASM still placeholder)
- [x] Artifact manifest schema and validator: `dist/bbjs/manifest.schema.json`; `scripts/internal/validate-bbjs-manifest.js`; root script `bbjs:validate-manifest`.
- [ ] Frontend integration: threaded bb.js loader, `crossOriginIsolated` guard, SRI verification.
- [ ] Contracts: swap Halo2 verifier with Barretenberg-generated verifier; update root registry `(authority_hash, epoch_id)`.
- [ ] CI: synthetic perf at depths 14/20/22; fail on time/memory; header check ensuring COOP/COEP for proving surface.
- [x] Remove legacy Halo2 wasm threading scripts (`packages/crypto/circuits/scripts/build-wasm-threaded.sh`, `tools/wasm-bindgen-runner`).
- [ ] Keygen unblock: either upstream bb.js keygen PR (see `docs/bbjs-upstream-keygen-pr.md`) or manual native `bb` CLI keygen via `native-keygen.sh` to emit vk/pk/wasm; update manifest with `has_pk_vk`.
- [ ] Native keygen script added (`scripts/internal/native-keygen.sh`); requires `bb` binary on PATH/BB_BIN; currently not run because bb binary is absent in repo.

## Blockers & resolution path
- Current `@aztec/bb.js` (2.1.8) exposes only `BarretenbergSync` without keygen APIs (`setupGenericProverAndVerifier`, `getSrs`). PK/VK/WASM are not emitted.
- ACIR generation is working for depths 14/20/22 and stored at `dist/bbjs/{depth}/acir.bin` with SRI.
- Next actions:
  1) Try a bb.js build that exposes keygen (check latest tag or nightly). If available, rewire `gen-bbjs-artifacts.js` to emit PK/VK/WASM.
  2) If not, implement manual keygen via lower-level `BarretenbergSync.api` or perform keygen in CI where a fuller bb.js build is present.
