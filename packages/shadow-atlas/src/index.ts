/**
 * Shadow Atlas - Geospatial Voting District Registry
 * 
 * @voter-protocol/shadow-atlas provides:
 * - Merkle tree construction for voting district boundaries
 * - Geospatial data acquisition from TIGER/Census and municipal sources
 * - Proof generation for ZK-based voter eligibility verification
 * - IPFS distribution for decentralized registry storage
 * 
 * @packageDocumentation
 */

// Core Merkle Tree (async API - uses Noir Poseidon2)
export {
    ShadowAtlasMerkleTree,
    createShadowAtlasMerkleTree,
    computeLeafHash,
    computeLeafHashesBatch,
    AUTHORITY_LEVELS,
    type BoundaryType,
    type MerkleLeafInput,
    type MerkleProof,
    type MerkleTreeConfig,
    type IPFSExportResult,
    exportToIPFS,
} from './merkle-tree.js';

// Multi-Layer Builder
export {
    MultiLayerMerkleTreeBuilder,
    type NormalizedBoundary,
    type MultiLayerMerkleTree,
    type MerkleLeafWithMetadata,
    type MultiLayerMerkleProof,
    type BoundaryLayers,
} from './core/multi-layer-builder.js';

// Global Merkle Tree (for multi-country support)
export {
    GlobalMerkleTreeBuilder,
    GLOBAL_AUTHORITY_LEVELS,
    REGION_NAMES,
    type GlobalBoundaryType,
    type AuthorityLevel,
    type ContinentalRegion,
    type GlobalDistrictInput,
    type DistrictLeafHash,
    type RegionalTree,
    type CountryTree,
    type ContinentalTree,
    type GlobalMerkleTree,
    type GlobalDistrictProof,
    type GlobalTreeUpdateResult,
} from './integration/global-merkle-tree.js';

// TIGER boundary types
export type { TIGERBoundaryType } from './provenance/tiger-authority-rules.js';

// Legislative layer types
export type { LegislativeLayerType } from './registry/state-gis-portals.js';

// Transformation and Validation
export {
    TransformationValidator,
    type FIPSValidation,
} from './transformation/validator.js';

// Poseidon2 hasher (async version using Noir) - re-exported from crypto package
export {
    Poseidon2Hasher,
    getHasher,
    hashPair,
    hashSingle,
    hashString,
} from '@voter-protocol/crypto/poseidon2';
