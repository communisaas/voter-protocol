# @voter-protocol/client

TypeScript SDK for the VOTER Protocol - democracy infrastructure that competes in the attention economy.

## Features

- **🆓 FREE Account Creation** - NEAR implicit accounts via Face ID/Touch ID (no gas, no on-chain tx)
- **🔐 Multi-Chain Control** - One passkey controls Scroll, Ethereum, Bitcoin via NEAR Chain Signatures
- **🕵️ Zero-Knowledge Proofs** - Prove congressional district without revealing address (Halo2 SNARKs)
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
  reputationRegistryAddress: '0x...'
});

// Create account (FREE - no gas required)
const account = await client.account.create({
  method: 'passkey'  // Face ID / Touch ID
});

console.log('Scroll Address:', account.scrollAddress);
console.log('NEAR Account:', account.nearAccount);

// Generate zero-knowledge proof of congressional district
const proof = await client.zk.proveDistrict({
  address: '1600 Pennsylvania Avenue NW, Washington, DC 20500'
  // Address never leaves browser, never goes on-chain
});

// Submit proof on-chain (Scroll L2)
const tx = await client.contracts.districtGate.verifyDistrict(proof);
await tx.wait();

console.log('District verified!');
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

### Zero-Knowledge Proofs: Halo2 SNARKs

Prove congressional district membership without revealing address:

```typescript
// Generate proof (8-12 seconds in browser WASM)
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
- Proving time: 8-12 seconds (browser WASM)
- Proof size: 384-512 bytes
- Verification gas: ~200-250k on Scroll L2
- Security: Trusted setup-free (Halo2), quantum-resistant roadmap

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

**DistrictGate.sol** - Halo2 proof verification:

```typescript
// Check verification status
const isVerified = await client.contracts.districtGate.isVerified(address);

// Get verified district
const districtHash = await client.contracts.districtGate.getUserDistrict(address);

// Listen for verifications
client.contracts.districtGate.onDistrictVerified((user, districtHash) => {
  console.log(`New verification: ${user}`);
});
```

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
  reputationRegistryAddress: string;
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
// Generate district proof
client.zk.proveDistrict({ address: string })

// Load Shadow Atlas
client.zk.shadowAtlas.load(cid: string)

// Generate Merkle proof
client.zk.shadowAtlas.generateProof(address: string)

// Estimate proving time
client.zk.halo2Prover.estimateProvingTime()
```

### Contract Interactions

```typescript
// DistrictGate
client.contracts.districtGate.verifyDistrict(proof)
client.contracts.districtGate.isVerified(address)
client.contracts.districtGate.getUserDistrict(address)
client.contracts.districtGate.getShadowAtlasCID()
client.contracts.districtGate.onDistrictVerified(callback)

// ReputationRegistry
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
