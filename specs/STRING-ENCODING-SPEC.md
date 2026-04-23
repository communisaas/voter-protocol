# String-to-Field Encoding Specification

> **Version:** 1.1.0
> **Status:** NORMATIVE (updated for BA-022 length-prefix fix)
> **Date:** 2026-01-26 (§ Encoding Algorithm revised 2026-04-23)
> **Author:** Voter Protocol Engineering

---

## Overview

This document specifies how strings are encoded as BN254 field elements for **Poseidon2** hashing in the voter-protocol. This specification is critical for ensuring cross-implementation compatibility between TypeScript and Noir ZK circuits.

**Scope — what is covered:**
- Poseidon2 string hashing (`hashString`) used inside ZK circuits for deterministic field-element derivation of strings (template ids, session ids, etc. when they appear as circuit inputs).

**Scope — what is NOT covered:**
- `action_domain` derivation, which does *not* use Poseidon2. `action_domain = keccak256(abi.encodePacked(protocol, country, jurisdictionType, recipientSubdivision, templateId, sessionId)) mod BN254`, implemented via Ethers `solidityPackedKeccak256` in `commons/src/lib/core/zkp/action-domain-builder.ts`. That path has its own semantics — see COORDINATION-INTEGRITY-SPEC § action_domain.

**Why This Matters:** Any divergence in Poseidon2 string encoding between implementations will cause Merkle proof verification failures. The encoding algorithm must be implemented identically in all environments where string hashes are computed.

---

## BN254 Field Constraints

| Property | Value |
|----------|-------|
| Field modulus | `21888242871839275222246405745257275088548364400416034343698204186575808495617` |
| Maximum bits | 254 |
| Safe chunk size | 31 bytes (248 bits) |

### Why 31 Bytes?

The BN254 scalar field has a 254-bit modulus. To guarantee that any arbitrary byte sequence can be represented as a valid field element without modular reduction:

- 32 bytes = 256 bits (may exceed field modulus)
- 31 bytes = 248 bits (always less than 254-bit modulus)

**Mathematical guarantee:** `2^248 - 1 < 2^254 < field_modulus`

Therefore, any 31-byte chunk interpreted as a big-endian unsigned integer is guaranteed to be a valid field element.

---

## Encoding Algorithm

### Step 1: UTF-8 Encode

Convert the input string to a UTF-8 byte array. This is the standard encoding for Unicode text and ensures consistent representation across platforms.

```typescript
const bytes = Buffer.from(str, 'utf-8');
```

### Step 2: Chunk into 31-Byte Segments

Split the byte array into chunks of exactly 31 bytes. The final chunk may contain fewer bytes (no padding required during chunking).

```typescript
for (let i = 0; i < bytes.length; i += 31) {
  const chunk = bytes.subarray(i, Math.min(i + 31, bytes.length));
  // Process chunk...
}
```

### Step 3: Convert Chunks to Field Elements

Each chunk is converted to a bigint using **big-endian** byte order:

```typescript
// Convert bytes to hex string, then to bigint
const fieldElement = BigInt('0x' + chunk.toString('hex'));
```

Equivalent algorithm (explicit):
```typescript
let value = 0n;
for (const byte of chunk) {
  value = (value << 8n) | BigInt(byte);
}
```

### Step 4: Hash Field Elements (BA-022 length-prefix algorithm)

The hash is seeded with the UTF-8 byte length, then each chunk is folded in left-to-right:

```
hash ← hashSingle(byte_length)
for chunk in chunks:
    hash ← hashPair(hash, chunk)
return hash
```

**Rationale (BA-022):** Without a length commitment, `""` and `"\x00"` both chunk to `[0n]` and collide under `hashSingle(0n)`; more broadly, any two strings whose 31-byte chunk sequences share a common suffix (trailing zero bytes) could collide. Seeding with the byte length makes every distinct string length a separate domain.

### Complete Reference Implementation

```typescript
/**
 * Convert a string to BN254 field elements using 31-byte chunking.
 *
 * @param str - Input string (any valid Unicode)
 * @returns Array of field elements (bigints)
 */
function stringToFieldElements(str: string): bigint[] {
  const bytes = Buffer.from(str, 'utf-8');
  const chunks: bigint[] = [];

  // Split into 31-byte chunks (248 bits < 254-bit BN254 field)
  for (let i = 0; i < bytes.length; i += 31) {
    const chunk = bytes.subarray(i, Math.min(i + 31, bytes.length));
    // Big-endian conversion via hex
    chunks.push(BigInt('0x' + chunk.toString('hex')));
  }

  return chunks;
}

/**
 * Hash a string to a single BN254 field element using Poseidon2.
 *
 * @param str - Input string
 * @returns Poseidon2 hash as bigint
 */
async function hashString(str: string): Promise<bigint> {
  const bytes = Buffer.from(str, 'utf-8');
  const chunks = stringToFieldElements(str);

  // BA-022: seed with byte length for domain separation
  let hash = await hashSingle(BigInt(bytes.length));
  for (const chunk of chunks) {
    hash = await hashPair(hash, chunk);
  }
  return hash;
}
```

**Canonical implementation:** `voter-protocol/packages/crypto/poseidon2.ts:553-583` (method `hashString`). Any reference to this spec's algorithm must match that function byte-for-byte, including the length-prefix seed.

---

## Byte Order: Big-Endian Rationale

This specification uses **big-endian** byte order for the following reasons:

1. **Natural String Ordering:** Big-endian preserves the left-to-right character order in the numeric representation. The string "AB" produces a larger value than "AA".

2. **Cryptographic Convention:** Most cryptographic standards (SHA-256, Keccak, etc.) use big-endian encoding for hash inputs.

3. **Consistency with Noir:** The Noir stdlib and BN254 field operations commonly use big-endian representation for byte arrays.

**Example:**
```
String: "ab"
UTF-8 bytes: [0x61, 0x62]
Big-endian value: 0x6162 = 24930
Little-endian value: 0x6261 = 25185
```

---

## Multi-Chunk Hashing Diagram

For strings longer than 31 bytes, chunks are hashed iteratively using left-associative reduction:

```
String: "This is a string longer than thirty-one bytes for testing"

Chunks:
  chunk[0] = "This is a string longer than t" (31 bytes)
  chunk[1] = "hirty-one bytes for testing"    (27 bytes)

Hashing:
  result = hashPair(chunk[0], chunk[1])
```

For even longer strings (62+ bytes):

```
String: [93+ characters]

Chunks:
  chunk[0] = [bytes 0-30]   (31 bytes)
  chunk[1] = [bytes 31-61]  (31 bytes)
  chunk[2] = [bytes 62-92]  (31 bytes)
  chunk[3] = [bytes 93+]    (remaining)

Hashing:
  step1 = hashPair(chunk[0], chunk[1])
  step2 = hashPair(step1, chunk[2])
  step3 = hashPair(step2, chunk[3])
  result = step3
```

---

## Test Vectors

> **⚠️ STALE — REGENERATION REQUIRED.** The vectors below were computed against the pre-BA-022 algorithm (no length prefix). They do **not** match the current `hashString` implementation in `poseidon2.ts` and will not verify against circuits built with it. Any consumer of this spec must regenerate vectors against the canonical TS implementation before relying on them, using the updated algorithm documented in Step 4 above.

The following test vectors were originally derived from the Poseidon2 implementation using `@noir-lang/noir_js`. **They are retained here for historical reference and must be replaced.**

### Basic Test Vectors (PRE-BA-022 — DO NOT USE)

| Input | UTF-8 Bytes | Chunks | Expected Hash |
|-------|-------------|--------|---------------|
| `""` (empty) | `[]` | `[0n]` | `11250791130336988991462250958918728798886439319225016858543557054782819955502n` |
| `"hello"` | `[0x68, 0x65, 0x6c, 0x6c, 0x6f]` | `[0x68656c6c6fn]` | `20295016858894593428496862809304457135181095319758016614231461188944930689651n` |
| `"voter-protocol-cve-006"` | 22 bytes | 1 chunk | `18611551177496161129560967712699392992457741027215021515979218815229220122625n` |
| `"voter-protocol-v1"` | 17 bytes | 1 chunk | `16900686253063682909327301483753383152173078221873999706517999868669682448702n` |

### Chunk Boundary Test Vectors

| Input | Byte Length | Chunk Count | Description |
|-------|-------------|-------------|-------------|
| `"a" x 30` | 30 | 1 | Under boundary |
| `"a" x 31` | 31 | 1 | Exact boundary |
| `"a" x 32` | 32 | 2 | Over boundary |
| `"a" x 62` | 62 | 2 | Exact 2 chunks |
| `"a" x 63` | 63 | 3 | Over 2 chunks |

### UTF-8 Multi-Byte Test Vectors

| Input | UTF-8 Bytes | Byte Length | Description |
|-------|-------------|-------------|-------------|
| `"a"` | `[0x61]` | 1 | ASCII single byte |
| `"\u00e9"` (e with accent) | `[0xc3, 0xa9]` | 2 | 2-byte UTF-8 |
| `"\u4e2d"` (Chinese character) | `[0xe4, 0xb8, 0xad]` | 3 | 3-byte UTF-8 |
| `"\U0001f600"` (emoji) | `[0xf0, 0x9f, 0x98, 0x80]` | 4 | 4-byte UTF-8 |

---

## Cross-Implementation Requirements

### TypeScript Implementation

The reference implementation is in `@voter-protocol/crypto`:

```typescript
import { Poseidon2Hasher, hashString } from '@voter-protocol/crypto';

// Using the hasher instance
const hasher = await Poseidon2Hasher.getInstance();
const hash = await hasher.hashString('hello');

// Using the convenience function
const hash2 = await hashString('hello');
```

**File:** `/packages/crypto/poseidon2.ts`

### Noir Implementation

Any Noir circuit that hashes strings MUST use the same algorithm:

```noir
use dep::std::hash::poseidon2_permutation;

// For single chunk (0-31 bytes):
fn hash_string_single(bytes: [u8; N]) -> Field {
    let mut value: Field = 0;
    for i in 0..N {
        value = value * 256 + bytes[i] as Field;
    }
    poseidon2_permutation([value, 0, 0, 0], 4)[0]
}

// For multi-chunk strings, implement iterative hashing
// matching the TypeScript behavior
```

### Verification Requirement

Before deploying any new implementation, verify against the golden test vectors in:

```
/packages/crypto/test/golden-vectors.test.ts
/packages/crypto/test/string-encoding.test.ts
```

---

## Security Considerations

### Collision Resistance

The 31-byte chunking preserves the collision resistance of Poseidon2. Since each chunk is guaranteed to be a valid field element (no modular reduction), there is no information loss during encoding.

### Length Extension

The iterative hashing approach for multi-chunk strings does NOT suffer from length extension attacks because Poseidon2 uses a sponge-like construction with full-state output.

### Unicode Normalization

This specification does NOT mandate Unicode normalization. The same logical string may have different byte representations (e.g., NFC vs NFD). Applications requiring string comparison SHOULD normalize strings before hashing.

**Recommendation:** Use NFC normalization for user-facing strings:

```typescript
const normalized = str.normalize('NFC');
const hash = await hashString(normalized);
```

---

## Changelog

### Version 1.0.0 (2026-01-26)

- Initial specification
- Documented 31-byte chunking algorithm
- Added test vectors from golden-vectors.test.ts
- Added cross-implementation requirements

---

## References

- [BN254 Curve Parameters](https://eips.ethereum.org/EIPS/eip-197)
- [Poseidon2 Hash Function](https://eprint.iacr.org/2023/323)
- [Noir Stdlib Poseidon2](https://github.com/noir-lang/noir/blob/master/noir_stdlib/src/hash/poseidon2.nr)
- [UTF-8 Encoding Standard](https://datatracker.ietf.org/doc/html/rfc3629)
- [UNIFIED-PROOF-ARCHITECTURE.md](./UNIFIED-PROOF-ARCHITECTURE.md) - Uses string hashing for district IDs

---

**Maintainers:** Voter Protocol Engineering
**License:** MIT
