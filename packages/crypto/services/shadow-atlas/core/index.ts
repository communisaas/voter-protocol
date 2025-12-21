/**
 * Shadow Atlas Cryptographic Primitives
 *
 * Provides Poseidon2 hashing and Merkle tree operations using
 * Noir stdlib via @noir-lang/noir_js (Barretenberg backend).
 */

export {
  Poseidon2Hasher,
  getHasher,
  hashPair,
  hashSingle,
  hashString,
} from './poseidon2-hasher.js';
