# @voter-protocol/client

TypeScript SDK for the VOTER Protocol - democracy infrastructure that competes in the attention economy.

## Features

- **🆓 FREE Account Creation** - NEAR implicit accounts via Face ID/Touch ID (no gas, no on-chain tx)
- **🔐 Multi-Chain Control** - One passkey controls Scroll, Ethereum, Bitcoin via NEAR Chain Signatures
- **🕵️ Zero-Knowledge Proofs** - Prove congressional district without revealing address (Noir/Barretenberg UltraPlonk)
- **⚡ Fast Settlement** - Scroll L2 (~$0.0047-$0.0511/tx, ~2 sec finality)
- **📊 Reputation System** - ERC-8004 portable reputation with time decay

## Installation

```bash
npm install @voter-protocol/client
# or
pnpm add @voter-protocol/client
# or
yarn add @voter-protocol/client
```

## Quick Start

```typescript
import { VOTERClient } from '@voter-protocol/client';

// Initialize client
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  nullifierRegistryAddress: '0x...',
  districtRegistryAddress: '0x...'
});

// Create account (FREE - no gas required)
const account = await client.account.create({
  method: 'passkey'  // Face ID / Touch ID
});

console.log('Scroll Address:', account.scrollAddress);
console.log('NEAR Account:', account.nearAccount);

// Generate zero-knowledge proof of congressional district
const proof = await client.zk.proveDistrict({
  address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
  actionId: '0x...',  // Hash of template/campaign ID (any bytes32 is valid)
  // Address never leaves browser, never goes on-chain
});

// Sign EIP-712 message (MEV-resistant - rewards go to signer, not submitter)
const { signature, deadline, nonce } = await client.signProofSubmission({
  proof: proof.proofBytes,
  districtRoot: proof.districtRoot,
  nullifier: proof.nullifier,
  actionId: proof.actionId,
  country: proof.country
});

// Submit proof on-chain (Scroll L2)
const tx = await client.contracts.districtGate.verifyAndAuthorizeWithSignature(
  account.scrollAddress,  // signer (receives credit)
  proof.proofBytes,
  proof.districtRoot,
  proof.nullifier,
  proof.actionId,
  proof.country,
  deadline,
  signature
);
await tx.wait();

console.log('Action verified!');
```

## Architecture

### Account Layer: NEAR Chain Signatures

NEAR Chain Signatures provide universal multi-chain account control:

```typescript
// One passkey controls addresses on ALL chains
const account = await client.account.create({ method: 'passkey' });

// Derive addresses for different chains
const scrollAddress = await chainSigs.deriveScrollAddress(account.nearAccount);
const ethAddress = await chainSigs.deriveEthereumAddress(account.nearAccount);
const btcAddress = await chainSigs.deriveBitcoinAddress(account.nearAccount);

// Sign transactions via MPC (~2-3 seconds)
const signature = await chainSigs.signTransaction({
  payload: txHash,
  path: 'scroll,1',
  keyVersion: 0
});
```

**How it works:**
- 300+ NEAR validators run MPC threshold signatures
- No bridges, no wrapped tokens, no trusted intermediaries
- Sub-second signature latency
- Byzantine fault tolerance (2/3 validators must collude to compromise)

### Zero-Knowledge Proofs: Noir/Barretenberg UltraPlonk

Prove congressional district membership without revealing address:

```typescript
// Generate proof (8-15 seconds in browser WASM)
const proof = await client.zk.proveDistrict({
  address: fullStreetAddress  // Never leaves browser
});

// Proof reveals:
// - districtHash: Poseidon(address, districtId) ✅
// - merkleRoot: Shadow Atlas root ✅
//
// Proof DOES NOT reveal:
// - Your full address ❌
// - Your street, city, zip code ❌
// - Any PII ❌
```

**Technical details:**
- Proving time: 8-15 seconds (browser WASM)
- Proof size: 384-512 bytes
- Verification gas: ~300-400k on Scroll L2
- Security: KZG trusted setup (Ethereum's 141K-participant ceremony), production-grade

### Shadow Atlas: Congressional District Merkle Tree

Global Merkle tree of 535 congressional districts (435 House + 100 Senate):

```typescript
// Load Shadow Atlas from IPFS (CID stored on-chain)
const cid = await client.contracts.districtGate.getShadowAtlasCID();
await client.zk.shadowAtlas.load(cid);

// Generate Merkle proof for address
const merkleProof = await client.zk.shadowAtlas.generateProof(address);

console.log('District:', merkleProof.leaf.districtId);
console.log('Type:', merkleProof.leaf.districtType); // house | senate
console.log('Country:', merkleProof.leaf.countryCode);
```

**Atlas structure:**
- 535 leaf nodes (435 House + 100 Senate)
- Poseidon hashing (SNARK-friendly)
- Updated quarterly via IPFS
- Verified on-chain before acceptance

### Smart Contracts: Scroll L2 Settlement

**DistrictGate.sol** - UltraPlonk proof verification (permissionless actions):

```typescript
// Check if nullifier was used for an action
const used = await client.contracts.districtGate.isNullifierUsed(actionId, nullifier);

// Get participant count for an action
const count = await client.contracts.districtGate.getParticipantCount(actionId);

// Listen for verified actions
client.contracts.districtGate.onActionVerified((user, submitter, districtRoot, country, nullifier, actionId) => {
  console.log(`Action verified: ${user} for action ${actionId}`);
});
```

**Important**: Actions are permissionless - any `bytes32` actionId is valid without pre-authorization. Spam is mitigated by:
- Rate limits (60s between actions per user)
- Gas costs (~$0.003-0.05 per tx)
- ZK proof generation time (8-15s in browser)

**ReputationRegistry.sol** - ERC-8004 reputation:

```typescript
// Get reputation score
const rep = await client.contracts.reputationRegistry.getReputation(
  address,
  'healthcare'  // Domain-specific reputation
);

console.log('Score:', rep.score);      // 0-10000
console.log('Tier:', rep.tier);        // trusted | established | emerging | novice | untrusted
console.log('Decay:', rep.decayRate);  // Annual decay percentage

// Check minimum threshold
const hasRep = await client.contracts.reputationRegistry.hasReputation(
  address,
  'healthcare',
  5000  // Minimum score
);
```

## API Reference

### VOTERClient

```typescript
interface VOTERClientConfig {
  network: 'scroll-mainnet' | 'scroll-sepolia';
  nearNetwork?: 'mainnet' | 'testnet';
  districtGateAddress: string;
  districtRegistryAddress: string;
  nullifierRegistryAddress: string;
  reputationRegistryAddress?: string;  // Phase 2
  ipfsGateway?: string;
  cacheStrategy?: 'aggressive' | 'minimal';
}

const client = new VOTERClient(config);
```

### Account Management

```typescript
// Create account
client.account.create({ method: 'passkey' | 'seed' })

// Derive addresses
client.account.deriveScrollAddress(nearAccountId)
client.account.deriveEthereumAddress(nearAccountId)
client.account.deriveBitcoinAddress(nearAccountId)

// Sign transactions
client.account.signTransaction({ payload, path, keyVersion })
```

### Zero-Knowledge Proofs

```typescript
// Generate district proof (address never leaves browser)
client.zk.proveDistrict({
  address: string,
  actionId: bytes32  // Any bytes32 is valid (permissionless)
})

// Load Shadow Atlas
client.zk.shadowAtlas.load(cid: string)

// Generate Merkle proof
client.zk.shadowAtlas.generateProof(address: string)

// Estimate proving time
client.zk.noirProver.estimateProvingTime()

// Sign EIP-712 proof submission (MEV-resistant)
client.signProofSubmission({
  proof: bytes,
  districtRoot: bytes32,
  nullifier: bytes32,
  actionId: bytes32,
  country: bytes3
})
```

### Contract Interactions

```typescript
// DistrictGate - EIP-712 signature-based (MEV-resistant)
client.contracts.districtGate.verifyAndAuthorizeWithSignature(
  signer, proof, districtRoot, nullifier, actionId, country, deadline, signature
)
client.contracts.districtGate.isNullifierUsed(actionId, nullifier)
client.contracts.districtGate.getParticipantCount(actionId)
client.contracts.districtGate.nonces(address)  // For signature construction
client.contracts.districtGate.DOMAIN_SEPARATOR()  // EIP-712 domain
client.contracts.districtGate.SUBMIT_PROOF_TYPEHASH()  // EIP-712 typehash
client.contracts.districtGate.onActionVerified(callback)

// Helper for EIP-712 signature
client.signProofSubmission({ proof, districtRoot, nullifier, actionId, country })

// ReputationRegistry (Phase 2)
client.contracts.reputationRegistry.getReputation(address, domain)
client.contracts.reputationRegistry.getReputationTier(address, domain)
client.contracts.reputationRegistry.hasReputation(address, domain, minScore)
client.contracts.reputationRegistry.getDomains(address)
client.contracts.reputationRegistry.onReputationUpdated(callback)
```

## Examples

See `/examples` directory for complete usage examples:

- `basic-usage.ts` - Account creation, district verification, reputation
- More examples coming soon

## Testing

```bash
# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Type checking
npm run typecheck
```

## Security

- **Private keys never leave device** - NEAR passkeys use WebAuthn
- **Address never on-chain** - Zero-knowledge proofs reveal only districtHash
- **MPC signing** - No single point of failure (300+ validators)
- **Audited contracts** - Professional security audits before mainnet

See [SECURITY.md](../../SECURITY.md) for complete threat model.

## License

MIT License - see [LICENSE](../../LICENSE)

## Links

- **Protocol Docs**: [TECHNICAL.md](../../TECHNICAL.md)
- **Architecture**: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Smart Contracts**: [/contracts](../../contracts/)
- **Main Repo**: [voter-protocol](https://github.com/voter-protocol/voter-protocol)

---

**Making democracy engaging is essential for its evolution in the attention economy.**

*Quality discourse pays. Bad faith costs.*
