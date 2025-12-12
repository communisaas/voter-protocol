# Voter Protocol Test Strategy

**Classification**: Distinguished Engineering  
**Threat Model**: Adversarial inputs, malicious provers, compromised infrastructure  
**Philosophy**: If it's not tested, it's broken.

---

## Test Pyramid

```
                    ┌─────────────────────┐
                    │   E2E Browser Test  │  ← Full stack in browser
                    │   (1-2 tests)       │
                    └─────────────────────┘
                   ╱                       ╲
         ┌─────────────────────────────────────────┐
         │       Integration Tests                 │  ← Cross-component
         │   (contracts ↔ prover ↔ circuit)       │
         └─────────────────────────────────────────┘
        ╱                                           ╲
┌───────────────────────────────────────────────────────────┐
│                    Unit Tests                              │
│  • Circuit constraints (Noir)                              │
│  • Contract functions (Foundry)                            │
│  • Prover methods (Vitest)                                 │
│  • Shadow Atlas (Vitest)                                   │
└───────────────────────────────────────────────────────────┘
```

---

## Layer 1: Unit Tests

### 1.1 Noir Circuit (`packages/crypto/noir/district_membership/`)

| Test | Purpose | Status |
|------|---------|--------|
| `test_valid_membership_proof` | Happy path with valid inputs | ⏳ TODO |
| `test_merkle_root_mismatch` | Circuit rejects wrong root | ⏳ TODO |
| `test_nullifier_computation` | Nullifier matches expected | ⏳ TODO |
| `test_index_out_of_range` | leaf_index >= 2^DEPTH fails | ⏳ TODO |

**Tooling**: `nargo test`

```bash
cd packages/crypto/noir/district_membership
nargo test
```

### 1.2 Solidity Contracts (`contracts/test/`)

| Contract | Test File | Status |
|----------|-----------|--------|
| NullifierRegistry | `NullifierRegistry.t.sol` | ✅ Exists |
| GuardianShield | `GuardianShield.t.sol` | ✅ Exists |
| DistrictGate | `DistrictGate.Core.t.sol` | ✅ Exists |
| DistrictGate | `DistrictGate.Governance.t.sol` | ✅ Exists |
| DistrictRegistry | `DistrictRegistry.t.sol` | ✅ Exists |
| Integration | `Integration.t.sol` | ✅ Exists |

**Tooling**: `forge test`

```bash
cd contracts
forge test --match-contract NullifierRegistry -vvv
```

### 1.3 NoirProver (`packages/noir-prover/src/`)

| Test | Purpose | Status |
|------|---------|--------|
| `should initialize Barretenberg backend` | WASM loads | ✅ Passing |
| `should generate proving key via acirGetProvingKey` | Stateful keygen | ✅ Passing |
| `should execute circuit witness generation` | noir_js compatibility | ✅ Passing |
| `should generate valid proof with correct inputs` | End-to-end prove | ⏳ TODO |
| `should verify proof` | Verification round-trip | ⏳ TODO |

**Tooling**: `vitest`

```bash
cd packages/noir-prover
npm test
```

### 1.4 Shadow Atlas (`packages/crypto/services/shadow-atlas/`)

| Test File | Purpose | Status |
|-----------|---------|--------|
| `merkle-tree.test.ts` | Tree construction | ✅ Exists |
| `merkle-tree-golden-vectors.test.ts` | Deterministic outputs | ✅ Exists |
| `validation-adversarial.test.ts` | Malicious input rejection | ✅ Exists |

---

## Layer 2: Integration Tests

### 2.1 Prove → Verify Round-Trip

**Critical Test**: Generate proof in NoirProver, verify in contract.

```typescript
// packages/noir-prover/src/integration.test.ts

describe('Prove/Verify Integration', () => {
    it('should generate proof that verifies on-chain', async () => {
        // 1. Build valid witness with real Poseidon2 hashes
        const witness = await buildValidWitness();
        
        // 2. Generate proof using NoirProver
        const prover = new NoirProver();
        await prover.init();
        await prover.warmup();
        const { proof, publicInputs } = await prover.prove(witness);
        
        // 3. Verify using bb.js verify API
        const isValid = await prover.verify(proof, publicInputs);
        expect(isValid).toBe(true);
        
        // 4. (Optional) Verify against Solidity verifier
        // Requires deployed contract or local Anvil fork
    });
});
```

**Dependency**: TypeScript Poseidon2 implementation to generate valid fixtures.

### 2.2 Contract Integration

```solidity
// contracts/test/Integration.t.sol

contract IntegrationTest is Test {
    function test_fullSubmissionFlow() public {
        // 1. Register district root
        districtRegistry.registerRoot(VALID_ROOT, "USA");
        
        // 2. Authorize action
        districtGate.authorizeAction(ACTION_ID);
        
        // 3. Submit proof (using pre-generated test vectors)
        districtGate.verifyAndAuthorizeWithSignature(
            signer, proof, districtRoot, nullifier, actionId, ...
        );
        
        // 4. Verify nullifier recorded
        assertTrue(nullifierRegistry.isNullifierUsed(actionId, nullifier));
    }
}
```

---

## Layer 3: End-to-End Tests

### 3.1 Browser Environment Test

**Purpose**: Verify full stack works in actual browser with SharedArrayBuffer.

```typescript
// e2e/browser-proof.spec.ts (Playwright)

test('generates valid ZK proof in browser', async ({ page }) => {
    // 1. Navigate to test page with COOP/COEP headers
    await page.goto('/test-prover');
    
    // 2. Check cross-origin isolation
    const isolated = await page.evaluate(() => crossOriginIsolated);
    expect(isolated).toBe(true);
    
    // 3. Trigger proof generation
    await page.click('#generate-proof');
    
    // 4. Wait for completion (up to 3 min)
    await page.waitForSelector('#proof-result', { timeout: 180000 });
    
    // 5. Verify success
    const result = await page.textContent('#proof-result');
    expect(result).toContain('verified: true');
});
```

---

## Test Fixtures

### Golden Vector Generation

```typescript
// packages/noir-prover/fixtures/generate-vectors.ts

import { poseidon2 } from '@zkpassport/poseidon2';

export function generateGoldenVector(): CircuitInputs {
    const DEPTH = 14;
    
    // Fixed test values
    const userSecret = BigInt('0x1234');
    const leaf = BigInt('0xabcd');
    const leafIndex = 0;
    const merklePath = Array(DEPTH).fill(BigInt(0));
    
    const authorityHash = BigInt('0x02');
    const epochId = BigInt('0x01');
    const campaignId = BigInt('0x01');
    
    // Compute Poseidon2 hashes exactly as circuit does
    const merkleRoot = computeMerkleRoot(leaf, merklePath, leafIndex);
    const nullifier = poseidon2([userSecret, campaignId, authorityHash, epochId]);
    
    return {
        merkleRoot: toHex(merkleRoot),
        nullifier: toHex(nullifier),
        authorityHash: toHex(authorityHash),
        epochId: toHex(epochId),
        campaignId: toHex(campaignId),
        leaf: toHex(leaf),
        merklePath: merklePath.map(toHex),
        leafIndex,
        userSecret: toHex(userSecret),
    };
}

function computeMerkleRoot(leaf: bigint, path: bigint[], index: number): bigint {
    let node = leaf;
    for (let i = 0; i < path.length; i++) {
        const bit = (index >> i) & 1;
        if (bit === 0) {
            node = poseidon2([node, path[i]]);
        } else {
            node = poseidon2([path[i], node]);
        }
    }
    return node;
}
```

---

## CI Pipeline

```yaml
# .github/workflows/test.yml

name: Test Suite
on: [push, pull_request]

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: foundry-rs/foundry-toolchain@v1
      - run: cd contracts && forge test -vvv

  noir-circuit:
    runs-on: ubuntu-latest
    steps:
      - uses: noir-lang/noirup@v1
      - run: cd packages/crypto/noir/district_membership && nargo test

  noir-prover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: cd packages/noir-prover && npm test

  shadow-atlas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: cd packages/crypto && npm test
```

---

## Coverage Targets

| Component | Target | Current |
|-----------|--------|---------|
| Solidity contracts | >90% line | ~80% |
| NoirProver | >80% function | ~60% |
| Noir circuit | 100% constraint | 0% |
| Shadow Atlas | >70% line | ~50% |

---

## What Makes This "Distinguished"

1. **Golden vectors**: Deterministic test fixtures computed with same Poseidon2
2. **Cross-layer integration**: Proof generated in TS verified in Solidity
3. **Adversarial tests**: Invalid inputs MUST fail, not just valid inputs pass
4. **Browser reality**: E2E test in actual browser with SharedArrayBuffer
5. **CI enforcement**: No merge without green tests
