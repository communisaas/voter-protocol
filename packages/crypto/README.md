# @voter-protocol/crypto

Client-side cryptography library for VOTER Protocol providing compression and key derivation.

## Features

- **90% Cost Reduction**: Multi-stage compression (MessagePack + Zstd-22)
- **Wallet-Compatible**: HKDF key derivation from NEAR signatures
- **ZK-Friendly**: WASM Poseidon hashing for Shadow Atlas integration

## Installation

```bash
npm install @voter-protocol/crypto
```

## Quick Start

```typescript
import {
  compressPII,
  decompressPII,
  deriveSovereignKey,
  initCrypto
} from '@voter-protocol/crypto';

// Initialize library (call once)
await initCrypto();

// 1. Compress PII data for storage
const piiData = {
  streetAddress: '123 Main St',
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  congressionalDistrict: 'TX-21'
};

const compressed = await compressPII(piiData);
console.log('Compressed size:', compressed.length); // ~180 bytes (vs 2.3KB JSON)

// 2. Later: Decompress
const pii = await decompressPII(compressed);

// 3. Derive key from NEAR wallet signature
const signature = await nearWallet.signMessage('voter-protocol-kdf');
const sovereignKey = deriveSovereignKey(signature, accountId);
```

## Architecture

### Compression Pipeline

```
JSON (2300B) → MessagePack (1600B) → Zstd-22 (180B) → 92% reduction
```

- **Stage 1**: MessagePack binary serialization (30% smaller)
- **Stage 2**: Zstandard-22 with dictionary training (8.4x ratio)
- **Result**: $1.12 → $0.11 per user storage cost

### Key Derivation

- **Primary**: HKDF from NEAR ed25519 signatures
- **Fallback**: PBKDF2 with 600k iterations (OWASP 2023)

### WASM Poseidon Hashing

- **Purpose**: Shadow Atlas Merkle tree construction
- **Implementation**: Axiom halo2_base circuit exported to JavaScript
- **Functions**: `hash_pair(left, right)`, `hash_single(value)`
- **Consistency**: Same Poseidon used in ZK circuits and off-chain Atlas build

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


## Security Considerations

### Client-Side Only

- All cryptographic operations happen in browser
- Keys never transmitted unencrypted
- ZK proofs generated client-side with WASM

### Memory Safety

- Use `wipeKey()` and `wipeMemory()` after key use
- Secure random generation for key derivation
- Constant-time operations

### Cryptographic Consistency

- **WASM Poseidon exports** ensure Shadow Atlas uses same hash as ZK circuits
- **Golden vector testing** validates hash outputs match audited Axiom implementation
- **Never mix implementations**: Only use WASM exports, never circomlibjs or other libraries

## Performance

- **Compression**: ~5ms for 2KB input
- **Decompression**: ~3ms for 180B input
- **Key Derivation**: ~50ms for HKDF, ~3s for PBKDF2
- **WASM Poseidon**: ~1ms per hash operation
- **Memory**: < 10MB (WASM + dictionary)

## References

- [TEST_STRATEGY.md](../../TEST_STRATEGY.md) - Testing philosophy and WASM Poseidon validation
- [COMPRESSION-STRATEGY.md](../../COMPRESSION-STRATEGY.md) - Compression analysis

## License

MIT
