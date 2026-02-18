/**
 * Dual-Tree Builder - Two-Tree Architecture for VOTER Protocol
 *
 * Constructs both trees for the two-tree architecture:
 *
 * TREE 1 (User Identity Tree):
 *   Standard balanced binary Merkle tree containing user registration leaves.
 *   Leaf = Poseidon2_Hash3(userSecret, cellId, registrationSalt)
 *   Uses the existing ShadowAtlasMerkleTree infrastructure.
 *
 * TREE 2 (Cell-District Mapping Tree):
 *   Sparse Merkle Tree mapping census tract cell IDs to 24-slot district arrays.
 *   Leaf = Poseidon2Hash2(cell_id, district_commitment)
 *   where district_commitment = poseidon2Sponge(districts[0..24])
 *   Uses SparseMerkleTree from @voter-protocol/crypto.
 *
 * SPEC REFERENCE: TWO-TREE-ARCHITECTURE-SPEC.md Sections 2, 3, 10
 *
 * @packageDocumentation
 */

import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';
import {
  SparseMerkleTree,
  createSparseMerkleTree,
  type SMTProof,
  type Field,
} from '@voter-protocol/crypto';
import type { CellMapState } from './serving/registration-service.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Number of district slots per cell in the 24-slot registration model.
 * Per DISTRICT-TAXONOMY.md:
 *   Slots 0-6:   Core governance (federal through municipal)
 *   Slots 7-10:  Education districts
 *   Slots 11-16: Core special districts
 *   Slots 17-19: Extended special districts
 *   Slots 20-21: Administrative boundaries
 *   Slots 22-23: Overflow/international
 */
export const DISTRICT_SLOT_COUNT = 24;

// User leaf hashing uses hash3(secret, cellId, salt) which internally applies
// DOMAIN_HASH3 = 0x48334d ("H3M") in the 4th Poseidon2 slot.
// This matches the Noir circuit: poseidon2_hash3(user_secret, cell_id, registration_salt).

/**
 * Cell-to-district mapping for a single census tract cell.
 *
 * Each cell represents a geographic area (Census Tract / Block Group)
 * and is mapped to exactly 24 district slots per the DISTRICT-TAXONOMY spec.
 */
export interface CellDistrictMapping {
  /** Census Tract FIPS code encoded as a BN254 field element */
  readonly cellId: bigint;
  /** Exactly 24 district IDs; unused slots MUST be 0n */
  readonly districts: bigint[];
}

/**
 * A single user registration record for Tree 1.
 */
export interface UserRegistration {
  /** User's secret (private, never revealed) */
  readonly userSecret: bigint;
  /** Census tract cell ID the user belongs to */
  readonly cellId: bigint;
  /** Random salt for registration uniqueness */
  readonly registrationSalt: bigint;
}

/**
 * Result of building the Cell-District Mapping tree (Tree 2).
 */
export interface CellMapTreeResult {
  /** Sparse Merkle Tree instance (for proof generation) */
  readonly tree: SparseMerkleTree;
  /** Root hash of Tree 2 */
  readonly root: bigint;
  /** Tree depth */
  readonly depth: number;
  /** Number of cells inserted */
  readonly cellCount: number;
  /** Map from cellId to its district commitment for quick lookup */
  readonly commitments: ReadonlyMap<string, bigint>;
  /** Map from cellId to the 24-slot district array (needed for CellMapState) */
  readonly districtMap: ReadonlyMap<string, readonly bigint[]>;
}

/**
 * Result of building the User Identity tree (Tree 1).
 */
export interface UserTreeResult {
  /** Leaf hashes in insertion order */
  readonly leaves: readonly bigint[];
  /** Root hash of Tree 1 */
  readonly root: bigint;
  /** Tree depth */
  readonly depth: number;
  /** Number of users in tree (excluding padding) */
  readonly leafCount: number;
  /** Ordered user leaf data for proof generation */
  readonly userLeafIndex: ReadonlyMap<number, { cellId: bigint }>;
}

/**
 * Combined result of building both trees.
 */
export interface DualTreeResult {
  userTree: {
    root: bigint;
    depth: number;
    leafCount: number;
  };
  cellMapTree: {
    root: bigint;
    depth: number;
    cellCount: number;
  };
  /** Warnings generated during construction (e.g., missing cell_ids) */
  warnings: string[];
}

/**
 * Proof structure for a cell-district mapping in Tree 2.
 * Contains all data needed by the ZK circuit.
 */
export interface CellMapProof {
  /** SMT proof (siblings, pathBits, attempt, root, key, value) */
  readonly proof: SMTProof;
  /** The 24 district IDs committed in this cell */
  readonly districts: readonly bigint[];
  /** District commitment hash = poseidon2Sponge(districts[0..24]) */
  readonly districtCommitment: bigint;
}

/**
 * Proof structure for a user in Tree 1.
 * Contains all data needed by the ZK circuit.
 */
export interface UserProof {
  /** Root of the user tree */
  readonly root: bigint;
  /** User's leaf hash */
  readonly leaf: bigint;
  /** Sibling hashes from leaf to root */
  readonly siblings: readonly bigint[];
  /** Path direction bits (0 = left, 1 = right) */
  readonly pathIndices: readonly number[];
  /** Index of the user's leaf in the tree */
  readonly leafIndex: number;
}

// ============================================================================
// Internal hasher + tree state
// ============================================================================

/** Module-level hasher cache (initialized on first use) */
let _hasher: Poseidon2Hasher | null = null;

async function ensureHasher(): Promise<Poseidon2Hasher> {
  if (!_hasher) {
    _hasher = await getHasher();
  }
  return _hasher;
}

// ============================================================================
// Cell Map Tree (Tree 2) - Sparse Merkle Tree
// ============================================================================

/**
 * Compute the district commitment for a 24-slot district array.
 *
 * commitment = poseidon2Sponge(districts[0..24])
 *
 * The sponge construction uses rate=3, capacity=1 with domain separation
 * tag DOMAIN_SPONGE_24 to prevent cross-context collisions.
 *
 * @param districts - Exactly 24 district IDs (0n for unused slots)
 * @returns District commitment hash
 */
export async function computeDistrictCommitment(districts: bigint[]): Promise<bigint> {
  if (districts.length !== DISTRICT_SLOT_COUNT) {
    throw new Error(
      `District array must have exactly ${DISTRICT_SLOT_COUNT} elements, got ${districts.length}`
    );
  }
  const hasher = await ensureHasher();
  return hasher.poseidon2Sponge(districts);
}

/**
 * Compute the cell-map leaf value for a given cell.
 *
 * cell_map_leaf = poseidon2Hash2(cell_id, district_commitment)
 *
 * @param cellId - Census tract FIPS as field element
 * @param districtCommitment - poseidon2Sponge(districts[0..24])
 * @returns Cell map leaf hash
 */
export async function computeCellMapLeaf(cellId: bigint, districtCommitment: bigint): Promise<bigint> {
  const hasher = await ensureHasher();
  return hasher.hashPair(cellId, districtCommitment);
}

/**
 * Build the Cell-District Mapping tree (Tree 2).
 *
 * For each cell mapping:
 *   1. Compute district_commitment = poseidon2Sponge(districts[0..24])
 *   2. Compute cell_map_leaf = poseidon2Hash2(cell_id, district_commitment)
 *   3. Insert into SMT with key=cell_id, value=cell_map_leaf
 *
 * @param mappings - Array of cell-to-district mappings
 * @param depth - SMT depth (default: 20 for ~1M capacity)
 * @returns CellMapTreeResult with tree instance, root, and metadata
 * @throws Error if duplicate cell_ids are detected
 */
export async function buildCellMapTree(
  mappings: CellDistrictMapping[],
  depth: number = 20,
): Promise<CellMapTreeResult> {
  const hasher = await ensureHasher();

  // Validate: no duplicate cell_ids
  const seenCellIds = new Set<string>();
  for (const mapping of mappings) {
    const key = mapping.cellId.toString();
    if (seenCellIds.has(key)) {
      throw new Error(`Duplicate cell_id detected: ${mapping.cellId}`);
    }
    seenCellIds.add(key);
  }

  // Create SMT
  const smt = await createSparseMerkleTree({ depth, hasher });

  // Track commitments and district arrays for proof generation
  const commitments = new Map<string, bigint>();
  const districtMap = new Map<string, readonly bigint[]>();

  // Insert each cell mapping
  for (const mapping of mappings) {
    // Validate district array length
    if (mapping.districts.length !== DISTRICT_SLOT_COUNT) {
      throw new Error(
        `Cell ${mapping.cellId}: district array must have ${DISTRICT_SLOT_COUNT} elements, ` +
        `got ${mapping.districts.length}`
      );
    }

    // Step 1: district commitment = poseidon2Sponge(districts)
    const districtCommitment = await hasher.poseidon2Sponge(mapping.districts);

    // Step 2: cell_map_leaf = hashPair(cell_id, district_commitment)
    const cellMapLeaf = await hasher.hashPair(mapping.cellId, districtCommitment);

    // Step 3: Insert into SMT
    await smt.insert(mapping.cellId, cellMapLeaf);

    // Track for later proof generation
    const cellIdStr = mapping.cellId.toString();
    commitments.set(cellIdStr, districtCommitment);
    districtMap.set(cellIdStr, [...mapping.districts]);
  }

  const root = await smt.getRoot();

  return {
    tree: smt,
    root,
    depth,
    cellCount: mappings.length,
    commitments,
    districtMap,
  };
}

/**
 * Convert a CellMapTreeResult into the CellMapState shape needed by the serving layer.
 *
 * @param result - Output from buildCellMapTree()
 * @returns CellMapState ready for createShadowAtlasAPI()
 */
export function toCellMapState(result: CellMapTreeResult): CellMapState {
  return {
    tree: result.tree,
    root: result.root,
    commitments: result.commitments,
    districtMap: result.districtMap,
    depth: result.depth,
  };
}

// ============================================================================
// User Identity Tree (Tree 1) - Standard Balanced Merkle Tree
// ============================================================================

/**
 * Compute a user leaf hash for Tree 1.
 *
 * user_leaf = poseidon2_hash3(userSecret, cellId, registrationSalt)
 *
 * Uses the hash3() method which applies DOMAIN_HASH3 (0x48334d = "H3M") in the
 * 4th Poseidon2 state slot. This MUST match the Noir circuit's poseidon2_hash3().
 *
 * State layout: [userSecret, cellId, registrationSalt, DOMAIN_HASH3]
 *
 * @param user - User registration data
 * @returns User leaf hash
 */
export async function computeUserLeaf(user: UserRegistration): Promise<bigint> {
  const hasher = await ensureHasher();
  return hasher.hash3(user.userSecret, user.cellId, user.registrationSalt);
}

/**
 * Build the User Identity tree (Tree 1).
 *
 * Constructs a standard balanced binary Merkle tree from user registration
 * leaves. The tree is built bottom-up with parallel pair hashing.
 *
 * For each user:
 *   user_leaf = hash3(userSecret, cellId, registrationSalt)
 *
 * Leaves are padded with a deterministic padding hash to fill to 2^depth.
 *
 * @param users - Array of user registrations
 * @param depth - Tree depth (default: 20)
 * @returns UserTreeResult with root, leaves, and metadata
 */
export async function buildUserTree(
  users: UserRegistration[],
  depth: number = 20,
): Promise<UserTreeResult> {
  const hasher = await ensureHasher();
  const capacity = 2 ** depth;

  if (users.length > capacity) {
    throw new Error(
      `User count ${users.length} exceeds tree capacity ${capacity} (depth=${depth})`
    );
  }

  // Compute all user leaf hashes
  const userLeaves: bigint[] = [];
  const userLeafIndex = new Map<number, { cellId: bigint }>();

  for (let i = 0; i < users.length; i++) {
    const leaf = await computeUserLeaf(users[i]);
    userLeaves.push(leaf);
    userLeafIndex.set(i, { cellId: users[i].cellId });
  }

  // Compute padding hash (deterministic empty leaf)
  const paddingHash = await hasher.hashPair(0n, 0n);

  // Pad to capacity
  const leaves = [...userLeaves];
  while (leaves.length < capacity) {
    leaves.push(paddingHash);
  }

  // Build tree layers bottom-up
  const layers: bigint[][] = [leaves];
  let currentLayer = leaves;

  for (let level = 0; level < depth; level++) {
    const nextLayer: bigint[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const hash = await hasher.hashPair(currentLayer[i], currentLayer[i + 1]);
      nextLayer.push(hash);
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  const root = layers[depth][0];

  return {
    leaves: userLeaves,
    root,
    depth,
    leafCount: users.length,
    userLeafIndex,
  };
}

/**
 * Generate a Merkle proof for a user in Tree 1.
 *
 * Traverses the tree from the given leaf index to the root,
 * collecting sibling hashes and path direction bits.
 *
 * @param layers - Full tree layers (from buildUserTreeFull)
 * @param leafIndex - Index of the user's leaf
 * @param depth - Tree depth
 * @returns UserProof with siblings, pathIndices, and root
 */
export function generateUserProof(
  layers: readonly (readonly bigint[])[],
  leafIndex: number,
  depth: number,
): UserProof {
  if (leafIndex < 0 || leafIndex >= layers[0].length) {
    throw new Error(`Leaf index ${leafIndex} out of range [0, ${layers[0].length})`);
  }

  const siblings: bigint[] = [];
  const pathIndices: number[] = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < depth; level++) {
    const isLeftChild = currentIndex % 2 === 0;
    const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

    siblings.push(layers[level][siblingIndex]);
    pathIndices.push(isLeftChild ? 0 : 1);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    root: layers[depth][0],
    leaf: layers[0][leafIndex],
    siblings,
    pathIndices,
    leafIndex,
  };
}

/**
 * Build the User Identity tree and return full layer data for proof generation.
 *
 * This is the extended version of buildUserTree that retains all tree layers,
 * enabling getUserProof() calls after construction.
 *
 * @param users - Array of user registrations
 * @param depth - Tree depth (default: 20)
 * @returns Object containing layers, root, and metadata
 */
export async function buildUserTreeFull(
  users: UserRegistration[],
  depth: number = 20,
): Promise<{
  layers: bigint[][];
  root: bigint;
  depth: number;
  leafCount: number;
  userLeafIndex: Map<number, { cellId: bigint }>;
}> {
  const hasher = await ensureHasher();
  const capacity = 2 ** depth;

  if (users.length > capacity) {
    throw new Error(
      `User count ${users.length} exceeds tree capacity ${capacity} (depth=${depth})`
    );
  }

  // Compute all user leaf hashes
  const userLeaves: bigint[] = [];
  const userLeafIndex = new Map<number, { cellId: bigint }>();

  for (let i = 0; i < users.length; i++) {
    const leaf = await computeUserLeaf(users[i]);
    userLeaves.push(leaf);
    userLeafIndex.set(i, { cellId: users[i].cellId });
  }

  // Compute padding hash
  const paddingHash = await hasher.hashPair(0n, 0n);

  // Pad to capacity
  const leaves = [...userLeaves];
  while (leaves.length < capacity) {
    leaves.push(paddingHash);
  }

  // Build tree layers bottom-up
  const layers: bigint[][] = [leaves];
  let currentLayer = leaves;

  for (let level = 0; level < depth; level++) {
    const nextLayer: bigint[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const hash = await hasher.hashPair(currentLayer[i], currentLayer[i + 1]);
      nextLayer.push(hash);
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    layers,
    root: layers[depth][0],
    depth,
    leafCount: users.length,
    userLeafIndex,
  };
}

// ============================================================================
// Dual-Tree Builder (Combined)
// ============================================================================

/**
 * Build both trees and validate consistency.
 *
 * Validates that every user's cellId exists in the cell map tree.
 * If a user references an unknown cellId, a warning is emitted.
 * If `strict` is true, unknown cellIds cause an error instead.
 *
 * @param users - User registrations for Tree 1
 * @param mappings - Cell-district mappings for Tree 2
 * @param options - Optional configuration
 * @returns DualTreeResult with both roots and metadata
 */
export async function buildDualTrees(
  users: UserRegistration[],
  mappings: CellDistrictMapping[],
  options: {
    depth?: number;
    strict?: boolean;
  } = {},
): Promise<DualTreeResult> {
  const depth = options.depth ?? 20;
  const strict = options.strict ?? false;
  const warnings: string[] = [];

  // Build cell map tree first (needed for consistency check)
  const cellMapResult = await buildCellMapTree(mappings, depth);

  // Build known cell set
  const knownCells = new Set<string>(
    mappings.map(m => m.cellId.toString())
  );

  // Validate user cell_ids exist in cell map
  for (let i = 0; i < users.length; i++) {
    const cellIdStr = users[i].cellId.toString();
    if (!knownCells.has(cellIdStr)) {
      const msg = `User ${i}: cellId ${users[i].cellId} not found in cell-district map`;
      if (strict) {
        throw new Error(msg);
      }
      warnings.push(msg);
    }
  }

  // Build user tree
  const userResult = await buildUserTree(users, depth);

  return {
    userTree: {
      root: userResult.root,
      depth: userResult.depth,
      leafCount: userResult.leafCount,
    },
    cellMapTree: {
      root: cellMapResult.root,
      depth: cellMapResult.depth,
      cellCount: cellMapResult.cellCount,
    },
    warnings,
  };
}

// ============================================================================
// Proof Generation Helpers
// ============================================================================

/**
 * Get an SMT proof for a cell in Tree 2 along with its district data.
 *
 * Returns the full CellMapProof needed by the ZK circuit, including:
 * - SMT siblings and pathBits for Merkle verification
 * - The 24 district IDs for commitment recomputation
 * - The district commitment hash
 *
 * @param cellMapResult - Result from buildCellMapTree()
 * @param cellId - Cell ID to prove
 * @param mappings - Original mappings (needed for district retrieval)
 * @returns CellMapProof
 * @throws Error if cellId not found
 */
export async function getCellMapProof(
  cellMapResult: CellMapTreeResult,
  cellId: bigint,
  mappings: CellDistrictMapping[],
): Promise<CellMapProof> {
  // Look up the original mapping
  const mapping = mappings.find(m => m.cellId === cellId);
  if (!mapping) {
    throw new Error(`Cell ID ${cellId} not found in mappings`);
  }

  // Get SMT proof
  const proof = await cellMapResult.tree.getProof(cellId);

  // Get the district commitment from cache
  const commitment = cellMapResult.commitments.get(cellId.toString());
  if (commitment === undefined) {
    throw new Error(`District commitment not found for cell ${cellId}`);
  }

  return {
    proof,
    districts: mapping.districts,
    districtCommitment: commitment,
  };
}

/**
 * Get a standard Merkle proof for a user in Tree 1.
 *
 * @param layers - Full tree layers from buildUserTreeFull()
 * @param leafIndex - Index of the user leaf
 * @param depth - Tree depth
 * @returns UserProof
 */
export function getUserProof(
  layers: readonly (readonly bigint[])[],
  leafIndex: number,
  depth: number,
): UserProof {
  return generateUserProof(layers, leafIndex, depth);
}

// ============================================================================
// Proof Verification Helpers (for testing, not for ZK circuits)
// ============================================================================

/**
 * Verify a user proof against a known root.
 *
 * Recomputes root from leaf + siblings and checks equality.
 * Used for testing; actual verification is done by the ZK circuit.
 *
 * @param proof - User proof to verify
 * @returns true if proof reconstructs to the stated root
 */
export async function verifyUserProof(proof: UserProof): Promise<boolean> {
  const hasher = await ensureHasher();
  let currentHash = proof.leaf;

  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    const isLeftChild = proof.pathIndices[i] === 0;

    if (isLeftChild) {
      currentHash = await hasher.hashPair(currentHash, sibling);
    } else {
      currentHash = await hasher.hashPair(sibling, currentHash);
    }
  }

  return currentHash === proof.root;
}

/**
 * Verify a cell map proof against a known root.
 *
 * Uses SparseMerkleTree.verify() which reconstructs the root from
 * the proof's value, siblings, and pathBits.
 *
 * @param proof - SMT proof to verify
 * @param root - Expected root hash
 * @returns true if proof is valid
 */
export async function verifyCellMapProof(proof: SMTProof, root: bigint): Promise<boolean> {
  const hasher = await ensureHasher();
  return SparseMerkleTree.verify(proof, root, hasher);
}
