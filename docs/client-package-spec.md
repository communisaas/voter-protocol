# @voter-protocol/client - NPM Package Specification

**Status**: Phase 1 Implementation Plan
**Target**: Production-ready by Month 3
**Purpose**: Browser SDK for zero-knowledge district verification + NEAR Chain Signatures account abstraction

---

## Table of Contents

1. [Package Architecture](#package-architecture)
2. [API Surface](#api-surface)
3. [NEAR Chain Signatures Integration](#near-chain-signatures-integration)
4. [Shadow Atlas Structure](#shadow-atlas-structure)
5. [Halo2 Circuit Design](#halo2-circuit-design)
6. [Smart Contract Interfaces](#smart-contract-interfaces)
7. [Implementation Phases](#implementation-phases)

---

## Package Architecture

### Core Modules

```
@voter-protocol/client/
├── src/
│   ├── index.ts                    # Main exports
│   ├── client.ts                   # VOTERClient class
│   ├── account/
│   │   ├── near-account.ts         # NEAR implicit account creation
│   │   ├── chain-signatures.ts     # MPC signing for Scroll/ETH
│   │   ├── wallet-adapter.ts       # MetaMask/WalletConnect
│   │   └── account-manager.ts      # Unified account interface
│   ├── zk/
│   │   ├── halo2-prover.ts         # WASM prover wrapper
│   │   ├── shadow-atlas.ts         # Merkle tree client
│   │   ├── district-proof.ts       # District membership proof
│   │   └── proof-types.ts          # TypeScript types
│   ├── contracts/
│   │   ├── district-gate.ts        # DistrictGate.sol interface
│   │   ├── reputation-registry.ts  # ERC-8004 interface
│   │   └── abi/                    # Contract ABIs
│   ├── crypto/
│   │   ├── poseidon.ts             # Poseidon hash (SNARK-friendly)
│   │   ├── merkle.ts               # Merkle proof generation
│   │   └── xchacha20.ts            # E2E encryption utils
│   ├── storage/
│   │   ├── ipfs-client.ts          # Shadow Atlas IPFS fetching
│   │   └── cache.ts                # IndexedDB caching
│   └── utils/
│       ├── errors.ts               # Custom error types
│       ├── retry.ts                # Network retry logic
│       └── format.ts               # Display formatting
├── wasm/
│   ├── halo2_prover.wasm          # Compiled Halo2 circuit
│   ├── halo2_prover.js            # WASM glue code
│   └── poseidon_hash.wasm         # Optimized hashing
├── types/
│   └── index.d.ts                 # TypeScript declarations
└── package.json
```

### Dependencies

```json
{
  "dependencies": {
    "ethers": "^6.15.0",           // Ethereum interaction
    "near-api-js": "^6.3.0",       // NEAR Chain Signatures
    "@near-js/biometric-ed25519": "^2.3.3",  // Passkey support
    "idb": "^8.0.0",               // IndexedDB storage
    "libsodium-wrappers": "^0.7.13" // XChaCha20-Poly1305
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "vite": "^5.4.10",             // WASM bundling
    "vitest": "^2.1.4"
  }
}
```

---

## API Surface

### Primary API (NEAR Chain Signatures)

```typescript
import { VOTERClient } from '@voter-protocol/client';

// 1. Create client (universal - works for all users)
const client = new VOTERClient({
  network: 'scroll-sepolia',  // or 'scroll-mainnet'
  nearNetwork: 'mainnet',      // NEAR MPC network

  // Optional: for users with existing wallets
  walletProvider: window.ethereum,  // MetaMask (optional)

  // IPFS gateway for Shadow Atlas
  ipfsGateway: 'https://gateway.voter.network',

  // Cache configuration
  cacheStrategy: 'aggressive',  // Cache Shadow Atlas locally
});

// 2. Account creation (NEAR implicit account)
const account = await client.account.create({
  method: 'passkey',  // Face ID / Touch ID
  // Generates NEAR implicit account + derives Scroll address
});

// Result:
// {
//   nearAccount: "a96ad3cb539b...ee1c58d3",
//   scrollAddress: "0xABCD...5678",
//   ethAddress: "0xABCD...1234"  (future)
// }

// 3. Generate district proof (4-6 seconds)
const proof = await client.zk.proveDistrict({
  address: {
    street: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701"
  },
  // Address never leaves browser, never sent to any server
});

// Result:
// {
//   proof: Uint8Array(512),      // Halo2 proof bytes
//   districtHash: "0x1a2b3c...", // Public: district identifier
//   merkleRoot: "0x7f8e9d...",   // Public: Shadow Atlas root
//   publicSignals: [...],         // Public inputs to circuit
// }

// 4. Submit verification on-chain (Scroll L2)
const tx = await client.contracts.districtGate.verify({
  proof: proof.proof,
  districtHash: proof.districtHash,
  // Signed via NEAR Chain Signatures (MPC)
});

// 5. Query reputation (ERC-8004)
const reputation = await client.contracts.reputation.getScore({
  address: account.scrollAddress,
  domain: 'healthcare'  // Domain-specific reputation
});

// Result:
// {
//   score: 8500,
//   tier: 'established',  // trusted | established | emerging | novice
//   lastUpdate: Date,
//   decayRate: 0.05
// }
```

### Alternative API (Existing Wallet)

```typescript
// For users with MetaMask/WalletConnect
const client = new VOTERClient({
  network: 'scroll-mainnet',
  walletProvider: window.ethereum,  // Connect directly
  skipNEAR: true  // Don't create NEAR account
});

// Rest of API identical - proof generation, verification, reputation queries
```

---

## NEAR Chain Signatures Integration

### Account Creation Flow

```typescript
// src/account/near-account.ts

import { KeyPair, InMemoryKeyStore } from 'near-api-js';
import { sha256 } from 'js-sha256';

export interface NEARAccountOptions {
  method: 'passkey' | 'seed';  // Passkey preferred
  networkId: 'mainnet' | 'testnet';
}

export interface NEARAccount {
  accountId: string;           // Implicit account ID
  keyPair: KeyPair;            // Ed25519 keypair
  publicKey: string;           // Base58 encoded
}

export class NEARAccountManager {
  private keyStore: InMemoryKeyStore;

  constructor(networkId: string) {
    this.keyStore = new InMemoryKeyStore();
  }

  /**
   * Create implicit NEAR account
   * FREE - no on-chain transaction required
   */
  async createImplicitAccount(options: NEARAccountOptions): Promise<NEARAccount> {
    let keyPair: KeyPair;

    if (options.method === 'passkey') {
      // Use WebAuthn for biometric authentication
      keyPair = await this.createPasskeyKeyPair();
    } else {
      // Generate from seed phrase (fallback)
      keyPair = KeyPair.fromRandom('ed25519');
    }

    // Derive implicit account ID from public key
    const publicKey = keyPair.getPublicKey().data;
    const accountId = sha256(publicKey).toString('hex');

    // Store in browser (IndexedDB via NEAR's keyStore)
    await this.keyStore.setKey(options.networkId, accountId, keyPair);

    return {
      accountId,
      keyPair,
      publicKey: keyPair.getPublicKey().toString()
    };
  }

  /**
   * Create Ed25519 keypair from WebAuthn passkey
   */
  private async createPasskeyKeyPair(): Promise<KeyPair> {
    // Use @near-js/biometric-ed25519
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {
          name: 'VOTER Protocol',
          id: window.location.hostname
        },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'voter-user',
          displayName: 'VOTER User'
        },
        pubKeyCredParams: [{ alg: -8, type: 'public-key' }],  // EdDSA
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // Face ID / Touch ID
          userVerification: 'required'
        }
      }
    });

    if (!credential) {
      throw new Error('Passkey creation failed');
    }

    // Extract Ed25519 public key from WebAuthn credential
    const publicKey = new Uint8Array(
      (credential as PublicKeyCredential).response.getPublicKey()!
    );

    // Store credential ID for signing operations
    const credentialId = credential.id;
    localStorage.setItem('voter_passkey_credential_id', credentialId);

    // Create NEAR KeyPair wrapper
    return KeyPair.fromString(`ed25519:${Buffer.from(publicKey).toString('base64')}`);
  }
}
```

### Chain Signatures (MPC Signing)

```typescript
// src/account/chain-signatures.ts

import { connect, Contract, keyStores } from 'near-api-js';

export interface ChainSignatureRequest {
  payload: Uint8Array;    // Transaction hash to sign
  path: string;           // Derivation path (e.g., "scroll,1")
  keyVersion: number;     // MPC key version
}

export interface ChainSignature {
  r: string;              // ECDSA signature r
  s: string;              // ECDSA signature s
  v: number;              // Recovery ID
  publicKey: string;      // Derived public key
}

export class ChainSignatureManager {
  private near: any;
  private signerContract: Contract & any;

  constructor(nearAccount: NEARAccount, networkId: string) {
    this.near = null;  // Initialized async
    this.initNEAR(nearAccount, networkId);
  }

  private async initNEAR(account: NEARAccount, networkId: string) {
    const config = {
      networkId,
      keyStore: new keyStores.InMemoryKeyStore(),
      nodeUrl: networkId === 'mainnet'
        ? 'https://rpc.mainnet.near.org'
        : 'https://rpc.testnet.near.org',
    };

    this.near = await connect(config);

    // Connect to MPC signer contract
    const signerContractId = networkId === 'mainnet'
      ? 'v1.signer'
      : 'v1.signer-dev.testnet';

    this.signerContract = new Contract(
      this.near.connection,
      signerContractId,
      {
        viewMethods: ['public_key', 'derived_public_key'],
        changeMethods: ['sign']
      }
    );
  }

  /**
   * Derive Scroll address from NEAR implicit account
   */
  async deriveScrollAddress(nearAccountId: string): Promise<string> {
    const derivedKey = await this.signerContract.derived_public_key({
      predecessor: nearAccountId,
      path: 'scroll,1'
    });

    // ECDSA public key → Ethereum address
    const address = this.publicKeyToAddress(derivedKey);
    return address;
  }

  /**
   * Sign Scroll transaction via NEAR MPC
   */
  async signTransaction(
    request: ChainSignatureRequest
  ): Promise<ChainSignature> {
    // Call MPC signing contract (~2-3 seconds)
    const signature = await this.signerContract.sign({
      args: {
        payload: Array.from(request.payload),
        path: request.path,
        key_version: request.keyVersion
      },
      gas: '300000000000000',  // 300 TGas
    });

    return {
      r: signature.big_r,
      s: signature.s,
      v: signature.recovery_id,
      publicKey: signature.public_key
    };
  }

  /**
   * Convert ECDSA public key to Ethereum address
   */
  private publicKeyToAddress(publicKey: string): string {
    const { keccak256 } = require('ethers');

    // Remove "04" prefix (uncompressed point indicator)
    const pubKeyBytes = Buffer.from(publicKey, 'hex').slice(1);

    // Keccak256 hash
    const hash = keccak256(pubKeyBytes);

    // Take last 20 bytes
    return '0x' + hash.slice(-40);
  }
}
```

### Transaction Flow (NEAR → Scroll)

```typescript
// src/client.ts

export class VOTERClient {
  private nearAccount: NEARAccount;
  private chainSigs: ChainSignatureManager;
  private scrollProvider: ethers.JsonRpcProvider;

  /**
   * Submit district verification transaction
   */
  async submitDistrictVerification(proof: DistrictProof): Promise<TransactionReceipt> {
    // 1. Derive Scroll address from NEAR account
    const scrollAddress = await this.chainSigs.deriveScrollAddress(
      this.nearAccount.accountId
    );

    // 2. Build Scroll transaction
    const tx = {
      to: DISTRICT_GATE_ADDRESS,
      data: this.contracts.districtGate.interface.encodeFunctionData(
        'verifyDistrict',
        [proof.proof, proof.districtHash, proof.merkleRoot]
      ),
      from: scrollAddress,
      gasLimit: 150000n,  // ~60-100k gas typical
      maxFeePerGas: await this.scrollProvider.getFeeData().maxFeePerGas,
      maxPriorityFeePerGas: 1000000000n,  // 1 gwei tip
      nonce: await this.scrollProvider.getTransactionCount(scrollAddress),
      chainId: 534352,  // Scroll mainnet
    };

    // 3. Serialize transaction for signing
    const serialized = ethers.Transaction.from(tx).unsignedSerialized;
    const txHash = ethers.keccak256(serialized);

    // 4. Sign via NEAR Chain Signatures (~2-3 seconds)
    const signature = await this.chainSigs.signTransaction({
      payload: Buffer.from(txHash.slice(2), 'hex'),
      path: 'scroll,1',
      keyVersion: 0
    });

    // 5. Reconstruct signed transaction
    const signedTx = ethers.Transaction.from({
      ...tx,
      signature: {
        r: '0x' + signature.r,
        s: '0x' + signature.s,
        v: signature.v
      }
    });

    // 6. Broadcast to Scroll L2
    const receipt = await this.scrollProvider.broadcastTransaction(
      signedTx.serialized
    );

    return receipt;
  }
}
```

---

## Shadow Atlas Structure

### Global District Merkle Tree

```typescript
// src/zk/shadow-atlas.ts

export interface ShadowAtlasConfig {
  ipfsGateway: string;
  cacheTTL: number;  // Cache duration (seconds)
}

export interface DistrictLeaf {
  address: string;           // Full street address (hashed)
  districtId: string;        // e.g., "TX-21"
  countryCode: string;       // ISO 3166-1 alpha-2
  leafHash: string;          // Poseidon(address, districtId)
}

export interface MerkleProof {
  leaf: DistrictLeaf;
  path: string[];            // Sibling hashes from leaf to root
  pathIndices: number[];     // 0 = left, 1 = right
  root: string;              // Current Merkle root
}

export class ShadowAtlas {
  private config: ShadowAtlasConfig;
  private cache: Map<string, MerkleProof>;
  private currentRoot: string | null = null;

  constructor(config: ShadowAtlasConfig) {
    this.config = config;
    this.cache = new Map();
  }

  /**
   * Fetch current Shadow Atlas root from on-chain contract
   */
  async getCurrentRoot(provider: ethers.Provider): Promise<string> {
    const districtGate = new ethers.Contract(
      DISTRICT_GATE_ADDRESS,
      DISTRICT_GATE_ABI,
      provider
    );

    this.currentRoot = await districtGate.shadowAtlasRoot();
    return this.currentRoot;
  }

  /**
   * Generate Merkle proof for address
   * Address never leaves browser - only district proof generated
   */
  async generateProof(address: string): Promise<MerkleProof> {
    // 1. Check cache
    const cached = this.cache.get(address);
    if (cached && this.isCacheValid(cached)) {
      return cached;
    }

    // 2. Geocode address locally (Census Bureau API)
    const geocoded = await this.geocodeAddress(address);

    // 3. Fetch relevant tree slice from IPFS
    // Only fetch the specific country/state subtree needed
    const treeSlice = await this.fetchTreeSlice(
      geocoded.countryCode,
      geocoded.stateCode
    );

    // 4. Generate Merkle path from address to root
    const proof = this.generateMerklePath(
      address,
      geocoded.districtId,
      treeSlice
    );

    // 5. Cache for future use
    this.cache.set(address, proof);

    return proof;
  }

  /**
   * Fetch tree slice from IPFS (only relevant subtree)
   */
  private async fetchTreeSlice(
    countryCode: string,
    stateCode: string
  ): Promise<any> {
    // Shadow Atlas structure on IPFS:
    // /shadow-atlas/
    //   ├── root.json          (current root hash)
    //   ├── countries/
    //   │   ├── US/
    //   │   │   ├── states/
    //   │   │   │   ├── TX/
    //   │   │   │   │   ├── districts.json  (TX-01 through TX-38)
    //   │   │   │   │   └── merkle.json     (Merkle path data)

    const ipfsCID = await this.resolveCurrentCID();
    const url = `${this.config.ipfsGateway}/ipfs/${ipfsCID}/countries/${countryCode}/states/${stateCode}/merkle.json`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch Shadow Atlas slice: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generate Merkle path from leaf to root
   */
  private generateMerklePath(
    address: string,
    districtId: string,
    treeSlice: any
  ): MerkleProof {
    // 1. Hash address with Poseidon (SNARK-friendly)
    const addressHash = this.poseidonHash(address);
    const leafHash = this.poseidonHash([addressHash, districtId]);

    // 2. Find leaf position in tree
    const leafIndex = treeSlice.leaves.findIndex(
      (l: any) => l.hash === leafHash
    );

    if (leafIndex === -1) {
      throw new Error('Address not found in Shadow Atlas');
    }

    // 3. Build Merkle path
    const path: string[] = [];
    const pathIndices: number[] = [];

    let currentIndex = leafIndex;
    let currentLevel = treeSlice.leaves;

    while (currentLevel.length > 1) {
      const isLeftNode = currentIndex % 2 === 0;
      const siblingIndex = isLeftNode ? currentIndex + 1 : currentIndex - 1;

      path.push(currentLevel[siblingIndex]?.hash || '0x0');
      pathIndices.push(isLeftNode ? 0 : 1);

      // Move up one level
      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = this.computeNextLevel(currentLevel);
    }

    return {
      leaf: {
        address: addressHash,  // Hashed, never plaintext
        districtId,
        countryCode: 'US',  // TODO: derive from address
        leafHash
      },
      path,
      pathIndices,
      root: this.currentRoot!
    };
  }

  /**
   * Poseidon hash (SNARK-friendly)
   */
  private poseidonHash(input: string | string[]): string {
    // Use @iden3/js-crypto or circomlibjs
    const { poseidon } = require('circomlibjs');

    const inputs = Array.isArray(input) ? input : [input];
    const bigInts = inputs.map(i => BigInt(i));

    return '0x' + poseidon(bigInts).toString(16);
  }
}
```

### Shadow Atlas Data Sources

```typescript
// Data pipeline (separate repo/service):
// 1. US Census Bureau TIGER/Line files (congressional districts)
// 2. Electoral Commission APIs (UK, Canada, Australia, etc.)
// 3. OpenAddresses.io (global address database)
// 4. Quarterly updates published to IPFS
// 5. New root hash published on-chain (DistrictGate.updateRoot)

export interface ShadowAtlasUpdate {
  version: string;          // "2025-Q1"
  rootHash: string;         // New Merkle root
  ipfsCID: string;          // IPFS content identifier
  countries: string[];      // Covered countries
  totalDistricts: number;   // Total districts indexed
  createdAt: Date;
}
```

---

## Halo2 Circuit Design

### Circuit Structure

```rust
// Separate Rust crate: @voter-protocol/halo2-circuits
// Compiled to WASM for browser execution

use halo2_proofs::{
    circuit::{Layouter, SimpleFloorPlanner, Value},
    plonk::{Circuit, ConstraintSystem, Error},
    poly::commitment::Params,
};
use halo2curves::bn256::{Bn256, Fr};

/// Circuit for proving congressional district membership
/// Private inputs: address, Merkle path
/// Public inputs: district hash, Merkle root
#[derive(Clone)]
pub struct DistrictMembershipCircuit {
    // PRIVATE witnesses
    address: Value<Fr>,           // User's full address (never revealed)
    merkle_path: Vec<Value<Fr>>,  // Sibling hashes in Merkle path
    path_indices: Vec<Value<Fr>>, // 0 = left, 1 = right

    // PUBLIC inputs
    district_hash: Fr,             // Claimed district (public)
    merkle_root: Fr,               // Shadow Atlas root (public)
}

impl Circuit<Fr> for DistrictMembershipCircuit {
    type Config = DistrictCircuitConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self::default()
    }

    fn configure(meta: &mut ConstraintSystem<Fr>) -> Self::Config {
        // Configure Poseidon hash gates
        // Configure Merkle path verification constraints
        DistrictCircuitConfig::configure(meta)
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<Fr>
    ) -> Result<(), Error> {
        // 1. Compute leaf hash = Poseidon(address, district_hash)
        let leaf_hash = config.poseidon_chip.hash(
            layouter.namespace(|| "compute leaf hash"),
            vec![self.address.clone(), Value::known(self.district_hash)]
        )?;

        // 2. Verify Merkle path from leaf to root
        let mut current_hash = leaf_hash;

        for (i, (sibling, is_left)) in self.merkle_path.iter()
            .zip(self.path_indices.iter())
            .enumerate()
        {
            // Compute parent hash based on path direction
            current_hash = config.merkle_chip.hash_pair(
                layouter.namespace(|| format!("merkle level {}", i)),
                current_hash,
                sibling.clone(),
                is_left.clone()
            )?;
        }

        // 3. Constrain final hash equals public Merkle root
        layouter.constrain_instance(
            current_hash.cell(),
            config.instance,
            0  // First public input
        )?;

        Ok(())
    }
}
```

### WASM Integration

```typescript
// src/zk/halo2-prover.ts

import init, { prove_district, verify_district } from '../wasm/halo2_prover';

export interface ProofInputs {
  address: string;           // Full address (private)
  districtId: string;        // e.g., "TX-21" (public)
  merklePath: string[];      // Sibling hashes (private)
  pathIndices: number[];     // Path directions (private)
  merkleRoot: string;        // Current root (public)
}

export interface DistrictProof {
  proof: Uint8Array;         // Halo2 proof bytes (384-512 bytes)
  districtHash: string;      // Public output
  merkleRoot: string;        // Public input
  publicSignals: string[];   // All public inputs
}

export class Halo2Prover {
  private initialized = false;

  /**
   * Initialize WASM module
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await init();  // Load halo2_prover.wasm
    this.initialized = true;
  }

  /**
   * Generate district membership proof
   * Takes 4-6 seconds on commodity hardware
   */
  async prove(inputs: ProofInputs): Promise<DistrictProof> {
    await this.init();

    console.time('halo2_proving');

    // Call Rust WASM function
    const result = await prove_district({
      address: inputs.address,
      district_id: inputs.districtId,
      merkle_path: inputs.merklePath,
      path_indices: inputs.pathIndices,
      merkle_root: inputs.merkleRoot
    });

    console.timeEnd('halo2_proving');

    return {
      proof: new Uint8Array(result.proof),
      districtHash: result.district_hash,
      merkleRoot: inputs.merkleRoot,
      publicSignals: [result.district_hash, inputs.merkleRoot]
    };
  }

  /**
   * Verify proof locally (for testing)
   */
  async verify(proof: DistrictProof): Promise<boolean> {
    await this.init();

    return verify_district({
      proof: Array.from(proof.proof),
      public_signals: proof.publicSignals
    });
  }
}
```

---

## Smart Contract Interfaces

### DistrictGate.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title DistrictGate
 * @notice Verifies Halo2 zero-knowledge proofs of congressional district membership
 * @dev Address never revealed on-chain, only district hash proven
 */
contract DistrictGate is Ownable, ReentrancyGuard {
    /// @notice Current Shadow Atlas Merkle root
    bytes32 public shadowAtlasRoot;

    /// @notice Halo2 verifier contract address
    address public halo2Verifier;

    /// @notice Mapping: user address => verified district hash
    mapping(address => bytes32) public verifiedDistricts;

    /// @notice Mapping: user address => verification timestamp
    mapping(address => uint256) public verificationTimestamps;

    /// @notice Verification expiry duration (default: 90 days)
    uint256 public verificationExpiry = 90 days;

    event DistrictVerified(
        address indexed user,
        bytes32 indexed districtHash,
        uint256 timestamp
    );

    event ShadowAtlasUpdated(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        uint256 timestamp
    );

    constructor(
        bytes32 _initialRoot,
        address _halo2Verifier
    ) {
        shadowAtlasRoot = _initialRoot;
        halo2Verifier = _halo2Verifier;
    }

    /**
     * @notice Verify district membership via Halo2 proof
     * @param proof Halo2 proof bytes (384-512 bytes)
     * @param districtHash Claimed district identifier
     * @param merkleRoot Shadow Atlas root used for proof
     */
    function verifyDistrict(
        bytes calldata proof,
        bytes32 districtHash,
        bytes32 merkleRoot
    ) external nonReentrant returns (bool) {
        // 1. Validate Merkle root matches current
        require(merkleRoot == shadowAtlasRoot, "Stale Merkle root");

        // 2. Prepare public inputs for Halo2 verification
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = districtHash;
        publicInputs[1] = merkleRoot;

        // 3. Verify Halo2 proof
        bool valid = IHalo2Verifier(halo2Verifier).verify(proof, publicInputs);
        require(valid, "Invalid proof");

        // 4. Record verification
        verifiedDistricts[msg.sender] = districtHash;
        verificationTimestamps[msg.sender] = block.timestamp;

        emit DistrictVerified(msg.sender, districtHash, block.timestamp);

        return true;
    }

    /**
     * @notice Check if user's verification is still valid
     */
    function isVerified(address user) external view returns (bool) {
        uint256 timestamp = verificationTimestamps[user];
        if (timestamp == 0) return false;

        return block.timestamp - timestamp <= verificationExpiry;
    }

    /**
     * @notice Get user's verified district (if valid)
     */
    function getVerifiedDistrict(address user) external view returns (bytes32) {
        require(this.isVerified(user), "Verification expired");
        return verifiedDistricts[user];
    }

    /**
     * @notice Update Shadow Atlas root (quarterly)
     * @dev Only owner (governance multisig) can update
     */
    function updateShadowAtlasRoot(bytes32 newRoot) external onlyOwner {
        bytes32 oldRoot = shadowAtlasRoot;
        shadowAtlasRoot = newRoot;

        emit ShadowAtlasUpdated(oldRoot, newRoot, block.timestamp);
    }

    /**
     * @notice Update verifier contract address
     */
    function updateVerifier(address newVerifier) external onlyOwner {
        require(newVerifier != address(0), "Invalid verifier");
        halo2Verifier = newVerifier;
    }
}

interface IHalo2Verifier {
    function verify(
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) external view returns (bool);
}
```

### TypeScript Interface

```typescript
// src/contracts/district-gate.ts

import { ethers } from 'ethers';
import DistrictGateABI from './abi/DistrictGate.json';

export class DistrictGateContract {
  private contract: ethers.Contract;

  constructor(
    address: string,
    provider: ethers.Provider,
    signer?: ethers.Signer
  ) {
    this.contract = new ethers.Contract(
      address,
      DistrictGateABI,
      signer || provider
    );
  }

  /**
   * Submit district verification on-chain
   */
  async verify(
    proof: Uint8Array,
    districtHash: string,
    merkleRoot: string
  ): Promise<ethers.ContractTransactionReceipt> {
    const tx = await this.contract.verifyDistrict(
      proof,
      districtHash,
      merkleRoot
    );

    return tx.wait();
  }

  /**
   * Check if address has valid verification
   */
  async isVerified(address: string): Promise<boolean> {
    return this.contract.isVerified(address);
  }

  /**
   * Get verified district for address
   */
  async getVerifiedDistrict(address: string): Promise<string> {
    return this.contract.getVerifiedDistrict(address);
  }

  /**
   * Get current Shadow Atlas root
   */
  async getCurrentRoot(): Promise<string> {
    return this.contract.shadowAtlasRoot();
  }

  /**
   * Estimate gas for verification
   */
  async estimateGas(
    proof: Uint8Array,
    districtHash: string,
    merkleRoot: string
  ): Promise<bigint> {
    return this.contract.verifyDistrict.estimateGas(
      proof,
      districtHash,
      merkleRoot
    );
  }
}
```

---

## Implementation Phases

### Month 1: Foundation (Weeks 1-4)

**Week 1-2: Project Setup**
- ✅ Initialize npm package structure
- ✅ Set up TypeScript build pipeline
- ✅ Configure Vite for WASM bundling
- ✅ Create basic VOTERClient class
- ✅ NEAR Chain Signatures account creation

**Week 3-4: Shadow Atlas v0.1**
- ✅ Define Merkle tree structure
- ✅ Build data ingestion pipeline (US only for MVP)
- ✅ Generate test Merkle tree (TX congressional districts)
- ✅ Publish test tree to IPFS
- ✅ Implement Atlas client (fetch, cache, proof generation)

**Milestone 1 Check**: Can we generate Merkle proofs from addresses?

---

### Month 2: Zero-Knowledge Proofs (Weeks 5-8)

**Week 5-6: Halo2 Circuit**
- ✅ Implement district membership circuit (Rust)
- ✅ Add Poseidon hash gadget
- ✅ Add Merkle path verification gadget
- ✅ Compile to WASM
- ✅ Benchmark proving time (<10s requirement)

**Week 7-8: Smart Contracts**
- ✅ Write DistrictGate.sol
- ✅ Write Halo2Verifier.sol (or integrate existing)
- ✅ Deploy to Scroll Sepolia testnet
- ✅ Measure verification gas (<250k requirement)
- ✅ Integration tests (proof generation → verification)

**Milestone 2 Check (CRITICAL)**:
- Proving time <10s? ✅ / ❌
- Verification gas <250k? ✅ / ❌
- If either fails: **PIVOT TO GROTH16**

---

### Month 3: Integration & Launch (Weeks 9-12)

**Week 9-10: Client Integration**
- ✅ Wire up all components (NEAR → proof → Scroll)
- ✅ Build example app (template submission flow)
- ✅ Add error handling and retry logic
- ✅ IndexedDB caching for Shadow Atlas
- ✅ Performance profiling

**Week 11: Security & Testing**
- ✅ External security audit (circuit + contracts)
- ✅ Fuzzing tests (invalid proofs, edge cases)
- ✅ Gas optimization
- ✅ Documentation (API reference, integration guide)

**Week 12: Mainnet Deployment**
- ✅ Deploy DistrictGate.sol to Scroll mainnet
- ✅ Publish Shadow Atlas v1.0 to IPFS
- ✅ Publish @voter-protocol/client to npm
- ✅ Update Communique to use client SDK

**Launch Ready**: Phase 1 complete! 🎉

---

## Usage Example (Full Flow)

```typescript
// Example: User submits civic action with district verification

import { VOTERClient } from '@voter-protocol/client';

// 1. Initialize client
const client = new VOTERClient({
  network: 'scroll-mainnet',
  nearNetwork: 'mainnet',
  ipfsGateway: 'https://gateway.voter.network'
});

// 2. Create account (one-time, passkey-based)
const account = await client.account.create({ method: 'passkey' });

console.log('NEAR account:', account.nearAccount);
console.log('Scroll address:', account.scrollAddress);

// 3. User provides address during message submission
const userAddress = {
  street: "123 Main St",
  city: "Austin",
  state: "TX",
  zip: "78701"
};

// 4. Generate district proof (4-6 seconds, client-side)
console.log('Generating zero-knowledge proof...');
const proof = await client.zk.proveDistrict({ address: userAddress });
console.log('Proof generated:', proof.districtHash);

// 5. Submit verification on-chain (Scroll L2)
console.log('Submitting to Scroll L2...');
const tx = await client.contracts.districtGate.verify({
  proof: proof.proof,
  districtHash: proof.districtHash
});

console.log('Transaction confirmed:', tx.hash);
console.log('Gas used:', tx.gasUsed.toString());

// 6. Verify on-chain
const isVerified = await client.contracts.districtGate.isVerified(
  account.scrollAddress
);

console.log('District verified:', isVerified);

// 7. Query reputation (Phase 1: read-only)
const reputation = await client.contracts.reputation.getScore({
  address: account.scrollAddress,
  domain: 'healthcare'
});

console.log('Reputation score:', reputation.score);
console.log('Reputation tier:', reputation.tier);
```

---

## Success Criteria

**Performance Targets:**
- ✅ Halo2 proving time: 4-6 seconds on commodity hardware
- ✅ Verification gas: 60-100k on Scroll L2 (~$0.01 at 0.1 gwei)
- ✅ Proof size: 384-512 bytes
- ✅ NEAR signature latency: <3 seconds

**Security Requirements:**
- ✅ Address never leaves browser, never stored anywhere
- ✅ Zero-knowledge property verified (no address leakage)
- ✅ Halo2 circuit audited (no trusted setup)
- ✅ Smart contracts audited (no vulnerabilities)

**User Experience:**
- ✅ One-time account creation (<60 seconds)
- ✅ District verification (<10 seconds total)
- ✅ Works on mobile browsers
- ✅ No wallet installation required (NEAR passkey)

**Developer Experience:**
- ✅ Clear TypeScript API
- ✅ Comprehensive documentation
- ✅ Example integration code
- ✅ Error messages guide debugging

---

**Package ready for Phase 1 launch! 🚀**
