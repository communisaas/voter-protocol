# VOTER Protocol Test Strategy

**Goal**: Prevent 100% ZK proof failure rate through systematic testing at every layer.

## Critical Testing Principles

**The brutalist's finding taught us**: A single cryptographic mismatch (circomlibjs vs Axiom Poseidon) causes complete system failure with zero visibility. Tests must verify:

1. **Cryptographic consistency** - Same hash function everywhere (circuit ↔ WASM ↔ Shadow Atlas)
2. **Golden test vectors** - Never derive expectations from code under test
3. **Adversarial scenarios** - Test what SHOULD fail, not just happy paths
4. **End-to-end verification** - Browser proof → on-chain verification

## Test Pyramid

```
                   ┌─────────────────────────┐
                   │   E2E Integration      │  ← 5% of tests
                   │   (Browser → Chain)    │
                   └─────────────────────────┘
                 ┌───────────────────────────────┐
                 │   Integration Tests           │  ← 15% of tests
                 │   (Multi-component flows)     │
                 └───────────────────────────────┘
           ┌─────────────────────────────────────────┐
           │        Component Tests                   │  ← 30% of tests
           │   (Shadow Atlas, WASM, Contracts)        │
           └─────────────────────────────────────────┘
     ┌───────────────────────────────────────────────────┐
     │              Unit Tests                            │  ← 50% of tests
     │   (Circuits, Functions, Utilities)                 │
     └───────────────────────────────────────────────────┘
```

## Layer 1: Unit Tests (50% of test suite)

### 1.1 ZK Circuit Tests (Rust/Halo2)

**Location**: `packages/crypto/circuits/tests/`

**Critical tests**:
- ✅ Golden vector validation (hash_pair(12345, 67890) == known Axiom output)
- ✅ Poseidon constant verification (test constants match Axiom spec)
- ✅ Merkle proof verification with tampered witnesses
- ✅ District membership proof with wrong public inputs
- ✅ Edge cases (zero inputs, max field elements, boundary values)

**Run command**:
```bash
cd packages/crypto/circuits
cargo test --lib
```

**Success criteria**: All tests pass, MockProver accepts valid proofs and rejects invalid ones

### 1.2 WASM Export Tests (JavaScript)

**Location**: `test-wasm-poseidon.mjs` (already exists)

**Critical tests**:
- ✅ hash_pair matches circuit golden vector
- ✅ hash_single produces consistent results
- ✅ Endianness handling (hex ↔ Fr field elements)
- ✅ Error handling (invalid hex, out-of-range values)

**Run command**:
```bash
node test-wasm-poseidon.mjs
```

**Success criteria**: WASM output exactly matches Axiom circuit implementation

### 1.3 Contract Unit Tests (Foundry/Solidity)

**Location**: `contracts/test/DistrictGate.t.sol`

**Critical tests**:
- ✅ Halo2 proof verification with valid proof
- ✅ Proof verification rejects tampered proof
- ✅ Access control for district-gated actions
- ✅ Gas consumption within expected bounds

**Run command**:
```bash
forge test -vvv
```

**Success criteria**: All tests pass, gas usage < 400k per verification

### 1.4 Client Library Tests (Vitest/TypeScript)

**Location**: `packages/client/test/client.test.ts`

**Existing tests**:
- ✅ VOTERClient initialization
- ✅ NEAR account management
- ✅ Chain signatures derivation
- ✅ Halo2Prover initialization
- ✅ ShadowAtlas loading state

**Run command**:
```bash
cd packages/client
npm test
```

## Layer 2: Component Tests (30% of test suite)

### 2.1 Shadow Atlas Build/Verify Pipeline

**NEW - Location**: `scripts/test-shadow-atlas.ts`

**Critical flow**:
```typescript
1. Build Shadow Atlas with WASM Poseidon
   → Generates 535 district hashes
   → Builds Merkle tree with hash_pair
   → Outputs shadow-atlas-us.json

2. Verify Atlas integrity
   → Recomputes Merkle root
   → Compares to stored root
   → Tests proof generation for sample districts

3. Validate hash consistency
   → Compare district hash from build vs verify
   → Ensure Merkle root matches across runs
   → Verify proof paths are correct length
```

**Run command**:
```bash
npm run test:atlas
```

**Success criteria**:
- ✅ Merkle root matches between build and verify
- ✅ All sample district proofs validate
- ✅ Hash outputs identical across runs (deterministic)

### 2.2 WASM Proof Generation

**Location**: `packages/client/test/proof-generation.test.ts` (NEW)

**Critical tests**:
- Generate proof with real Shadow Atlas
- Verify proof locally before submission
- Test proof generation timing (< 15s on mobile)
- Test with invalid district (should fail gracefully)

**Run command**:
```bash
cd packages/client
npm run test:proofs
```

### 2.3 Contract Integration Tests

**Location**: `contracts/test/integration/` (NEW)

**Critical tests**:
- Deploy Halo2Verifier → verify test proof
- Deploy DistrictGate → submit action with proof
- Test proof replay protection
- Test district registry updates

**Run command**:
```bash
forge test --match-path "test/integration/**/*.t.sol"
```

## Layer 3: Integration Tests (15% of test suite)

### 3.1 Atlas → Proof → Verification Flow

**Location**: `scripts/test-integration.ts` (NEW)

**Critical flow**:
```typescript
1. Build Shadow Atlas (WASM Poseidon)
2. Generate ZK proof for specific district
3. Serialize proof for contract
4. Call Halo2Verifier.verify() on Scroll testnet
5. Verify on-chain verification succeeds
```

**Run command**:
```bash
npm run test:integration
```

**Success criteria**:
- ✅ End-to-end proof generation + verification
- ✅ Contract accepts valid proof
- ✅ Contract rejects tampered proof

### 3.2 Multi-Chain Account Flow

**Location**: `packages/client/test/integration/chain-signatures.test.ts` (NEW)

**Critical tests**:
- Create NEAR account via passkey
- Derive Ethereum address via NEAR Chain Signatures
- Sign transaction for Scroll L2
- Submit proof to DistrictGate

**Run command**:
```bash
cd packages/client
npm run test:chain-sigs
```

## Layer 4: E2E Tests (5% of test suite)

### 4.1 Browser-to-Chain Proof Submission

**Location**: `packages/client/test/e2e/` (NEW)

**Critical flow** (runs in headless browser):
```typescript
1. User loads app in browser
2. Loads Shadow Atlas from IPFS
3. Generates proof in Web Worker
4. Connects wallet (MetaMask/injected)
5. Submits proof to DistrictGate on Scroll testnet
6. Waits for transaction confirmation
7. Verifies on-chain state updated
```

**Run command**:
```bash
npm run test:e2e
```

**Tools**: Playwright for browser automation

**Success criteria**:
- ✅ Complete flow in < 30 seconds
- ✅ Proof generation succeeds in browser
- ✅ Transaction confirms on testnet

## Test Execution Strategy

### Pre-Commit Tests (Fast, < 30 seconds)

```bash
#!/bin/bash
# .git/hooks/pre-commit

# TypeScript type checking
npm run typecheck

# Circuit unit tests (fast subset)
cd packages/crypto/circuits && cargo test --lib hash_pair

# Contract unit tests
cd contracts && forge test --match-test "testBasic"

# Client unit tests
cd packages/client && npm test -- --run
```

### Pre-Push Tests (Medium, < 5 minutes)

```bash
npm run test:all
```

Runs:
- All circuit tests
- All contract tests
- All client tests
- Shadow Atlas build + verify
- WASM Poseidon validation

### CI/CD Pipeline (Complete, < 15 minutes)

**GitHub Actions**:
```yaml
- Unit tests (all layers)
- Component tests (Shadow Atlas, WASM, contracts)
- Integration tests (Atlas → Proof → Chain)
- E2E tests (browser automation on Scroll testnet)
- Gas profiling (track cost regressions)
- Coverage reporting (enforce > 80% coverage)
```

## Critical Test Data

### Golden Test Vectors

**Location**: `packages/crypto/circuits/tests/golden_vectors.rs`

```rust
// NEVER derive these from the library we're testing
// Computed ONCE from audited Axiom implementation

pub const POSEIDON_HASH_PAIR_12345_67890: &str =
    "0x1a52400b0566a6d2eb81fcf923da131e3f0db95e6e618ed4041225c78530a49a";

pub const MERKLE_ROOT_535_DISTRICTS: &str =
    "0x..."; // From production Shadow Atlas build
```

### Test Shadow Atlas

**Location**: `test-data/shadow-atlas-test.json`

**Properties**:
- 10 districts (not 535, for speed)
- Deterministic seed for reproducibility
- Known Merkle root for validation
- Sample proof paths for each district

## Monitoring & Alerts

### Test Failure Categories

1. **CRITICAL** (blocks deployment):
   - Circuit tests fail
   - WASM hash mismatch with circuit
   - Contract verification rejects valid proof

2. **HIGH** (requires immediate fix):
   - Integration test failure
   - Gas cost regression > 10%
   - Proof generation time > 15s

3. **MEDIUM** (fix before release):
   - E2E test failure
   - Coverage drop > 5%
   - Flaky tests (> 1% failure rate)

### Test Metrics Dashboard

Track over time:
- ✅ Test pass rate (target: 100%)
- ✅ Proof generation time (target: < 10s avg)
- ✅ Gas cost per verification (target: < 350k)
- ✅ Coverage percentage (target: > 80%)
- ✅ Flaky test count (target: 0)

## Testing the Tests

**Meta-tests** to verify test suite catches real bugs:

1. **Mutation testing**: Introduce bugs, verify tests catch them
   - Change Poseidon round constant → tests MUST fail
   - Swap left/right in hash_pair → tests MUST fail
   - Remove proof validation → tests MUST fail

2. **Coverage gaps**: Identify untested code paths
   - Use `cargo tarpaulin` for Rust coverage
   - Use `vitest --coverage` for TypeScript
   - Use `forge coverage` for Solidity

3. **Performance regression**: Track test execution time
   - Unit tests should stay < 30s
   - Integration tests should stay < 5min
   - Alert on > 20% slowdown

## Next Steps: Implementing Shadow Atlas Tests

See: `scripts/test-shadow-atlas.ts` (to be created)

This test strategy ensures we never repeat the circomlibjs disaster: **systematic validation at every layer, golden vectors for cryptographic correctness, and adversarial testing for production readiness**.

---

*Quality discourse pays. Broken cryptography costs.*
