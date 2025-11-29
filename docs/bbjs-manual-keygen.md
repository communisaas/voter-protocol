# Manual Keygen Plan for bb.js/Barretenberg (2025-11-29, US launch track)

## Why we need this
`@aztec/bb.js` (latest npm tag: 2.1.8) exposes only `BarretenbergSync` with curve ops; it does **not** expose `setupGenericProverAndVerifier` or SRS/keygen helpers. Our build currently produces ACIR binaries (`dist/bbjs/{depth}/acir.bin`) but PK/VK/WASM artifacts are placeholders. We need a deterministic, auditable keygen path that works today.

## Target proving system
- UltraPlonk/UltraHonk on BN254 (matching Noir default backend v0.87.x).
- Circuit depths: 14 / 20 / 22 (as per migration spec).

## Manual keygen strategy (native `bb` CLI)
1) **Build Barretenberg CLI (`bb`) from source**  
   - Use barretenberg tag `v0.87.0` (matches Noir 1.0.0-beta.11 tooling).  
   - Build native binary with BN254, UltraPlonk/UltraHonk enabled:  
     ```
     git clone https://github.com/AztecProtocol/barretenberg.git
     cd barretenberg
     git checkout v0.87.0
     ./scripts/bootstrap.sh
     cmake -S cpp -B build -DCMAKE_BUILD_TYPE=Release
     cmake --build build --target bb -j$(nproc)
     ```
   - Output: `build/bin/bb`.

2) **Use Noir to emit JSON ACIR for keygen**  
   - From our repo root:  
     ```
     nargo compile --workspace packages/crypto/noir/district_membership
     # outputs target/<package>.json
     ```
   - Alternatively: extend `compile-acir.js` to also write `program.json` (decoded from the noir_wasm `program` object) alongside `acir.bin`.

3) **Run keygen with native `bb`**  
   - Verification key:  
     ```
     bb write_vk -b target/<pkg>.json -o dist/bbjs/<depth>/vk
     ```  
   - Proving key (if supported in this bb build):  
     ```
     bb write_pk -b target/<pkg>.json -o dist/bbjs/<depth>/pk
     ```  
   - Optional Solidity verifier:  
     ```
     bb write_solidity_verifier -k dist/bbjs/<depth>/vk -o dist/bbjs/<depth>/Verifier.sol
     ```

4) **Proof generation sanity check (native)**  
   - Generate witness (with inputs) using `nargo execute` to produce `target/<pkg>.gz`.  
   - Prove & verify:  
     ```
     bb prove -b target/<pkg>.json -w target/<pkg>.gz -o dist/bbjs/<depth>/proof
     bb verify -k dist/bbjs/<depth>/vk -p dist/bbjs/<depth>/proof
     ```

5) **Artifact packaging for browser**  
   - Store: `acir.bin` (gzipped ACIR), `vk`, `pk` (if produced), `Verifier.sol`, `sri.json`.  
   - Update `manifest.json` to include `has_pk_vk: true/false` per depth.

## Alternative: build a custom bb.js with keygen API
If native CLI doesn’t fit the delivery path, build bb.js from barretenberg `ts/` with threading + keygen exposed:
```
cd barretenberg/ts
yarn install
EXPOSE_KEYGEN=1 SKIP_ST_BUILD=1 yarn build
# publish or consume from local dist/
```
This yields a bb.js bundle exposing `setupGenericProverAndVerifier` usable in `gen-bbjs-artifacts.js`.

## Security considerations
- Run keygen on hardened builders; publish SHA256/SRI for `acir.bin`, `vk`, `pk`, `wasm`.
- Bind keys to (depth, authority_hash, epoch_id) in manifest; reject mismatches at load time.
- Keep COOP/COEP + SRI enforcement unchanged for the proving UI.
- Keep nullifier domain separation and Poseidon parameter parity (already in migration spec).

## Action items
- [ ] Build native `bb` v0.87.0 and script `scripts/internal/native-keygen.sh` to emit vk/pk for depths 14/20/22.
- [ ] Extend `compile-acir.js` to also emit `program.json` (decoded `program` from noir_wasm).
- [ ] Update `gen-bbjs-artifacts.js` to load vk/pk if present; otherwise fallback to current placeholder.
- [ ] Update `manifest.json` to include `has_pk_vk`, `vk_path`, `pk_path`.
- [ ] Add CI job to regenerate vk/pk and verify proof round-trip per depth.
