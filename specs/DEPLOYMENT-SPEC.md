# Deployment Specification

**Component:** VOTER Protocol Infrastructure
**Environments:** Testnet, Mainnet
**Status:** 📋 Day 8-9+ Deployment

---

## Overview

Complete deployment procedures for VOTER Protocol stack including CipherVault contract, client SDKs, and Communique integration.

**Deployment Phases:**
1. **Testnet** (Days 8-9): Initial deployment, testing, validation
2. **Mainnet** (Days 10+): Production deployment after audit

**Related Specs:**
- [CIPHERVAULT-CONTRACT-SPEC.md](./CIPHERVAULT-CONTRACT-SPEC.md) - Contract build
- [INTEGRATION-SPEC.md](./INTEGRATION-SPEC.md) - Communique integration

---

## Prerequisites

### Development Tools

```bash
# Rust toolchain for contract builds
rustup target add wasm32-unknown-unknown

# NEAR CLI for deployment
npm install -g near-cli

# Node.js for SDK packages
node --version  # v18+
npm --version   # v9+
```

### NEAR Accounts

**Testnet:**
```bash
# Create testnet account via wallet
# Visit: https://testnet.mynearwallet.com

# Or create via CLI
near create-account YOUR_ACCOUNT.testnet --useFaucet
```

**Mainnet:**
```bash
# Create mainnet account (requires NEAR purchase)
# Visit: https://mynearwallet.com

# Or import existing account
near login
```

---

## Phase 1: Testnet Deployment

### Step 1: Build Contract

**Location:** `contracts/near/ciphervault/`

```bash
cd contracts/near/ciphervault

# Run tests first
cargo test

# Build optimized WASM
./build.sh
```

**build.sh:**
```bash
#!/bin/bash
set -e

echo "Building CipherVault contract..."

# Build with optimizations
RUSTFLAGS='-C link-arg=-s' cargo build \
  --target wasm32-unknown-unknown \
  --release

# Create output directory
mkdir -p ../../out

# Copy WASM
cp target/wasm32-unknown-unknown/release/ciphervault.wasm ../../out/

# Check size
echo "WASM size:"
ls -lh ../../out/ciphervault.wasm

echo "Build complete: out/ciphervault.wasm"
```

**Expected output:**
```
WASM size: 200-300KB
```

**If larger than 300KB:**
```bash
# Install wasm-opt (part of binaryen)
brew install binaryen  # macOS
apt install binaryen   # Linux

# Optimize
wasm-opt -Oz --strip-debug \
  ../../out/ciphervault.wasm \
  -o ../../out/ciphervault_opt.wasm
```

---

### Step 2: Create Contract Account

```bash
# Create subaccount for contract
near create-account ciphervault-v1.YOUR_ACCOUNT.testnet \
  --masterAccount YOUR_ACCOUNT.testnet \
  --initialBalance 10

# Verify account
near state ciphervault-v1.YOUR_ACCOUNT.testnet
```

**Expected output:**
```json
{
  "amount": "10000000000000000000000000",
  "block_height": 123456789,
  "storage_usage": 182
}
```

---

### Step 3: Deploy Contract

```bash
# Deploy to testnet
near deploy ciphervault-v1.YOUR_ACCOUNT.testnet \
  ../../out/ciphervault.wasm \
  --initFunction new \
  --initArgs '{}'

# Verify deployment
near view ciphervault-v1.YOUR_ACCOUNT.testnet get_version '{}'
```

**Expected output:**
```
"ciphervault-v1.0.0"
```

---

### Step 4: Test Contract

**Basic smoke tests:**

```bash
# 1. Check version
near view ciphervault-v1.YOUR_ACCOUNT.testnet get_version '{}'

# 2. Check envelope count
near view ciphervault-v1.YOUR_ACCOUNT.testnet get_envelope_count '{}'
# Expected: 0

# 3. Storage deposit
near call ciphervault-v1.YOUR_ACCOUNT.testnet storage_deposit \
  '{"account_id": null, "registration_only": false}' \
  --accountId YOUR_ACCOUNT.testnet \
  --amount 0.1

# 4. Check balance
near view ciphervault-v1.YOUR_ACCOUNT.testnet storage_balance_of \
  '{"account_id": "YOUR_ACCOUNT.testnet"}'

# 5. Store test envelope
near call ciphervault-v1.YOUR_ACCOUNT.testnet store_envelope '{
  "encrypted_data": [1,2,3,4,5],
  "nonce": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  "poseidon_commit": "0000000000000000000000000000000000000000000000000000000000000000",
  "encrypted_sovereign_key": [6,7,8,9,10],
  "sovereign_key_iv": [0,0,0,0,0,0,0,0,0,0,0,0],
  "sovereign_key_tag": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  "guardians": null
}' --accountId YOUR_ACCOUNT.testnet --gas 30000000000000

# 6. Retrieve envelope
near view ciphervault-v1.YOUR_ACCOUNT.testnet get_envelope \
  '{"envelope_id": "YOUR_ACCOUNT.testnet-1"}'
```

---

### Step 5: Publish NPM Packages

**Testnet packages for testing:**

```bash
# 1. Types package
cd packages/types
npm version 0.1.0-testnet.1
npm publish --tag testnet --access public

# 2. Crypto package
cd ../crypto
npm version 0.1.0-testnet.1
npm publish --tag testnet --access public

# 3. Client package
cd ../client
npm version 0.1.0-testnet.1
npm publish --tag testnet --access public
```

**Installation (testnet):**
```bash
npm install @voter-protocol/client@testnet
```

---

### Step 6: Integration Testing

**Create test script:**

```typescript
// scripts/test-integration.ts
import { CipherVaultClient, AccountManager } from '@voter-protocol/client';
import { createEnvelope } from '@voter-protocol/crypto';
import { keyStores, connect } from 'near-api-js';

async function testIntegration() {
  console.log('Testing VOTER Protocol integration...\n');

  // 1. Create test account
  console.log('1. Creating implicit account...');
  const keyStore = new keyStores.InMemoryKeyStore();
  const { accountId, keyPair } = await AccountManager.createImplicitAccount(
    'test-user-' + Date.now(),
    keyStore,
    'testnet'
  );
  console.log(`   Account: ${accountId.slice(0, 16)}...`);

  // 2. Initialize client
  console.log('2. Initializing CipherVault client...');
  const near = await connect({
    networkId: 'testnet',
    keyStore,
    nodeUrl: 'https://rpc.testnet.near.org'
  });
  const account = await near.account(accountId);
  const client = new CipherVaultClient({
    contractId: 'ciphervault-v1.YOUR_ACCOUNT.testnet',
    account
  });
  console.log('   Connected to contract');

  // 3. Deposit storage
  console.log('3. Depositing storage...');
  await client.storageManager.deposit(new BN('100000000000000000000000')); // 0.1 NEAR
  const balance = await client.storageManager.getBalance();
  console.log(`   Balance: ${StorageManager.formatNEAR(balance)} NEAR`);

  // 4. Store PII
  console.log('4. Storing encrypted PII...');
  const pii = {
    email: 'test@example.com',
    firstName: 'Alice',
    lastName: 'Voter',
    streetAddress: '123 Test St',
    city: 'TestCity',
    state: 'TC',
    zipCode: '12345'
  };

  const passkeyKey = new Uint8Array(32).fill(1); // Test key
  const envelope = await createEnvelope(pii, passkeyKey, accountId);
  const result = await client.storeEnvelope({ envelope });
  console.log(`   Envelope ID: ${result.envelopeId}`);
  console.log(`   Cost: ${result.cost}`);

  // 5. Retrieve PII
  console.log('5. Retrieving PII...');
  const retrieved = await client.getEnvelope(result.envelopeId);
  if (retrieved) {
    console.log(`   Retrieved: ${retrieved.envelope.encrypted_data.length} bytes`);
  }

  console.log('\n✅ Integration test passed!');
}

testIntegration().catch(console.error);
```

**Run test:**
```bash
npx tsx scripts/test-integration.ts
```

---

### Step 7: Deploy Communique Integration

**Update Communique configuration:**

```typescript
// communique/.env.testnet
NEAR_NETWORK_ID=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
CIPHERVAULT_CONTRACT_ID=ciphervault-v1.YOUR_ACCOUNT.testnet
VOTER_PROTOCOL_API_URL=https://api.voter-protocol.testnet
```

**Deploy Communique:**
```bash
cd communique

# Install dependencies
npm install

# Run database migrations
npm run db:push

# Build
npm run build

# Deploy (example: fly.io)
flyctl deploy --config fly.testnet.toml
```

---

## Phase 2: Mainnet Deployment

### Pre-Deployment Checklist

**Security Audit:**
- [ ] Contract code audit completed
- [ ] Penetration testing passed
- [ ] Gas optimization verified
- [ ] Storage economics validated
- [ ] Upgrade path tested

**Testing:**
- [ ] All unit tests passing (9/9)
- [ ] Integration tests passing
- [ ] Testnet stress testing completed
- [ ] 1000+ test envelopes stored/retrieved
- [ ] Gas costs within budget

**Documentation:**
- [ ] API documentation complete
- [ ] Integration guide published
- [ ] Security model documented
- [ ] Incident response plan ready

**Infrastructure:**
- [ ] Monitoring setup (alerting, logging)
- [ ] Backup strategy defined
- [ ] Upgrade procedures documented
- [ ] Team training completed

---

### Step 1: Mainnet Contract Account

```bash
# Create mainnet subaccount
near create-account ciphervault-v1.YOUR_ACCOUNT.near \
  --masterAccount YOUR_ACCOUNT.near \
  --initialBalance 50

# Add access keys for deployment
near add-key ciphervault-v1.YOUR_ACCOUNT.near
```

---

### Step 2: Deploy to Mainnet

```bash
# Build contract (same as testnet)
cd contracts/near/ciphervault
./build.sh

# Deploy
near deploy ciphervault-v1.YOUR_ACCOUNT.near \
  ../../out/ciphervault.wasm \
  --initFunction new \
  --initArgs '{}' \
  --networkId mainnet

# Verify
near view ciphervault-v1.YOUR_ACCOUNT.near get_version '{}' \
  --networkId mainnet
```

---

### Step 3: Initial Storage Deposit

```bash
# Platform funds initial storage pool
near call ciphervault-v1.YOUR_ACCOUNT.near storage_deposit \
  '{"account_id": null, "registration_only": false}' \
  --accountId YOUR_ACCOUNT.near \
  --amount 100 \
  --networkId mainnet

# Verify balance
near view ciphervault-v1.YOUR_ACCOUNT.near storage_balance_of \
  '{"account_id": "YOUR_ACCOUNT.near"}' \
  --networkId mainnet
```

---

### Step 4: Publish Production Packages

```bash
# 1. Types (stable release)
cd packages/types
npm version 1.0.0
npm publish --access public

# 2. Crypto
cd ../crypto
npm version 1.0.0
npm publish --access public

# 3. Client
cd ../client
npm version 1.0.0
npm publish --access public
```

---

### Step 5: Gradual Rollout

**Phase 1: Beta Users (Week 1)**
```typescript
// Communique feature flag
const VOTER_PROTOCOL_ENABLED =
  process.env.ENABLE_VOTER_PROTOCOL === 'true' &&
  isBetaUser(user.email);
```

**Phase 2: 10% Rollout (Week 2)**
```typescript
const VOTER_PROTOCOL_ENABLED =
  Math.random() < 0.1; // 10% of users
```

**Phase 3: Full Rollout (Week 3+)**
```typescript
const VOTER_PROTOCOL_ENABLED = true;
```

---

### Step 6: Monitoring Setup

**Prometheus metrics:**

```typescript
// src/lib/integrations/voter-protocol/metrics.ts
import { Counter, Histogram, Gauge } from 'prom-client';

export const metrics = {
  enrollments: new Counter({
    name: 'voter_protocol_enrollments_total',
    help: 'Total user enrollments in VOTER Protocol'
  }),

  storageOperations: new Histogram({
    name: 'voter_protocol_storage_duration_seconds',
    help: 'CipherVault storage operation duration',
    buckets: [0.1, 0.5, 1, 2, 5, 10]
  }),

  storageBalance: new Gauge({
    name: 'voter_protocol_storage_balance_near',
    help: 'Platform storage balance in NEAR'
  }),

  rewards: new Counter({
    name: 'voter_protocol_rewards_distributed_total',
    help: 'Total VOTER tokens distributed',
    labelNames: ['verification_status']
  })
};
```

**Grafana dashboard:**
```yaml
# grafana-dashboard.json
{
  "title": "VOTER Protocol Metrics",
  "panels": [
    {
      "title": "Enrollments per Hour",
      "targets": [
        "rate(voter_protocol_enrollments_total[1h])"
      ]
    },
    {
      "title": "Storage Operation Latency",
      "targets": [
        "histogram_quantile(0.95, voter_protocol_storage_duration_seconds)"
      ]
    },
    {
      "title": "Storage Balance",
      "targets": [
        "voter_protocol_storage_balance_near"
      ]
    },
    {
      "title": "Rewards Distributed",
      "targets": [
        "rate(voter_protocol_rewards_distributed_total[1h])"
      ]
    }
  ]
}
```

---

### Step 7: Incident Response

**Alert thresholds:**

```yaml
# prometheus-alerts.yml
groups:
  - name: voter_protocol
    interval: 30s
    rules:
      - alert: HighStorageLatency
        expr: histogram_quantile(0.95, voter_protocol_storage_duration_seconds) > 10
        for: 5m
        annotations:
          summary: "Storage operations taking > 10s"

      - alert: LowStorageBalance
        expr: voter_protocol_storage_balance_near < 10
        for: 1m
        annotations:
          summary: "Platform storage balance < 10 NEAR"

      - alert: HighErrorRate
        expr: rate(voter_protocol_errors_total[5m]) > 0.05
        for: 5m
        annotations:
          summary: "Error rate > 5%"
```

**Incident runbook:**

1. **High Storage Latency**
   - Check NEAR RPC status
   - Verify gas prices normal
   - Review transaction logs
   - Scale RPC providers if needed

2. **Low Storage Balance**
   - Trigger automatic top-up
   - Notify finance team
   - Review usage patterns

3. **High Error Rate**
   - Check contract logs
   - Verify RPC connectivity
   - Review recent deployments
   - Rollback if necessary

---

## Upgrade Procedures

### Contract Upgrades

**Testnet upgrade:**
```bash
# Build new version
cd contracts/near/ciphervault
./build.sh

# Deploy upgrade
near deploy ciphervault-v1.YOUR_ACCOUNT.testnet \
  ../../out/ciphervault.wasm

# Verify version
near view ciphervault-v1.YOUR_ACCOUNT.testnet get_version '{}'
```

**Mainnet upgrade (with DAO governance):**
```bash
# 1. Propose upgrade
near call dao.YOUR_ACCOUNT.near propose '{
  "description": "Upgrade CipherVault to v1.1.0",
  "kind": {
    "FunctionCall": {
      "receiver_id": "ciphervault-v1.YOUR_ACCOUNT.near",
      "actions": [{
        "method_name": "upgrade",
        "args": "base64-encoded-wasm",
        "deposit": "0",
        "gas": "300000000000000"
      }]
    }
  }
}' --accountId YOUR_ACCOUNT.near --amount 1

# 2. Vote on proposal
near call dao.YOUR_ACCOUNT.near act_proposal '{
  "id": 0,
  "action": "VoteApprove"
}' --accountId YOUR_ACCOUNT.near

# 3. Execute after voting period
near call dao.YOUR_ACCOUNT.near finalize '{
  "id": 0
}' --accountId YOUR_ACCOUNT.near
```

---

## Cost Management

### Storage Cost Monitoring

```typescript
// Monitor storage usage and costs
async function monitorStorageCosts() {
  const client = new CipherVaultClient({ /* config */ });

  // Get platform balance
  const balance = await client.storageManager.getBalance();
  const balanceNEAR = parseFloat(StorageManager.formatNEAR(balance));

  // Alert if low
  if (balanceNEAR < 10) {
    await sendAlert({
      type: 'low_storage_balance',
      balance: balanceNEAR,
      threshold: 10
    });
  }

  // Log usage
  await logMetrics({
    storage_balance_near: balanceNEAR,
    storage_cost_per_user: 0.05, // $0.11 at $2.19/NEAR
    estimated_capacity: Math.floor(balanceNEAR / 0.05)
  });
}

// Run every hour
setInterval(monitorStorageCosts, 60 * 60 * 1000);
```

### Auto Top-Up

```typescript
// Automatic storage balance top-up
async function autoTopUp() {
  const minBalance = 50; // NEAR
  const topUpAmount = 100; // NEAR

  const balance = await client.storageManager.getBalance();
  const balanceNEAR = parseFloat(StorageManager.formatNEAR(balance));

  if (balanceNEAR < minBalance) {
    await client.storageManager.deposit(
      new BN(topUpAmount).mul(new BN('1000000000000000000000000'))
    );

    await logEvent({
      type: 'storage_top_up',
      amount: topUpAmount,
      previous_balance: balanceNEAR,
      new_balance: balanceNEAR + topUpAmount
    });
  }
}
```

---

## Rollback Procedures

### Emergency Contract Rollback

**If critical bug discovered:**

```bash
# 1. Identify last known good version
CONTRACT_VERSION="v1.0.0"
WASM_FILE="ciphervault-${CONTRACT_VERSION}.wasm"

# 2. Deploy previous version
near deploy ciphervault-v1.YOUR_ACCOUNT.near \
  backups/${WASM_FILE} \
  --networkId mainnet

# 3. Verify rollback
near view ciphervault-v1.YOUR_ACCOUNT.near get_version '{}' \
  --networkId mainnet

# 4. Notify users
curl -X POST https://api.communique.app/admin/broadcast \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"message": "VOTER Protocol temporarily rolled back for maintenance"}'
```

### Application Rollback

```bash
# Disable VOTER Protocol integration
flyctl config set ENABLE_VOTER_PROTOCOL=false

# Redeploy
flyctl deploy --config fly.mainnet.toml

# Verify
curl https://communique.app/api/health | jq '.voter_protocol.enabled'
# Should return: false
```

---

## Disaster Recovery

### Data Recovery

**Scenario: Contract data loss**

1. **All data is on-chain** - No centralized backup needed
2. **Rebuild from blockchain** - Query all envelopes via RPC
3. **User recovery** - Users re-enroll if envelope IDs lost

**Recovery script:**

```typescript
// scripts/recover-envelopes.ts
async function recoverEnvelopes() {
  const contract = new Contract(/* config */);

  // Get total count
  const count = await contract.get_envelope_count();

  // Recover all envelope IDs
  const envelopes = [];
  for (let i = 1; i <= count; i++) {
    // Envelope IDs format: {accountId}-{counter}
    // Query contract logs to rebuild mapping
    const envelope = await queryContractLogs(i);
    envelopes.push(envelope);
  }

  // Rebuild database
  await prisma.user.updateMany({
    data: envelopes.map(e => ({
      where: { nearAccountId: e.owner },
      data: { ciphervaultEnvelopeId: e.id }
    }))
  });
}
```

---

## Status

- 📋 **Pending:** Testnet deployment (Day 8)
- 📋 **Pending:** Integration testing (Day 9)
- 📋 **Pending:** Security audit (Before mainnet)
- 📋 **Pending:** Mainnet deployment (Day 10+)
- 📋 **Pending:** Monitoring setup
- 📋 **Pending:** Incident response procedures

---

## Appendix

### Useful Commands

```bash
# Check contract state
near state CONTRACT_ID

# View contract logs
near view-state CONTRACT_ID --finality final

# Calculate storage cost
near view CONTRACT_ID storage_balance_bounds '{}'

# Delete all keys (testing)
near delete-key CONTRACT_ID ACCESS_KEY --accountId YOUR_ACCOUNT

# Transfer account ownership
near send YOUR_ACCOUNT NEW_OWNER 1
```

### Cost Calculator

```typescript
// Calculate deployment costs
function calculateDeploymentCosts(users: number) {
  const storagePerUser = 0.05; // NEAR
  const nearPrice = 2.19; // USD

  return {
    users,
    storage_near: users * storagePerUser,
    storage_usd: users * storagePerUser * nearPrice,
    account_cost_near: 0, // Implicit accounts are free
    total_usd: users * storagePerUser * nearPrice
  };
}

// Examples
calculateDeploymentCosts(100);     // $11
calculateDeploymentCosts(1000);    // $110
calculateDeploymentCosts(10000);   // $1,100
calculateDeploymentCosts(100000);  // $11,000
calculateDeploymentCosts(1000000); // $110,000
```

---

**Complete:** All modular specifications created. Ready to revise IMPLEMENTATION-PLAN.md as high-level overview.
