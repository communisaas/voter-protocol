# Scroll Mainnet Deployment Checklist

**Document Version:** 1.0
**Last Updated:** 2026-02-02
**Target Network:** Scroll Mainnet (Chain ID: 534352)

---

## Overview

This checklist must be completed before deploying VOTER Protocol contracts to Scroll Mainnet. Each item requires verification and sign-off. DO NOT proceed with deployment until all items are checked.

**Deployment Script:** `contracts/script/DeployScrollMainnet.s.sol`

---

## Pre-Deployment Checklist

### 1. Security Audit Status

| Item | Status | Verified By | Date |
|------|--------|-------------|------|
| [ ] Professional security audit completed | | | |
| [ ] All critical findings addressed | | | |
| [ ] All high findings addressed | | | |
| [ ] Medium findings reviewed and accepted/fixed | | | |
| [ ] Audit report published | | | |

#### Security Fixes Verification (SA-001 through SA-007)

| Finding | Description | Status | Implementation Location |
|---------|-------------|--------|------------------------|
| [ ] SA-001 | actionDomain Whitelist (Double-Voting Fix) | | `DistrictGate.sol:91-99, 245-247, 371-412` |
| [ ] SA-004 | Root Lifecycle Management (Revocation) | | `DistrictRegistry.sol:338-486` |
| [ ] HIGH-001 | Verifier Timelock (14-day for all registrations) | | `VerifierRegistry.sol:63-64, 90-127` |
| [ ] HIGH-001 | NullifierRegistry Proposal Overwrite Prevention | | `NullifierRegistry.sol:178-186, 227-231` |
| [ ] CRITICAL-001 | NullifierRegistry Governance Timelock | | `NullifierRegistry.sol:28-32, 99-101` |
| [ ] MED-005 | NullifierRegistry Governance Transfer Timelock | | `NullifierRegistry.sol:319-335` |

**Verification Command:**
```bash
cd contracts
grep -n "SA-001\|SA-004\|HIGH-001\|CRITICAL-001" src/*.sol
```

### 2. Contract Compilation

| Item | Status | Notes |
|------|--------|-------|
| [ ] All contracts compile without errors | | |
| [ ] No compiler warnings (or all reviewed/accepted) | | |
| [ ] Solidity version pinned to 0.8.19 | | |
| [ ] Optimizer enabled (200 runs, via_ir=true) | | |

**Verification Command:**
```bash
cd contracts
forge build --force
```

### 3. Test Suite

| Item | Status | Coverage |
|------|--------|----------|
| [ ] All unit tests passing | | |
| [ ] All integration tests passing | | |
| [ ] Governance tests passing | | |
| [ ] EIP-712 signature tests passing | | |
| [ ] Lifecycle tests passing | | |
| [ ] Fuzz tests passing (256+ runs) | | |
| [ ] Test coverage > 95% | | |

**Verification Commands:**
```bash
cd contracts
forge test -vv
forge coverage
```

### 4. Testnet Validation (Scroll Sepolia)

| Item | Status | Details |
|------|--------|---------|
| [ ] Deployed to Scroll Sepolia | | Addresses: |
| [ ] 100+ valid proofs verified | | Count: |
| [ ] 50+ invalid proofs rejected | | Count: |
| [ ] Gas costs within expected range (~2.2M) | | Avg: |
| [ ] All governance timelocks tested | | |
| [ ] District registration tested | | |
| [ ] actionDomain workflow tested | | |
| [ ] Campaign registry integration tested | | |

**Testnet Contract Addresses:**
- DistrictRegistry: `__________________`
- NullifierRegistry: `__________________`
- VerifierRegistry: `__________________`
- DistrictGate: `__________________`
- CampaignRegistry: `__________________`
- HonkVerifier: `__________________`

### 5. Verifier Contract

| Item | Status | Details |
|------|--------|---------|
| [ ] Real Honk verifier generated (NOT MockVerifier) | | |
| [ ] Verifier matches Noir circuit version | | Circuit hash: |
| [ ] Verifier deployed to mainnet | | Address: |
| [ ] Verifier contract verified on Scrollscan | | |
| [ ] Verifier tested with valid proofs on testnet | | |
| [ ] Verifier tested with invalid proofs on testnet | | |

**Verifier Generation:**
```bash
cd packages/crypto
./scripts/build-circuits.sh
# Verifier output: noir/district_membership/target/verifier.sol
```

### 6. Governance Configuration

| Item | Status | Details |
|------|--------|---------|
| [ ] Governance multisig created | | Address: |
| [ ] Multisig threshold set (minimum 3-of-5) | | Threshold: |
| [ ] Signers distributed across jurisdictions | | |
| [ ] All signers use hardware wallets | | |
| [ ] Backup/recovery procedures documented | | |
| [ ] Multisig tested with test transactions | | |

**Governance Multisig Address:** `__________________`

**Signers:**
1. `__________________` (Location: ___)
2. `__________________` (Location: ___)
3. `__________________` (Location: ___)
4. `__________________` (Location: ___)
5. `__________________` (Location: ___)

### 7. Environment Variables

| Variable | Set | Validated |
|----------|-----|-----------|
| [ ] PRIVATE_KEY | | Secure storage confirmed |
| [ ] GOVERNANCE_ADDRESS | | Multisig address verified |
| [ ] VERIFIER_ADDRESS | | Deployed verifier verified |
| [ ] VERIFIER_DEPTH | | Valid depth (18/20/22/24) |
| [ ] ETHERSCAN_API_KEY | | Scrollscan compatible |

**Environment Setup:**
```bash
# DO NOT commit these values - use secure secrets management
export PRIVATE_KEY="<deployer_private_key>"
export GOVERNANCE_ADDRESS="<multisig_address>"
export VERIFIER_ADDRESS="<deployed_verifier_address>"
export VERIFIER_DEPTH="20"  # Or 18, 22, 24
export ETHERSCAN_API_KEY="<scrollscan_api_key>"
```

### 8. Deployer Account

| Item | Status | Details |
|------|--------|---------|
| [ ] Deployer account created (fresh, single-use recommended) | | Address: |
| [ ] Sufficient ETH balance for deployment | | Balance: ETH |
| [ ] Deployer key secured (hardware wallet/HSM) | | |
| [ ] Key rotation planned post-deployment | | |

**Estimated Deployment Cost:**
- Total gas: ~9,150,000 gas
- At 0.01-0.1 gwei: ~0.00009 - 0.0009 ETH
- Recommended buffer: 0.01 ETH

### 9. Infrastructure

| Item | Status | Details |
|------|--------|---------|
| [ ] RPC endpoint configured (scroll_mainnet) | | Provider: |
| [ ] RPC endpoint rate limits verified | | |
| [ ] Backup RPC endpoint available | | |
| [ ] Block explorer access confirmed | | |

---

## Deployment Execution

### Pre-Deployment Final Checks

- [ ] All checklist items above completed
- [ ] Team notified of deployment window
- [ ] Monitoring systems ready
- [ ] Incident response team on standby
- [ ] Communication channels prepared

### Deployment Commands

**Step 1: Dry Run (Simulation)**
```bash
cd contracts
forge script script/DeployScrollMainnet.s.sol:DeployScrollMainnet \
  --rpc-url scroll_mainnet \
  --private-key $PRIVATE_KEY \
  -vvvv
```

**Step 2: Actual Deployment**
```bash
cd contracts
forge script script/DeployScrollMainnet.s.sol:DeployScrollMainnet \
  --rpc-url scroll_mainnet \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --slow
```

**Step 3: Record Deployed Addresses**

| Contract | Address | Tx Hash |
|----------|---------|---------|
| DistrictRegistry | | |
| NullifierRegistry | | |
| VerifierRegistry | | |
| DistrictGate | | |
| CampaignRegistry | | |

---

## Post-Deployment Checklist

### Immediate (Within 1 Hour)

| Item | Status | Notes |
|------|--------|-------|
| [ ] All contracts verified on Scrollscan | | |
| [ ] Deployed addresses documented | | |
| [ ] Deployment transaction confirmed | | Block: |
| [ ] Contract ownership verified (governance) | | |
| [ ] Initial state verified via block explorer | | |

### Verification Commands

```bash
# Verify each contract on Scrollscan
forge verify-contract <address> DistrictRegistry --chain scroll --watch
forge verify-contract <address> NullifierRegistry --chain scroll --watch
forge verify-contract <address> VerifierRegistry --chain scroll --watch
forge verify-contract <address> DistrictGate --chain scroll --watch
forge verify-contract <address> CampaignRegistry --chain scroll --watch
```

### Timelock Operations Schedule

| Operation | Initiated | Execute After | Status |
|-----------|-----------|---------------|--------|
| Verifier Activation | Deployment | +14 days | [ ] Pending |
| NullifierRegistry Caller Auth | Deployment | +7 days | [ ] Pending |
| CampaignRegistry Proposal | After NullReg Auth | +7 days | [ ] Pending |
| CampaignRegistry Execution | After Proposal | +7 days | [ ] Pending |

**Critical Dates:**
- Verifier can be activated: `__________________`
- NullifierRegistry auth can be executed: `__________________`
- CampaignRegistry can be proposed: `__________________`
- CampaignRegistry can be executed: `__________________`

### Governance Actions Required

**Day 0 (Deployment Day):**
1. [x] Contracts deployed
2. [x] Verifier proposed (14-day timelock started)
3. [x] NullifierRegistry caller proposed (7-day timelock started)
4. [x] CampaignRegistry caller authorized (immediate)

**Day 7:**
1. [ ] Execute NullifierRegistry caller authorization
   ```solidity
   nullifierRegistry.executeCallerAuthorization(<DistrictGate_address>);
   ```
2. [ ] Propose CampaignRegistry on DistrictGate
   ```solidity
   gate.proposeCampaignRegistry(<CampaignRegistry_address>);
   ```

**Day 14:**
1. [ ] Execute verifier activation
   ```solidity
   verifierRegistry.executeVerifier(<depth>);
   ```
2. [ ] Execute CampaignRegistry integration
   ```solidity
   gate.executeCampaignRegistry();
   ```

**Day 14+ (Ongoing):**
1. [ ] Register initial districts
   ```solidity
   districtRegistry.registerDistrict(<root>, <country>, <depth>);
   ```
2. [ ] Register initial action domains (7-day timelock each)
   ```solidity
   gate.proposeActionDomain(<actionDomain>);
   // Wait 7 days
   gate.executeActionDomain(<actionDomain>);
   ```
3. [ ] Set minimum authority levels per action domain (Wave 14d)
   ```solidity
   // Decreases are immediate; increases require 24h timelock
   gate.setActionDomainMinAuthority(<actionDomain>, 3); // Require L3+ (ID verified)
   // For sensitive domains requiring passport verification:
   gate.setActionDomainMinAuthority(<actionDomain>, 4); // Starts 24h timelock
   // Wait 24 hours, then:
   gate.executeMinAuthorityIncrease(<actionDomain>);
   ```
4. [ ] Configure two-tree registries (7-day timelock)
   ```solidity
   gate.proposeTwoTreeRegistries(<userRootRegistry>, <cellMapRegistry>);
   // Wait 7 days
   gate.executeTwoTreeRegistries();
   ```

**Relayer Setup (communique server):**
5. [ ] Fund relayer wallet with ≥ 0.1 ETH on Scroll
6. [ ] Set `SCROLL_PRIVATE_KEY` in production secrets manager
7. [ ] Set `SCROLL_RPC_URL` to production RPC endpoint
8. [ ] Set `DISTRICT_GATE_ADDRESS` to deployed contract address
9. [ ] Verify relayer health: `GET /api/admin/relayer-health`
10. [ ] Deploy Convex schema: `npx convex deploy --env-file .env.production`

---

## Monitoring & Alerts

### Events to Monitor

| Event | Contract | Significance |
|-------|----------|--------------|
| `GovernanceTransferInitiated` | All | Governance change proposed |
| `VerifierProposed` | VerifierRegistry | New verifier proposed |
| `CallerAuthorizationProposed` | NullifierRegistry | New caller proposed |
| `ActionDomainProposed` | DistrictGate | New action domain proposed |
| `RootDeactivationInitiated` | DistrictRegistry | District being deprecated |
| `ContractPaused` | DistrictGate | Emergency pause |

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Pending governance transfers | Any | - |
| Pending verifier changes | Any | - |
| Gas price spike | >10x normal | >50x normal |
| Failed verifications | >5% | >10% |
| Unusual nullifier activity | >1000/hour | >5000/hour |

---

## Rollback Plan

### If Critical Issue Discovered Post-Deployment

**Option 1: Pause Contracts (Immediate)**
```solidity
// Governance multisig calls:
districtGate.pause();
nullifierRegistry.pause();
campaignRegistry.pause();
```

**Option 2: Disable Verifier (Requires Timelock)**
```solidity
// Cannot immediately disable - 14-day timelock for changes
// Use pause() instead for immediate response
```

**Option 3: Revoke Caller Authorization (Requires Timelock)**
```solidity
// Propose revocation (7-day timelock)
nullifierRegistry.proposeCallerRevocation(<DistrictGate_address>);
```

### Recovery Procedures

1. **If contracts need redeployment:**
   - Deploy new contracts with fixes
   - Migrate governance to new contracts
   - Coordinate with users for transition

2. **If district data compromised:**
   - Initiate root deactivation (7-day timelock)
   - Register corrected district roots
   - Communicate timeline to users

3. **If governance compromised:**
   - Phase 1: Limited to timelock duration
   - Community has 7-14 days to respond
   - Emergency pause if malicious actions detected

---

## Sign-Off

### Deployment Authorization

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Technical Lead | | | |
| Security Lead | | | |
| Product Lead | | | |

### Final Approval

- [ ] All checklist items verified
- [ ] All sign-offs obtained
- [ ] Deployment window approved
- [ ] Ready to deploy

**Deployment Authorized By:** _______________

**Date:** _______________

---

## Appendix

### Gas Cost Reference

| Operation | Estimated Gas | USD at $2500/ETH, 0.05 gwei |
|-----------|---------------|------------------------------|
| Full Deployment | ~9,150,000 | ~$1.14 |
| Single Proof Verification | ~350,000 | ~$0.04 |
| District Registration | ~75,000 | ~$0.01 |
| ActionDomain Proposal | ~50,000 | ~$0.006 |
| ActionDomain Execution | ~50,000 | ~$0.006 |

### Contract Size Reference

| Contract | Size (bytes) | EIP-170 Limit |
|----------|--------------|---------------|
| DistrictRegistry | ~8,500 | 24,576 |
| NullifierRegistry | ~7,200 | 24,576 |
| VerifierRegistry | ~5,800 | 24,576 |
| DistrictGate | ~12,000 | 24,576 |
| CampaignRegistry | ~9,500 | 24,576 |

### Security Contact

For security issues discovered during or after deployment:
- Email: security@voter-protocol.org
- PGP Key: 0x7F3A...

### Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-02 | Initial | Initial checklist |

---

**END OF CHECKLIST**
