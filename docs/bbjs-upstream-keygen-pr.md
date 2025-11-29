# Upstream bb.js Keygen API Proposal (2025-11-29)

## Objective
Expose deterministic keygen/prove/verify helpers in `@aztec/bb.js` so browser/Node consumers can generate proving/verification keys and proofs for Noir/Barretenberg ACIR without shelling out to the native `bb` CLI.

## Motivation
- npm `@aztec/bb.js@2.1.8` only exposes curve ops; no `setupGenericProverAndVerifier` or SRS/keygen helpers.
- Native `bb` CLI already supports `write_vk`, `write_pk`, `write_solidity_verifier`, `prove`, `verify`; the functionality exists in C++ and wasm exports, just not surfaced in JS.
- Projects (including voter-protocol) need an in-process path for keygen in CI and Node/browser without maintaining a parallel native toolchain.

## Target API (TS)
Expose via `@aztec/bb.js`:
```ts
interface KeygenOptions {
  crs?: Uint8Array | string; // optional CRS bytes or path (Node)
  threads?: number;          // default: auto when SAB available
  proofSystem?: 'ultraplonk' | 'ultrahonk';
}

async function setupGenericProverAndVerifier(acir: Uint8Array, opts?: KeygenOptions): Promise<{ prover: Prover; verifier: Verifier }>;

interface Prover {
  getProvingKey(): Promise<Uint8Array>;
  getCircuitWasm(): Promise<Uint8Array>;
  prove(witness: Uint8Array): Promise<Uint8Array>;
}

interface Verifier {
  getVerificationKey(): Promise<Uint8Array>;
  verify(proof: Uint8Array): Promise<boolean>;
  getSolidityVerifier(): Promise<string>; // optional
}

// Convenience single-shot helpers
async function writeVk(acir: Uint8Array, opts?: KeygenOptions): Promise<Uint8Array>;
async function writePk(acir: Uint8Array, opts?: KeygenOptions): Promise<Uint8Array>;
async function prove(acir: Uint8Array, witness: Uint8Array, opts?: KeygenOptions): Promise<Uint8Array>;
async function verify(vk: Uint8Array, proof: Uint8Array, opts?: KeygenOptions): Promise<boolean>;
```

## Implementation sketch (barretenberg/ts)
- Bindings: extend the existing wasm wrapper to export the C++ functions already used by the `bb` CLI (keygen, prove, verify, solidity_verifier). Similar to how `splitHonkProof` is exposed today.
- Threading: keep the current detection; when SAB unavailable, fall back to single-threaded.
- CRS handling: accept optional CRS bytes; otherwise load default BN254 CRS baked in wasm (existing behavior). For Node, allow filesystem path for large CRS.
- Proof system: default to UltraHonk/UltraPlonk; allow selection if the backend supports both.
- Types: add TS definitions in `dist/node/index.d.ts` (or `types/`).

## Tests (ts/__tests__)
- Use a small ACIR fixture (depth 2–4) to:
  - keygen -> prove -> verify round-trip.
  - export vk/pk and re-import to verify proofs.
- Run both threaded and non-threaded modes (where SAB absent, skip threaded).

## Browser considerations
- Document that threaded wasm requires COOP/COEP + SAB; non-threaded still works but slower.
- Keep existing SRI guidance; encourage consumers to pin wasm hashes.

## Backward compatibility
- Add new exports; do not remove existing curve ops. Publish under `next`/`rc` first, then `latest` after tests.

## Delivery plan
1) Patch `barretenberg/ts` to export keygen/prove/verify helpers; add TS types and tests.
2) Build and verify `yarn test` passes; publish canary tag (`3.0.0-canary.<hash>`).
3) Open PR with changelog entry and usage snippet.

## Security notes
- Do not generate CRS in JS; require provided CRS or baked-in default.
- Keep domain separation/proof-system flags explicit.
- Encourage consumers to SRI-pin wasm and JS bundles; document SAB/header requirements.
