/**
 * Shadow Atlas Cryptographic Primitives
 *
 * Provides Poseidon2 hashing and Merkle tree operations using
 * Noir stdlib via @noir-lang/noir_js (Barretenberg backend).
 *
 * NOTE: Poseidon2 hasher now lives in @voter-protocol/crypto package.
 * This file re-exports for backwards compatibility.
 */

export {
  Poseidon2Hasher,
  getHasher,
  hashPair,
  hashSingle,
  hashString,
} from '@voter-protocol/crypto/poseidon2';
