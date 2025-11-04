# Halo2Verifier Deployment Information

**Generation Date**: 2025-11-02 11:16 UTC
**Circuit**: District Membership (Single-Tier K=14)
**K**: 14
**Public Outputs**: 3 (district_root, nullifier, action_id)
**Commitment Scheme**: SHPLONK + KZG on BN256
**Verifying Key Hash**: 7ac831b0b5a059e4

## Architecture (2025-10-28)

**Current**: Single-tier K=14 (~12-16KB verifier, 8-15s mobile proving)
**Security model**: ZK proof + on-chain DistrictRegistry.sol
**Advantage**: Fits EIP-170 limit, deployable to any EVM chain

## Bytecode

**File**: `Halo2Verifier.bytecode`
**Size**: 20143 bytes
**Format**: EVM deployment bytecode
**EIP-170 limit**: 24,576 bytes (24KB)

## Deployment

This bytecode can be deployed directly to Ethereum/Scroll:

```bash
# Using cast (Foundry)
cast send --create $(cat contracts/src/Halo2Verifier.bytecode)

# Or deploy via Solidity wrapper (recommended)
# See contracts/src/Halo2VerifierWrapper.sol
```

## Integration

The deployed verifier contract expects:
- **Function signature**: `function verify(bytes calldata proof, uint256[3] calldata publicInputs) external view returns (bool)`
- **Public inputs order**: [district_root, nullifier, action_id]
- **Proof format**: SHPLONK proof bytes (384-512 bytes)

### Two-Step Verification Flow

```solidity
// Step 1: Verify ZK proof (district membership + nullifier)
bool valid = halo2Verifier.verify(proof, [districtRoot, nullifier, actionId]);

// Step 2: Verify district→country mapping (on-chain registry)
bytes3 country = districtRegistry.getCountry(districtRoot);
require(country == expectedCountry, "Unauthorized district");
```

## Gas Costs

Expected verification gas cost: **300-400k gas**

This includes:
- BN256 pairing operations (~250k gas)
- Polynomial commitment opening verification (SHPLONK)
- Public input validation (3 field elements)
- Fewer columns than two-tier (6-8 vs 12) reduces commitment overhead

On-chain registry lookup adds ~2.1k gas (SLOAD operation)

## Security

**Verifying Key Hash**: 7ac831b0b5a059e4

This hash identifies the exact circuit configuration. Any change to:
- Circuit structure
- Public output count/order
- KZG parameters
- Commitment scheme

...will produce a different verifying key hash.

**Audit Status**:
- halo2-lib: Trail of Bits audited (2023-08-15)
- snark-verifier: Trail of Bits audited (2024-06-05)
- Circuit: Internal Brutalist audit complete (2025-10-26)
- External audit: Pending (Week 4-6)

## Regeneration

To regenerate this verifier:

```bash
cd packages/crypto/circuits
cargo run --bin generate_verifier --release
```

**WARNING**: Only regenerate if circuit structure changes. Changing the verifier
requires redeploying contracts and updating all integration points.
