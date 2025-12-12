# VOTER Protocol - Smart Contracts

Solidity contracts for on-chain verification of browser-generated Noir/Barretenberg zero-knowledge proofs.

## Architecture

**DistrictGate.sol** - Main verification contract
- Verifies UltraPlonk proofs via pluggable verifier (300-500k gas)
- Tracks nullifiers to prevent double-actions
- Manages Shadow Atlas Merkle root updates
- **Permissionless actions**: Any `bytes32` actionId is valid (no authorization required)
- EIP-712 signatures for MEV protection
- TimelockGovernance (Phase 1): 7-day governance transfer, 14-day verifier upgrade timelocks

**DistrictRegistry.sol** - District management
- Maps district roots to countries
- Governance-controlled with 7-day timelock

**NullifierRegistry.sol** - Double-action prevention
- Records nullifiers per action namespace
- Rate limiting (60s between actions per user)
- Authorized caller pattern for DistrictGate integration

**TimelockGovernance.sol** - Phase 1 governance
- 7-day governance transfer timelock
- 14-day verifier upgrade timelock
- Community detection window for malicious changes

**GuardianShield.sol** - Phase 2 nation-state resistance (planned)
- Multi-jurisdiction guardian veto power
- Single guardian veto blocks malicious transfers
- Requires recruiting real human guardians across jurisdictions

### What Contracts Verify (and Don't)

**Contracts verify:**
- ZK proofs of district membership (UltraPlonkVerifier.sol)
- Nullifier uniqueness (one action per user per campaign)
- District-to-country mappings (DistrictRegistry.sol)

**Contracts do NOT handle:**
- User's street address (never touches chain - stays in browser)
- Identity verification (Phase 2, application layer via self.xyz/Didit.me)
- Message content (separate system via AWS Nitro Enclaves)

Smart contracts are the trustless verification layer. Identity and message delivery happen off-chain.

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
```

Expected gas costs:
- **Single verification**: 300-500k gas (with real verifier)
- **Fee (Scroll mainnet)**: ~$0.0047-$0.0511 per verification

## Deployment

### Testnet Deployment (Scroll Sepolia)

```bash
# Set environment variables
export PRIVATE_KEY=<deployer_private_key>
export SCROLLSCAN_API_KEY=<scrollscan_api_key>

# Deploy using script
forge script script/DeployScrollSepolia.s.sol:DeployScrollSepolia \
  --rpc-url scroll_sepolia \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

### Mainnet Deployment (Scroll)

Before mainnet deployment:

1. **Generate real verifier** from Noir circuit (NOT MockVerifier)
2. **Complete security audit** (professional firm)
3. **Deploy to testnet** and verify 100+ valid/invalid proofs
4. **Gas cost verification** (confirm 300-500k range)
5. **Governance multisig setup** for administration
6. **Guardian setup** (min 2 guardians in different jurisdictions)

## Contract Addresses

### Scroll Sepolia (Testnet)
- **DistrictGate**: `<deployed_address>`
- **DistrictRegistry**: `<deployed_address>`
- **NullifierRegistry**: `<deployed_address>`
- **UltraPlonkVerifier**: `<deployed_address>`

### Scroll Mainnet (Production)
- **DistrictGate**: `<deployed_address>`
- **DistrictRegistry**: `<deployed_address>`
- **NullifierRegistry**: `<deployed_address>`
- **UltraPlonkVerifier**: `<deployed_address>`

## Usage Examples

### Verify District Membership Proof

```solidity
// User submits browser-generated proof with EIP-712 signature
bytes memory proof = <noir_proof_bytes>;
bytes32 districtRoot = <merkle_root>;
bytes32 nullifier = <poseidon_nullifier>;
bytes32 actionId = keccak256("contact_representative"); // Any actionId works
bytes3 country = "USA";

// Generate EIP-712 signature off-chain
bytes memory signature = <user_signature>;
uint256 deadline = block.timestamp + 1 hours;

// Verify proof on-chain (signer gets credit, not submitter - MEV resistant)
districtGate.verifyAndAuthorizeWithSignature(
    signer,
    proof,
    districtRoot,
    nullifier,
    actionId,
    country,
    deadline,
    signature
);
```

### Permissionless Actions

Actions are **permissionless** - any `bytes32` can be used as an actionId:

```solidity
// These all work without pre-authorization:
bytes32 actionId1 = keccak256("contact_representative");
bytes32 actionId2 = keccak256(abi.encodePacked(templateId)); // Hash of template
bytes32 actionId3 = bytes32(campaignId); // Direct campaign identifier

// Spam mitigation is handled by:
// 1. Rate limits (60s between actions per user)
// 2. Gas costs (~$0.003-0.05 per tx)
// 3. ZK proof generation time (8-15s in browser)
```

### Check Verification Status

```solidity
// Check if nullifier was used for an action
bool used = districtGate.isNullifierUsed(actionId, nullifier);

// Get participant count for an action
uint256 count = districtGate.getParticipantCount(actionId);
```

## Security Considerations

### Threat Model

1. **Forged Proofs**: Mitigated by UltraPlonk cryptographic soundness
2. **Nullifier Replay**: Mitigated by on-chain nullifier tracking
3. **Shadow Atlas Poisoning**: Mitigated by governance multisig + quarterly review
4. **MEV Attacks**: Mitigated by EIP-712 signatures binding rewards to signer
5. **Nation-State Coercion**: Phase 1 uses TimelockGovernance (7-day detection window). Phase 2 adds GuardianShield (multi-jurisdiction veto)
6. **Spam Actions**: Mitigated by rate limits + gas costs + proof generation time

### Permissionless Security Model

Actions are permissionless because:
- **Economic spam resistance**: Gas costs + rate limits make spam expensive
- **Proof generation barrier**: 8-15 seconds per proof prevents mass generation
- **Nullifier uniqueness**: Same person can't act twice on same action
- **District verification**: Only valid district members can participate

No authorization bottleneck means:
- Protocol works on deployment (no bootstrap problem)
- Templates can be created permissionlessly (Communique integration)
- New action types don't require governance votes

### Audit Checklist

Before production deployment:

- [ ] **Security audit completed** (professional firm)
- [ ] **Gas costs verified** (300-500k confirmed on testnet)
- [ ] **100+ test cases passing** (valid + invalid proofs)
- [ ] **Governance multisig configured** (3/5 or 4/7 signature threshold)
- [ ] **Guardians configured** (Phase 2: min 2, different legal jurisdictions)
- [ ] **Shadow Atlas root verified** (matches production IPFS CID)
- [ ] **Verifier auto-generated** (NOT using MockVerifier)
- [ ] **Contract ownership transferred** to governance multisig

## Gas Optimization

### Current Optimizations

1. **Immutable registry addresses**: Saves ~2.1k gas per SLOAD
2. **ReentrancyGuard**: Prevents reentrancy attacks (standard security)
3. **Via IR compilation**: Enables advanced optimizer features

### Expected Gas Costs (Mainnet)

At typical Scroll L2 gas prices:
- **Single verification**: ~$0.0047-$0.0511 per verification

Platform subsidizes gas costs (users pay $0).

## Contributing

### Code Style

Run formatter before committing:

```bash
forge fmt
```

### Testing Requirements

All PRs must:
- Pass all tests: `forge test`
- Maintain >95% coverage: `forge coverage`
- Gas costs documented: Include gas profiling for new functions
- Security reviewed: Flag any new attack vectors

## References

- **Noir Documentation**: https://noir-lang.org/
- **Barretenberg**: https://github.com/AztecProtocol/barretenberg
- **Foundry Book**: https://book.getfoundry.sh/
- **Scroll L2 Docs**: https://docs.scroll.io/
- **OpenZeppelin Contracts**: https://docs.openzeppelin.com/contracts/

## License

MIT License - See LICENSE file for details
