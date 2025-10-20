# @voter-protocol/crypto

Client-side cryptography library for VOTER Protocol providing compression, encryption, and key derivation.

## Features

- **90% Cost Reduction**: Multi-stage compression (MessagePack + Zstd-22)
- **Zero-Knowledge Privacy**: Client-side encryption only
- **Wallet-Compatible**: HKDF key derivation from NEAR signatures
- **Authenticated Encryption**: AAD binding prevents ciphertext reuse
- **ZK-Friendly**: Poseidon commitments for SNARK integrity

## Installation

```bash
npm install @voter-protocol/crypto
```

## Quick Start

```typescript
import {
  createEnvelope,
  openEnvelope,
  deriveSovereignKey,
  initCrypto
} from '@voter-protocol/crypto';

// Initialize library (call once)
await initCrypto();

// 1. Derive sovereign key from wallet signature
const signature = await nearWallet.signMessage('voter-protocol-kdf');
const sovereignKey = deriveSovereignKey(signature, accountId);

// 2. Encrypt PII data
const piiData = {
  streetAddress: '123 Main St',
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  congressionalDistrict: 'TX-21'
};

const envelope = await createEnvelope(piiData, sovereignKey, accountId);
// envelope.ciphertext is ~500 bytes (vs 5KB uncompressed)

// 3. Store in NEAR contract
await contract.store_envelope({
  encrypted_data: Array.from(envelope.ciphertext),
  nonce: Array.from(envelope.nonce),
  poseidon_commit: envelope.commitment
});

// 4. Later: Retrieve and decrypt
const fetchedEnvelope = await contract.get_envelope({ owner: accountId });
const decryptedPII = await openEnvelope(fetchedEnvelope, sovereignKey);
```

## Architecture

### Compression Pipeline

```
JSON (2300B) → MessagePack (1600B) → Zstd-22 (180B) → 92% reduction
```

- **Stage 1**: MessagePack binary serialization (30% smaller)
- **Stage 2**: Zstandard-22 with dictionary training (8.4x ratio)
- **Result**: $1.12 → $0.11 per user storage cost

### Encryption Layers

- **PII**: XChaCha20-Poly1305 with AAD binding
- **Sovereign Keys**: AES-256-GCM with explicit IV/tag
- **Commitments**: Poseidon hash for ZK integrity

### Key Derivation

- **Primary**: HKDF from NEAR ed25519 signatures
- **Fallback**: PBKDF2 with 600k iterations (OWASP 2023)

## API Reference

### Key Derivation

#### `deriveSovereignKey(signature: Uint8Array, accountId: string): Uint8Array`

Derive 32-byte sovereign key from wallet signature.

```typescript
const sovereignKey = deriveSovereignKey(signature, accountId);
```

#### `deriveAccountKey(signature: Uint8Array, accountId: string): Uint8Array`

Derive 32-byte account key for sovereign key encryption.

```typescript
const accountKey = deriveAccountKey(signature, accountId);
```

#### `deriveKeyFromPassword(params: PasswordKeyDerivation): Uint8Array`

Fallback key derivation from password (600k iterations).

```typescript
const key = deriveKeyFromPassword({
  password: 'user-password',
  accountId: accountId,
  purpose: 'voter-protocol-sovereign-key-v1'
});
```

### Compression

#### `compressPII(pii: PIIData): Promise<Uint8Array>`

Compress PII data (MessagePack + Zstd-22).

```typescript
const compressed = await compressPII(piiData);
console.log('Size:', compressed.length);  // ~180 bytes
```

#### `decompressPII(compressed: Uint8Array): Promise<PIIData>`

Decompress PII data.

```typescript
const pii = await decompressPII(compressed);
```

### Encryption

#### `encryptPII(data: Uint8Array, sovereignKey: Uint8Array, aad: EncryptionAAD): Promise<EncryptedPII>`

Encrypt with XChaCha20-Poly1305 and AAD binding.

```typescript
const encrypted = await encryptPII(compressed, sovereignKey, {
  accountId: accountId,
  timestamp: Date.now(),
  version: 'voter-protocol-v1'
});
```

#### `decryptPII(envelope: EncryptedPII, sovereignKey: Uint8Array): Promise<Uint8Array>`

Decrypt and verify AAD.

```typescript
const decrypted = await decryptPII(envelope, sovereignKey);
```

#### `encryptSovereignKey(sovereignKey: Uint8Array, accountKey: Uint8Array): Promise<EncryptedSovereignKey>`

Encrypt sovereign key for contract storage (AES-256-GCM with explicit IV/tag).

```typescript
const accountKey = deriveAccountKey(signature, accountId);
const encrypted = await encryptSovereignKey(sovereignKey, accountKey);

// Store in contract
await contract.store_envelope({
  encrypted_sovereign_key: Array.from(encrypted.ciphertext),
  sovereign_key_iv: Array.from(encrypted.iv),
  sovereign_key_tag: Array.from(encrypted.tag)
});
```

#### `generateCommitment(data: Uint8Array, nonce: Uint8Array, accountId: string): Promise<string>`

Generate Poseidon commitment for ZK integrity.

```typescript
const commitment = await generateCommitment(compressedPII, nonce, accountId);
// Returns 64-char hex string
```

### Convenience Functions

#### `createEnvelope(pii: PIIData, sovereignKey: Uint8Array, accountId: string): Promise<EncryptedPII>`

Complete compression + encryption flow.

```typescript
const envelope = await createEnvelope(piiData, sovereignKey, accountId);
// Returns ~500B encrypted envelope
```

#### `openEnvelope(envelope: EncryptedPII, sovereignKey: Uint8Array): Promise<PIIData>`

Complete decryption + decompression flow.

```typescript
const pii = await openEnvelope(envelope, sovereignKey);
```

## Security Considerations

### Client-Side Only

- All encryption happens in browser
- Server never sees plaintext PII
- Keys never transmitted unencrypted

### AAD Binding

- Ciphertext bound to account ID
- Prevents reuse across accounts
- Authentication verified on decrypt

### Memory Safety

- Use `wipeKey()` and `wipeMemory()` after key use
- Secure random generation (libsodium)
- Constant-time operations

## Performance

- **Compression**: ~5ms for 2KB input
- **Encryption**: ~2ms for 500B input
- **Key Derivation**: ~50ms for HKDF, ~3s for PBKDF2
- **Memory**: < 10MB (WASM + dictionary)

## References

- [CRYPTO-SDK-SPEC.md](../../specs/CRYPTO-SDK-SPEC.md) - Full specification
- [COMPRESSION-STRATEGY.md](../../COMPRESSION-STRATEGY.md) - Compression analysis
- [DAY-2-SECURITY-FIXES.md](../../DAY-2-SECURITY-FIXES.md) - Security audit findings

## License

MIT
