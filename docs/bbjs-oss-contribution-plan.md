# bb.js Integration: Tradeoffs & OSS Contribution Strategy

## 1. Tradeoff Analysis: Stateless vs. Stateful Proving

Currently, `bb.js` forces a **Stateless** workflow because it cannot accept a pre-computed Proving Key (PK). It must generate the PK from the ACIR bytecode *every time* a proof is requested.

| Feature | Stateless (Current bb.js) | Stateful (Ideal / Native) |
| :--- | :--- | :--- |
| **Latency** | **High.** Adds ~2-5s (depending on circuit size) to *every* proof for PK generation. | **Low.** PK generation happens once (at build time). Proving starts immediately. |
| **Memory** | **High.** Must hold ACIR + intermediate structures for PK generation in WASM memory. | **Optimized.** Can potentially stream the PK or map it directly, avoiding generation spikes. |
| **Bandwidth** | **Low.** Client only downloads ACIR (small) + Verification Key (small). | **High.** Client must download the Proving Key (large, ~50MB+ for depth 20). |
| **UX** | "Loading..." spinner is longer on every interaction. | "Loading..." is fast, but initial page load/setup is heavier (downloading PK). |
| **Complexity** | **Low.** No PK artifact management. | **Medium.** Need to version, cache, and serve large PK binaries. |

**Verdict:** For a high-performance voting app, **Stateful is critical**. Adding 5s of latency to every vote cast (for PK regen) is a poor user experience. We want to pay the download cost *once* (pre-load) and have instant proving.

## 2. The Principled OSS Contribution

To realize the Stateful solution, we need to expose the "Key Loading" and "Key Export" APIs in `bb.js`. This requires changes across the stack:

### A. C++ Layer (Barretenberg WASM)
The WASM binary needs to export functions to serialize/deserialize the PK.
*   **Goal:** Expose `acir_get_proving_key(acir_ptr)` and `acir_load_proving_key(pk_ptr)`.
*   **Location:** Likely in `barretenberg/cpp/src/barretenberg/wasm/main.cpp` (or similar export definition file).
*   **Change:** Add `WASM_EXPORT` bindings that map to the underlying `AcirProof` class's serialization methods.

### B. TypeScript Layer (bb.js)
Update the `Barretenberg` class to use these new WASM exports.
1.  **Update Bindings:** Add `acirGetProvingKey` and `acirLoadProvingKey` to `BarretenbergWasm`.
2.  **New API:**
    ```typescript
    // Generate and return the PK (Uint8Array)
    async generateProvingKey(acir: Uint8Array): Promise<Uint8Array>;

    // Initialize prover with a pre-computed PK
    async newProver(acir: Uint8Array, pk: Uint8Array): Promise<Prover>;
    ```

### C. Build Pipeline
Ensure the build process (`cmake` -> `wasm`) preserves these new exports and doesn't strip them as dead code.

## 3. Recommended Plan

### Phase 1: The "Hacker" Fix (Immediate Unblock)
Since we cannot wait for an upstream merge to unblock our work:
1.  **Use Native Keygen:** Stick to the plan of using `native-keygen.sh` to generate the PK/VK artifacts for deployment.
2.  **Accept Stateless Proving (Dev):** For local dev/testing, just use the slow "stateless" mode. It works today and lets us build the UI.
3.  **Simulate Stateful (Prod):** We can't simulate it without the WASM change. We are stuck with Stateless in the browser until the fix lands.

### Phase 2: The Contribution
1.  **Fork `aztec-packages`.**
2.  **Implement the C++ exports.**
3.  **Build a custom `bb.js`** (e.g., `@voter-protocol/bb.js`) from this fork.
4.  **Use the custom build** in our project to enable the Stateful workflow.
5.  **Upstream the PR** to Aztec.

This is the most principled approach: it solves our problem immediately (via custom build) and contributes the "correct" missing feature back to the community.
