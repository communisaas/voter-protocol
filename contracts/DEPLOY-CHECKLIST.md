# Scroll Mainnet Deployment Checklist

## Prerequisites

- [ ] `PRIVATE_KEY` set (deployer wallet with ETH on Scroll mainnet)
- [ ] `GOVERNANCE_ADDRESS` set (or defaults to deployer address)
- [ ] `ETHERSCAN_API_KEY` set (for Scrollscan contract verification)
- [ ] Foundry installed: `forge --version` shows 1.4.3+
- [ ] Verifier contracts compiled: `FOUNDRY_PROFILE=verifiers forge build`
- [ ] Protocol contracts compiled: `forge build`
- [ ] All tests pass: `forge test`

## Step 1: Deploy Verifier Contracts

```bash
cd contracts
PRIVATE_KEY=0x... ./script/deploy-verifiers.sh --network mainnet --depths "18 20 22 24"
```

Outputs: `deployed-verifiers.json` with addresses per depth.

## Step 2: Deploy Protocol Contracts

```bash
# Export verifier addresses from Step 1
export VERIFIER_ADDRESS_18=0x...
export VERIFIER_ADDRESS_20=0x...
export VERIFIER_ADDRESS_22=0x...
export VERIFIER_ADDRESS_24=0x...

# Deploy (genesis seal is automatic and irreversible)
PRIVATE_KEY=0x... ./script/deploy.sh --network mainnet --depths "18 20 22 24"
```

Outputs: `deployed-addresses.json` with all contract addresses + timelock schedule.

**Dry-run first**: Add `--dry-run` to simulate without broadcasting.

## Step 3: Post-Deployment Timelocks (NOT required for initial launch)

Genesis phase is sealed at deploy time — verifiers are registered and the system is fully
operational after Steps 1-2. Timelocks only apply to **subsequent** changes (adding new
verifiers, modifying governance, integrating CampaignRegistry).

| Day | Action | Command |
|-----|--------|---------|
| 0 | Genesis sealed, verifiers registered | Automatic at deploy |
| 7+ | Execute NullifierRegistry caller auth | `STEP=1 forge script script/ExecuteTimelocks.s.sol --rpc-url scroll_mainnet --broadcast` |
| 7+ | Propose CampaignRegistry on DistrictGate | `STEP=2 forge script script/ExecuteTimelocks.s.sol --rpc-url scroll_mainnet --broadcast` |
| 14+ | Execute CampaignRegistry integration | `STEP=3 forge script script/ExecuteTimelocks.s.sol --rpc-url scroll_mainnet --broadcast` |

Each step requires the previous step to be completed and its timelock to have matured.

Set env vars before running ExecuteTimelocks:
```bash
export PRIVATE_KEY=0x...
export DISTRICT_GATE=0x...
export NULLIFIER_REGISTRY=0x...
export CAMPAIGN_REGISTRY=0x...
export VERIFIER_REGISTRY=0x...
export DISTRICT_REGISTRY=0x...
```

## Step 4: Verification

- [ ] All contracts verified on Scrollscan (`ETHERSCAN_API_KEY` enables auto-verify)
- [ ] `cast call $VERIFIER_REGISTRY "getRegisteredDepths()(uint8[])" --rpc-url scroll_mainnet` returns `[18, 20, 22, 24]`
- [ ] `cast call $VERIFIER_REGISTRY "getVerifier(uint8)(address)" 20 --rpc-url scroll_mainnet` returns correct address
- [ ] `cast call $DISTRICT_GATE "verifierRegistry()(address)" --rpc-url scroll_mainnet` returns VerifierRegistry address
- [ ] `cast call $NULLIFIER_REGISTRY "authorizedCallers(address)(bool)" $DISTRICT_GATE --rpc-url scroll_mainnet` returns `true` (after Step 1 timelock)

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
