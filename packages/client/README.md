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

The main client class that coordinates all protocol functionality.

```typescript
class VOTERClient {
  constructor(config: VOTERClientConfig);

  // Initialization
  ready(): Promise<void>;                    // Wait for async initialization
  isReady(): boolean;                        // Check if ready (sync)
  getState(): VOTERClientState;              // Get current state
  getNetwork(): string;                      // Get network name

  // Wallet connection
  connectSigner(signer: ethers.Signer): void;
  useChainSignaturesSigner(): ChainSignaturesSigner;

  // API namespaces
  account: AccountAPI;
  zk: ZKProofAPI;
  contracts: ContractsAPI;
}

interface VOTERClientConfig {
  // Network (required)
  network: 'scroll-mainnet' | 'scroll-sepolia';
  nearNetwork?: 'mainnet' | 'testnet';  // Default: 'mainnet'

  // Contract addresses (required)
  districtGateAddress: string;
  reputationRegistryAddress: string;

  // Optional configuration
  walletProvider?: ethers.Eip1193Provider;  // Existing wallet (e.g., window.ethereum)
  skipNEAR?: boolean;                       // Skip NEAR initialization
  shadowAtlasUrl?: string;                  // Shadow Atlas endpoint (default: IPFS gateway)
  ipfsGateway?: string;                     // Deprecated: use shadowAtlasUrl
  cacheStrategy?: 'aggressive' | 'moderate' | 'minimal';  // Default: 'aggressive'
}

interface VOTERClientState {
  initialized: boolean;
  nearAccount: NEARAccount | null;
  scrollAddress: string | null;
  connectedWallet: string | null;
}
```

### Account Management API

```typescript
client.account.create(options: {
  method: 'passkey' | 'seed'
}): Promise<{
  nearAccount: string;
  scrollAddress: string;
  ethAddress: string;
}>

client.account.getState(): {
  nearAccount: string | null;
  scrollAddress: string | null;
  connectedWallet: string | null;
}
```

### Zero-Knowledge Proof API

```typescript
client.zk.proveDistrict(params: {
  address: string | StreetAddress;
}): Promise<DistrictProof>

client.zk.verifyProof(proof: DistrictProof): Promise<boolean>

// Direct access to components
client.zk.shadowAtlas: ShadowAtlas | null
client.zk.noirProver: NoirProverAdapter | null
```

### Contract APIs

#### DistrictGate Contract

```typescript
// Read methods
client.contracts.districtGate.isVerified(address: string): Promise<boolean>
client.contracts.districtGate.getUserDistrict(address: string): Promise<string>
client.contracts.districtGate.getShadowAtlasCID(): Promise<string>
client.contracts.districtGate.getCurrentMerkleRoot(): Promise<string>
client.contracts.districtGate.getVerifierContract(): Promise<string>
client.contracts.districtGate.getAddress(): string
client.contracts.districtGate.getVerifierAddress(): string

// Write methods (requires signer)
client.contracts.districtGate.verifyDistrict(
  proof: DistrictProof
): Promise<ContractTransaction>

client.contracts.districtGate.updateShadowAtlas(
  newCID: string,
  newRoot: string
): Promise<ContractTransaction>

// Gas estimation
client.contracts.districtGate.estimateVerificationGas(
  proof: DistrictProof
): Promise<bigint>

// Event listeners
client.contracts.districtGate.onDistrictVerified(
  callback: (user: string, districtHash: string) => void
): () => void  // Returns unsubscribe function

client.contracts.districtGate.onShadowAtlasUpdated(
  callback: (newCID: string, newRoot: string) => void
): () => void
```

#### ReputationRegistry Contract

```typescript
// Read methods
client.contracts.reputationRegistry.getReputation(
  address: string,
  domain: string
): Promise<ReputationScore>

client.contracts.reputationRegistry.getReputationTier(
  address: string,
  domain: string
): Promise<ReputationTier>

client.contracts.reputationRegistry.hasReputation(
  address: string,
  domain: string,
  minScore: number
): Promise<boolean>

client.contracts.reputationRegistry.getDomains(
  address: string
): Promise<string[]>

client.contracts.reputationRegistry.getAddress(): string

// Write methods (requires signer)
client.contracts.reputationRegistry.updateReputation(
  user: string,
  domain: string,
  delta: number,
  reason: string
): Promise<ContractTransaction>

client.contracts.reputationRegistry.setDecayRate(
  user: string,
  domain: string,
  annualDecayPercent: number
): Promise<ContractTransaction>

client.contracts.reputationRegistry.transferReputation(
  to: string,
  domain: string,
  amount: number
): Promise<ContractTransaction>

// Event listeners
client.contracts.reputationRegistry.onReputationUpdated(
  callback: (user: string, domain: string, newScore: number, delta: number, reason: string) => void
): () => void

client.contracts.reputationRegistry.onReputationDecayed(
  callback: (user: string, domain: string, oldScore: number, newScore: number) => void
): () => void
```

## TypeScript Types

### Core Types

```typescript
// Account types
interface NEARAccount {
  accountId: string;           // Implicit account ID (64-char hex)
  keyPair: KeyPair;            // Ed25519 keypair
  publicKey: string;           // Base58 encoded
}

interface ChainSignatureRequest {
  payload: Uint8Array;         // Transaction hash to sign
  path: string;                // Derivation path (e.g., "scroll,1")
  keyVersion: number;          // MPC key version
}

interface ChainSignature {
  r: string;                   // ECDSA signature r
  s: string;                   // ECDSA signature s
  v: number;                   // Recovery ID
  publicKey: string;           // Derived public key
}

// Zero-knowledge proof types
interface DistrictProof {
  proof: Uint8Array;           // Noir proof bytes
  districtHash: string;        // Public output: Poseidon(address, district)
  merkleRoot: string;          // Shadow Atlas Merkle root
  publicSignals: string[];     // All public signals
  metadata?: {
    provingTimeMs?: number;
    proofSizeBytes?: number;
    circuitSize?: number;
    cacheHit?: boolean;
  };
}

interface MerkleProof {
  leaf: {
    hash: string;
    districtId?: string;
    districtType?: 'house' | 'senate';
  };
  path: string[];              // Merkle path hashes
  pathIndices: number[];       // Path directions (0 = left, 1 = right)
  root: string;                // Merkle root
}

interface ProofInputs {
  address: StreetAddress;
  merkleProof: MerkleProof;
}

// Reputation types
enum ReputationTier {
  TRUSTED = 'trusted',         // 80-100 score
  ESTABLISHED = 'established', // 60-79 score
  EMERGING = 'emerging',       // 40-59 score
  NOVICE = 'novice',           // 20-39 score
  UNTRUSTED = 'untrusted'      // 0-19 score
}

interface ReputationScore {
  score: number;               // 0-10000 (stored as integer on-chain)
  tier: ReputationTier;
  lastUpdate: Date;
  decayRate: number;           // Annual decay percentage
  domain: string;              // e.g., "healthcare", "climate"
}

// Address types (branded types for type safety)
type StreetAddress = string & { readonly __brand: 'StreetAddress' };
type EthereumAddress = string & { readonly __brand: 'EthereumAddress' };

// Contract config
interface DistrictGateConfig {
  address: string;
  verifierAddress: string;     // Noir verifier contract
}

interface ShadowAtlasConfig {
  endpoint: string;
  cacheStrategy: 'aggressive' | 'moderate' | 'minimal';
}
```

### Error Types

```typescript
class VOTERError extends Error {
  constructor(message: string, code?: string);
  code?: string;
}

class ProofGenerationError extends VOTERError {
  constructor(message: string);
  name: 'ProofGenerationError';
  code: 'PROOF_GENERATION_ERROR';
}

class ContractError extends VOTERError {
  constructor(message: string, txHash?: string);
  name: 'ContractError';
  code: 'CONTRACT_ERROR';
  txHash?: string;
}

class NetworkError extends VOTERError {
  constructor(message: string, statusCode?: number);
  name: 'NetworkError';
  code: 'NETWORK_ERROR';
  statusCode?: number;
}

class AccountError extends VOTERError {
  constructor(message: string);
  name: 'AccountError';
  code: 'ACCOUNT_ERROR';
}
```

### Utility Functions

```typescript
// Address utilities
function createStreetAddress(address: string): StreetAddress;
function createEthereumAddress(address: string): EthereumAddress;
function isStreetAddress(value: unknown): value is StreetAddress;
function isEthereumAddress(value: unknown): value is EthereumAddress;
function sanitizeStreetAddressForLogging(address: StreetAddress): string;
function toChecksumAddress(address: string): string;

// Encoding utilities
function uint8ToBase64(data: Uint8Array): string;
function base64ToUint8(data: string): Uint8Array;
function uint8ToHex(data: Uint8Array): string;
function hexToUint8(data: string): Uint8Array;

// Formatting utilities
function formatTokenAmount(amount: bigint, decimals: number): string;
function getReputationTier(score: number): ReputationTier;
function isConnectedWallet(client: VOTERClient): boolean;
```

## Usage Examples

### Example 1: Creating an Account with Passkey

```typescript
import { VOTERClient } from '@voter-protocol/client';

const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x1234...', // Your deployed DistrictGate contract
  reputationRegistryAddress: '0x5678...' // Your deployed ReputationRegistry contract
});

// Create account using Face ID/Touch ID (no gas required)
const account = await client.account.create({
  method: 'passkey'
});

console.log('NEAR Account:', account.nearAccount);
console.log('Scroll Address:', account.scrollAddress);
console.log('Ethereum Address:', account.ethAddress);
```

### Example 2: Generating a District Proof

```typescript
// Wait for client initialization (MUST call before using zk APIs)
await client.ready();

// Generate zero-knowledge proof of congressional district
// Address never leaves the browser
const proof = await client.zk.proveDistrict({
  address: '1600 Pennsylvania Avenue NW, Washington, DC 20500'
});

console.log('Proof generated:', {
  districtHash: proof.districtHash,
  merkleRoot: proof.merkleRoot,
  proofSize: proof.proof.length,
  provingTime: proof.metadata?.provingTimeMs
});

// Verify proof locally before submitting
const isValid = await client.zk.verifyProof(proof);
console.log('Proof valid:', isValid);
```

### Example 3: Submitting Proof with MetaMask

```typescript
import { ethers } from 'ethers';

// Connect MetaMask
const provider = new ethers.BrowserProvider(window.ethereum);
await provider.send('eth_requestAccounts', []);
const signer = await provider.getSigner();

// Connect signer to client
client.connectSigner(signer);

// Submit proof on-chain
const tx = await client.contracts.districtGate.verifyDistrict(proof);
console.log('Transaction submitted:', tx.hash);

// Wait for confirmation
const receipt = await tx.wait();
console.log('District verified! Block:', receipt.blockNumber);
```

### Example 4: Using NEAR Chain Signatures

```typescript
// Create NEAR account
await client.account.create({ method: 'passkey' });

// Use NEAR MPC signer instead of MetaMask
const nearSigner = client.useChainSignaturesSigner();
client.connectSigner(nearSigner);

// Now contract calls use NEAR Chain Signatures (2-3 second latency)
const proof = await client.zk.proveDistrict({
  address: '123 Main St, Springfield, IL 62701'
});

const tx = await client.contracts.districtGate.verifyDistrict(proof);
await tx.wait(); // Signed via 300+ NEAR validators
```

### Example 5: Checking Reputation

```typescript
// Get reputation for a user in the "healthcare" domain
const reputation = await client.contracts.reputationRegistry.getReputation(
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  'healthcare'
);

console.log('Reputation:', {
  score: reputation.score,       // 0-10000
  tier: reputation.tier,         // 'trusted' | 'established' | 'emerging' | 'novice' | 'untrusted'
  domain: reputation.domain,     // 'healthcare'
  decayRate: reputation.decayRate, // Annual decay percentage
  lastUpdate: reputation.lastUpdate
});

// Check minimum threshold (e.g., for gating features)
const hasMinRep = await client.contracts.reputationRegistry.hasReputation(
  '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  'healthcare',
  5000  // Minimum score required
);

console.log('Meets threshold:', hasMinRep);
```

### Example 6: Listening for Events

```typescript
// Listen for district verifications
const unsubscribe = client.contracts.districtGate.onDistrictVerified(
  (user, districtHash) => {
    console.log(`User ${user} verified district ${districtHash}`);
  }
);

// Listen for reputation updates
const unsubscribeRep = client.contracts.reputationRegistry.onReputationUpdated(
  (user, domain, newScore, delta, reason) => {
    console.log(`${user} reputation in ${domain}: ${newScore} (${delta > 0 ? '+' : ''}${delta})`);
    console.log(`Reason: ${reason}`);
  }
);

// Cleanup when done
unsubscribe();
unsubscribeRep();
```

### Example 7: Estimating Gas Costs

```typescript
const proof = await client.zk.proveDistrict({
  address: '1600 Pennsylvania Avenue NW, Washington, DC 20500'
});

// Estimate gas before submitting
const gasEstimate = await client.contracts.districtGate.estimateVerificationGas(proof);
console.log('Estimated gas:', gasEstimate.toString());

// Get current gas price
const feeData = await client.contracts.districtGate.getAddress()
  .then(addr => ethers.getDefaultProvider('https://sepolia-rpc.scroll.io').getFeeData());

const estimatedCost = gasEstimate * (feeData.gasPrice || 0n);
console.log('Estimated cost:', ethers.formatEther(estimatedCost), 'ETH');
```

### Example 8: Error Handling

```typescript
import {
  VOTERError,
  ProofGenerationError,
  ContractError,
  NetworkError
} from '@voter-protocol/client';

try {
  const proof = await client.zk.proveDistrict({
    address: 'invalid address'
  });
} catch (error) {
  if (error instanceof ProofGenerationError) {
    console.error('Proof generation failed:', error.message);
    // Show user-friendly error message
  } else if (error instanceof ContractError) {
    console.error('Contract interaction failed:', error.message);
    console.error('Transaction hash:', error.txHash);
    // Check transaction on block explorer
  } else if (error instanceof NetworkError) {
    console.error('Network error:', error.message);
    console.error('Status code:', error.statusCode);
    // Retry with exponential backoff
  } else if (error instanceof VOTERError) {
    console.error('VOTER Protocol error:', error.message);
    console.error('Error code:', error.code);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Example 9: Advanced Configuration

```typescript
const client = new VOTERClient({
  network: 'scroll-mainnet',
  nearNetwork: 'mainnet',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',

  // Custom Shadow Atlas endpoint (for development)
  shadowAtlasUrl: 'http://localhost:8080/atlas',

  // Cache strategy: 'aggressive' (default), 'moderate', 'minimal'
  cacheStrategy: 'moderate',

  // Skip NEAR initialization (if you only need proof generation)
  skipNEAR: true,

  // Connect existing wallet
  walletProvider: window.ethereum
});

// Check client state
const state = client.getState();
console.log('Client initialized:', state.initialized);
console.log('Network:', client.getNetwork());
```

## Complete Workflows

### Workflow: First-Time User Verification

```typescript
import { VOTERClient } from '@voter-protocol/client';
import { ethers } from 'ethers';

async function verifyNewUser(address: string) {
  // 1. Initialize client
  const client = new VOTERClient({
    network: 'scroll-sepolia',
    districtGateAddress: process.env.DISTRICT_GATE_ADDRESS!,
    reputationRegistryAddress: process.env.REPUTATION_REGISTRY_ADDRESS!
  });

  // 2. Create FREE account (no gas required)
  console.log('Creating account...');
  const account = await client.account.create({ method: 'passkey' });
  console.log('Account created:', account.scrollAddress);

  // 3. Wait for ZK components to initialize
  console.log('Initializing ZK prover...');
  await client.ready();

  // 4. Generate proof (8-15 seconds)
  console.log('Generating proof...');
  const startTime = Date.now();
  const proof = await client.zk.proveDistrict({ address });
  const provingTime = Date.now() - startTime;
  console.log(`Proof generated in ${provingTime}ms`);

  // 5. Connect wallet signer
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  client.connectSigner(signer);

  // 6. Estimate gas cost
  const gasEstimate = await client.contracts.districtGate.estimateVerificationGas(proof);
  console.log('Estimated gas:', gasEstimate.toString());

  // 7. Submit proof on-chain
  console.log('Submitting proof...');
  const tx = await client.contracts.districtGate.verifyDistrict(proof);
  console.log('Transaction hash:', tx.hash);

  // 8. Wait for confirmation (~2 seconds on Scroll L2)
  const receipt = await tx.wait();
  console.log('Verified! Block:', receipt.blockNumber);

  return {
    account,
    proof,
    transaction: receipt
  };
}
```

### Workflow: Checking Verification Status

```typescript
async function checkUserStatus(userAddress: string) {
  const client = new VOTERClient({
    network: 'scroll-sepolia',
    districtGateAddress: process.env.DISTRICT_GATE_ADDRESS!,
    reputationRegistryAddress: process.env.REPUTATION_REGISTRY_ADDRESS!
  });

  // Check if user has verified their district
  const isVerified = await client.contracts.districtGate.isVerified(userAddress);

  if (isVerified) {
    // Get their district hash
    const districtHash = await client.contracts.districtGate.getUserDistrict(userAddress);

    // Get their reputation across all domains
    const domains = await client.contracts.reputationRegistry.getDomains(userAddress);
    const reputations = await Promise.all(
      domains.map(domain =>
        client.contracts.reputationRegistry.getReputation(userAddress, domain)
      )
    );

    return {
      verified: true,
      districtHash,
      reputations: reputations.map(rep => ({
        domain: rep.domain,
        score: rep.score,
        tier: rep.tier
      }))
    };
  }

  return { verified: false };
}
```

## Configuration Options

### Network Selection

```typescript
// Scroll Sepolia (testnet)
const client = new VOTERClient({
  network: 'scroll-sepolia',
  nearNetwork: 'testnet',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...'
});

// Scroll Mainnet (production)
const client = new VOTERClient({
  network: 'scroll-mainnet',
  nearNetwork: 'mainnet',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...'
});
```

### Cache Strategies

```typescript
// Aggressive caching (default) - best for production
// Caches Shadow Atlas, proofs, and contract data
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  cacheStrategy: 'aggressive'
});

// Moderate caching - balance between freshness and performance
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  cacheStrategy: 'moderate'
});

// Minimal caching - always fetch fresh data (development)
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  cacheStrategy: 'minimal'
});
```

### Shadow Atlas Sources

```typescript
// Production: IPFS via custom gateway
const client = new VOTERClient({
  network: 'scroll-mainnet',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  shadowAtlasUrl: 'https://gateway.voter.network/ipfs'
});

// Development: Local shadow atlas server
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  shadowAtlasUrl: 'http://localhost:8080/atlas'
});

// Alternative: Pinata IPFS gateway
const client = new VOTERClient({
  network: 'scroll-mainnet',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  shadowAtlasUrl: 'https://gateway.pinata.cloud/ipfs'
});
```

### Wallet Integration

```typescript
// MetaMask
const provider = new ethers.BrowserProvider(window.ethereum);
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  walletProvider: window.ethereum
});

// WalletConnect
import { EthereumProvider } from '@walletconnect/ethereum-provider';
const provider = await EthereumProvider.init({
  projectId: 'YOUR_PROJECT_ID',
  chains: [534351], // Scroll Sepolia
  showQrModal: true
});
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...',
  walletProvider: provider
});

// NEAR Chain Signatures (no external wallet needed)
const client = new VOTERClient({
  network: 'scroll-sepolia',
  districtGateAddress: '0x...',
  reputationRegistryAddress: '0x...'
});
await client.account.create({ method: 'passkey' });
const signer = client.useChainSignaturesSigner();
client.connectSigner(signer);
```

## Common Patterns

### Pattern: Retry with Exponential Backoff

```typescript
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (error instanceof NetworkError) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error; // Don't retry non-network errors
      }
    }
  }

  throw lastError;
}

// Usage
const proof = await retryOperation(() =>
  client.zk.proveDistrict({ address: '123 Main St, Springfield, IL 62701' })
);
```

### Pattern: Progress Tracking

```typescript
interface ProofProgress {
  stage: 'loading-atlas' | 'generating-merkle' | 'proving' | 'complete';
  progress: number; // 0-100
}

async function proveDistrictWithProgress(
  client: VOTERClient,
  address: string,
  onProgress: (progress: ProofProgress) => void
): Promise<DistrictProof> {
  // Stage 1: Loading Shadow Atlas
  onProgress({ stage: 'loading-atlas', progress: 0 });
  await client.ready();
  onProgress({ stage: 'loading-atlas', progress: 100 });

  // Stage 2: Generating Merkle proof
  onProgress({ stage: 'generating-merkle', progress: 0 });
  // (This happens internally in proveDistrict)

  // Stage 3: ZK proof generation
  onProgress({ stage: 'proving', progress: 0 });
  const proof = await client.zk.proveDistrict({ address });

  // Complete
  onProgress({ stage: 'complete', progress: 100 });
  return proof;
}

// Usage with React
const [progress, setProgress] = useState<ProofProgress>({ stage: 'loading-atlas', progress: 0 });
const proof = await proveDistrictWithProgress(client, address, setProgress);
```

### Pattern: Transaction Monitoring

```typescript
async function submitProofWithMonitoring(
  client: VOTERClient,
  proof: DistrictProof
) {
  console.log('Estimating gas...');
  const gasEstimate = await client.contracts.districtGate.estimateVerificationGas(proof);

  console.log('Submitting transaction...');
  const tx = await client.contracts.districtGate.verifyDistrict(proof);
  console.log('Transaction hash:', tx.hash);

  // Monitor transaction status
  console.log('Waiting for confirmation...');
  const receipt = await tx.wait();

  if (receipt.status === 1) {
    console.log('Transaction successful!');
    console.log('Block number:', receipt.blockNumber);
    console.log('Gas used:', receipt.gasUsed.toString());
  } else {
    console.error('Transaction failed!');
    throw new ContractError('Transaction failed', tx.hash);
  }

  return receipt;
}
```

### Pattern: Batch Reputation Checks

```typescript
async function checkMultipleReputations(
  client: VOTERClient,
  addresses: string[],
  domain: string,
  minScore: number
) {
  const results = await Promise.all(
    addresses.map(async (address) => {
      try {
        const hasRep = await client.contracts.reputationRegistry.hasReputation(
          address,
          domain,
          minScore
        );
        return { address, hasRep, error: null };
      } catch (error) {
        return { address, hasRep: false, error: error as Error };
      }
    })
  );

  return {
    qualified: results.filter(r => r.hasRep && !r.error),
    unqualified: results.filter(r => !r.hasRep && !r.error),
    errors: results.filter(r => r.error)
  };
}
```

### Pattern: Safe Address Input Validation

```typescript
import { createStreetAddress, isStreetAddress } from '@voter-protocol/client';

function validateAndCreateAddress(input: string): StreetAddress {
  // Trim whitespace
  const trimmed = input.trim();

  // Basic validation
  if (trimmed.length < 10) {
    throw new Error('Address too short');
  }

  // Check for required components (street, city, state, zip)
  const hasStreet = /\d+\s+\w+/.test(trimmed);
  const hasState = /\b[A-Z]{2}\b/.test(trimmed);
  const hasZip = /\d{5}(-\d{4})?/.test(trimmed);

  if (!hasStreet || !hasState || !hasZip) {
    throw new Error('Address missing required components (street, state, or zip)');
  }

  // Create branded type
  return createStreetAddress(trimmed);
}

// Usage
try {
  const address = validateAndCreateAddress(userInput);
  const proof = await client.zk.proveDistrict({ address });
} catch (error) {
  console.error('Invalid address:', error.message);
}
```

### Pattern: Event Stream Processing

```typescript
class DistrictVerificationMonitor {
  private unsubscribe: (() => void) | null = null;
  private verifications: Map<string, { districtHash: string; timestamp: Date }> = new Map();

  start(client: VOTERClient) {
    this.unsubscribe = client.contracts.districtGate.onDistrictVerified(
      (user, districtHash) => {
        this.verifications.set(user, {
          districtHash,
          timestamp: new Date()
        });
        console.log(`User ${user} verified district ${districtHash}`);
      }
    );
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  getStats() {
    return {
      totalVerifications: this.verifications.size,
      recentVerifications: Array.from(this.verifications.entries())
        .filter(([_, data]) => Date.now() - data.timestamp.getTime() < 3600000)
        .length
    };
  }
}

// Usage
const monitor = new DistrictVerificationMonitor();
monitor.start(client);
// ... later
monitor.stop();
```

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

- **Protocol Docs**: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Architecture**: [ARCHITECTURE.md](../../ARCHITECTURE.md)
- **Smart Contracts**: [/contracts](../../contracts/)
- **Main Repo**: [voter-protocol](https://github.com/voter-protocol/voter-protocol)

---

**Making democracy engaging is essential for its evolution in the attention economy.**

*Quality discourse pays. Bad faith costs.*
