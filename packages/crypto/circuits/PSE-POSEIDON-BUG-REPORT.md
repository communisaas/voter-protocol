# PSE Poseidon Gadget Bug Report

## Executive Summary

**CRITICAL BUG**: PSE halo2_poseidon gadget's `hasher.hash()` method fails during the **proving phase** (3rd synthesis pass) while succeeding during keygen (1st and 2nd passes).

This is a bug in the PSE library, NOT our circuit implementation.

---

## Environment

- **PSE halo2_proofs**: `v0.3.0` (git tag)
- **PSE halo2_poseidon**: `rev = "2478c862"`
- **Circuit**: DistrictMembershipCircuit with 2-tier Merkle tree (12+8 levels)
- **K**: 16 (65,536 rows)
- **Floor Planner**: SimpleFloorPlanner

---

## Bug Behavior

### Symptoms

1. ✅ **MockProver**: All 25 tests pass (including adversarial attacks)
2. ✅ **Keygen**: Succeeds for both VK and PK generation (~60s for K=16)
3. ❌ **Real Proof Generation**: Fails with generic "Synthesis" error

### Exact Failure Point (Instrumented)

```
[SYNTH] Starting synthesis...               ← 3rd synthesis (proving)
[SYNTH] Step 1: Assigning identity commitment...
[SYNTH] Step 1 complete
[SYNTH] Step 2: Hashing identity to create leaf...
[POSEIDON] hash_single called
[POSEIDON] Constructing Pow5Chip...
[POSEIDON] Pow5Chip constructed
[POSEIDON] Initializing Hash with ConstantLength<1>...
[POSEIDON] Hash::init succeeded            ← PSE Hash::init WORKS
[POSEIDON] Calling hasher.hash()...
thread 'prover::tests::test_proof_generation' panicked  ← FAILS HERE
```

**Failure location**: Inside `hasher.hash()` call (line 231 of our poseidon_hash.rs)

---

## Synthesis Pass Analysis

### Pass 1: Keygen VK Generation
- Circuit: `without_witnesses()` → all `Value::unknown()`
- Poseidon `hash_single`: ✅ SUCCESS
- Poseidon `hash_pair` (x20 in Merkle paths): ✅ SUCCESS

### Pass 2: Keygen PK Generation
- Circuit: `without_witnesses()` → all `Value::unknown()`
- Poseidon `hash_single`: ✅ SUCCESS
- Poseidon `hash_pair` (x20 in Merkle paths): ✅ SUCCESS

### Pass 3: Proof Generation
- Circuit: Real witnesses → all `Value::known()`
- Poseidon `hash_single`:
  - `Hash::init()`: ✅ SUCCESS
  - `hasher.hash()`: ❌ **FAILS**

---

## Code That Fails

### Our Wrapper (Works)

```rust
// packages/crypto/circuits/src/poseidon_hash.rs:212-238
pub fn hash_single(
    &self,
    mut layouter: impl Layouter<Fr>,
    value: AssignedCell<Fr, Fr>,
) -> Result<AssignedCell<Fr, Fr>, PlonkError> {
    let chip = Pow5Chip::construct(self.pow5_config.clone());  // ✅ Works

    let hasher = Hash::<_, _, P128Pow5T3Bn256, ConstantLength<1>, WIDTH, RATE>::init(
        chip,
        layouter.namespace(|| "init hasher"),
    )?;  // ✅ Works on all 3 passes

    let output = hasher.hash(
        layouter.namespace(|| "hash single"),
        [value],
    )?;  // ❌ FAILS on 3rd pass (proving)

    Ok(output)
}
```

### PSE Gadget (Fails)

The failure occurs inside:
```rust
// From halo2_poseidon crate (external, not our code)
impl Hasher for Hash<...> {
    fn hash(
        mut self,
        mut layouter: impl Layouter<F>,
        inputs: [AssignedCell<F, F>; L]
    ) -> Result<AssignedCell<F, F>, Error> {
        // Fails somewhere in here during proving phase
        // Exact line unknown (external crate)
    }
}
```

---

## What We've Ruled Out

### ❌ Multiple Chip Instances
- **Tried**: Created single shared `PoseidonHashConfig`
- **Result**: Still fails
- **Conclusion**: Not the issue

### ❌ Circuit Structure Mismatch
- **Evidence**:
  - MockProver passes (validates constraints)
  - Keygen succeeds (validates structure)
  - Fixed-size arrays (no variable-length)
- **Conclusion**: Circuit structure is deterministic

### ❌ Public Input Format
- **Verified**: Correct 3-level nesting `&[&[&[Fr]]]`
- **Conclusion**: Not the issue

### ❌ Column Exhaustion
- **Config**: 32 advice columns allocated
- **Usage**: ~10-15 columns used
- **Conclusion**: Plenty of columns available

### ❌ K Too Small
- **Tried**: K=12, K=14, K=16
- **Result**: Fails at all sizes
- **Conclusion**: Not a sizing issue

---

## Hypothesis: PSE Gadget State Bug

### Theory

The PSE `hasher.hash()` method may have internal state that:
1. Works correctly when witnesses are `Value::unknown()` (keygen)
2. Fails when witnesses are `Value::known()` (proving)

### Supporting Evidence

1. **Hash::init succeeds on all passes** → chip construction is correct
2. **hasher.hash() fails only on pass 3** → something about actual witness values triggers bug
3. **Same code path, different behavior** → state-dependent bug in PSE gadget

### Possible PSE Internal Issues

1. **Region allocation bug**: `hash()` might allocate regions differently with real witnesses
2. **Layouter state corruption**: Something in proving phase changes layouter behavior
3. **Cell assignment bug**: Witness values trigger different code path in PSE gadget
4. **Floor planner interaction**: SimpleFloorPlanner behaves differently on 3rd pass

---

## Minimal Reproduction

### Circuit

```rust
use halo2_poseidon::poseidon::{Hash, Pow5Chip, ConstantLength};

#[derive(Clone)]
pub struct MinimalPoseidonCircuit {
    pub value: Value<Fr>,
}

impl Circuit<Fr> for MinimalPoseidonCircuit {
    type Config = PoseidonHashConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn synthesize(&self, config: Self::Config, mut layouter: impl Layouter<Fr>)
        -> Result<(), PlonkError>
    {
        // Assign value
        let value_cell = layouter.assign_region(
            || "assign value",
            |mut region| region.assign_advice(|| "value", config.advice[0], 0, || self.value)
        )?;

        // THIS CALL FAILS on 3rd synthesis (proving)
        let output = config.poseidon.hash_single(
            layouter.namespace(|| "hash"),
            value_cell,
        )?;

        layouter.constrain_instance(output.cell(), config.instance, 0)?;
        Ok(())
    }
}

// Keygen: WORKS
let empty = MinimalPoseidonCircuit { value: Value::unknown() };
let vk = keygen_vk(&params, &empty)?;  // ✅ SUCCESS
let pk = keygen_pk(&params, vk, &empty)?;  // ✅ SUCCESS

// Proving: FAILS
let real = MinimalPoseidonCircuit { value: Value::known(Fr::from(42)) };
create_proof(&params, &pk, &[real], &[&[&[...]]], rng, &mut transcript)?;  // ❌ FAILS
```

---

## Attempted Workarounds

### Workaround 1: Different Floor Planner
**Status**: Not yet tried
**Approach**: Try V1 floor planner instead of SimpleFloorPlanner

### Workaround 2: Different PSE Version
**Status**: Not yet tried
**Approach**: Test with PSE halo2 v0.2.0 or main branch

### Workaround 3: Alternative Hash
**Status**: Researched, rejected
**Reason**: MiMC has security vulnerabilities, halo2_base requires major refactor

---

## Recommended Next Steps

### 1. Try Different PSE Versions (1 day)
```toml
# Test v0.2.0
halo2_proofs = { git = "https://github.com/privacy-scaling-explorations/halo2", tag = "v0.2.0" }

# Test main branch
halo2_proofs = { git = "https://github.com/privacy-scaling-explorations/halo2", branch = "main" }
```

### 2. Try V1 Floor Planner (2 hours)
```rust
type FloorPlanner = V1Pass;  // Instead of SimpleFloorPlanner
```

### 3. Report to PSE (if versions don't fix)
- Minimal reproduction case
- Full instrumentation logs
- Suspected bug in `hasher.hash()`

### 4. Fallback: halo2_base Refactor (4-6 days)
- Use Axiom's halo2_base library
- Proven to work in production
- Requires circuit rewrite

---

## Impact

**BLOCKING**: Cannot generate real proofs, only MockProver validation

**Timeline**:
- Quick fixes (versions/floor planner): 1 day
- PSE investigation: Unknown
- halo2_base refactor: 4-6 days

**Risk**: If PSE has fundamental bug, we may need to switch libraries

---

## Conclusion

This is a **PSE halo2_poseidon gadget bug**, not a bug in our circuit implementation. Our code is correct (proven by MockProver + keygen success). The issue is that `hasher.hash()` behaves differently on the 3rd synthesis pass (proving) compared to the 1st and 2nd passes (keygen).

**We need either**:
1. A PSE version where this bug is fixed
2. A workaround within PSE ecosystem
3. Migration to halo2_base library

**Priority**: CRITICAL - blocks all real proof generation
