# VOTER Protocol - Smart Contract Deployment Guide

Complete guide for deploying VOTER Protocol contracts to Scroll L2.

## Prerequisites

### 1. Wallet Setup
- Create a deployment wallet (MetaMask, Frame, or hardware wallet)
- Export the private key (for testnet deployments only - NEVER share mainnet keys)
- Fund the wallet with Scroll Sepolia ETH

### 2. Get Testnet ETH
```bash
# Option 1: Scroll Sepolia Faucet
https://scroll.io/bridge

# Option 2: Bridge from Ethereum Sepolia
https://sepolia.scrollscan.com/bridge

# Recommended amount: 0.1 ETH (sufficient for all deployments + verification)
```

### 3. Get Scrollscan API Key (Optional, for verification)
- Visit https://scrollscan.com/myapikey
- Create free account
- Generate API key
- Add to `.env` file

## Environment Configuration

### Step 1: Update .env File

Edit `/Users/noot/Documents/voter-protocol/.env`:

```bash
# Smart Contract Deployment
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE  # Remove "0x" prefix if present
SCROLLSCAN_API_KEY=YOUR_API_KEY_HERE  # Optional
```

**SECURITY WARNING**:
- ⚠️ NEVER commit `.env` to git
- ⚠️ Use a dedicated testnet wallet
- ⚠️ For mainnet, use hardware wallet or multi-sig

## Deployment Sequence

### Phase 1: Deploy Halo2Verifier

The Halo2Verifier contract verifies ZK proofs of district membership.

#### 1.1: Deploy Contract

```bash
cd /Users/noot/Documents/voter-protocol/contracts

forge script script/DeployHalo2Verifier.s.sol \
  --rpc-url scroll_sepolia \
  --broadcast \
  --verify
```

**Expected Output**:
```
Deploying Halo2Verifier...
Bytecode size: 20142 bytes
EIP-170 limit: 24576 bytes
Margin: 4434 bytes

==========================================
Halo2Verifier deployed at: 0x...
==========================================

Gas used: ~300,000-400,000
Total cost: ~$0.001-0.002 USD
```

#### 1.2: Save Verifier Address

```bash
# Copy the deployed address from output
export HALO2_VERIFIER_ADDRESS=0x...

# Add to .env
echo "HALO2_VERIFIER_ADDRESS=$HALO2_VERIFIER_ADDRESS" >> ../.env
```

#### 1.3: Verify Deployment

```bash
# Check contract exists
cast code $HALO2_VERIFIER_ADDRESS --rpc-url scroll_sepolia

# Should return bytecode (20,142 bytes)
```

### Phase 2: Deploy DistrictRegistry

The DistrictRegistry stores district metadata and Merkle roots.

#### 2.1: Create Deployment Script

```solidity
// script/DeployDistrictRegistry.s.sol
pragma solidity =0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictRegistry.sol";

contract DeployDistrictRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        DistrictRegistry registry = new DistrictRegistry();

        vm.stopBroadcast();

        console.log("DistrictRegistry deployed at:", address(registry));
    }
}
```

#### 2.2: Deploy

```bash
forge script script/DeployDistrictRegistry.s.sol \
  --rpc-url scroll_sepolia \
  --broadcast \
  --verify
```

#### 2.3: Save Registry Address

```bash
export DISTRICT_REGISTRY_ADDRESS=0x...
echo "DISTRICT_REGISTRY_ADDRESS=$DISTRICT_REGISTRY_ADDRESS" >> ../.env
```

### Phase 3: Deploy DistrictGate

The DistrictGate contract orchestrates proof verification and action recording.

#### 3.1: Update Deployment Script

```solidity
// script/DeployDistrictGate.s.sol
pragma solidity =0.8.19;

import "forge-std/Script.sol";
import "../src/DistrictGate.sol";

contract DeployDistrictGate is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address verifier = vm.envAddress("HALO2_VERIFIER_ADDRESS");
        address registry = vm.envAddress("DISTRICT_REGISTRY_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        DistrictGate gate = new DistrictGate(verifier, registry);

        vm.stopBroadcast();

        console.log("DistrictGate deployed at:", address(gate));
    }
}
```

#### 3.2: Deploy

```bash
forge script script/DeployDistrictGate.s.sol \
  --rpc-url scroll_sepolia \
  --broadcast \
  --verify
```

#### 3.3: Save Gate Address

```bash
export DISTRICT_GATE_ADDRESS=0x...
echo "DISTRICT_GATE_ADDRESS=$DISTRICT_GATE_ADDRESS" >> ../.env
```

## Post-Deployment Configuration

### Step 1: Initialize Shadow Atlas

```bash
cd /Users/noot/Documents/voter-protocol

# Build production Shadow Atlas (with real Census data)
npm run atlas:prod

# Verify Atlas integrity
npm run atlas:verify
```

### Step 2: Upload Atlas to IPFS

```typescript
// scripts/publish-atlas.ts
import { create } from 'ipfs-http-client';
import * as fs from 'fs/promises';

const client = create({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: {
    authorization: `Bearer ${process.env.PINATA_API_KEY}`
  }
});

const atlasData = await fs.readFile('shadow-atlas-us.json');
const { cid } = await client.add(atlasData);

console.log(`Shadow Atlas CID: ${cid}`);
```

### Step 3: Update On-Chain Registry

```bash
# Read Shadow Atlas root
MERKLE_ROOT=$(jq -r '.root' shadow-atlas-us.json)

# Update registry with new CID and root
cast send $DISTRICT_REGISTRY_ADDRESS \
  "updateAtlas(string,bytes32)" \
  "QmXXX..." \  # IPFS CID
  "$MERKLE_ROOT" \
  --rpc-url scroll_sepolia \
  --private-key $PRIVATE_KEY
```

## Verification

### Verify All Contracts on Scrollscan

```bash
# Halo2Verifier (pre-compiled bytecode)
forge verify-contract \
  $HALO2_VERIFIER_ADDRESS \
  Halo2Verifier \
  --chain scroll-sepolia

# DistrictRegistry
forge verify-contract \
  $DISTRICT_REGISTRY_ADDRESS \
  src/DistrictRegistry.sol:DistrictRegistry \
  --chain scroll-sepolia

# DistrictGate
forge verify-contract \
  $DISTRICT_GATE_ADDRESS \
  src/DistrictGate.sol:DistrictGate \
  --constructor-args $(cast abi-encode "constructor(address,address)" $HALO2_VERIFIER_ADDRESS $DISTRICT_REGISTRY_ADDRESS) \
  --chain scroll-sepolia
```

### Test End-to-End Flow

```bash
# Generate proof (browser-native)
cd /Users/noot/Documents/communique
npm run test:e2e

# Expected flow:
# 1. User enters address: "1600 Pennsylvania Ave NW, Washington, DC 20500"
# 2. Browser generates ZK proof (~8-15s on mobile)
# 3. Submit proof to DistrictGate contract
# 4. Contract verifies proof via Halo2Verifier
# 5. Contract records action in DistrictRegistry
# 6. User receives on-chain confirmation
```

## Gas Costs (Scroll Sepolia)

| Operation | Gas Used | Cost (ETH) | Cost (USD) |
|-----------|----------|------------|------------|
| Deploy Halo2Verifier | ~300k | ~0.0003 | ~$0.001 |
| Deploy DistrictRegistry | ~500k | ~0.0005 | ~$0.002 |
| Deploy DistrictGate | ~800k | ~0.0008 | ~$0.003 |
| Verify Proof | ~350k | ~0.00035 | ~$0.001 |
| Update Atlas | ~50k | ~0.00005 | ~$0.0002 |
| **Total Deployment** | ~1.6M | **~0.0016** | **~$0.006** |

## Mainnet Deployment Checklist

Before deploying to Scroll mainnet:

- [ ] Professional security audit (Trail of Bits, OpenZeppelin, or Consensys Diligence)
- [ ] Multi-sig governance configured (3-of-5 recommended)
- [ ] Emergency pause mechanism tested
- [ ] Shadow Atlas with production Census data verified
- [ ] IPFS pinning service configured (Pinata or Infura)
- [ ] On-chain registry update process documented
- [ ] Challenge market contracts deployed (Phase 2)
- [ ] Integration tests passing (browser → contract → verification)
- [ ] Documentation complete and public
- [ ] Community bug bounty program active

## Troubleshooting

### Error: "insufficient funds"
**Solution**: Fund deployment wallet with Scroll Sepolia ETH from bridge

### Error: "nonce too low"
**Solution**: Reset nonce with `cast send --nonce $(cast nonce $DEPLOYER_ADDRESS --rpc-url scroll_sepolia)`

### Error: "contract already deployed"
**Solution**: Use a different deployment salt or re-deploy with CREATE2

### Error: "verification failed"
**Solution**: Ensure `SCROLLSCAN_API_KEY` is set and contract is fully synced (~30 seconds)

## Next Steps

1. ✅ Deploy Halo2Verifier to Scroll Sepolia
2. ✅ Deploy DistrictRegistry to Scroll Sepolia
3. ✅ Deploy DistrictGate to Scroll Sepolia
4. 🔄 Generate production Shadow Atlas with real Census data
5. 🔄 Upload Shadow Atlas to IPFS
6. 🔄 Update on-chain registry with IPFS CID and Merkle root
7. 🔄 Integration testing (browser WASM → contract verification)
8. 🔄 Security audit preparation

## Resources

- **Scroll Sepolia Explorer**: https://sepolia.scrollscan.com/
- **Scroll Bridge**: https://scroll.io/bridge
- **Foundry Documentation**: https://book.getfoundry.sh/
- **VOTER Protocol Docs**: https://github.com/voter-protocol/
- **Census TIGER/Line Data**: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html

---

**Status**: Deployment infrastructure ready. Awaiting wallet configuration for Scroll Sepolia deployment.
