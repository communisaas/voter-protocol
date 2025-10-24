# Brutalist Fix Plan: @voter-protocol/client

**Status:** NOT PRODUCTION READY - 3/8 components functional
**Estimated Fix Time:** 2-3 days for P0 issues
**Analysis Date:** 2025-10-22
**Analysis ID:** 346004a8

---

## Executive Summary

The core architecture is **sound** and **production-viable**. However, critical implementation gaps prevent the system from working end-to-end. The primary failure is in the critical path: **passkey → sign → prove → verify** is completely broken.

**What Works:**
- ✅ Account creation from random seed
- ✅ Shadow Atlas IPFS loading & validation
- ✅ Reputation registry read queries
- ✅ Type safety (strict TypeScript caught many issues)
- ✅ Clean API design and component separation

**What's Broken:**
- ❌ Passkey-based account creation (no private key)
- ❌ NEAR Chain Signatures (keystore not shared)
- ❌ Merkle proof generation (toy hash function)
- ❌ ZK proof generation (returns random bytes, leaks PII)
- ❌ Contract writes (no signer injection)

---

## Priority 0: Critical Security Fixes (MUST FIX)

### P0-1: Fix Passkey KeyPair Construction
**File:** `src/account/near-account.ts:54-114`
**Current Problem:** Creates KeyPair from public key only → no private key → cannot sign
**Impact:** Accounts created but completely unusable

#### Root Cause
```typescript
// ❌ BROKEN: KeyPair.fromString expects SECRET key, not public key
const publicKeyBase64 = Buffer.from(publicKey).toString('base64');
return KeyPair.fromString(`ed25519:${publicKeyBase64}`);
```

#### Solution: Use @near-js/biometric-ed25519

**Research Findings:**
- NEAR provides official biometric library: `@near-js/biometric-ed25519`
- API: `createKey(userName)` returns Ed25519 keypair
- API: `getKeys(userName)` retrieves stored keys (returns 2 possible pairs due to EC crypto)
- Already in dependencies: `"@near-js/biometric-ed25519": "^2.3.3"`

**Implementation:**
```typescript
import { createKey, getKeys } from '@near-js/biometric-ed25519';

private async createPasskeyKeyPair(): Promise<KeyPair> {
  if (!window.navigator.credentials) {
    throw new AccountError('WebAuthn not supported');
  }

  try {
    // Use NEAR's official biometric signer
    const userName = `voter-${Date.now()}`; // Unique identifier
    const keyPair = await createKey(userName);

    // Store username for future retrieval
    localStorage.setItem('voter_passkey_username', userName);

    return keyPair;
  } catch (error) {
    throw new AccountError(`Passkey creation failed: ${error.message}`);
  }
}

// Add retrieval method
async retrievePasskeyKeyPair(userName: string): Promise<KeyPair> {
  const keys = await getKeys(userName);

  // getKeys returns 2 possible keypairs due to EC crypto
  // Match against stored public key to find correct one
  const storedPublicKey = localStorage.getItem('voter_passkey_public_key');

  for (const keyPair of keys) {
    if (keyPair.getPublicKey().toString() === storedPublicKey) {
      return keyPair;
    }
  }

  throw new AccountError('Passkey not found');
}
```

**Files to Modify:**
- `src/account/near-account.ts` - Replace custom WebAuthn logic
- `src/account/types.ts` - Add retrieval methods to interface

**Testing:**
1. Create account with passkey
2. Verify keypair has both public + private keys
3. Attempt to sign a test message
4. Retrieve keypair after page reload

**Estimated Time:** 4 hours

---

### P0-2: Implement Cryptographic Poseidon Hashing
**File:** `src/zk/shadow-atlas.ts:209-224`
**Current Problem:** Using JavaScript string hash (djb2) → trivially forgeable proofs
**Impact:** Zero-knowledge proofs are worthless, anyone can forge Merkle siblings

#### Root Cause
```typescript
// ❌ BROKEN: Toy hash function with no cryptographic security
private hashPair(left: string, right: string): string {
  const combined = left + right;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash) + combined.charCodeAt(i);
    hash |= 0;
  }
  return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
}
```

#### Solution: Use circomlibjs Poseidon

**Research Findings:**
- `circomlibjs` provides browser-compatible Poseidon implementation
- Already in dependencies: `"circomlibjs": "^0.1.7"`
- Browser-safe, works in Web Workers
- Standard usage: `await circomlibjs.buildPoseidon()` → `poseidon([input])`
- Returns finite field element → convert with `poseidon.F.toString()`

**Implementation:**
```typescript
import { buildPoseidon } from 'circomlibjs';

export class ShadowAtlas {
  private poseidon: any = null; // Poseidon hasher instance

  constructor(...) {
    // ...existing code...
  }

  /**
   * Initialize Poseidon hasher (async, must be awaited)
   */
  private async initPoseidon(): Promise<void> {
    if (this.poseidon) return;
    this.poseidon = await buildPoseidon();
  }

  /**
   * Hash two nodes using Poseidon (SNARK-friendly)
   */
  private hashPair(left: string, right: string): string {
    if (!this.poseidon) {
      throw new ProofGenerationError('Poseidon not initialized');
    }

    // Convert hex strings to BigInt
    const leftBigInt = BigInt(left);
    const rightBigInt = BigInt(right);

    // Hash with Poseidon
    const hashBytes = this.poseidon([leftBigInt, rightBigInt]);
    const hash = this.poseidon.F.toString(hashBytes);

    // Return as hex string
    return '0x' + BigInt(hash).toString(16).padStart(64, '0');
  }

  /**
   * Load Shadow Atlas from IPFS
   */
  async load(cid: string): Promise<void> {
    // Initialize Poseidon before any hashing
    await this.initPoseidon();

    // ...existing IPFS loading code...

    // Verify Merkle root with REAL cryptographic hash
    const computedRoot = this.computeMerkleRoot(data.districts);
    if (computedRoot !== data.root) {
      throw new ProofGenerationError('Atlas root mismatch');
    }

    // ...rest of existing code...
  }
}
```

**Files to Modify:**
- `src/zk/shadow-atlas.ts` - Replace hashPair, add initPoseidon
- `src/zk/types.ts` - Add Poseidon initialization state if needed

**Testing:**
1. Compute Merkle root of test district set
2. Verify root matches on-chain root (once contracts deployed)
3. Generate proof, verify path hashes are valid Poseidon outputs
4. Attempt to forge sibling hash → should fail verification

**Estimated Time:** 6 hours (includes testing with mock on-chain root)

---

### P0-3: Share Keystore Between Components
**File:** `src/account/chain-signatures.ts:35`
**Current Problem:** New empty keystore → keys never loaded → MPC calls fail
**Impact:** Chain Signatures completely non-functional

#### Root Cause
```typescript
// ❌ BROKEN: Creates new empty keystore instead of sharing
const config = {
  networkId: this.networkId,
  keyStore: new keyStores.InMemoryKeyStore(), // Empty!
  nodeUrl: ...
};
```

#### Solution: Shared KeyStore Architecture

**Implementation:**
```typescript
// src/account/keystore-manager.ts (NEW FILE)
import { keyStores } from 'near-api-js';

/**
 * Singleton keystore shared across all NEAR components
 */
class KeyStoreManager {
  private static instance: keyStores.InMemoryKeyStore | null = null;

  static getKeyStore(): keyStores.InMemoryKeyStore {
    if (!KeyStoreManager.instance) {
      KeyStoreManager.instance = new keyStores.InMemoryKeyStore();
    }
    return KeyStoreManager.instance;
  }

  static resetKeyStore(): void {
    KeyStoreManager.instance = new keyStores.InMemoryKeyStore();
  }
}

export { KeyStoreManager };
```

```typescript
// src/account/near-account.ts
import { KeyStoreManager } from './keystore-manager';

export class NEARAccountManager {
  private keyStore: InstanceType<typeof keyStores.InMemoryKeyStore>;

  constructor(networkId: string) {
    // Use shared keystore
    this.keyStore = KeyStoreManager.getKeyStore();
    this.networkId = networkId;
  }

  // ...rest of existing code...
}
```

```typescript
// src/account/chain-signatures.ts
import { KeyStoreManager } from './keystore-manager';

export class ChainSignatureManager {
  private async init(): Promise<void> {
    if (this.near) return;

    const config = {
      networkId: this.networkId,
      keyStore: KeyStoreManager.getKeyStore(), // ✅ SHARED
      nodeUrl: ...
    };

    this.near = await connect(config);
    // ...rest of existing code...
  }
}
```

**Files to Modify:**
- `src/account/keystore-manager.ts` - NEW singleton manager
- `src/account/near-account.ts` - Use shared keystore
- `src/account/chain-signatures.ts` - Use shared keystore
- `src/index.ts` - Export KeyStoreManager for testing

**Testing:**
1. Create NEAR account via NEARAccountManager
2. Verify key is stored in shared keystore
3. Initialize ChainSignatureManager with same account
4. Attempt to derive address (should find key)
5. Attempt to sign transaction (should succeed)

**Estimated Time:** 3 hours

---

### P0-4: Remove Privacy-Violating Console Logs
**File:** `src/zk/halo2-prover.ts:70-79`
**Current Problem:** Logs part of user's street address → violates "never leaves browser"
**Impact:** Privacy breach, undermines entire ZK privacy model

#### Root Cause
```typescript
// ❌ BROKEN: Logs private data
console.log('Proof inputs:', {
  address: inputs.address.slice(0, 20) + '...',  // PII LEAK
  districtId: inputs.merkleProof.leaf.districtId
});
```

#### Solution: Remove Sensitive Logging

**Implementation:**
```typescript
async prove(inputs: ProofInputs): Promise<DistrictProof> {
  await this.init();

  // ✅ Log only non-sensitive metadata
  console.warn('Halo2Prover.prove(): Stub implementation');
  console.log('Proof metadata:', {
    districtType: inputs.merkleProof.leaf.districtType,
    merkleDepth: inputs.merkleProof.path.length,
    circuitSize: this.circuitConfig.k
  });

  // ...rest of stub implementation...
}
```

**Files to Modify:**
- `src/zk/halo2-prover.ts` - Remove address logging

**Testing:**
1. Generate proof with real address
2. Check console output
3. Verify no PII leaked

**Estimated Time:** 30 minutes

---

### P0-5: Verify On-Chain Merkle Root Before Proving
**File:** `src/zk/shadow-atlas.ts:37-75`
**Current Problem:** Generates proofs without checking on-chain root validity
**Impact:** Wasted proving time (8-12 seconds), guaranteed on-chain rejection

#### Solution: Root Verification Step

**Implementation:**
```typescript
/**
 * Load Shadow Atlas and verify against on-chain root
 */
async load(
  cid: string,
  onChainRoot?: string // Optional: verify against contract
): Promise<void> {
  if (this.currentCID === cid && this.atlasData) {
    return;
  }

  await this.initPoseidon();

  // ...existing IPFS loading code...

  // Verify Merkle root
  const computedRoot = this.computeMerkleRoot(data.districts);
  if (computedRoot !== data.root) {
    throw new ProofGenerationError('Atlas root mismatch - data corrupted');
  }

  // NEW: Verify against on-chain root if provided
  if (onChainRoot && computedRoot !== onChainRoot) {
    throw new ProofGenerationError(
      `Atlas root mismatch with on-chain contract. ` +
      `Computed: ${computedRoot}, On-chain: ${onChainRoot}. ` +
      `Atlas may be outdated - check for newer CID.`
    );
  }

  this.atlasData = data;
  this.currentCID = cid;

  // ...rest of existing code...
}
```

```typescript
// src/client.ts - Integration
get zk() {
  return {
    proveDistrict: async (params: { address: string }): Promise<DistrictProof> => {
      if (!this.halo2Prover || !this.shadowAtlas) {
        throw new Error('Client not initialized');
      }

      // Get current on-chain root
      const onChainRoot = await this.districtGateContract!.getCurrentMerkleRoot();

      // Get current CID from contract
      const cid = await this.districtGateContract!.getShadowAtlasCID();

      // Load Atlas and verify against on-chain root
      await this.shadowAtlas.load(cid, onChainRoot);

      // Generate proof (now guaranteed to match on-chain root)
      const merkleProof = await this.shadowAtlas.generateProof(params.address);
      const proof = await this.halo2Prover.prove({
        address: params.address,
        merkleProof
      });

      return proof;
    }
  };
}
```

**Files to Modify:**
- `src/zk/shadow-atlas.ts` - Add onChainRoot parameter to load()
- `src/client.ts` - Fetch and verify on-chain root before proving

**Testing:**
1. Deploy contract with known Merkle root
2. Load matching IPFS Atlas → should succeed
3. Load Atlas with different root → should throw clear error
4. Generate proof → verify root matches contract

**Estimated Time:** 2 hours

---

## Priority 1: Architectural Improvements (SHOULD FIX)

### P1-1: Add Explicit Async Initialization Pattern
**File:** `src/client.ts:96`
**Current Problem:** Constructor fires async init without await → race conditions
**Impact:** Unhandled promise rejections, null component access

#### Solution: Explicit `ready()` Method

**Implementation:**
```typescript
export class VOTERClient {
  private initPromise: Promise<void> | null = null;

  constructor(config: VOTERClientConfig) {
    // ...existing sync initialization...

    // Start async init but don't block constructor
    this.initPromise = this.initZKComponents();
  }

  /**
   * Wait for client to be fully initialized
   * MUST be called before using zk or contracts APIs
   */
  async ready(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  /**
   * Check if client is ready (synchronous)
   */
  isReady(): boolean {
    return this.state.initialized;
  }

  // Guard all async APIs
  get zk() {
    return {
      proveDistrict: async (params) => {
        await this.ready(); // ✅ Auto-wait if not ready

        if (!this.halo2Prover || !this.shadowAtlas) {
          throw new Error('Client components failed to initialize');
        }

        // ...rest of existing code...
      }
    };
  }
}
```

**Updated Usage Pattern:**
```typescript
// Create client (sync, fast)
const client = new VOTERClient({ ... });

// Wait for initialization (async, ~100-500ms)
await client.ready();

// Now safe to use
const proof = await client.zk.proveDistrict({ address });
```

**Files to Modify:**
- `src/client.ts` - Add ready() method, guard async APIs
- `examples/basic-usage.ts` - Add await client.ready()
- `README.md` - Update usage examples

**Testing:**
1. Create client without await ready() → should auto-wait
2. Call ready() multiple times → should be idempotent
3. Check isReady() before and after init
4. Simulate init failure → ready() should throw clear error

**Estimated Time:** 3 hours

---

### P1-2: Replace Node.js Buffer with Web APIs
**Files:** Multiple (`near-account.ts:106`, `chain-signatures.ts:129`, `district-gate.ts:59`)
**Current Problem:** Node.js Buffer won't work in browser without polyfills
**Impact:** Build failures, larger bundle size, runtime crashes

#### Solution: Use Native Web APIs

**Research Findings:**
- Modern browsers (Sept 2025+) support `Uint8Array.toBase64()` and `Uint8Array.fromBase64()`
- These are FASTER than polyfills and have zero dependencies
- For older browsers, core-js provides polyfill

**Implementation:**
```typescript
// src/utils/encoding.ts (NEW FILE)

/**
 * Browser-safe encoding utilities
 * Replaces Node.js Buffer with native Web APIs
 */

/**
 * Convert Uint8Array to base64 string
 * Uses native browser API (Sept 2025+) with polyfill fallback
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  // Modern browsers
  if (typeof bytes.toBase64 === 'function') {
    return bytes.toBase64();
  }

  // Fallback: btoa + String.fromCharCode
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToUint8(base64: string): Uint8Array {
  // Modern browsers
  if (typeof Uint8Array.fromBase64 === 'function') {
    return Uint8Array.fromBase64(base64);
  }

  // Fallback: atob
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function uint8ToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToUint8(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
```

**Replace Buffer Usage:**
```typescript
// ❌ BEFORE (near-account.ts:106)
const publicKeyBase64 = Buffer.from(publicKey).toString('base64');

// ✅ AFTER
import { uint8ToBase64 } from '../utils/encoding';
const publicKeyBase64 = uint8ToBase64(publicKey);
```

```typescript
// ❌ BEFORE (chain-signatures.ts:129)
const pubKeyBytes = Buffer.from(pubKeyHex, 'hex');

// ✅ AFTER
import { hexToUint8 } from '../utils/encoding';
const pubKeyBytes = hexToUint8(pubKeyHex);
```

```typescript
// ❌ BEFORE (district-gate.ts:59)
const proofBytes = '0x' + Buffer.from(proof.proof).toString('hex');

// ✅ AFTER
import { uint8ToHex } from '../utils/encoding';
const proofBytes = uint8ToHex(proof.proof);
```

**Files to Modify:**
- `src/utils/encoding.ts` - NEW browser-safe encoding utilities
- `src/account/near-account.ts` - Replace Buffer usage
- `src/account/chain-signatures.ts` - Replace Buffer usage
- `src/contracts/district-gate.ts` - Replace Buffer usage
- `package.json` - Add core-js as optional polyfill dependency

**Testing:**
1. Run in modern browser (Chrome 128+) → should use native APIs
2. Run in older browser → should use fallback
3. Test round-trip: bytes → base64 → bytes
4. Test round-trip: bytes → hex → bytes
5. Verify bundle size reduction

**Estimated Time:** 4 hours

---

### P1-3: Type-Safe Address Handling
**Files:** `src/zk/types.ts`, `src/zk/shadow-atlas.ts:119`
**Current Problem:** "address" parameter ambiguous (street vs Ethereum)
**Impact:** Runtime crashes, confusing API

#### Solution: Branded Types + Clear Naming

**Implementation:**
```typescript
// src/zk/types.ts

/**
 * Street address (private, never on-chain)
 * Example: "1600 Pennsylvania Avenue NW, Washington, DC 20500"
 */
export type StreetAddress = string & { readonly __brand: 'StreetAddress' };

/**
 * Ethereum address (public, hex format)
 * Example: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb4"
 */
export type EthereumAddress = string & { readonly __brand: 'EthereumAddress' };

/**
 * Validate and brand street address
 */
export function createStreetAddress(address: string): StreetAddress {
  if (!address || address.length < 10) {
    throw new Error('Invalid street address');
  }
  return address as StreetAddress;
}

/**
 * Validate and brand Ethereum address
 */
export function createEthereumAddress(address: string): EthereumAddress {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid Ethereum address format');
  }
  return address as EthereumAddress;
}

/**
 * Convert street address to search key for Shadow Atlas
 * Uses geocoding or address normalization service
 */
export async function streetToSearchKey(
  address: StreetAddress
): Promise<string> {
  // TODO: Integrate with geocoding service (Google Maps, Nominatim, etc.)
  // For now, return normalized form
  return address.toLowerCase().trim();
}
```

**Updated Types:**
```typescript
export interface ProofInputs {
  streetAddress: StreetAddress;  // ✅ Clear: street address (private)
  merkleProof: MerkleProof;
}

export interface DistrictLeaf {
  districtId: string;
  districtType: 'house' | 'senate';
  countryCode: string;
  hash: string;

  // Address range is for SEARCH, not Ethereum addresses
  searchKeyRangeStart: string;  // ✅ Clear: normalized address search key
  searchKeyRangeEnd: string;
}
```

**Updated Implementation:**
```typescript
// src/zk/shadow-atlas.ts

async generateProof(streetAddress: StreetAddress): Promise<MerkleProof> {
  if (!this.atlasData) {
    throw new ProofGenerationError('Shadow Atlas not loaded');
  }

  // Convert street address to search key
  const searchKey = await streetToSearchKey(streetAddress);

  // Find district leaf
  const leaf = this.findDistrictLeaf(searchKey);

  if (!leaf) {
    throw new ProofGenerationError(
      `Address not found in Shadow Atlas. ` +
      `This may indicate: (1) address outside supported districts, ` +
      `(2) address format not recognized, or (3) outdated Atlas data.`
    );
  }

  // ...rest of existing code...
}

private findDistrictLeaf(searchKey: string): DistrictLeaf | null {
  // Binary search on normalized search keys (NOT Ethereum addresses)
  // ...existing binary search logic...
}
```

**Updated Client API:**
```typescript
// src/client.ts

get zk() {
  return {
    proveDistrict: async (params: {
      streetAddress: string  // User-facing: accepts plain string
    }): Promise<DistrictProof> => {
      await this.ready();

      // Validate and brand
      const streetAddress = createStreetAddress(params.streetAddress);

      // ...rest of existing code with branded type...
    }
  };
}
```

**Files to Modify:**
- `src/zk/types.ts` - Add branded types, validation functions
- `src/zk/shadow-atlas.ts` - Use StreetAddress type, rename addressRange fields
- `src/client.ts` - Validate input at API boundary
- `examples/basic-usage.ts` - Update example to show clear address usage

**Testing:**
1. Pass valid street address → should succeed
2. Pass Ethereum address to proveDistrict → should throw clear error
3. Pass invalid string → should throw validation error
4. Type-check: try to pass StreetAddress where EthereumAddress expected → compile error

**Estimated Time:** 3 hours

---

### P1-4: Signer Injection Pattern for Contract Writes
**File:** `src/client.ts:74-97`
**Current Problem:** Contracts initialized with read-only provider → cannot write
**Impact:** All state-changing operations fail

#### Solution: Lazy Signer Injection

**Implementation:**
```typescript
export class VOTERClient {
  private signer: ethers.Signer | null = null;

  /**
   * Connect wallet for state-changing operations
   * Required before calling verifyDistrict, updateReputation, etc.
   */
  async connectSigner(signer: ethers.Signer): Promise<void> {
    this.signer = signer;

    // Reinitialize contracts with signer
    this.districtGateContract = new DistrictGateContract(
      {
        address: this.config.districtGateAddress,
        verifierAddress: '0x' // TODO: fetch from contract
      },
      signer  // ✅ Now has write access
    );

    this.reputationRegistryContract = new ReputationRegistryContract(
      this.config.reputationRegistryAddress,
      signer
    );
  }

  /**
   * Disconnect wallet
   */
  disconnectSigner(): void {
    this.signer = null;

    // Revert to read-only provider
    this.districtGateContract = new DistrictGateContract(
      { address: this.config.districtGateAddress, verifierAddress: '0x' },
      this.scrollProvider
    );

    this.reputationRegistryContract = new ReputationRegistryContract(
      this.config.reputationRegistryAddress,
      this.scrollProvider
    );
  }

  /**
   * Get connected signer address
   */
  async getSignerAddress(): Promise<string | null> {
    if (!this.signer) return null;
    return this.signer.getAddress();
  }

  /**
   * Check if signer is connected
   */
  hasSigner(): boolean {
    return this.signer !== null;
  }
}
```

**Alternative: NEAR Chain Signatures as Default Signer**
```typescript
export class VOTERClient {
  /**
   * Use NEAR Chain Signatures as signer (no external wallet needed)
   * This is the VOTER-native approach: one passkey controls everything
   */
  async useChainSignaturesSigner(): Promise<void> {
    if (!this.chainSignatures) {
      throw new Error('NEAR account not created - call account.create() first');
    }

    // Create ethers.Signer implementation that uses Chain Signatures
    const chainSigsSigner = new ChainSignaturesSigner(
      this.chainSignatures,
      this.scrollProvider
    );

    await this.connectSigner(chainSigsSigner);
  }
}
```

```typescript
// src/account/chain-signatures-signer.ts (NEW FILE)
import { ethers } from 'ethers';
import type { ChainSignatureManager } from './chain-signatures';

/**
 * Ethers.js Signer implementation using NEAR Chain Signatures
 * Enables VOTER clients to sign Scroll/Ethereum transactions via MPC
 */
export class ChainSignaturesSigner extends ethers.AbstractSigner {
  constructor(
    private chainSigs: ChainSignatureManager,
    provider: ethers.Provider
  ) {
    super(provider);
  }

  async getAddress(): Promise<string> {
    // Derive from NEAR account via MPC
    return this.chainSigs.deriveScrollAddress(
      this.chainSigs['nearAccount'].accountId
    );
  }

  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    // Serialize transaction
    const serialized = ethers.Transaction.from(tx).unsignedSerialized;
    const txHash = ethers.keccak256(serialized);

    // Sign via NEAR MPC (~2-3 seconds)
    const signature = await this.chainSigs.signTransaction({
      payload: ethers.getBytes(txHash),
      path: 'scroll,1',
      keyVersion: 0
    });

    // Combine into signed transaction
    const signedTx = ethers.Transaction.from({
      ...tx,
      signature: {
        r: signature.r,
        s: signature.s,
        v: signature.v
      }
    });

    return signedTx.serialized;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const messageHash = ethers.hashMessage(message);

    const signature = await this.chainSigs.signTransaction({
      payload: ethers.getBytes(messageHash),
      path: 'scroll,1',
      keyVersion: 0
    });

    return ethers.Signature.from({
      r: signature.r,
      s: signature.s,
      v: signature.v
    }).serialized;
  }

  connect(provider: ethers.Provider): ChainSignaturesSigner {
    return new ChainSignaturesSigner(this.chainSigs, provider);
  }
}
```

**Updated Usage Pattern:**
```typescript
// Option 1: External wallet (MetaMask)
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
await client.connectSigner(signer);

// Option 2: NEAR Chain Signatures (VOTER-native)
await client.account.create({ method: 'passkey' });
await client.useChainSignaturesSigner();

// Now can submit proofs
const tx = await client.contracts.districtGate.verifyDistrict(proof);
```

**Files to Modify:**
- `src/client.ts` - Add connectSigner, useChainSignaturesSigner methods
- `src/account/chain-signatures-signer.ts` - NEW ethers.Signer implementation
- `examples/basic-usage.ts` - Show both signer patterns
- `README.md` - Document signer options

**Testing:**
1. Connect MetaMask → verify signer address
2. Submit proof transaction → should succeed
3. Use Chain Signatures signer → verify MPC signing works
4. Disconnect signer → verify contracts revert to read-only

**Estimated Time:** 6 hours

---

## Priority 2: Feature Flags & Documentation (NICE TO HAVE)

### P2-1: Feature Flag Stub ZK Implementation
**File:** `src/zk/halo2-prover.ts`

**Implementation:**
```typescript
export class Halo2Prover {
  private stubMode: boolean = true; // Feature flag

  async prove(inputs: ProofInputs): Promise<DistrictProof> {
    await this.init();

    if (this.stubMode) {
      console.error(
        '⚠️  WARNING: Halo2 prover running in STUB mode. ' +
        'Proofs will NOT verify on-chain. ' +
        'This is expected during Phase 1 development.'
      );
    }

    // ...existing stub implementation...
  }

  /**
   * Enable real Halo2 proving (requires Axiom integration)
   */
  enableRealProving(): void {
    if (!this.realProverImplemented()) {
      throw new Error('Real Halo2 prover not yet implemented');
    }
    this.stubMode = false;
  }

  private realProverImplemented(): boolean {
    // Check if Axiom WASM is loaded
    return false; // TODO: implement
  }
}
```

**Estimated Time:** 1 hour

---

### P2-2: Comprehensive Error Messages

Add context to all errors:
- Shadow Atlas not found → suggest checking CID, IPFS gateway
- Address not in Atlas → explain possible causes (out of district, format issue)
- Keystore errors → explain passkey storage, browser compatibility
- MPC signing failures → explain timeout, network issues

**Estimated Time:** 2 hours

---

### P2-3: Update Documentation

**Files to Update:**
- `README.md` - Add `await client.ready()` to examples
- `README.md` - Document signer connection patterns
- `IMPLEMENTATION_STATUS.md` - Update with fix status
- `examples/basic-usage.ts` - Complete working example
- New: `docs/TROUBLESHOOTING.md` - Common issues and solutions

**Estimated Time:** 3 hours

---

## Implementation Timeline

### Day 1 (8 hours)
- **Morning (4h):** P0-1 (Passkey fix) + P0-3 (Shared keystore)
- **Afternoon (4h):** P0-2 (Poseidon hashing) - start implementation

### Day 2 (8 hours)
- **Morning (4h):** P0-2 (Poseidon hashing) - testing + integration
- **Afternoon (4h):** P0-4, P0-5 (Remove PII logs, verify on-chain root)

### Day 3 (8 hours)
- **Morning (4h):** P1-1 (Async init), P1-2 (Remove Buffer) - start
- **Afternoon (4h):** P1-2 (Remove Buffer) - complete, P1-3 (Type-safe addresses)

### Optional Day 4 (for complete polish)
- **Morning (4h):** P1-4 (Signer injection + Chain Signatures signer)
- **Afternoon (4h):** P2 items (feature flags, docs)

---

## Testing Strategy

### Unit Tests (Vitest)
```typescript
describe('P0 Fixes', () => {
  it('should create passkey with valid private key', async () => {
    const manager = new NEARAccountManager('testnet');
    const account = await manager.createImplicitAccount({
      method: 'passkey',
      networkId: 'testnet'
    });

    // Verify we can sign
    const message = new Uint8Array(32);
    const signature = account.keyPair.sign(message);
    expect(signature).toBeDefined();
    expect(signature.signature).toHaveLength(64);
  });

  it('should compute valid Poseidon hashes', async () => {
    const atlas = new ShadowAtlas();
    await atlas['initPoseidon'](); // Access private for testing

    const hash = atlas['hashPair']('0x1234', '0x5678');
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);

    // Verify deterministic
    const hash2 = atlas['hashPair']('0x1234', '0x5678');
    expect(hash).toBe(hash2);
  });

  it('should share keystore between components', async () => {
    const accountMgr = new NEARAccountManager('testnet');
    const account = await accountMgr.createImplicitAccount({
      method: 'seed',
      networkId: 'testnet'
    });

    const chainSigs = new ChainSignatureManager(account, 'testnet');
    await chainSigs['init'](); // Should find key in shared store

    // Verify no "account not found" error
    expect(chainSigs['near']).toBeDefined();
  });
});
```

### Integration Tests
```typescript
describe('End-to-End Flow', () => {
  it('should complete full proof generation flow', async () => {
    const client = new VOTERClient({
      network: 'scroll-sepolia',
      districtGateAddress: DEPLOYED_CONTRACT,
      reputationRegistryAddress: DEPLOYED_REP,
      nearNetwork: 'testnet'
    });

    await client.ready();

    // Create account
    const account = await client.account.create({ method: 'seed' });
    expect(account.scrollAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

    // Connect signer
    await client.useChainSignaturesSigner();
    expect(client.hasSigner()).toBe(true);

    // Generate proof
    const proof = await client.zk.proveDistrict({
      streetAddress: TEST_ADDRESS
    });
    expect(proof.proof).toBeInstanceOf(Uint8Array);

    // Submit on-chain (stub: won't verify yet)
    const tx = await client.contracts.districtGate.verifyDistrict(proof);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
```

---

## Success Criteria

**P0 Complete (Required for Testing):**
- ✅ Create passkey account → can sign test message
- ✅ Chain Signatures derive address → no keystore errors
- ✅ Generate Merkle proof → Poseidon hashes match on-chain root
- ✅ No PII in console logs
- ✅ Proof generation checks on-chain root before computing

**P1 Complete (Production-Ready):**
- ✅ `await client.ready()` before all operations
- ✅ No Node.js Buffer usage (browser bundle works)
- ✅ Type-safe address handling (compile-time safety)
- ✅ Can submit transactions via NEAR Chain Signatures OR MetaMask

**P2 Complete (Polished):**
- ✅ Clear warning when using stub ZK prover
- ✅ Helpful error messages with troubleshooting hints
- ✅ Documentation up-to-date with all changes

---

## Post-Fix: Next Steps

Once P0 + P1 are complete, the SDK will be **testable end-to-end**. Next phases:

### Phase 1.5: Real ZK Proof Integration
1. Define Halo2 circuit in Rust (Merkle tree membership proof)
2. Compile with `@axiom-crypto/halo2-wasm-compiler`
3. Integrate with `@axiom-crypto/halo2-js` browser proving
4. Test proving time (target: 8-12 seconds)
5. Deploy Halo2 verifier contract to Scroll testnet
6. End-to-end test: browser proof → on-chain verification

### Phase 2: Production Deployment
1. Deploy DistrictGate + ReputationRegistry to Scroll mainnet
2. Generate production Shadow Atlas (535 real districts)
3. Pin to IPFS, store CID on-chain
4. Security audit (especially MPC signing flow)
5. Load testing (proof generation under high load)
6. Beta test with real congressional offices

---

## Appendix: Detailed Research

### A. NEAR Biometric Library (@near-js/biometric-ed25519)

**Package:** `@near-js/biometric-ed25519` v2.3.3
**Purpose:** Official NEAR library for WebAuthn-based Ed25519 key generation

**API:**
```typescript
import { createKey, getKeys } from '@near-js/biometric-ed25519';

// Create new keypair with biometric auth
const keyPair = await createKey(userName: string);

// Retrieve existing keypairs (returns 2 due to EC crypto)
const keyPairs = await getKeys(userName: string);
```

**Important Notes:**
- Returns **full KeyPair** with private key (unlike our broken implementation)
- Uses platform authenticator (Face ID/Touch ID)
- Stores credentials in browser's WebAuthn storage
- `getKeys` returns array of 2 KeyPairs due to elliptic curve cryptography
- Must persist public key to identify correct pair on retrieval

**Why This Fixes P0-1:**
- Official NEAR implementation → battle-tested
- Properly generates Ed25519 secret key
- No manual WebAuthn ceremony → less error-prone
- Integrates with NEAR's key storage patterns

---

### B. Poseidon Hashing (circomlibjs)

**Package:** `circomlibjs` v0.1.7
**Purpose:** JavaScript implementation of Poseidon hash (SNARK-friendly)

**API:**
```typescript
import { buildPoseidon } from 'circomlibjs';

// Initialize (async, ~100ms)
const poseidon = await buildPoseidon();

// Hash inputs (finite field elements)
const hash = poseidon([BigInt(input1), BigInt(input2)]);

// Convert to string
const hashString = poseidon.F.toString(hash);
```

**Why Poseidon (not Keccak256):**
- **SNARK-friendly:** ~10x fewer constraints in ZK circuits
- **Merkle trees:** Efficient for recursive proofs
- **Browser-safe:** Pure JavaScript, no native dependencies
- **Standard:** Used by Tornado Cash, Semaphore, zkSync

**Important Notes:**
- Returns finite field element → must convert with `poseidon.F.toString()`
- Version compatibility: circomlibjs output must match circom circuit version
- For contracts: Use `poseidon_gencontract.js` to generate Solidity verifier

**Why This Fixes P0-2:**
- Replaces toy hash with real cryptographic primitive
- Enables ZK proof verification (Halo2 circuit will use same hash)
- Standard implementation → matches what's deployed on-chain

---

### C. Web Crypto APIs (Buffer Replacement)

**Native API:** `Uint8Array.toBase64()` / `Uint8Array.fromBase64()`
**Browser Support:** Chrome 128+, Firefox 128+, Safari 18+ (Sept 2025)
**Polyfill:** `core-js` provides fallback for older browsers

**API:**
```typescript
// Encode to base64
const bytes = new Uint8Array([72, 101, 108, 108, 111]);
const base64 = bytes.toBase64(); // "SGVsbG8="

// Decode from base64
const decoded = Uint8Array.fromBase64("SGVsbG8=");

// With options
const urlSafe = bytes.toBase64({ alphabet: 'base64url' });
const noPadding = bytes.toBase64({ omitPadding: true });
```

**Fallback (for older browsers):**
```typescript
function uint8ToBase64Fallback(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

function base64ToUint8Fallback(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
```

**Why This Fixes P1-2:**
- Zero dependencies → smaller bundle
- Native browser API → faster than polyfills
- No build configuration needed
- Future-proof (standard TC39 proposal)

---

### D. NEAR Chain Signatures Architecture

**MPC Contract:** `v1.signer` (mainnet), `v1.signer-dev.testnet` (testnet)
**Purpose:** Threshold ECDSA signing across 300+ NEAR validators

**How It Works:**
1. User creates NEAR implicit account (free, instant)
2. Call `derived_public_key({ path: "ethereum,1" })` → MPC derives ECDSA pubkey
3. Convert pubkey to Ethereum address: `keccak256(pubkey)[12:32]`
4. To sign: call `sign({ payload, path })` → MPC nodes create signature shares
5. Shares combined → valid ECDSA signature for Ethereum/Scroll/Bitcoin

**Key Insights:**
- **Derivation paths** enable one NEAR account → infinite addresses
  - `ethereum,1` → Ethereum L1 address
  - `scroll,1` → Scroll L2 address
  - `bitcoin,1` → Bitcoin address
- **No bridges:** Native multi-chain via cryptography (not wrapped tokens)
- **Censorship-resistant:** 2/3 of validators must collude to block
- **Latency:** ~2-3 seconds for MPC signature generation

**Why This Is Brilliant:**
- One passkey controls Bitcoin, Ethereum, Scroll, Solana, Cosmos, etc.
- No custody risk (users hold NEAR key, MPC holds derived keys)
- No bridge risk (native signatures, not lock-and-mint)
- Privacy: NEAR account ≠ Ethereum address (not linkable on-chain)

**Why Our Implementation Was Broken:**
- Created new keystore instead of sharing → MPC couldn't find NEAR key
- Didn't fund implicit account → contract calls would fail
- Didn't handle MPC response format correctly

---

## Final Thoughts

The brutalist analysis was **harsh but fair**. The architecture is sound:
- NEAR Chain Signatures for multi-chain = correct approach
- Poseidon Merkle trees for ZK proofs = correct primitive
- Passkey-based account creation = correct UX

The implementation had **rookie mistakes**:
- Not using official libraries (`@near-js/biometric-ed25519`)
- Rolling custom crypto (toy hash function)
- Ignoring browser constraints (Node.js Buffer)

**With these fixes, we'll have:**
- ✅ Working passkey account creation
- ✅ Functional NEAR Chain Signatures (one key controls all chains)
- ✅ Valid Merkle proofs (cryptographically secure)
- ✅ Browser-compatible build (no Node.js dependencies)
- ✅ Type-safe APIs (compile-time safety)

**Estimated timeline: 2-3 days to testable, 4 days to polished.**

The cypherpunk vision remains intact. We're just fixing the implementation to match the ambition.
