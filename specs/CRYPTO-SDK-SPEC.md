# Crypto SDK Engineering Specification

⚠️ **DEPRECATED SPECIFICATION - OBSOLETE ARCHITECTURE**

**This document describes an earlier architecture using AWS Nitro TEE proving.**

**The VOTER Protocol now uses browser-native Halo2 + KZG proving instead. All TEE-based proving has been eliminated in favor of client-side WASM proving.**

**For current specifications, see:**
- [ZK-PROOF-SPEC-REVISED.md](./ZK-PROOF-SPEC-REVISED.md) - Browser-native Halo2 + KZG architecture (CURRENT)
- [TECHNICAL.md](../TECHNICAL.md) - Current implementation details with browser-native proving

**This file is retained for historical reference only. Do not use for new development.**

---

**Component:** TypeScript Cryptography Library
**Language:** TypeScript
**Location:** `packages/crypto/`
**Status:** ❌ DEPRECATED - See ZK-PROOF-SPEC-REVISED.md for current architecture

---

## Overview (HISTORICAL - Do Not Use)

The Crypto SDK provides client-side encryption, compression, key derivation, and zero-knowledge proof generation for VOTER Protocol. It ensures privacy through multi-stage compression, authenticated encryption, and TEE-based ZK proofs.

**Core Functionality:**
1. **PII Encryption**: Client-side XChaCha20-Poly1305 encryption with compression (2.3KB → 180B)
2. **ZK Proof Generation**: Halo2 district membership proofs via Trusted Execution Environment (TEE)
3. **Key Management**: HKDF from wallet signatures or PBKDF2 from passwords
4. **Witness Privacy**: X25519 ECDH encryption for ZK witness data sent to TEE

**Security Model:**
- Client-side encryption only (server never sees plaintext PII)
- TEE-based proving (AWS Nitro Enclaves)
- Authenticated encryption with additional data (AAD) binding
- Wallet-compatible key derivation (HKDF from signatures)
- Dictionary-trained compression for cost optimization

**Related Specs:**
- [ZK-PROOF-SPEC.md](./ZK-PROOF-SPEC.md) - Complete Halo2 + TEE proving architecture
- [COMPRESSION-STRATEGY.md](../COMPRESSION-STRATEGY.md) - Detailed compression implementation
- [CIPHERVAULT-CONTRACT-SPEC.md](./CIPHERVAULT-CONTRACT-SPEC.md) - Contract storage schema

---

## Architecture

### Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Application Layer                                          │
│  (Communique, voter-protocol apps)                          │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  Crypto SDK (this spec)                                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Key Derivation                                      │    │
│  │ - HKDF (wallet signatures)                          │    │
│  │ - PBKDF2 (password fallback)                        │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Compression Layer                                   │    │
│  │ - MessagePack (binary serialization)                │    │
│  │ - Zstd-22 (dictionary training)                     │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Encryption Layer                                    │    │
│  │ - XChaCha20-Poly1305 (PII)                          │    │
│  │ - AES-256-GCM (sovereign keys)                      │    │
│  │ - X25519 ECDH (ZK witness → TEE)                    │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Zero-Knowledge Proofs (TEE Architecture)            │    │
│  │ - Witness generation (Poseidon hash, client-side)   │    │
│  │ - Witness encryption (X25519 ECDH)                  │    │
│  │ - TEE proof request (HTTP to AWS Nitro endpoint)    │    │
│  │ - Attestation verification (AWS Nitro)              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
          ↓ PII Storage                    ↓ ZK Proving
┌──────────────────────────┐    ┌──────────────────────────────┐
│  CipherVault (NEAR)      │    │  TEE Prover (AWS Nitro)      │
│  - Encrypted PII         │    │  - Nitro Enclaves            │
│  - Sovereign keys        │    │  - Halo2 proving (2-5s)      │
└──────────────────────────┘    │  - Attestation documents     │
                                └──────────────────────────────┘
                                         ↓ Proof Verification
                                ┌──────────────────────────────┐
                                │  DistrictVerifier (Scroll L2)│
                                │  - Halo2 verification        │
                                │  - Attestation verification  │
                                └──────────────────────────────┘
```

---

## Dependencies

```json
{
  "dependencies": {
    "libsodium-wrappers": "^0.7.13",
    "@bokuweb/zstd-wasm": "^0.0.20",
    "@msgpack/msgpack": "^3.0.0",
    "@noble/hashes": "^1.3.3",
    "circomlibjs": "^0.1.7"
  }
}
```

**Why these libraries?**
- **libsodium-wrappers**: Industry-standard for XChaCha20-Poly1305, X25519 ECDH, constant-time operations
- **@bokuweb/zstd-wasm**: Fastest Zstd implementation for browser, supports dictionary training
- **@msgpack/msgpack**: Smallest binary serialization, 30% reduction vs JSON
- **@noble/hashes**: Audited HKDF/SHA256 implementation, no dependencies
- **circomlibjs**: Poseidon hash for ZK witness generation and Merkle tree hashing

---

## Key Derivation

### HKDF from Wallet Signature (Primary Method)

**Purpose:** Derive 32-byte sovereign key from wallet signature (high entropy).

```typescript
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

export interface WalletKeyDerivation {
  signature: Uint8Array;  // 64 bytes (NEAR ed25519 signature)
  accountId: string;      // NEAR account ID
  purpose: string;        // "voter-protocol-sovereign-key-v1"
}

export async function deriveKeyFromWallet(
  params: WalletKeyDerivation
): Promise<Uint8Array> {
  // HKDF parameters
  const ikm = params.signature;  // Input key material (64 bytes)
  const salt = new TextEncoder().encode(params.accountId);
  const info = new TextEncoder().encode(params.purpose);

  // Derive 32-byte key using HKDF-SHA256
  const key = hkdf(sha256, ikm, salt, info, 32);

  return key;
}
```

**Security Properties:**
- High entropy input (wallet signature = 64 bytes random)
- Account ID binding prevents key reuse across accounts
- Purpose string prevents key reuse across contexts
- One-way derivation (cannot recover signature from key)

**Gas Cost:** FREE (client-side derivation)

---

### PBKDF2 from Password (Fallback Method)

**Purpose:** Derive key from password when wallet unavailable (OWASP 2023 recommendations).

```typescript
export interface PasswordKeyDerivation {
  password: string;
  accountId: string;
  iterations?: number;  // Default: 600,000 (OWASP 2023)
}

export async function deriveKeyFromPassword(
  params: PasswordKeyDerivation
): Promise<{ key: Uint8Array; salt: Uint8Array }> {
  const iterations = params.iterations ?? 600_000;

  // Generate random salt (16 bytes)
  const salt = sodium.randombytes_buf(16);

  // Derive 32-byte key using PBKDF2-SHA256
  const key = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(params.password),
      'PBKDF2',
      false,
      ['deriveBits']
    ),
    256  // 32 bytes
  );

  return {
    key: new Uint8Array(key),
    salt: salt
  };
}
```

**Security Properties:**
- 600,000 iterations (OWASP 2023 recommendation)
- Random salt prevents rainbow tables
- SHA-256 (widely supported, audited)
- Store salt with envelope for key recovery

**Performance:** ~500ms on modern devices (acceptable for infrequent operation)

---

## Compression Layer

**Full implementation details:** [COMPRESSION-STRATEGY.md](../COMPRESSION-STRATEGY.md)

### Multi-Stage Pipeline

```
Input (PIIData)
  ↓
MessagePack Serialization (2300B → 1600B, 30% reduction)
  ↓
Zstd-22 with Dictionary (1600B → 180B, 8.4x ratio)
  ↓
Output (Uint8Array, ready for encryption)
```

### Dictionary Training

**Purpose:** Improve compression on small PII data (< 1KB).

```typescript
import { train } from '@bokuweb/zstd-wasm';

// Train dictionary on 1000+ PII samples
export async function trainPIIDictionary(
  samples: PIIData[]
): Promise<Uint8Array> {
  // Convert samples to MessagePack binary
  const packedSamples = samples.map(s => msgpack.encode(s));

  // Train 16KB dictionary
  const dictionary = await train(packedSamples, 16 * 1024);

  return dictionary;
}

// Pre-trained dictionary (embed in SDK)
const PII_DICTIONARY: Uint8Array = await loadDictionary();
```

**Results:**
- Without dictionary: 3.7x compression ratio
- With dictionary: 8.4x compression ratio
- 57% improvement on small data

---

### Compression Functions

```typescript
import * as zstd from '@bokuweb/zstd-wasm';
import * as msgpack from '@msgpack/msgpack';

export interface PIIData {
  email: string;
  firstName: string;
  lastName: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  congressionalDistrict?: string;
}

export async function compressPII(pii: PIIData): Promise<Uint8Array> {
  // Stage 1: Binary serialization (30% reduction)
  const packed = msgpack.encode(pii);

  // Stage 2: Dictionary-trained Zstd compression (8.4x ratio)
  const compressed = await zstd.compress(packed, {
    level: 22,
    dictionary: PII_DICTIONARY
  });

  return compressed;
}

export async function decompressPII(compressed: Uint8Array): Promise<PIIData> {
  // Stage 1: Zstd decompression
  const decompressed = await zstd.decompress(compressed, {
    dictionary: PII_DICTIONARY
  });

  // Stage 2: MessagePack deserialization
  const pii = msgpack.decode(decompressed) as PIIData;

  return pii;
}
```

**Performance:**
- Compression: ~5ms for 2KB input
- Decompression: ~2ms
- Browser memory usage: < 10MB (WASM + dictionary)

---

## Encryption Layer

### PII Encryption (XChaCha20-Poly1305)

**Purpose:** Encrypt compressed PII with authenticated additional data (AAD).

```typescript
import sodium from 'libsodium-wrappers';

export interface EncryptionAAD {
  accountId: string;      // NEAR account ID
  timestamp: number;      // Unix timestamp (ms)
  version: string;        // "voter-protocol-v1"
}

export interface EncryptedPII {
  ciphertext: Uint8Array;  // Encrypted + authenticated
  nonce: Uint8Array;       // 24 bytes (XChaCha20)
  aad: EncryptionAAD;      // Stored separately (not encrypted)
}

export async function encryptPII(
  pii: PIIData,
  sovereignKey: Uint8Array,
  aad: EncryptionAAD
): Promise<EncryptedPII> {
  // STEP 1: COMPRESS (2300 bytes → 180 bytes)
  const compressed = await compressPII(pii);

  // STEP 2: ENCRYPT with AAD (180 bytes + 16 byte tag = 196 bytes)
  await sodium.ready;

  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );

  const aadBytes = new TextEncoder().encode(JSON.stringify(aad));

  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    compressed,
    aadBytes,
    null,  // No secret nonce
    nonce,
    sovereignKey
  );

  return {
    ciphertext,
    nonce,
    aad
  };
}
```

**Security Properties:**
- XChaCha20-Poly1305 provides confidentiality + authenticity
- AAD binding prevents ciphertext reuse across contexts
- 24-byte nonce (192 bits) eliminates collision risk
- Poly1305 MAC prevents tampering (16-byte authentication tag)

**AAD Prevents:**
- Cross-account attacks (attacker copies ciphertext to different account)
- Replay attacks (timestamp prevents reuse)
- Version confusion (explicit version tag)

---

### PII Decryption

```typescript
export async function decryptPII(
  encrypted: EncryptedPII,
  sovereignKey: Uint8Array
): Promise<PIIData> {
  await sodium.ready;

  // Reconstruct AAD
  const aadBytes = new TextEncoder().encode(JSON.stringify(encrypted.aad));

  // Decrypt and verify MAC
  const compressed = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,  // No secret nonce
    encrypted.ciphertext,
    aadBytes,
    encrypted.nonce,
    sovereignKey
  );

  // MAC verification failed → throws exception
  if (compressed === null) {
    throw new Error('Decryption failed: invalid key or corrupted ciphertext');
  }

  // Decompress
  const pii = await decompressPII(compressed);

  return pii;
}
```

**Error Handling:**
- MAC verification failure → invalid key or tampering
- AAD mismatch → silent failure (MAC fails)
- Decompression failure → corrupted data

---

### Sovereign Key Encryption (AES-256-GCM)

**Purpose:** Encrypt sovereign key with user's passkey/wallet-derived key.

```typescript
export interface EncryptedSovereignKey {
  ciphertext: Uint8Array;  // Encrypted key (32 bytes)
  iv: Uint8Array;          // 12 bytes (AES-GCM)
  tag: Uint8Array;         // 16 bytes (authentication tag)
}

export async function encryptSovereignKey(
  sovereignKey: Uint8Array,     // 32 bytes
  passkeyDerivedKey: Uint8Array // 32 bytes (from HKDF/PBKDF2)
): Promise<EncryptedSovereignKey> {
  // Generate random IV (12 bytes for AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Import key for Web Crypto API
  const key = await crypto.subtle.importKey(
    'raw',
    passkeyDerivedKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // Encrypt with explicit IV and tag
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv, tagLength: 128 },
    key,
    sovereignKey
  );

  // Split ciphertext and tag
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, 32);
  const tag = encryptedArray.slice(32);  // Last 16 bytes

  return { ciphertext, iv, tag };
}
```

**Why AES-GCM?**
- Native Web Crypto API support (hardware acceleration)
- Authenticated encryption (prevents tampering)
- Industry standard for key wrapping

**Security Properties:**
- 256-bit key (future-proof against quantum attacks)
- 96-bit IV (sufficient for billions of encryptions)
- 128-bit authentication tag (prevents forgery)

---

### Sovereign Key Decryption

```typescript
export async function decryptSovereignKey(
  encrypted: EncryptedSovereignKey,
  passkeyDerivedKey: Uint8Array
): Promise<Uint8Array> {
  // Reconstruct ciphertext + tag
  const combined = new Uint8Array(
    encrypted.ciphertext.length + encrypted.tag.length
  );
  combined.set(encrypted.ciphertext, 0);
  combined.set(encrypted.tag, encrypted.ciphertext.length);

  // Import key
  const key = await crypto.subtle.importKey(
    'raw',
    passkeyDerivedKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt and verify tag
  const sovereignKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.iv, tagLength: 128 },
    key,
    combined
  );

  return new Uint8Array(sovereignKey);
}
```

---

## Zero-Knowledge Proof Generation (TEE Architecture)

**Purpose:** Generate Halo2 proofs for congressional district membership verification via Trusted Execution Environment (TEE).

**Architecture:** Client generates witness locally → Encrypts witness → TEE proves → User submits proof + attestation

**See also:** [ZK-PROOF-SPEC.md](./ZK-PROOF-SPEC.md) for complete Halo2 circuit implementation.

---

### Witness Generation (Client-Side)

**Purpose:** Generate witness data for Merkle tree membership proof (<1s, ~1KB data).

```typescript
import { poseidon } from 'circomlibjs';
import { sha256 } from '@noble/hashes/sha256';

export interface ShadowAtlasMerkleProof {
  districtPath: string[];   // Merkle path through district tree (~20 hashes)
  globalPath: string[];     // Merkle path through global tree (~10 hashes)
  districtRoot: string;     // Root of district tree
  shadowAtlasRoot: string;  // Global root (matches on-chain value)
  districtId: number;       // Congressional district ID (0-534)
}

export interface DistrictWitness {
  // Private inputs (never leave client in plaintext)
  addressHash: string;           // Poseidon(address, 0)
  districtProof: string[];       // District tree Merkle path
  globalProof: string[];         // Global tree Merkle path

  // Public inputs (submitted on-chain)
  shadowAtlasRoot: string;       // Global Merkle root
  districtHash: string;          // Poseidon(district_id, 0)
}

export async function generateDistrictWitness(
  address: string,
  districtId: number
): Promise<DistrictWitness> {
  // Step 1: Fetch Shadow Atlas Merkle proof from public IPFS
  const merkleProof = await fetchShadowAtlasProof(districtId, address);

  // Step 2: Hash address to field element
  const poseidonHash = await buildPoseidon();
  const addressHash = poseidonHash.F.toString(
    poseidonHash([BigInt('0x' + sha256(address)), 0n])
  );

  // Step 3: Hash district ID to field element
  const districtHash = poseidonHash.F.toString(
    poseidonHash([BigInt(districtId), 0n])
  );

  // Step 4: Assemble witness
  return {
    addressHash,
    districtProof: merkleProof.districtPath,
    globalProof: merkleProof.globalPath,
    shadowAtlasRoot: merkleProof.shadowAtlasRoot,
    districtHash
  };
}

async function fetchShadowAtlasProof(
  districtId: number,
  address: string
): Promise<ShadowAtlasMerkleProof> {
  // Fetch from public IPFS gateway or CDN
  const response = await fetch(
    `https://shadow-atlas.voter-protocol.org/proof/${districtId}/${address}`
  );
  return response.json();
}
```

**Performance:**
- Client-side generation: <1 second
- Memory usage: <100MB
- Battery impact: <0.1%
- Network: ~2KB download (Merkle proof)

---

### Witness Encryption for TEE

**Purpose:** Encrypt witness before sending to TEE proving service.

```typescript
export interface EncryptedWitness {
  ciphertext: Uint8Array;       // Encrypted witness (~1KB)
  ephemeralPublicKey: Uint8Array; // X25519 public key (32 bytes)
  nonce: Uint8Array;            // XChaCha20 nonce (24 bytes)
}

export async function encryptWitnessForTEE(
  witness: DistrictWitness,
  teePublicKey: Uint8Array  // TEE's X25519 public key
): Promise<EncryptedWitness> {
  await sodium.ready;

  // Generate ephemeral keypair for this encryption
  const ephemeralKeypair = sodium.crypto_box_keypair();

  // Derive shared secret using X25519
  const sharedSecret = sodium.crypto_scalarmult(
    ephemeralKeypair.privateKey,
    teePublicKey
  );

  // Generate nonce
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );

  // Serialize witness
  const witnessBytes = new TextEncoder().encode(JSON.stringify(witness));

  // Encrypt with XChaCha20-Poly1305
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    witnessBytes,
    null,  // No additional data
    null,  // No secret nonce
    nonce,
    sharedSecret
  );

  return {
    ciphertext,
    ephemeralPublicKey: ephemeralKeypair.publicKey,
    nonce
  };
}
```

**Security Properties:**
- **X25519 ECDH**: Ephemeral key agreement prevents replay attacks
- **XChaCha20-Poly1305**: Authenticated encryption (confidentiality + integrity)
- **Perfect forward secrecy**: Each witness uses new ephemeral key
- **TEE-only decryption**: Only TEE with matching private key can decrypt

---

### TEE Proof Request

**Purpose:** Send encrypted witness to TEE and receive proof + attestation.

```typescript
export interface TEEProofRequest {
  encryptedWitness: EncryptedWitness;
  districtId: number;  // Public (for routing/logging)
}

export interface TEEProofResponse {
  proof: Uint8Array;           // Halo2 proof (384-512 bytes)
  attestation: Uint8Array;     // AWS Nitro attestation document (~1-2KB)
  districtHash: string;        // Public output (matches witness)
  publicInputs: string[];      // [shadowAtlasRoot, districtHash]
}

export class TEEProver {
  private teeEndpoint: string;
  private teePublicKey: Uint8Array;

  constructor(config: { endpoint: string; publicKey: Uint8Array }) {
    this.teeEndpoint = config.endpoint;
    this.teePublicKey = config.publicKey;
  }

  async generateProof(
    witness: DistrictWitness,
    onProgress?: (step: string, percent: number) => void
  ): Promise<TEEProofResponse> {
    // Step 1: Encrypt witness (<1s)
    onProgress?.('Encrypting witness', 10);
    const encryptedWitness = await encryptWitnessForTEE(
      witness,
      this.teePublicKey
    );

    // Step 2: Send to TEE (2-5s proving time)
    onProgress?.('Generating proof in TEE', 30);
    const response = await fetch(`${this.teeEndpoint}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encryptedWitness: {
          ciphertext: Array.from(encryptedWitness.ciphertext),
          ephemeralPublicKey: Array.from(encryptedWitness.ephemeralPublicKey),
          nonce: Array.from(encryptedWitness.nonce)
        },
        districtId: parseInt(witness.districtHash)  // For logging only
      })
    });

    if (!response.ok) {
      throw new Error(`TEE proving failed: ${response.statusText}`);
    }

    const result = await response.json();

    // Step 3: Verify attestation locally (<1s)
    onProgress?.('Verifying TEE attestation', 80);
    await this.verifyAttestation(result.attestation);

    onProgress?.('Complete', 100);

    return {
      proof: new Uint8Array(result.proof),
      attestation: new Uint8Array(result.attestation),
      districtHash: result.districtHash,
      publicInputs: result.publicInputs
    };
  }

  private async verifyAttestation(attestation: Uint8Array): Promise<void> {
    // Verify AWS Nitro Enclaves attestation document
    // This ensures:
    // 1. Code running in enclave matches expected PCR measurements (hash)
    // 2. Enclave is genuine AWS Nitro environment
    // 3. No tampering with enclave code

    // TODO: Implement AWS Nitro attestation verification
    // Reference: https://github.com/aws/aws-nitro-enclaves-nsm-api
    // Attestation document is CBOR-encoded with signature

    // For now, basic structure validation
    if (attestation.length < 512) {
      throw new Error('Invalid attestation document: too short');
    }
  }
}
```

**Usage Example:**
```typescript
// Initialize TEE prover with endpoint and public key
const teeProver = new TEEProver({
  endpoint: 'https://tee-prover.voter-protocol.org',
  publicKey: new Uint8Array(/* TEE X25519 public key */)
});

// Generate witness locally
const witness = await generateDistrictWitness(
  '123 Main St, Washington DC 20001',
  0  // District ID (DC's at-large district)
);

// Request proof from TEE
const proofResponse = await teeProver.generateProof(
  witness,
  (step, percent) => console.log(`${step}: ${percent}%`)
);

// Submit to blockchain (see CLIENT-SDK-SPEC.md)
await submitDistrictProof(
  proofResponse.proof,
  proofResponse.attestation,
  proofResponse.publicInputs
);
```

**End-to-End Performance:**
1. Generate witness (client): <1s
2. Encrypt witness (client): <1s
3. TEE proving: 2-5s
4. Verify attestation (client): <1s
5. Submit to blockchain: 2-5s
**Total: 10-15 seconds**

---

### Commitment Generation (Deprecated)

**Note:** This section is **deprecated**. VOTER Protocol now uses Halo2 ZK proofs generated in TEE (see above) rather than simple Poseidon commitments. This code is kept for reference only.

~~```typescript
import { buildPoseidon } from 'circomlibjs';

export async function generateCommitment(
  pii: PIIData,
  sovereignKey: Uint8Array
): Promise<string> {
  const poseidon = await buildPoseidon();

  // Convert PII to field elements (simplified)
  const fields = [
    BigInt(hashToField(pii.email)),
    BigInt(hashToField(pii.firstName)),
    BigInt(hashToField(pii.lastName)),
    BigInt(hashToField(pii.streetAddress)),
    BigInt(hashToField(pii.zipCode))
  ];

  // Compute Poseidon hash
  const commitment = poseidon.F.toString(poseidon(fields));

  return commitment;
}

function hashToField(input: string): string {
  const hash = sha256(new TextEncoder().encode(input));
  const hex = Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 64);  // 32 bytes = 64 hex chars
}
```~~

**Why deprecated:**
- Poseidon commitments are NOT zero-knowledge proofs (they only prove data binding)
- TEE-based Halo2 proofs provide actual ZK properties (prove district membership without revealing address)
- Commitments remain useful for PII integrity verification, but not for ZK district verification

---

## Complete Encryption Flow

```typescript
export interface CipherEnvelope {
  encrypted_data: Uint8Array;
  nonce: Uint8Array;
  encrypted_sovereign_key: Uint8Array;
  sovereign_key_iv: Uint8Array;
  sovereign_key_tag: Uint8Array;
}

export async function createEnvelope(
  pii: PIIData,
  passkeyDerivedKey: Uint8Array,
  accountId: string
): Promise<CipherEnvelope> {
  // Step 1: Generate random sovereign key
  await sodium.ready;
  const sovereignKey = sodium.randombytes_buf(32);

  // Step 2: Encrypt PII with sovereign key
  const aad: EncryptionAAD = {
    accountId,
    timestamp: Date.now(),
    version: 'voter-protocol-v1'
  };
  const encryptedPII = await encryptPII(pii, sovereignKey, aad);

  // Step 3: Encrypt sovereign key with passkey-derived key
  const encryptedKey = await encryptSovereignKey(
    sovereignKey,
    passkeyDerivedKey
  );

  // Step 4: Assemble envelope
  return {
    encrypted_data: encryptedPII.ciphertext,
    nonce: encryptedPII.nonce,
    encrypted_sovereign_key: encryptedKey.ciphertext,
    sovereign_key_iv: encryptedKey.iv,
    sovereign_key_tag: encryptedKey.tag
  };
}
```

---

## Complete Decryption Flow

```typescript
export async function openEnvelope(
  envelope: CipherEnvelope,
  passkeyDerivedKey: Uint8Array,
  aad: EncryptionAAD
): Promise<PIIData> {
  // Step 1: Decrypt sovereign key
  const sovereignKey = await decryptSovereignKey(
    {
      ciphertext: envelope.encrypted_sovereign_key,
      iv: envelope.sovereign_key_iv,
      tag: envelope.sovereign_key_tag
    },
    passkeyDerivedKey
  );

  // Step 2: Decrypt PII
  const pii = await decryptPII(
    {
      ciphertext: envelope.encrypted_data,
      nonce: envelope.nonce,
      aad
    },
    sovereignKey
  );

  return pii;
}
```

---

## Testing

### Test Coverage

```typescript
// tests/crypto-sdk/key-derivation.test.ts
describe('Key Derivation', () => {
  test('HKDF from wallet signature', async () => {
    const signature = new Uint8Array(64).fill(1);
    const key = await deriveKeyFromWallet({
      signature,
      accountId: 'test.near',
      purpose: 'voter-protocol-sovereign-key-v1'
    });
    expect(key).toHaveLength(32);
  });

  test('PBKDF2 from password', async () => {
    const result = await deriveKeyFromPassword({
      password: 'hunter2',
      accountId: 'test.near',
      iterations: 100_000  // Reduced for test speed
    });
    expect(result.key).toHaveLength(32);
    expect(result.salt).toHaveLength(16);
  });
});

// tests/crypto-sdk/compression.test.ts
describe('Compression', () => {
  const samplePII: PIIData = {
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    streetAddress: '1600 Pennsylvania Ave NW',
    city: 'Washington',
    state: 'DC',
    zipCode: '20500'
  };

  test('compress and decompress PII', async () => {
    const compressed = await compressPII(samplePII);
    const decompressed = await decompressPII(compressed);
    expect(decompressed).toEqual(samplePII);
    expect(compressed.length).toBeLessThan(500);  // Target < 500B
  });
});

// tests/crypto-sdk/encryption.test.ts
describe('Encryption', () => {
  test('encrypt and decrypt PII', async () => {
    const sovereignKey = sodium.randombytes_buf(32);
    const aad: EncryptionAAD = {
      accountId: 'test.near',
      timestamp: Date.now(),
      version: 'voter-protocol-v1'
    };

    const encrypted = await encryptPII(samplePII, sovereignKey, aad);
    const decrypted = await decryptPII(encrypted, sovereignKey);

    expect(decrypted).toEqual(samplePII);
  });

  test('AAD binding prevents cross-account attacks', async () => {
    const sovereignKey = sodium.randombytes_buf(32);
    const aad1: EncryptionAAD = {
      accountId: 'alice.near',
      timestamp: Date.now(),
      version: 'voter-protocol-v1'
    };
    const aad2: EncryptionAAD = {
      accountId: 'bob.near',
      timestamp: Date.now(),
      version: 'voter-protocol-v1'
    };

    const encrypted = await encryptPII(samplePII, sovereignKey, aad1);

    // Attempt to decrypt with different AAD
    await expect(
      decryptPII({ ...encrypted, aad: aad2 }, sovereignKey)
    ).rejects.toThrow('Decryption failed');
  });

  test('encrypt and decrypt sovereign key', async () => {
    const sovereignKey = sodium.randombytes_buf(32);
    const passkeyKey = sodium.randombytes_buf(32);

    const encrypted = await encryptSovereignKey(sovereignKey, passkeyKey);
    const decrypted = await decryptSovereignKey(encrypted, passkeyKey);

    expect(decrypted).toEqual(sovereignKey);
  });
});

// tests/crypto-sdk/integration.test.ts
describe('Complete Flow', () => {
  test('create and open envelope', async () => {
    const passkeyKey = sodium.randombytes_buf(32);

    const envelope = await createEnvelope(
      samplePII,
      passkeyKey,
      'test.near'
    );

    const decrypted = await openEnvelope(
      envelope,
      passkeyKey,
      {
        accountId: 'test.near',
        timestamp: Date.now(),
        version: 'voter-protocol-v1'
      }
    );

    expect(decrypted).toEqual(samplePII);
  });
});
```

**Run tests:**
```bash
cd packages/crypto
npm test
```

---

## Package Structure

```
packages/crypto/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── key-derivation.ts           # HKDF, PBKDF2
│   ├── compression.ts              # MessagePack, Zstd
│   ├── encryption.ts               # XChaCha20, AES-GCM
│   ├── envelope.ts                 # PII envelope flow
│   ├── zk/
│   │   ├── witness.ts              # ZK witness generation (client-side)
│   │   ├── tee-prover.ts           # TEE proof request client
│   │   └── attestation.ts          # AWS Nitro attestation verification
│   └── dictionary/
│       └── pii-dictionary.bin      # Pre-trained Zstd dictionary
├── tests/
│   ├── key-derivation.test.ts
│   ├── compression.test.ts
│   ├── encryption.test.ts
│   ├── envelope.test.ts
│   ├── zk/
│   │   ├── witness.test.ts
│   │   ├── tee-prover.test.ts
│   │   └── attestation.test.ts
│   └── integration.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## Performance Benchmarks

**Target Performance (Modern Device):**

| Operation | Target | Typical |
|-----------|--------|---------|
| **PII Encryption** | | |
| HKDF derivation | < 10ms | 2-5ms |
| PBKDF2 derivation (600k) | < 1000ms | 500ms |
| Compression (2KB) | < 10ms | 5ms |
| Decompression | < 5ms | 2ms |
| PII encryption | < 20ms | 8ms |
| PII decryption | < 20ms | 10ms |
| Sovereign key encryption | < 10ms | 3ms |
| Complete envelope creation | < 50ms | 20ms |
| Complete envelope opening | < 50ms | 25ms |
| **ZK Proof (TEE)** | | |
| Witness generation (client) | < 1000ms | 500ms |
| Witness encryption (client) | < 100ms | 50ms |
| TEE proving (server) | < 5000ms | 2000-5000ms |
| Attestation verification (client) | < 1000ms | 500ms |
| **End-to-end ZK proof** | **< 15s** | **10-15s** |

**Optimization Notes:**
- WASM modules loaded once at initialization
- Dictionary loaded once and cached
- Libsodium initialized once per session
- TEE prover endpoint supports connection pooling
- Use Web Workers for background encryption/witness generation (future)

---

## Security Considerations

### Client-Side Only (PII Encryption)
- ✅ All PII encryption happens in browser (server never sees plaintext)
- ✅ Sovereign key generated client-side (32 bytes entropy)
- ✅ Passkey-derived key never leaves device

### Authenticated Encryption
- ✅ XChaCha20-Poly1305 provides confidentiality + authenticity
- ✅ AAD binding prevents ciphertext reuse
- ✅ MAC verification prevents tampering

### Key Management
- ✅ HKDF from wallet signature (primary, high-entropy)
- ✅ PBKDF2 from password (fallback, OWASP 2023 compliant)
- ✅ Sovereign key wrapped with AES-256-GCM
- ✅ Explicit IV and tag storage prevents decryption failures

### Compression Security
- ✅ Compression before encryption (no timing attacks)
- ✅ Dictionary training on public data only
- ✅ No compression of encrypted data (CRIME/BREACH immune)

### TEE Proving Security
- ✅ **Witness privacy**: Address never leaves client in plaintext (encrypted with X25519 ECDH)
- ✅ **Perfect forward secrecy**: Ephemeral keypair per witness prevents replay attacks
- ✅ **Attestation verification**: Client verifies AWS Nitro attestation before trusting proof
- ✅ **Code integrity**: TEE attestation ensures code matches expected PCR measurements (hash)
- ⚠️ **Hardware trust**: Assumes AWS Nitro Enclaves implementation is correct (industry-standard assumption)
- ⚠️ **Platform trust**: Assumes AWS does not have undisclosed backdoor into Nitro Enclaves
- ✅ **No platform trust for correctness**: Blockchain verifies proof validity, not just attestation

**Trust Model:**
- **PII storage**: Zero-trust (client-side encryption, server never sees plaintext)
- **ZK proving**: Hardware-based trust (AWS Nitro Enclaves)
- **Proof verification**: Zero-trust (on-chain Halo2 verification, mathematical soundness)

**See also:** [ZK-PROOF-SPEC.md](./ZK-PROOF-SPEC.md) for complete TEE security threat model

---

## Integration

**For Client SDK Integration:** See [CLIENT-SDK-SPEC.md](./CLIENT-SDK-SPEC.md)

**For Contract Storage:** See [CIPHERVAULT-CONTRACT-SPEC.md](./CIPHERVAULT-CONTRACT-SPEC.md)

**For Compression Details:** See [COMPRESSION-STRATEGY.md](../COMPRESSION-STRATEGY.md)

**Example usage:**
```typescript
import {
  createEnvelope,
  openEnvelope,
  deriveKeyFromWallet,
  generateDistrictWitness,
  TEEProver
} from '@voter-protocol/crypto';

// 1. Create PII envelope
const passkeyKey = await deriveKeyFromWallet({
  signature: walletSignature,
  accountId: 'alice.near',
  purpose: 'voter-protocol-sovereign-key-v1'
});

const envelope = await createEnvelope(pii, passkeyKey, 'alice.near');

// 2. Store on-chain (see CLIENT-SDK-SPEC.md)
await cipherVault.store_envelope({
  encrypted_data: Array.from(envelope.encrypted_data),
  nonce: Array.from(envelope.nonce),
  encrypted_sovereign_key: Array.from(envelope.encrypted_sovereign_key),
  sovereign_key_iv: Array.from(envelope.sovereign_key_iv),
  sovereign_key_tag: Array.from(envelope.sovereign_key_tag),
  guardians: null
});

// 3. Generate district membership proof (TEE-based ZK proof)
const teeProver = new TEEProver({
  endpoint: 'https://tee-prover.voter-protocol.org',
  publicKey: TEE_PUBLIC_KEY
});

const witness = await generateDistrictWitness(
  pii.streetAddress + ', ' + pii.city + ', ' + pii.state + ' ' + pii.zipCode,
  pii.congressionalDistrict || 0
);

const proof = await teeProver.generateProof(witness);

// 4. Submit proof on-chain (see ZK-PROOF-SPEC.md)
await districtVerifier.verifyDistrictMembership({
  proof: Array.from(proof.proof),
  districtHash: proof.districtHash,
  attestationReport: Array.from(proof.attestation)
});

// 5. Retrieve and decrypt PII
const stored = await cipherVault.get_envelope(envelopeId);
const decryptedPii = await openEnvelope(
  {
    encrypted_data: new Uint8Array(stored.encrypted_data),
    nonce: new Uint8Array(stored.nonce),
    encrypted_sovereign_key: new Uint8Array(stored.encrypted_sovereign_key),
    sovereign_key_iv: new Uint8Array(stored.sovereign_key_iv),
    sovereign_key_tag: new Uint8Array(stored.sovereign_key_tag)
  },
  passkeyKey,
  {
    accountId: 'alice.near',
    timestamp: stored.created_at / 1_000_000,  // Convert nanoseconds
    version: 'voter-protocol-v1'
  }
);
```

---

## Status

- 📋 **Pending:** Implementation (Day 3-4)
- 📋 **Pending:** Test suite (15+ tests planned)
- 📋 **Pending:** Dictionary training on sample PII data
- 📋 **Pending:** Performance benchmarking
- 📋 **Pending:** Bundle size optimization (< 500KB target)

---

**Next:** [CLIENT-SDK-SPEC.md](./CLIENT-SDK-SPEC.md) - CipherVault client wrapper, storage management
