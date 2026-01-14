/**
 * Shadow Atlas Global Integration Layer - Barrel Export
 *
 * Single import point for global Merkle tree integration types and utilities.
 * Provides hierarchical tree construction, proof generation, and verification
 * for international multi-jurisdictional boundary data.
 *
 * ARCHITECTURE:
 * - types.ts: Type definitions for global tree structures
 * - global-merkle-tree.ts: GlobalMerkleTreeBuilder implementation
 * - global-tree-adapter.ts: Adapter bridging flat and global trees
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Continental regions
  ContinentalRegion,
  // Global boundary types
  GlobalBoundaryType,
  // Input data
  GlobalDistrictInput,
  // Tree structures
  LeafEntry,
  RegionTree,
  CountryTree,
  ContinentalTree,
  GlobalMerkleTree,
  // Proof structures
  GlobalMerkleProof,
} from './types.js';

// ============================================================================
// Type Guard Exports
// ============================================================================

export {
  isContinentalRegion,
  isGlobalDistrictInput,
  isLeafEntry,
  isGlobalMerkleTree,
  isGlobalMerkleProof,
} from './types.js';

// ============================================================================
// Implementation Exports
// ============================================================================

/**
 * Global Merkle tree builder
 *
 * Constructs hierarchical tree from district inputs:
 * 1. Group districts by continent → country → region
 * 2. Build region trees (district leaves)
 * 3. Build country trees (region roots)
 * 4. Build continental trees (country roots)
 * 5. Build global tree (continental roots)
 */
export { GlobalMerkleTreeBuilder } from './global-merkle-tree.js';

/**
 * Global tree adapter
 *
 * Bridges flat US Merkle trees with global hierarchical trees:
 * - Single country + optimization → flat tree (battle-tested)
 * - Multi-country → global hierarchical tree
 */
export {
  GlobalTreeAdapter,
  type GlobalTreeConfig,
  type UnifiedMerkleTree,
} from './global-tree-adapter.js';
