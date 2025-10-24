/**
 * @voter-protocol/client
 *
 * Browser SDK for VOTER Protocol
 * - Zero-knowledge district verification (Halo2 proofs)
 * - NEAR Chain Signatures (universal account abstraction)
 * - Scroll L2 settlement
 * - ERC-8004 portable reputation
 */

export { VOTERClient } from './client';
export type { VOTERClientConfig, VOTERClientState } from './client';

// Account management
export { NEARAccountManager } from './account/near-account';
export { ChainSignatureManager } from './account/chain-signatures';
export { ChainSignaturesSigner } from './account/chain-signatures-signer';
export { KeyStoreManager } from './account/keystore-manager';
export type {
  NEARAccount,
  NEARAccountOptions,
  ChainSignatureRequest,
  ChainSignature
} from './account/types';

// Zero-knowledge proofs
export { Halo2Prover } from './zk/halo2-prover';
export { ShadowAtlas } from './zk/shadow-atlas';
export type {
  DistrictProof,
  ProofInputs,
  MerkleProof,
  ShadowAtlasConfig
} from './zk/types';

// Smart contracts
export { DistrictGateContract } from './contracts/district-gate';
export { ReputationRegistryContract } from './contracts/reputation-registry';
export type {
  DistrictGateConfig,
  ReputationScore,
  ReputationTier
} from './contracts/types';

// Utilities
export {
  formatTokenAmount,
  getReputationTier,
  isConnectedWallet
} from './utils/format';

export {
  VOTERError,
  ProofGenerationError,
  ContractError,
  NetworkError
} from './utils/errors';

// Address types and validation
export type { StreetAddress, EthereumAddress } from './utils/addresses';
export {
  createStreetAddress,
  createEthereumAddress,
  isStreetAddress,
  isEthereumAddress,
  sanitizeStreetAddressForLogging,
  toChecksumAddress
} from './utils/addresses';

// Browser-safe encoding utilities
export {
  uint8ToBase64,
  base64ToUint8,
  uint8ToHex,
  hexToUint8
} from './utils/encoding';
