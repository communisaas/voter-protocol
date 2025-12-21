/**
 * Merkle Proof Generator
 *
 * Generates cryptographic inclusion proofs for district membership.
 * Clients verify proofs against published Merkle root (IPFS + on-chain).
 *
 * Proof format:
 * - leaf: Hash of district data
 * - siblings: Sibling hashes for tree traversal
 * - pathIndices: 0 = left, 1 = right
 * - root: Merkle root (cryptographic commitment)
 *
 * Verification:
 * hash(hash(...hash(leaf, sibling[0]), sibling[1])...) == root
 *
 * SECURITY CRITICAL: Proofs enable trustless verification.
 * Clients don't trust server - they verify cryptographically.
 */

import { ShadowAtlasMerkleTree, type MerkleProof } from '../merkle-tree';
import type { DistrictBoundary } from './types';

/**
 * Merkle proof service
 */
export class ProofService {
  private merkleTree: ShadowAtlasMerkleTree;
  private readonly districtMap: Map<string, number>;

  /**
   * @param districts - Array of districts (must match Merkle tree construction)
   * @param addresses - Array of addresses used to build tree (sorted lexicographically)
   */
  constructor(districts: readonly DistrictBoundary[], addresses: readonly string[]) {
    // Build Merkle tree from addresses
    this.merkleTree = new ShadowAtlasMerkleTree(addresses);

    // Build district ID → address index map
    this.districtMap = new Map();
    districts.forEach((district, index) => {
      this.districtMap.set(district.id, index);
    });
  }

  /**
   * Generate Merkle proof for district
   *
   * @param districtId - District ID to prove membership
   * @returns Merkle proof with siblings and path indices
   * @throws Error if district not found
   */
  generateProof(districtId: string): MerkleProof {
    const addressIndex = this.districtMap.get(districtId);

    if (addressIndex === undefined) {
      throw new Error(`District not found in tree: ${districtId}`);
    }

    // Get corresponding address (districts and addresses must be 1:1 mapped)
    // In production, this would be loaded from database or snapshot
    // For now, we generate proof by district ID directly
    return this.generateProofByIndex(addressIndex);
  }

  /**
   * Generate proof by address index
   */
  private generateProofByIndex(index: number): MerkleProof {
    const leaves = this.merkleTree.getLeaves();
    const leaf = leaves[index];

    if (!leaf) {
      throw new Error(`Invalid index: ${index}`);
    }

    // Generate proof using Merkle tree
    const siblings: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;

    // Traverse tree from leaf to root, collecting siblings
    for (let level = 0; level < 12; level++) {
      // Fixed depth of 12
      const isLeftChild = currentIndex % 2 === 0;
      const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
      const layer = this.merkleTree.getLayer(level);
      const siblingHash = layer[siblingIndex];

      if (siblingHash === undefined) {
        throw new Error(`Missing sibling at level ${level}, index ${siblingIndex}`);
      }

      siblings.push(siblingHash);
      pathIndices.push(isLeftChild ? 0 : 1);

      // Move to parent index
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: this.merkleTree.getRoot(),
      leaf,
      siblings,
      pathIndices,
    };
  }

  /**
   * Verify Merkle proof (for testing, actual verification in browser/ZK circuit)
   *
   * @param proof - Merkle proof to verify
   * @returns true if proof is valid
   */
  verifyProof(proof: MerkleProof): boolean {
    let computedHash = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathIndices[i] === 0;

      if (isLeftChild) {
        computedHash = this.hashPair(computedHash, sibling);
      } else {
        computedHash = this.hashPair(sibling, computedHash);
      }
    }

    return computedHash === proof.root;
  }

  /**
   * Hash two values using Poseidon (via WASM)
   * NOTE: In production, import from merkle-tree.ts
   */
  private hashPair(left: bigint, right: bigint): bigint {
    // Import hash_pair from WASM circuit
    // For now, simplified implementation (replace with actual WASM call)
    const leftHex = '0x' + left.toString(16).padStart(64, '0');
    const rightHex = '0x' + right.toString(16).padStart(64, '0');

    // In production: import { hash_pair } from '../../circuits/pkg';
    // const hashHex = hash_pair(leftHex, rightHex);
    // return BigInt(hashHex);

    // Placeholder: XOR for testing (REPLACE with WASM Poseidon)
    return left ^ right;
  }

  /**
   * Get Merkle root
   */
  getRoot(): bigint {
    return this.merkleTree.getRoot();
  }

  /**
   * Get total leaf count
   */
  getLeafCount(): number {
    return this.merkleTree.getLeaves().length;
  }

  /**
   * Generate ZK proof for district membership
   * 
   * Uses the barretenberg stateful keygen backend.
   * 
   * @param districtId - District ID to prove
   */
  async generateZKProof(districtId: string): Promise<Uint8Array> {
    // 1. Get Merkle inclusions proof
    const merkleProof = this.generateProof(districtId);

    // 2. Initialize Circuit Driver
    // Note: In a real app, you should cache the driver/prover instance
    const { CircuitDriver } = await import('../core/circuit_driver');
    const driver = await CircuitDriver.new();

    // 3. Generate Witness
    // TODO: Use Noir WASM to generate witness from inputs
    // const inputs = this.mapToCircuitInputs(merkleProof);
    // const witness = await generate_witness(inputs);

    console.warn("Using placeholder witness - proof generation will fail until Noir Witness generation is hooked up");
    const witness = new Uint8Array(100); // Placeholder

    // 4. Generate Proof
    return driver.prove(witness);
  }
}

/**
 * Compact proof format for network transmission
 */
export interface CompactProof {
  readonly r: string; // root (hex)
  readonly l: string; // leaf (hex)
  readonly s: readonly string[]; // siblings (hex array)
  readonly p: readonly number[]; // path indices
}

/**
 * Convert MerkleProof to compact format
 */
export function toCompactProof(proof: MerkleProof): CompactProof {
  return {
    r: '0x' + proof.root.toString(16),
    l: '0x' + proof.leaf.toString(16),
    s: proof.siblings.map((s) => '0x' + s.toString(16)),
    p: proof.pathIndices as number[],
  };
}

/**
 * Convert compact format back to MerkleProof
 */
export function fromCompactProof(compact: CompactProof): MerkleProof {
  return {
    root: BigInt(compact.r),
    leaf: BigInt(compact.l),
    siblings: compact.s.map((s) => BigInt(s)),
    pathIndices: compact.p,
  };
}
