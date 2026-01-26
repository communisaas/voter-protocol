# VOTER Protocol Developer Guide

**For developers implementing VOTER Protocol integrations, building on the protocol, or contributing to core infrastructure.**

This guide provides practical implementation guidance for working with VOTER Protocol. For high-level architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Table of Contents

- [Quick Start](#quick-start)
- [Development Environment Setup](#development-environment-setup)
- [Smart Contract Development](#smart-contract-development)
- [Zero-Knowledge Proof Implementation](#zero-knowledge-proof-implementation)
- [Client-Side Integration](#client-side-integration)
- [Testing](#testing)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Quick Start

**Prerequisites:**
- Node.js 18+ and npm/yarn
- Foundry (for smart contracts)
- Noir toolchain (for ZK circuits)

**Clone and install:**
```bash
git clone https://github.com/voter-protocol/voter-protocol.git
cd voter-protocol
npm install
```

**Run tests:**
```bash
# Smart contracts
cd contracts
forge test

# Noir circuits
cd ../packages/crypto/noir/district_membership
nargo test

# Integration tests
npm run test:integration
```

---

## Development Environment Setup

### 1. Install Dependencies

**Smart Contract Tools:**
```bash
# Foundry (Solidity development)
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

**Zero-Knowledge Proof Tools:**
```bash
# Noir toolchain
curl -L https://noir.sh | bash
noirup

# Barretenberg proving backend
npm install -g @aztec/bb.js
```

### 2. Environment Configuration

Create `.env` file in project root:
```bash
# Scroll L2 RPC
SCROLL_RPC_URL=https://rpc.scroll.io
SCROLL_TESTNET_RPC_URL=https://sepolia-rpc.scroll.io

# Private key (for deployment only, never commit)
DEPLOYER_PRIVATE_KEY=0x...

# API keys (for development)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# AWS (for message delivery testing)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

### 3. Directory Structure

```
voter-protocol/
├── contracts/              # Solidity smart contracts
│   ├── src/
│   │   ├── DistrictGate.sol
│   │   ├── DistrictRegistry.sol
│   │   └── VOTERReputation.sol
│   ├── test/
│   └── foundry.toml
├── packages/
│   ├── crypto/            # Zero-knowledge circuits
│   │   └── noir/
│   │       └── district_membership/
│   ├── sdk/               # Client SDKs
│   └── shadow-atlas/      # Global boundary data
└── docs/                  # Documentation
```

---

## Smart Contract Development

### Contract Architecture

VOTER Protocol uses three core contracts on Scroll L2:

1. **DistrictRegistry.sol** - Maps district roots to countries (governance-controlled)
2. **DistrictGate.sol** - Verifies ZK proofs and authorizes actions
3. **VOTERReputation.sol** - Tracks domain-specific reputation (ERC-8004)

### Deploy Smart Contracts

**1. Compile contracts:**
```bash
cd contracts
forge build
```

**2. Deploy to Scroll Sepolia (testnet):**
```bash
forge script script/Deploy.s.sol \
  --rpc-url $SCROLL_TESTNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast
```

**3. Deploy to Scroll Mainnet:**
```bash
# IMPORTANT: Audit contracts before mainnet deployment
forge script script/Deploy.s.sol \
  --rpc-url $SCROLL_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify
```

### Key Contract Interactions

**Register a district (governance only):**
```solidity
// DistrictRegistry.sol
function registerDistrict(bytes32 districtRoot, bytes3 country) external onlyGovernance {
    require(districtToCountry[districtRoot] == bytes3(0), "Already registered");
    districtToCountry[districtRoot] = country;
    emit DistrictRegistered(districtRoot, country, block.timestamp);
}
```

**Verify district membership:**
```solidity
// DistrictGate.sol
function verifyAndAuthorize(
    bytes calldata proof,
    bytes32 districtRoot,
    bytes32 nullifier,
    bytes32 actionId,
    bytes3 expectedCountry
) external {
    // Step 1: Verify ZK proof
    uint256[3] memory publicInputs = [uint256(districtRoot), uint256(nullifier), uint256(actionId)];
    (bool success, bytes memory result) = verifier.call(
        abi.encodeWithSignature("verifyProof(bytes,uint256[3])", proof, publicInputs)
    );
    require(success && abi.decode(result, (bool)), "ZK proof verification failed");

    // Step 2: Check district→country mapping
    bytes3 actualCountry = registry.getCountry(districtRoot);
    require(actualCountry == expectedCountry, "Unauthorized district");

    // Step 3: Prevent double-voting
    require(!nullifierUsed[nullifier], "Nullifier already used");
    nullifierUsed[nullifier] = true;

    emit ActionVerified(msg.sender, districtRoot, actualCountry, nullifier, actionId);
}
```

**Update reputation:**
```solidity
// VOTERReputation.sol
function updateReputation(
    address actor,
    bytes32 domain,
    int256 delta,
    bytes calldata proof
) external onlyAuthorizedAgents {
    DomainScore storage score = reputation[actor][domain];

    // Apply time decay
    uint256 elapsed = block.timestamp - score.lastUpdate;
    uint256 decayed = (score.score * score.decayRate * elapsed) / 365 days;
    score.score -= decayed;

    // Apply delta
    if (delta > 0) {
        score.score += uint256(delta);
    } else {
        score.score -= uint256(-delta);
    }

    score.lastUpdate = block.timestamp;
}
```

---

## Zero-Knowledge Proof Implementation

### Noir Circuit Development

**Location:** `packages/crypto/noir/district_membership/`

**Circuit structure:**
```rust
// src/main.nr
use dep::std;

fn main(
    // Private inputs (never revealed)
    merkle_root: Field,
    leaf: Field,
    merkle_path: [Field; 14],
    leaf_index: Field,
    user_secret: Field,

    // Public inputs (verified on-chain)
    nullifier: pub Field,
    authority_hash: pub Field,
    epoch_id: pub Field,
    campaign_id: pub Field
) {
    // 1. Verify Merkle tree membership
    let computed_root = compute_merkle_root(leaf, merkle_path, leaf_index);
    assert(computed_root == merkle_root);

    // 2. Verify nullifier derivation (prevents double-voting)
    let computed_nullifier = poseidon::hash([user_secret, campaign_id]);
    assert(computed_nullifier == nullifier);

    // 3. Verify authority commitment
    let computed_authority = poseidon::hash([merkle_root, epoch_id]);
    assert(computed_authority == authority_hash);
}

// Helper: Compute Merkle root from leaf and path
fn compute_merkle_root(
    leaf: Field,
    path: [Field; 14],
    index: Field
) -> Field {
    let mut current = leaf;
    let mut idx = index;

    for i in 0..14 {
        let is_right = idx & 1;
        if is_right == 1 {
            current = poseidon::hash([path[i], current]);
        } else {
            current = poseidon::hash([current, path[i]]);
        }
        idx = idx >> 1;
    }

    current
}
```

### Compile Circuit

```bash
cd packages/crypto/noir/district_membership

# Compile Noir circuit to ACIR
nargo compile

# Generate verification key
bb write_vk -b target/district_membership.json -o vk

# Generate Solidity verifier (optional, for on-chain deployment)
bb write_solidity_verifier -k vk -o Verifier.sol
```

**Outputs:**
- `target/district_membership.json` (ACIR bytecode)
- `vk` (verification key)
- `Verifier.sol` (on-chain verifier contract)

### Browser-Native Proving

**Client implementation:**
```typescript
import { Barretenberg } from '@voter-protocol/bb.js';
import { Noir } from '@noir-lang/noir_js';
import circuitJson from './district_membership.json';

class NoirProver {
    private api: Barretenberg | null = null;
    private noir: Noir | null = null;
    private bytecode: Uint8Array | null = null;
    private provingKey: Uint8Array | null = null;

    // Initialize Barretenberg backend + Noir witness generator
    async init(): Promise<void> {
        this.api = await Barretenberg.new();
        this.noir = new Noir(circuitJson);

        // Decompress circuit bytecode
        const bytecodeBuffer = Uint8Array.from(atob(circuitJson.bytecode), c => c.charCodeAt(0));
        this.bytecode = inflate(bytecodeBuffer);
    }

    // Pre-warm prover by generating proving key
    async warmup(): Promise<void> {
        await this.init();
        const result = await this.api!.acirGetProvingKey({
            circuit: { name: 'district_membership', bytecode: this.bytecode! },
            settings: { ipaAccumulation: false, oracleHashType: 'poseidon', disableZk: false }
        });
        this.provingKey = result.provingKey;
    }

    // Generate ZK proof for district membership
    async prove(inputs: CircuitInputs): Promise<ProofResult> {
        await this.warmup();

        // 1. Generate witness from circuit inputs
        const noirInputs = {
            merkle_root: inputs.merkleRoot,
            nullifier: inputs.nullifier,
            authority_hash: inputs.authorityHash,
            epoch_id: inputs.epochId,
            campaign_id: inputs.campaignId,
            leaf: inputs.leaf,
            merkle_path: inputs.merklePath,
            leaf_index: inputs.leafIndex,
            user_secret: inputs.userSecret,
        };
        let { witness } = await this.noir!.execute(noirInputs);

        // 2. Generate UltraPlonk proof with Barretenberg
        const result = await this.api!.acirProveWithPk({
            circuit: { name: 'district_membership', bytecode: this.bytecode! },
            witness,
            provingKey: this.provingKey!,
            settings: { ipaAccumulation: false, oracleHashType: 'poseidon', disableZk: false }
        });

        return { proof: result.proof, publicInputs: { ... } };
    }
}
```

---

## Client-Side Integration

### SDK Usage (Wallets/Dapps)

```typescript
import { VOTERClient } from '@voter-protocol/sdk';

const client = new VOTERClient({
  network: 'scroll-mainnet',
  walletProvider: window.ethereum
});

// Generate district proof
const proof = await client.generateDistrictProof({
  address: userAddress,
  district: 'TX-18'
});

// Submit template action
const tx = await client.submitTemplate({
  templateId: '0xabc...',
  customization: 'My personal story...',
  proof: proof
});

// Check reputation
const rep = await client.getReputation(wallet, 'healthcare');
console.log(`Healthcare reputation: ${rep.score}`);
```

### Congressional Office Integration

```typescript
import { CongressionalDashboard } from '@voter-protocol/congressional-sdk';

const dashboard = new CongressionalDashboard({
  officeId: 'TX-18',
  apiKey: process.env.CONGRESSIONAL_API_KEY
});

// Fetch verified messages
const messages = await dashboard.getMessages({
  minReputation: 5000,
  domain: 'healthcare',
  verifiedOnly: true
});

// Each message includes:
// - district: 'TX-18' (verified via ZK proof)
// - reputation: 8500 (on-chain score)
// - challengeStatus: 'survived 3 challenges'
// - impactHistory: 'previous templates correlated with 2 bills'
```

---

## Testing

### Run Smart Contract Tests

```bash
cd contracts

# Run all tests
forge test

# Run specific test
forge test --match-test testDistrictVerification

# Run with gas reporting
forge test --gas-report

# Run with verbosity (show logs)
forge test -vvv
```

### Run ZK Circuit Tests

```bash
cd packages/crypto/noir/district_membership

# Run circuit tests
nargo test

# Run with witness generation
nargo test --show-output
```

### Integration Tests

```bash
# Full end-to-end test (browser + contracts + backend)
npm run test:integration

# Specific flow
npm run test:integration -- --testNamePattern="district proof generation"
```

---

## Deployment

### Deploy to Scroll L2

**1. Testnet deployment:**
```bash
cd contracts

# Deploy contracts
forge script script/Deploy.s.sol \
  --rpc-url $SCROLL_TESTNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# Verify on Scrollscan
forge verify-contract \
  --chain-id 534351 \
  --compiler-version v0.8.20 \
  <CONTRACT_ADDRESS> \
  src/DistrictGate.sol:DistrictGate \
  --etherscan-api-key $SCROLLSCAN_API_KEY
```

**2. Mainnet deployment:**
```bash
# IMPORTANT: Run security audit before mainnet
forge script script/Deploy.s.sol \
  --rpc-url $SCROLL_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast \
  --verify
```

### Update Verifier Contract

**When circuit changes:**
```bash
cd packages/crypto/noir/district_membership

# 1. Compile circuit
nargo compile

# 2. Generate verification key
bb write_vk -b target/district_membership.json -o vk

# 3. Generate Solidity verifier
bb write_solidity_verifier -k vk -o Verifier.sol

# 4. Deploy new verifier
cd ../../../contracts
forge script script/UpdateVerifier.s.sol --broadcast
```

**CRITICAL:** Stale verifier = silent verification failures. Always regenerate after circuit changes.

---

## API Reference

### Smart Contracts

**DistrictRegistry.sol**
```solidity
// Register district (governance only)
function registerDistrict(bytes32 districtRoot, bytes3 country) external onlyGovernance

// Get country for district
function getCountry(bytes32 districtRoot) external view returns (bytes3)
```

**DistrictGate.sol**
```solidity
// Verify proof and authorize action
function verifyAndAuthorize(
    bytes calldata proof,
    bytes32 districtRoot,
    bytes32 nullifier,
    bytes32 actionId,
    bytes3 expectedCountry
) external
```

**VOTERReputation.sol**
```solidity
// Update reputation (authorized agents only)
function updateReputation(
    address actor,
    bytes32 domain,
    int256 delta,
    bytes calldata proof
) external onlyAuthorizedAgents

// Get reputation score
function getReputation(address actor, bytes32 domain) external view returns (uint256)
```

### Client SDK

**VOTERClient**
```typescript
// Initialize client
constructor(config: { network: string, walletProvider: any })

// Generate district proof
generateDistrictProof(params: { address: string, district: string }): Promise<Proof>

// Submit template
submitTemplate(params: { templateId: string, customization: string, proof: Proof }): Promise<Transaction>

// Get reputation
getReputation(wallet: string, domain: string): Promise<ReputationScore>
```

---

## Troubleshooting

### Common Issues

**1. Circuit compilation fails**

```bash
Error: Cannot find module 'dep::std'
```

**Solution:** Install Noir standard library:
```bash
nargo add std
```

---

**2. Proof verification fails on-chain**

```
Error: ZK proof verification failed
```

**Solution:** Ensure verifier contract matches circuit:
```bash
# Regenerate verifier
cd packages/crypto/noir/district_membership
nargo compile
bb write_vk -b target/district_membership.json -o vk
bb write_solidity_verifier -k vk -o Verifier.sol

# Redeploy verifier
cd ../../contracts
forge script script/UpdateVerifier.s.sol --broadcast
```

---

**3. Browser proving too slow**

```
Proof generation: 30+ seconds on mobile
```

**Solution:** Check for SharedArrayBuffer support:
```typescript
if (!crossOriginIsolated) {
    console.warn('SharedArrayBuffer not available - proving will be slower');
    console.warn('Ensure COOP/COEP headers are set correctly');
}
```

Add headers to web server:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

---

**4. Gas estimation fails**

```
Error: Transaction reverted without a reason string
```

**Solution:** Check district registration:
```typescript
// Ensure district is registered before proof verification
const isRegistered = await districtRegistry.getCountry(districtRoot);
if (isRegistered === '0x000000') {
    throw new Error('District not registered - contact governance');
}
```

---

**5. Shadow Atlas tree not found**

```
Error: Boundary tree not found for district TX-18
```

**Solution:** Download latest Shadow Atlas data:
```bash
cd packages/shadow-atlas
npm run download-latest

# Or specific district
npm run download-district -- --district TX-18
```

---

## Contributing

### Development Workflow

1. **Fork repository**
2. **Create feature branch:** `git checkout -b feature/your-feature`
3. **Write tests first** (TDD approach)
4. **Implement feature**
5. **Run full test suite:** `npm test`
6. **Open pull request** with description and test results

### Code Standards

- **Solidity:** Follow OpenZeppelin style guide
- **TypeScript:** Use ESLint config in `.eslintrc.json`
- **Noir:** Follow Aztec circuit conventions
- **Commits:** Conventional commits (feat:, fix:, docs:, etc.)

### Bug Bounties

- **Critical:** $100k - $500k (treasury drain, privacy break)
- **High:** $10k - $50k (reputation manipulation, oracle exploits)
- **Medium:** $1k - $10k (DoS, gas griefing)

Report vulnerabilities: security@voter-protocol.org

---

## Additional Resources

- **Architecture Overview:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Noir Circuit Spec:** [docs/specs/NOIR-CIRCUIT-SPEC.md](docs/specs/NOIR-CIRCUIT-SPEC.md)
- **Shadow Atlas Spec:** [packages/shadow-atlas/docs/specs/MERKLE-FOREST-SPEC.md](packages/shadow-atlas/docs/specs/MERKLE-FOREST-SPEC.md)
- **API Documentation:** [docs/api/](docs/api/)

**Questions?** Join our [Discord](https://discord.gg/voter-protocol) or email [dev@voter-protocol.org](mailto:dev@voter-protocol.org)
