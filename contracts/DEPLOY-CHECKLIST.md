# Scroll Mainnet Deployment Checklist

## Prerequisites

- [ ] `PRIVATE_KEY` set (deployer wallet with ETH on Scroll mainnet)
- [ ] `GOVERNANCE_ADDRESS` set (or defaults to deployer address)
- [ ] `ETHERSCAN_API_KEY` set (for Scrollscan contract verification)
- [ ] Foundry installed: `forge --version` shows 1.4.3+
- [ ] Verifier contracts compiled: `FOUNDRY_PROFILE=verifiers forge build`
- [ ] Protocol contracts compiled: `forge build`
- [ ] All tests pass: `forge test`

## Step 1: Deploy Three-Tree Verifier Contracts (Primary)

```bash
cd contracts
PRIVATE_KEY=0x... ./script/deploy-verifiers.sh --network mainnet --depths "18 20 22 24" --tree three
```

Outputs: `deployed-verifiers.json` with three-tree verifier addresses per depth.

## Step 1b: Deploy Two-Tree Verifier Contracts (Legacy)

> **Note:** Two-tree verification is deprecated. Deploy only if backward compatibility
> with existing two-tree proofs is required during the migration period.

```bash
PRIVATE_KEY=0x... ./script/deploy-verifiers.sh --network mainnet --depths "18 20 22 24"
```

## Step 2: Deploy Protocol Contracts

```bash
# Export three-tree verifier addresses from Step 1 (primary)
export THREE_TREE_VERIFIER_18=0x...
export THREE_TREE_VERIFIER_20=0x...
export THREE_TREE_VERIFIER_22=0x...
export THREE_TREE_VERIFIER_24=0x...

# Export two-tree verifier addresses from Step 1b (legacy, optional)
export VERIFIER_ADDRESS_18=0x...
export VERIFIER_ADDRESS_20=0x...
export VERIFIER_ADDRESS_22=0x...
export VERIFIER_ADDRESS_24=0x...

# Deploy (genesis seal is automatic and irreversible)
# Deploys 8 contracts: DistrictRegistry, NullifierRegistry, VerifierRegistry,
# DistrictGate, CampaignRegistry, UserRootRegistry, CellMapRegistry,
# EngagementRootRegistry
PRIVATE_KEY=0x... ./script/deploy.sh --network mainnet --depths "18 20 22 24"
```

Outputs: `deployed-addresses.json` with all contract addresses + timelock schedule.

**Dry-run first**: Add `--dry-run` to simulate without broadcasting.

## Step 3: Post-Deployment Timelocks (NOT required for initial launch)

Genesis phase is sealed at deploy time -- three-tree and two-tree verifiers are registered,
NullifierRegistry caller authorization is granted, CampaignRegistry, UserRootRegistry,
CellMapRegistry, and EngagementRootRegistry are set on DistrictGate, and a default action
domain is registered. The system is **fully operational** after Steps 1-2 with no pending
timelocks.

Timelocks only apply to **subsequent** changes made after genesis is sealed:

| Timelock | Duration | Command |
|----------|----------|---------|
| New three-tree verifier registration | 14 days | `verifierRegistry.proposeThreeTreeVerifier(depth, addr)` then `verifierRegistry.executeThreeTreeVerifier(depth)` |
| New two-tree verifier registration (legacy) | 14 days | `verifierRegistry.proposeVerifier(depth, addr)` then `verifierRegistry.executeVerifier(depth)` |
| Action domain registration | 7 days | `gate.proposeActionDomain(domain)` then `gate.executeActionDomain(domain)` |
| Governance transfer | 7 days | `*.initiateGovernanceTransfer(addr)` then `*.executeGovernanceTransfer(addr)` |
| New caller authorization | 7 days | `nullifierRegistry.proposeCaller(addr)` then `nullifierRegistry.executeCaller(addr)` |
| Engagement registry change | 7 days | `gate.proposeEngagementRegistry(addr)` then `gate.executeEngagementRegistry()` |

Set env vars before running ExecuteTimelocks:
```bash
export PRIVATE_KEY=0x...
export DISTRICT_GATE=0x...
export NULLIFIER_REGISTRY=0x...
export CAMPAIGN_REGISTRY=0x...
export VERIFIER_REGISTRY=0x...
export DISTRICT_REGISTRY=0x...
export ENGAGEMENT_ROOT_REGISTRY=0x...
```

## Step 4: Verification

- [ ] All contracts verified on Scrollscan (`ETHERSCAN_API_KEY` enables auto-verify)
- [ ] `cast call $VERIFIER_REGISTRY "getRegisteredThreeTreeDepths()(uint8[])" --rpc-url scroll_mainnet` returns `[18, 20, 22, 24]`
- [ ] `cast call $VERIFIER_REGISTRY "getThreeTreeVerifier(uint8)(address)" 20 --rpc-url scroll_mainnet` returns correct address
- [ ] `cast call $DISTRICT_GATE "verifierRegistry()(address)" --rpc-url scroll_mainnet` returns VerifierRegistry address
- [ ] `cast call $DISTRICT_GATE "engagementRootRegistry()(address)" --rpc-url scroll_mainnet` returns EngagementRootRegistry address
- [ ] `cast call $NULLIFIER_REGISTRY "authorizedCallers(address)(bool)" $DISTRICT_GATE --rpc-url scroll_mainnet` returns `true` (set during genesis -- no timelock needed)

### Legacy Verification Path (Two-Tree)

- [ ] `cast call $VERIFIER_REGISTRY "getRegisteredDepths()(uint8[])" --rpc-url scroll_mainnet` returns `[18, 20, 22, 24]`
- [ ] `cast call $VERIFIER_REGISTRY "getVerifier(uint8)(address)" 20 --rpc-url scroll_mainnet` returns correct two-tree verifier address

## Optional: Governance Transfer

Transfer governance from deployer to a multisig (7-day timelock):

```bash
export NEW_GOVERNANCE=0x...  # Multisig address
STEP=governance forge script script/ExecuteTimelocks.s.sol --rpc-url scroll_mainnet --broadcast
```

## Network Configuration

| Network | RPC | Chain ID | Explorer |
|---------|-----|----------|----------|
| Scroll Sepolia | `https://sepolia-rpc.scroll.io` | 534351 | scrollscan.com (sepolia) |
| Scroll Mainnet | `https://rpc.scroll.io` | 534352 | scrollscan.com |
