# VOTER Protocol - Smart Contracts

Solidity contracts for on-chain verification of browser-generated Halo2 zero-knowledge proofs.

## Architecture

**DistrictGate.sol** - Main verification contract
- Verifies Halo2 SHPLONK proofs (300-500k gas)
- Tracks nullifiers to prevent double-actions
- Manages Shadow Atlas Merkle root updates
- Authorizes action types (contact representative, vote, etc.)

**Halo2Verifier.sol** - ZK proof verifier
- Auto-generated from Halo2 circuit using halo2-solidity tools
- Implements BN254 pairing verification
- Validates 4 public inputs: [global_root, district_root, nullifier, action_id]
- Uses Ethereum's 141K-participant KZG ceremony (no custom trusted setup)

## Setup

### Prerequisites

```bash
# Install Foundry (Solidity development toolkit)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install OpenZeppelin contracts
forge install OpenZeppelin/openzeppelin-contracts
```

### Install Dependencies

```bash
cd contracts
forge install
```

## Development

### Build Contracts

```bash
forge build
```

### Run Tests

```bash
# Run all tests
forge test

# Run with gas reporting
forge test --gas-report

# Run specific test
forge test --match-test testVerifyValidProof

# Run with detailed output
forge test -vvv
```

### Test Coverage

```bash
forge coverage
```

Expected coverage: **>95%** (all critical paths tested)

### Gas Profiling

```bash
# Profile gas usage for single verification
forge test --match-test testGasSingleVerification -vvv

# Profile gas usage for batch verification
forge test --match-test testGasBatchVerification -vvv
```

Expected gas costs:
- **Single verification**: 300-500k gas (with real Halo2Verifier)
- **Batch verification (10 proofs)**: ~3-5M gas total (~300-500k per proof)

## Deployment

### Testnet Deployment (Scroll Sepolia)

```bash
# Set environment variables
export PRIVATE_KEY=<deployer_private_key>
export SCROLLSCAN_API_KEY=<scrollscan_api_key>

# Deploy MockHalo2Verifier (for testing before circuit is ready)
forge create src/Halo2Verifier.sol:MockHalo2Verifier \
  --rpc-url scroll_sepolia \
  --private-key $PRIVATE_KEY \
  --verify

# Deploy DistrictGate
forge create src/DistrictGate.sol:DistrictGate \
  --rpc-url scroll_sepolia \
  --private-key $PRIVATE_KEY \
  --constructor-args <SHADOW_ATLAS_ROOT> <HALO2_VERIFIER_ADDRESS> \
  --verify
```

### Mainnet Deployment (Scroll)

⚠️ **CRITICAL**: Before mainnet deployment:

1. ✅ **Generate real Halo2Verifier** from circuit (NOT MockVerifier)
2. ✅ **Complete security audit** (Trail of Bits or Kudelski Security)
3. ✅ **Deploy to testnet** and verify 100+ valid/invalid proofs
4. ✅ **Gas cost verification** (confirm 300-500k range)
5. ✅ **Governance multisig setup** for Shadow Atlas root management

```bash
# Deploy real Halo2Verifier (auto-generated from circuit)
forge create out/Halo2Verifier.sol:Halo2Verifier \
  --rpc-url scroll_mainnet \
  --private-key $PRIVATE_KEY \
  --verify

# Deploy DistrictGate
forge create src/DistrictGate.sol:DistrictGate \
  --rpc-url scroll_mainnet \
  --private-key $PRIVATE_KEY \
  --constructor-args <PRODUCTION_SHADOW_ATLAS_ROOT> <HALO2_VERIFIER_ADDRESS> \
  --verify

# Transfer ownership to governance multisig
cast send <DISTRICT_GATE_ADDRESS> \
  "transferOwnership(address)" <GOVERNANCE_MULTISIG> \
  --rpc-url scroll_mainnet \
  --private-key $PRIVATE_KEY
```

## Generating Halo2Verifier from Circuit

The `Halo2Verifier.sol` contract must be auto-generated from the Halo2 circuit:

```bash
# In the circuits directory
cd ../packages/crypto/circuits

# Build with solidity-verifier feature
cargo build --release --features solidity-verifier

# Generated verifier will be in: target/Halo2Verifier.sol
# Copy to contracts/src/
cp target/Halo2Verifier.sol ../../contracts/src/

# Deploy updated verifier
cd ../../contracts
forge build
```

⚠️ **WARNING**: The `MockHalo2Verifier` in `Halo2Verifier.sol` is **ONLY for development**.
It always returns `true` and provides **ZERO security**. Replace with real auto-generated verifier before any production use.

## Contract Addresses

### Scroll Sepolia (Testnet)
- **DistrictGate**: `<deployed_address>`
- **Halo2Verifier**: `<deployed_address>`
- **Shadow Atlas Root**: `<testnet_root>`

### Scroll Mainnet (Production)
- **DistrictGate**: `<deployed_address>`
- **Halo2Verifier**: `<deployed_address>`
- **Shadow Atlas Root**: `<production_root>`

## Usage Examples

### Verify District Membership Proof

```solidity
// User submits browser-generated proof
bytes memory proof = <halo2_proof_bytes>;
bytes32[4] memory publicInputs = [
    shadowAtlasRoot,    // Global root (current on-chain value)
    districtRoot,       // District root (e.g., CA-12)
    nullifier,          // Poseidon(identity, action_id)
    actionId            // e.g., keccak256("contact_representative")
];

// Verify proof on-chain
bool valid = districtGate.verifyDistrictMembership(proof, publicInputs);
```

### Batch Verification

```solidity
// Prepare batch
bytes[] memory proofs = new bytes[](10);
bytes32[4][] memory publicInputsArray = new bytes32[4][](10);

// ... populate arrays ...

// Batch verify (more gas-efficient)
bool[] memory results = districtGate.batchVerifyDistrictMembership(
    proofs,
    publicInputsArray
);
```

### Update Shadow Atlas Root (Governance Only)

```solidity
// Update quarterly when new voter registration data is available
bytes32 newRoot = <new_shadow_atlas_root>;
districtGate.updateShadowAtlasRoot(newRoot);
```

### Authorize New Action Type

```solidity
// Authorize a new civic action
bytes32 actionId = keccak256("vote_on_referendum");
districtGate.authorizeAction(actionId);
```

## Security Considerations

### Threat Model

1. **Forged Proofs**: Mitigated by Halo2 cryptographic soundness (2^-128 soundness error)
2. **Nullifier Replay**: Mitigated by on-chain nullifier tracking (mapping)
3. **Shadow Atlas Poisoning**: Mitigated by governance multisig + quarterly review
4. **Unauthorized Actions**: Mitigated by action whitelist (only owner can authorize)

### Audit Checklist

Before production deployment:

- [ ] **Security audit completed** (professional firm)
- [ ] **Gas costs verified** (300-500k confirmed on testnet)
- [ ] **100+ test cases passing** (valid + invalid proofs)
- [ ] **Governance multisig configured** (3/5 or 4/7 signature threshold)
- [ ] **Shadow Atlas root verified** (matches production IPFS CID)
- [ ] **Action IDs authorized** (whitelist configured)
- [ ] **Halo2Verifier auto-generated** (NOT using MockVerifier)
- [ ] **Contract ownership transferred** to governance multisig

## Gas Optimization

### Current Optimizations

1. **Immutable verifier address**: Saves ~2.1k gas per SLOAD
2. **ReentrancyGuard**: Prevents reentrancy attacks (standard security)
3. **Batch verification**: Amortizes fixed costs across multiple proofs
4. **Via IR compilation**: Enables advanced optimizer features

### Expected Gas Costs (Mainnet)

At **0.1 gwei** (typical Scroll L2 gas price):
- **300k gas**: ~$0.030 per verification
- **500k gas**: ~$0.050 per verification

Platform subsidizes gas costs (users pay $0).

### Break-Even Analysis

- **Browser-native approach**: $0/month infrastructure + ($0.030 × verifications/month)
- **TEE approach**: $150/month infrastructure + ($0.008 × verifications/month)
- **Break-even**: ~1,500 verifications/month

Browser-native wins economically beyond 1,500 monthly verifications.

## Contributing

### Code Style

Run formatter before committing:

```bash
forge fmt
```

### Testing Requirements

All PRs must:
- ✅ **Pass all tests**: `forge test`
- ✅ **Maintain >95% coverage**: `forge coverage`
- ✅ **Gas costs documented**: Include gas profiling for new functions
- ✅ **Security reviewed**: Flag any new attack vectors

## References

- **Halo2 Documentation**: https://zcash.github.io/halo2/
- **PSE Halo2 Library**: https://github.com/privacy-scaling-explorations/halo2
- **Foundry Book**: https://book.getfoundry.sh/
- **Scroll L2 Docs**: https://docs.scroll.io/
- **OpenZeppelin Contracts**: https://docs.openzeppelin.com/contracts/

## License

MIT License - See LICENSE file for details
