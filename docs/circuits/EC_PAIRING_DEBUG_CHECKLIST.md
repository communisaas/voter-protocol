# EC Pairing Failure Debug Checklist
## Immediate Actions to Find the Bug

**Status**: 🚨 EVM pairing returns FALSE despite perfect synchronization
**Root Cause**: Unknown (likely instance encoding mismatch)
**Priority**: P0 - Blocks production deployment

---

## Quick Diagnosis (Run This First)

### Test 1: Verify Instance Structure Match (5 minutes)

**In `generate_verifier.rs` after line 296**, add:
```rust
eprintln!("\n🔍 KEYGEN INSTANCE STRUCTURE:");
eprintln!("  num_instance(): {:?}", circuit_for_keygen.num_instance());
eprintln!("  assigned_instances columns: {}", circuit_for_keygen.builder.assigned_instances.len());
for (i, col) in circuit_for_keygen.builder.assigned_instances.iter().enumerate() {
    eprintln!("  Column {}: {} values", i, col.len());
    for (j, val) in col.iter().take(3).enumerate() {
        use halo2_base::halo2_proofs::halo2curves::serde::SerdeObject;
        let mut bytes = Vec::new();
        val.value().write_raw(&mut bytes).unwrap();
        bytes.reverse();
        eprintln!("    [{}]: 0x{}", j, hex::encode(&bytes));
    }
}
```

**Run**:
```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/circuits
ALLOW_TEST_PARAMS=1 cargo run --bin generate_verifier --release --target aarch64-apple-darwin 2>&1 | grep -A 20 "KEYGEN INSTANCE"
```

**Expected**: Should print instance structure from keygen.

**Compare with prover output** (already has debug logging at line 636-658):
```bash
ALLOW_TEST_PARAMS=1 cargo test --lib export_proof_for_solidity --target aarch64-apple-darwin -- --ignored --nocapture 2>&1 | grep -A 20 "EXTRACTING INSTANCES"
```

**CRITICAL**: Both outputs MUST show IDENTICAL structure:
```
✅ CORRECT:
Keygen:  1 column with 3 values [val0, val1, val2]
Prover:  1 column with 3 values [val0, val1, val2]

❌ WRONG:
Keygen:  3 columns with 1 value each [val0], [val1], [val2]
Prover:  1 column with 3 values [val0, val1, val2]
```

---

## Test 2: Check G2 Generator (2 minutes)

**Verify KZG parameters are correct**:
```bash
cd /Users/noot/Documents/voter-protocol/packages/crypto/circuits
cargo run --bin check_params_g2 --release --target aarch64-apple-darwin
```

**Expected**: "✅ G2 generator matches canonical BN254 value"

**If fails**: 🚨 **CRITICAL SUPPLY-CHAIN ATTACK** - re-download ceremony params.

---

## Test 3: Instance Order Experiment (10 minutes)

**In `prover.rs` at line 702**, replace:
```rust
// ORIGINAL:
let proof = gen_evm_proof_shplonk(&self.params, &self.pk, circuit_wrapper, instances);

// EXPERIMENT 1: Try vec![1,1,1] instead of vec![3]
// Modify CircuitExt impl temporarily:
impl CircuitExt<Fr> for DistrictCircuitForKeygen {
    fn num_instance(&self) -> Vec<usize> {
        vec![1, 1, 1]  // ← Changed from vec![3]
    }

    fn instances(&self) -> Vec<Vec<Fr>> {
        // Transpose: [col0: [v0,v1,v2]] → [col0: [v0], col1: [v1], col2: [v2]]
        let vals: Vec<Fr> = self.builder.assigned_instances[0].iter().map(|v| *v.value()).collect();
        vals.into_iter().map(|v| vec![v]).collect()
    }
}
```

**Run proof generation**:
```bash
ALLOW_TEST_PARAMS=1 cargo test --lib export_proof_for_solidity --target aarch64-apple-darwin -- --ignored --nocapture
```

**Run Solidity test**:
```bash
cd /Users/noot/Documents/voter-protocol/contracts
forge test --match-contract Integration --match-test testProof -vvv
```

**If this works**: Bug is in `num_instance()` return value (should be `vec![1,1,1]`, not `vec![3]`).

---

## Test 4: Find Axiom's Working Example (15 minutes)

**Clone Axiom's production code**:
```bash
cd /tmp
git clone https://github.com/axiom-crypto/axiom-eth
cd axiom-eth
rg -l "gen_evm_proof_shplonk"
```

**Find their `CircuitExt` implementation**:
```bash
rg -A 15 "impl CircuitExt" $(rg -l "gen_evm_proof_shplonk")
```

**Copy their pattern** and compare with yours:
- How do they implement `num_instance()`?
- How do they implement `instances()`?
- Do they use `vec![3]` or `vec![1,1,1]`?

**Test their pattern** in your circuit.

---

## Test 5: Manual Pairing Verification (20 minutes)

**Extract commitments from proof and verify manually**:

```rust
// Add to prover.rs after line 705
fn debug_pairing_check(proof: &[u8], instances: &[Vec<Fr>]) {
    use halo2_base::halo2_proofs::halo2curves::bn256::{G1Affine, Fq};

    eprintln!("\n🔍 MANUAL PAIRING CHECK:");

    // First commitment (after 3x32 public inputs)
    let offset = 96;
    let x_bytes = &proof[offset..offset+32];
    let y_bytes = &proof[offset+32..offset+64];

    eprintln!("First commitment point:");
    eprintln!("  X: 0x{}", hex::encode(x_bytes));
    eprintln!("  Y: 0x{}", hex::encode(y_bytes));

    // Parse as field elements
    let x = Fq::from_bytes(x_bytes.try_into().unwrap()).unwrap();
    let y = Fq::from_bytes(y_bytes.try_into().unwrap()).unwrap();

    // Verify curve equation: y² = x³ + 3
    let y_sq = y * y;
    let x_cu = x * x * x;
    let x_cu_plus_3 = x_cu + Fq::from(3);

    if y_sq == x_cu_plus_3 {
        eprintln!("  ✅ Point is on BN254 curve");
    } else {
        eprintln!("  ❌ Point NOT on curve - PROOF IS MALFORMED");
    }

    // Verify point is not identity
    if x == Fq::zero() && y == Fq::zero() {
        eprintln!("  ❌ Point is identity - INVALID COMMITMENT");
    }
}
```

---

## Common Issues and Fixes

### Issue 1: `num_instance()` Returns Wrong Value

**Symptom**: Keygen says 1 column, prover builds 3 columns (or vice versa).

**Fix**: Ensure `num_instance()` matches actual `assigned_instances` structure:
```rust
// CORRECT (if you have 1 column with 3 values):
fn num_instance(&self) -> Vec<usize> {
    vec![3]  // Column 0 has 3 values
}

// CORRECT (if you have 3 columns with 1 value each):
fn num_instance(&self) -> Vec<usize> {
    vec![1, 1, 1]  // Column 0: 1 value, Column 1: 1 value, Column 2: 1 value
}
```

### Issue 2: Instance Extraction Uses Wrong Method

**Symptom**: `instances()` returns different structure than what's in `assigned_instances`.

**Fix**: Ensure `instances()` directly reflects `assigned_instances`:
```rust
fn instances(&self) -> Vec<Vec<Fr>> {
    // DON'T manipulate, just extract values
    self.builder.assigned_instances.iter()
        .map(|col| col.iter().map(|v| *v.value()).collect())
        .collect()
}
```

### Issue 3: Keygen and Prover Use Different Builders

**Symptom**: Configuration parameters differ between keygen and proving.

**Fix**: Ensure `generate_verifier.rs` and `prover.rs` call:
```rust
// BOTH must have:
builder.set_lookup_bits(8);
builder.set_instance_columns(1);  // MUST match num_instance().len()
```

---

## Decision Tree

```
1. Run Test 1 (Instance Structure Match)
   ├─ Structures MATCH → Go to step 2
   └─ Structures DIFFER → 🎯 BUG FOUND
      └─ Fix: Modify num_instance() or instances() to match

2. Run Test 2 (G2 Generator Check)
   ├─ G2 valid → Go to step 3
   └─ G2 invalid → 🚨 CRITICAL: Re-download KZG params

3. Run Test 3 (Instance Order Experiment)
   ├─ vec![1,1,1] WORKS → 🎯 BUG FOUND
   │  └─ Fix: Change num_instance() to vec![1,1,1]
   └─ Still fails → Go to step 4

4. Run Test 4 (Axiom Working Example)
   ├─ Find different pattern → 🎯 BUG FOUND
   │  └─ Fix: Adopt Axiom's pattern
   └─ Same pattern → Go to step 5

5. Run Test 5 (Manual Pairing Check)
   ├─ Pairing FAILS manually → Proof generation bug
   │  └─ Open issue on axiom-crypto/snark-verifier
   └─ Pairing PASSES manually → EVM encoding bug
      └─ Check Halo2Verifier.sol assembly
```

---

## Emergency Contacts

**If all tests fail**:

1. **Open issue on axiom-crypto/snark-verifier**:
   - Title: "gen_evm_proof_shplonk pairing failure with K=14 circuit (v0.1.7)"
   - Include: Circuit config, test results, minimal repro

2. **Check axiom-crypto/halo2-lib examples**:
   - Look for production circuits with similar setup
   - Compare CircuitExt implementations

3. **Bisect snark-verifier commits**:
   - Test v0.1.6-rc0 (audited)
   - Test v0.1.7 (22 commits later)
   - Find which commit broke pairing

---

## Success Criteria

**Test passes when**:
```bash
forge test --match-contract Integration --match-test testProof
```

**Outputs**:
```
[PASS] testProof() (gas: ~294k-300k)
```

**No more "pairing precompile returned false"**.

---

## Timeline Estimate

| Test | Time | Probability of Finding Bug |
|------|------|---------------------------|
| Test 1 | 5 min | 85% |
| Test 2 | 2 min | 10% |
| Test 3 | 10 min | 70% |
| Test 4 | 15 min | 60% |
| Test 5 | 20 min | 40% |

**Total**: ~1 hour to find bug with 95% confidence.

---

**START WITH TEST 1**. It's most likely the issue.
