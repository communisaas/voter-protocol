# Depth Parameterization Implementation Plan

**Version:** 1.2.0
**Date:** 2026-01-25
**Status:** Draft
**Author:** Distinguished Engineer Analysis

---

## 1. Executive Summary

Support international constituencies by parameterizing Merkle tree depth across the stack.

**Validated Parameters (v1.2):** Based on comprehensive research across 20+ democracies:
- **Depth 24** supports 16.7M voters (covers Netherlands 13.4M national constituency, India Malkajgiri 3.78M + future growth)
- **24 district slots (hybrid: 20 defined + 4 overflow)** covers USA's 15-18 elected governance levels plus edge cases, special districts, and future expansion

**Key Insight:** Noir array sizes are compile-time constants. We cannot have runtime-variable depth. Instead, we compile multiple circuit variants and select at runtime.

---

## 2. Noir Circuit Parameterization

### 2.1 Why Compile-Time Only

```noir
// This is REQUIRED - Noir arrays must have compile-time known sizes
global CELL_TREE_DEPTH: u32 = 18;

fn main(
    cell_merkle_path: [Field; CELL_TREE_DEPTH],  // Size must be constant
    // ...
)
```

**Fundamental constraint:** ZK circuits have fixed constraint counts. Array sizes determine constraint count. Therefore, array sizes must be known at compile time.

### 2.2 Parameterization Strategy: Multi-Variant Compilation

```
┌─────────────────────────────────────────────────────────────┐
│                    BUILD TIME                                │
│                                                              │
│   main.nr (template)                                         │
│   global CELL_TREE_DEPTH: u32 = PLACEHOLDER;                │
│                     │                                        │
│         ┌──────────┼──────────┬──────────┐                  │
│         ▼          ▼          ▼          ▼                  │
│   sed DEPTH=18  DEPTH=20  DEPTH=22  DEPTH=24                │
│         │          │          │          │                  │
│         ▼          ▼          ▼          ▼                  │
│   nargo compile × 4                                          │
│         │          │          │          │                  │
│         ▼          ▼          ▼          ▼                  │
│   circuit_18.json  _20.json   _22.json   _24.json           │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Depth Variants Needed

| Depth | Max Leaves | Use Case | Countries |
|-------|------------|----------|-----------|
| 18 | 262K | Small constituencies (UK max: 77K, DE avg: 200K) | UK, DE, FR |
| 20 | 1M | Medium constituencies (US Congress: 760K, PK avg: 484K) | USA, PK, BD |
| 22 | 4M | Large constituencies (India Malkajgiri: 3.78M, ID: 3-4M) | IN, ID, BR |
| 24 | 16.7M | National PR systems (NL: 13.4M, IL: 10M) + future growth | NL, IL, future |

### 2.4 Constraint Count Impact

```
Per Merkle level: ~500 constraints (Poseidon2 hash)
Boundary array hash (24 elements): ~11,500 constraints  // Updated for 24 slots (hybrid)
Nullifier computation: ~500 constraints
Leaf hash: ~500 constraints

Total by depth:
  DEPTH=18: 9,000 + 12,550 = ~21,550 constraints
  DEPTH=20: 10,000 + 12,550 = ~22,550 constraints
  DEPTH=22: 11,000 + 12,550 = ~23,550 constraints
  DEPTH=24: 12,000 + 12,550 = ~24,550 constraints

Proving time impact: ~1-2s per additional depth level (mobile)
```

---

## 3. Runtime Circuit Selection

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RUNTIME                                   │
│                                                              │
│   User Registration                                          │
│   └── jurisdiction: "IN" (India)                            │
│   └── constituency_size: 3,150,000                          │
│   └── required_depth: 22                                     │
│                     │                                        │
│                     ▼                                        │
│   Session Credentials                                        │
│   └── depth: 22                                              │
│   └── merkle_path: Field[22]                                │
│                     │                                        │
│                     ▼                                        │
│   Prover (lazy load)                                         │
│   └── import(`./circuits/geographic_cell_22.json`)          │
│   └── UltraHonkBackend(circuit.bytecode)                    │
│                     │                                        │
│                     ▼                                        │
│   Proof Generation                                           │
│   └── proof includes depth indicator                         │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Prover Updates

```typescript
// packages/noir-prover/src/prover.ts

type CircuitDepth = 18 | 20 | 22 | 24;

// Lazy-loaded circuit modules
const circuitLoaders: Record<CircuitDepth, () => Promise<CompiledCircuit>> = {
  18: () => import('../circuits/geographic_cell_18.json').then(m => m.default),
  20: () => import('../circuits/geographic_cell_20.json').then(m => m.default),
  22: () => import('../circuits/geographic_cell_22.json').then(m => m.default),
  24: () => import('../circuits/geographic_cell_24.json').then(m => m.default),
};

export class NoirProver {
  private backends: Map<CircuitDepth, UltraHonkBackend> = new Map();
  private noirs: Map<CircuitDepth, Noir> = new Map();

  /**
   * Initialize prover for specific depth (lazy)
   */
  async initForDepth(depth: CircuitDepth): Promise<void> {
    if (this.backends.has(depth)) return;

    console.log(`[NoirProver] Loading circuit for depth ${depth}...`);
    const circuit = await circuitLoaders[depth]();

    const noir = new Noir(circuit);
    const backend = new UltraHonkBackend(circuit.bytecode, { threads: this.threads });

    this.noirs.set(depth, noir);
    this.backends.set(depth, backend);
  }

  /**
   * Generate proof with specified depth
   */
  async prove(inputs: CircuitInputs, depth: CircuitDepth): Promise<ProofResult> {
    await this.initForDepth(depth);

    const noir = this.noirs.get(depth)!;
    const backend = this.backends.get(depth)!;

    // Validate merkle_path length matches depth
    if (inputs.merklePath.length !== depth) {
      throw new Error(`Merkle path length ${inputs.merklePath.length} != depth ${depth}`);
    }

    const { witness } = await noir.execute(inputs);
    const { proof, publicInputs } = await backend.generateProof(witness);

    return {
      proof,
      publicInputs,
      depth,  // Include depth in result for verifier
    };
  }
}
```

### 3.3 Session Credential Updates

```typescript
interface SessionCredential {
  // ... existing fields ...

  // NEW: Depth information for circuit selection
  treeDepth: CircuitDepth;

  // Merkle path length now matches treeDepth
  merklePath: string[];  // Length = treeDepth

  // District hashes (24 slots: 20 defined + 4 overflow)
  districtHashes: string[];  // Length = 24, unused slots use EMPTY_HASH
}
```

### 3.4 Depth Selection Logic

> **Note:** For complete slot allocation documentation, see [DISTRICT-TAXONOMY.md](./DISTRICT-TAXONOMY.md).

```typescript
// packages/crypto/src/depth-selector.ts

interface JurisdictionConfig {
  country: string;
  maxConstituencySize: number;
  recommendedDepth: CircuitDepth;
}

const JURISDICTION_CONFIGS: JurisdictionConfig[] = [
  { country: 'US', maxConstituencySize: 800_000, recommendedDepth: 20 },
  { country: 'IN', maxConstituencySize: 3_200_000, recommendedDepth: 22 },
  { country: 'ID', maxConstituencySize: 2_500_000, recommendedDepth: 22 },
  { country: 'BR', maxConstituencySize: 1_500_000, recommendedDepth: 22 },
  { country: 'UK', maxConstituencySize: 100_000, recommendedDepth: 18 },
  // Default for unknown jurisdictions
  { country: '*', maxConstituencySize: 16_000_000, recommendedDepth: 24 },
];

export function selectDepthForJurisdiction(country: string): CircuitDepth {
  const config = JURISDICTION_CONFIGS.find(c => c.country === country)
    ?? JURISDICTION_CONFIGS.find(c => c.country === '*')!;
  return config.recommendedDepth;
}

export function selectDepthForSize(constituencySize: number): CircuitDepth {
  if (constituencySize <= 262_144) return 18;
  if (constituencySize <= 1_048_576) return 20;
  if (constituencySize <= 4_194_304) return 22;
  return 24;
}
```

### 3.5 Slot Allocation Rationale

**Why 24 slots?** Research across 20+ democracies revealed:
- USA has the most complex governance structure globally (15-18 elected levels)
- Need overflow capacity for edge cases and future expansion
- Must accommodate special districts (water, fire, school, transit, etc.)

**Tier Structure (20 defined + 4 overflow):**

| Tier | Slots | Purpose |
|------|-------|---------|
| **Core** | 0-6 | Federal, state, county, municipal, sub-municipal |
| **Education** | 7-9 | School districts (unified, elementary, secondary) |
| **Special-Core** | 10-12 | Water, fire/EMS, transit districts |
| **Special-Extended** | 13-16 | Utility, healthcare, parks, judicial |
| **Administrative** | 17-19 | Planning, zoning, assessment, library |
| **Overflow** | 20-23 | Reserved for edge cases and future expansion |

**Overflow Slot Usage Guidelines:**
1. Slots 20-23 are reserved for jurisdictions exceeding the standard 20-slot allocation
2. Should be used sparingly—most US addresses use only 8-12 slots
3. Typical overflow cases: addresses in multiple special districts, tribal lands with dual governance
4. Empty slots use `EMPTY_HASH` (Poseidon2 hash of zero) for consistent array sizing

---

## 4. Build Pipeline Updates

### 4.1 Updated Build Script

```bash
#!/bin/bash
# build-circuits.sh - Multi-depth compilation for geographic_cell_membership

set -e

CIRCUIT_DIR="noir/geographic_cell_membership"
CIRCUIT_SRC="${CIRCUIT_DIR}/src/main.nr"
DEPTHS=(18 20 22 24)

for depth in "${DEPTHS[@]}"; do
    echo "=== Compiling DEPTH=${depth} ==="

    # Replace depth constant
    sed -i.bak "s/global CELL_TREE_DEPTH: u32 = [0-9]*;/global CELL_TREE_DEPTH: u32 = ${depth};/" "${CIRCUIT_SRC}"

    # Compile
    (cd "${CIRCUIT_DIR}" && nargo compile)

    # Rename output
    mv "${CIRCUIT_DIR}/target/geographic_cell_membership.json" \
       "${CIRCUIT_DIR}/target/geographic_cell_18.json"

    # Generate Solidity verifier
    bb write_vk -b "${CIRCUIT_DIR}/target/geographic_cell_${depth}.json" \
                -o "${CIRCUIT_DIR}/target/vk_${depth}.bin"
    bb contract -k "${CIRCUIT_DIR}/target/vk_${depth}.bin" \
                -o "contracts/src/verifiers/GeographicCellVerifier_${depth}.sol"

    # Restore original
    mv "${CIRCUIT_SRC}.bak" "${CIRCUIT_SRC}"
done

echo "=== Build Complete ==="
ls -la "${CIRCUIT_DIR}/target/"
ls -la contracts/src/verifiers/
```

### 4.2 Package.json Scripts

```json
{
  "scripts": {
    "build:circuits": "./scripts/build-circuits.sh",
    "build:circuits:18": "DEPTHS=18 ./scripts/build-circuits.sh",
    "build:circuits:all": "DEPTHS='18 20 22 24' ./scripts/build-circuits.sh"
  }
}
```

### 4.3 CI/CD Updates

```yaml
# .github/workflows/circuits.yml
name: Circuit Build & Test

on:
  push:
    paths:
      - 'packages/crypto/noir/**'
      - 'packages/noir-prover/**'

jobs:
  build-circuits:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        depth: [18, 20, 22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: noir-lang/noirup@v0.1.0
      - name: Build circuit (depth ${{ matrix.depth }})
        run: |
          cd packages/crypto
          DEPTHS=${{ matrix.depth }} ./scripts/build-circuits.sh
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: circuit-${{ matrix.depth }}
          path: packages/crypto/noir/geographic_cell_membership/target/*.json
```

---

## 5. Smart Contract Architecture

### 5.1 Multi-Verifier Registry

```solidity
// contracts/src/GeographicCellVerifierRegistry.sol

interface IGeographicCellVerifier {
    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}

contract GeographicCellVerifierRegistry {
    mapping(uint8 => IGeographicCellVerifier) public verifiers;

    // Supported depths
    uint8[] public supportedDepths = [18, 20, 22, 24];

    constructor(
        address verifier18,
        address verifier20,
        address verifier22,
        address verifier24
    ) {
        verifiers[18] = IGeographicCellVerifier(verifier18);
        verifiers[20] = IGeographicCellVerifier(verifier20);
        verifiers[22] = IGeographicCellVerifier(verifier22);
        verifiers[24] = IGeographicCellVerifier(verifier24);
    }

    /**
     * Verify proof with depth-specific verifier
     */
    function verify(
        uint8 depth,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool) {
        IGeographicCellVerifier verifier = verifiers[depth];
        require(address(verifier) != address(0), "Unsupported depth");
        return verifier.verify(proof, publicInputs);
    }

    /**
     * Add new depth verifier (governance only)
     */
    function addVerifier(uint8 depth, address verifier) external onlyGovernance {
        verifiers[depth] = IGeographicCellVerifier(verifier);
        supportedDepths.push(depth);
    }
}
```

### 5.2 Updated NullifierRegistry

```solidity
// contracts/src/NullifierRegistry.sol

contract NullifierRegistry {
    GeographicCellVerifierRegistry public verifierRegistry;

    mapping(bytes32 => bool) public usedNullifiers;

    struct ProofRecord {
        bytes32 nullifier;
        bytes32[24] districtHashes;  // Geographic identity (24 slots: 20 defined + 4 overflow)
        uint8 depth;
        uint256 timestamp;
    }

    mapping(bytes32 => ProofRecord) public proofRecords;

    /**
     * Submit and verify geographic identity proof
     */
    function submitProof(
        uint8 depth,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external {
        // Verify with depth-specific verifier
        require(
            verifierRegistry.verify(depth, proof, publicInputs),
            "Invalid proof"
        );

        // Extract public outputs
        bytes32 nullifier = publicInputs[0];
        require(!usedNullifiers[nullifier], "Nullifier already used");

        // Extract 24 district hashes (hybrid: 20 defined + 4 overflow)
        bytes32[24] memory districtHashes;
        for (uint i = 0; i < 24; i++) {
            districtHashes[i] = publicInputs[1 + i];
        }

        // Record
        usedNullifiers[nullifier] = true;
        proofRecords[nullifier] = ProofRecord({
            nullifier: nullifier,
            districtHashes: districtHashes,
            depth: depth,
            timestamp: block.timestamp
        });

        emit ProofSubmitted(msg.sender, nullifier, depth);
    }
}
```

---

## 6. Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    USER REGISTRATION                                 │
│                                                                      │
│  1. User provides address (e.g., Mumbai, India)                     │
│  2. Backend resolves jurisdiction → country: "IN"                   │
│  3. Backend selects depth: selectDepthForJurisdiction("IN") → 22   │
│  4. Backend builds Merkle tree with depth 22                        │
│  5. Session credential includes: { depth: 22, merklePath: [...] }  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PROOF GENERATION                                  │
│                                                                      │
│  1. Frontend reads session.depth → 22                               │
│  2. Prover lazy-loads circuit_22.json                               │
│  3. Prover generates proof with 22-element merkle_path              │
│  4. Proof includes depth indicator in metadata                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    VERIFICATION                                      │
│                                                                      │
│  1. Backend receives proof + depth indicator                        │
│  2. On-chain: verifierRegistry.verify(22, proof, publicInputs)     │
│  3. Routes to GeographicCellVerifier_22 contract                    │
│  4. Verification succeeds → nullifier recorded                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Migration Strategy

### Phase 1: Build Infrastructure (Week 1)
- [ ] Create `geographic_cell_membership` circuit with CELL_TREE_DEPTH parameter
- [ ] Update build script for depths 18, 20, 22, 24
- [ ] Generate verifier contracts for each depth
- [ ] Deploy verifier registry contract

### Phase 2: Runtime Support (Week 2)
- [ ] Update NoirProver with lazy-loading multi-depth support
- [ ] Add depth to SessionCredential schema
- [ ] Implement jurisdiction → depth selection logic
- [ ] Update Communique to pass depth to prover

### Phase 3: Data Pipeline (Week 3)
- [ ] Update Shadow Atlas to track jurisdiction per cell
- [ ] Build international cell database (start with US, UK, India)
- [ ] Add depth metadata to registration flow

### Phase 4: Testing & Rollout (Week 4)
- [ ] Integration tests for all depth variants
- [ ] Performance benchmarks (proving time by depth)
- [ ] Staged rollout: US (depth 20) → UK (depth 18) → India (depth 22)

---

## 8. Open Questions

1. **Default depth:** Should unknown jurisdictions default to 24 (safe) or 20 (faster)?

2. **Depth upgrade path:** If a country's largest constituency grows, how do we migrate users to higher depth?

3. **Bundle size:** With 4 circuit variants (~25KB each), total is ~100KB. Acceptable for lazy loading?

4. **Verification key management:** Store VKs on-chain or use content-addressed storage (IPFS)?

---

## 9. Appendix: Proving Time Estimates

| Depth | Constraints | Mobile (Snapdragon 8) | Desktop (M2) |
|-------|-------------|----------------------|--------------|
| 18 | ~21,550 | ~14s | ~4s |
| 20 | ~22,550 | ~16s | ~5s |
| 22 | ~23,550 | ~18s | ~5s |
| 24 | ~24,550 | ~20s | ~6s |

**Recommendation:** Cache proofs aggressively. Proving time difference between depths is acceptable.

---

**Authors:** Claude Code (Distinguished Engineer Analysis)
**License:** MIT
