# [FEATURE] Stateful Proving Key Caching in bbapi

## Problem Statement

For applications that generate multiple proofs for the same circuit, the current bbapi workflow recomputes the proving key on each invocation. In browser-based proving scenarios where initialization latency is critical, this means the expensive key computation cannot be amortized across proofs.

The proving key is deterministic for a given circuit—regenerating it per-proof is unnecessary overhead when proofs are generated repeatedly.

## Proposed Solution

Expose two new bbapi commands that separate proving key generation from proof construction:

1. **`AcirGetProvingKey`**: Generates and serializes the proving key for a circuit
2. **`AcirProveWithPk`**: Accepts a pre-serialized proving key and generates a proof

This is an **opt-in addition**—the existing `CircuitProve` workflow remains unchanged and is still the recommended approach for single-proof use cases. The new commands provide an alternative for applications that benefit from key reuse.

## Example Use Case

```typescript
// First proof: generate and cache proving key
const { provingKey } = await bb.execute('acir_get_proving_key', {
  circuit: { bytecode },
  settings: { disableZk: false, oracleHashType: 'poseidon2' }
});

// Cache provingKey in memory/storage...

// Subsequent proofs: reuse cached key
const proof = await bb.execute('acir_prove_with_pk', {
  circuit: { bytecode },
  witness,
  provingKey,
  settings
});
```

## Alternative Solutions

1. **Keep using `CircuitProve` for everything** - Simpler, works well for single-proof cases. The new API is only beneficial when generating multiple proofs for the same circuit.
2. **Application-level caching of prover state** - More complex, requires internal knowledge of prover structure
3. **Memoization within bb process** - Doesn't persist across invocations or WASM instances

## Additional Context

We have an implementation ready for discussion. Key points:

- **Purely additive** - No modifications to existing commands or behavior
- **All Ultra flavors supported** - Ultra, UltraZK, UltraKeccak, UltraKeccakZK, UltraRollup
- **Bytecode validation** - Serialized key includes BLAKE3 hash of circuit bytecode, validated on use to prevent mismatched key/circuit pairs

Happy to share implementation details or adjust the approach based on feedback.
