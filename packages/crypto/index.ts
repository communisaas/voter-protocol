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

import { Poseidon2Hasher as _Poseidon2Hasher } from './poseidon2.js';

export {
  Poseidon2Hasher,
  getHasher,
  hash3,
  hash4,
  hashPair,
  hashSingle,
  hashString,
  poseidon2Sponge,
  DOMAIN_HASH1,
  DOMAIN_HASH2,
  DOMAIN_HASH3,
  DOMAIN_HASH4,
  DOMAIN_SPONGE_24,
} from './poseidon2.js';

// Export BN254_MODULUS for field validation in dependent packages (BR3-003 fix)
export const BN254_MODULUS = _Poseidon2Hasher.BN254_MODULUS;

export {
  SparseMerkleTree,
  createSparseMerkleTree,
  type SMTProof,
  type SMTConfig,
  type Field,
} from './sparse-merkle-tree.js';

export {
  computeEngagementDataCommitment,
  computeEngagementLeaf,
  computeShannonDiversity,
  encodeShannonDiversity,
  computeCompositeScore,
  deriveTier,
  type EngagementMetrics,
  type EngagementData,
} from './engagement.js';
