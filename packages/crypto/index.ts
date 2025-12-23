/**
 * VOTER Protocol Crypto SDK
 *
 * Cryptography library providing:
 * - Poseidon2 hashing (Noir stdlib compatibility for ZK circuits)
 * - District resolution services
 * - Geocoding services
 *
 * @packageDocumentation
 */

export {
  Poseidon2Hasher,
  getHasher,
  hashPair,
  hashSingle,
  hashString,
} from './poseidon2.js';
