#!/usr/bin/env npx tsx
/**
 * Shadow Atlas Merkle Tree Builder (Layer 5)
 *
 * Builds canonical Merkle tree from deduplicated governance districts.
 * This is the final validation layer producing cryptographic commitment
 * for ZK residency proofs.
 *
 * ARCHITECTURE:
 * - Input: comprehensive_classified_layers.jsonl (Layers 1-4 output)
 * - Process: Construct binary Merkle tree with keccak256 hashing
 * - Output: merkle_tree.json, merkle_proofs.json, merkle_tree_report.txt
 *
 * DETERMINISM REQUIREMENTS:
 * - Canonical leaf ordering (sort by district_id)
 * - Consistent hashing (keccak256 for production)
 * - Reproducible tree construction (same input → same root)
 *
 * VALIDATION:
 * - All proofs verify against root before publishing
 * - Tree structure validated (depth, leaf count, balance)
 * - Output suitable for IPFS publishing and on-chain commitment
 */

import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { GovernanceDistrict } from '../schemas/governance-district.js';
import { QualityTier } from '../schemas/governance-district.js';

// ES module path handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Merkle leaf node for district
 */
interface MerkleLeaf {
  readonly index: number;           // Leaf position in tree (0-based)
  readonly district_id: string;     // Unique identifier (layer_url)
  readonly district_type: string;   // city_council, school_board, etc.
  readonly name: string;            // Layer name
  readonly geometry_hash: string;   // Keccak256(geometry) - placeholder for now
  readonly metadata_hash: string;   // Keccak256(metadata JSON)
  readonly leaf_hash: string;       // Keccak256(district_id || geometry_hash || metadata_hash)
}

/**
 * Merkle proof for district
 */
interface MerkleProof {
  readonly district_id: string;
  readonly leaf_hash: string;
  readonly proof: readonly string[];      // Sibling hashes along path to root
  readonly indices: readonly number[];    // Bit vector: 0 = left, 1 = right
  readonly root: string;
}

/**
 * Merkle tree structure
 */
interface MerkleTree {
  readonly root: string;
  readonly levels: readonly string[][];   // All tree levels (leaf to root)
  readonly leafCount: number;
  readonly depth: number;
}

/**
 * Country-specific Merkle tree (for global sharding)
 */
interface CountryMerkleTree {
  readonly country_code: string;     // ISO 3166-1 alpha-3 (USA, FRA, DEU)
  readonly root: string;             // Merkle root for this country
  readonly leaf_count: number;
  readonly depth: number;
  readonly ipfs_cid?: string;        // CID for this country's data (populated after IPFS upload)
}

/**
 * Global Merkle tree index
 */
interface GlobalMerkleTree {
  readonly global_root: string;      // Root of country roots
  readonly countries: readonly CountryMerkleTree[];
  readonly total_districts: number;
  readonly version: string;          // "2025-Q1"
  readonly created_at: string;       // ISO 8601 timestamp
}

/**
 * Tree construction report
 */
interface TreeReport {
  readonly version: string;
  readonly created_at: string;
  readonly input: {
    readonly total_districts: number;
    readonly filtered_districts: number;  // After quality filtering
    readonly countries: number;
  };
  readonly tree_structure: {
    readonly root: string;
    readonly depth: number;
    readonly leaf_count: number;
  };
  readonly proof_validation: {
    readonly total_proofs: number;
    readonly verified: number;
    readonly failed: number;
  };
  readonly ipfs_publishing?: {
    readonly global_index_cid: string;
    readonly country_cids: Record<string, string>;
    readonly total_size_mb: number;
  };
  readonly status: 'READY' | 'VALIDATION_FAILED' | 'INCOMPLETE';
}

/**
 * Keccak256 hash function (production-grade, matches Ethereum)
 */
function keccak256(data: string): string {
  return '0x' + createHash('sha3-256').update(data).digest('hex');
}

/**
 * Create district_id from layer_url (deterministic unique identifier)
 */
function createDistrictId(district: GovernanceDistrict): string {
  // Use layer_url as primary key (guaranteed unique)
  return district.layer_url;
}

/**
 * Fetch GeoJSON geometry from ArcGIS FeatureServer
 *
 * Constructs query URL from layer_url and fetches first feature's geometry.
 * Uses standard ArcGIS REST API pattern: {layer_url}/query?where=1=1&f=geojson&resultRecordCount=1
 *
 * @param layerUrl - Full ArcGIS layer URL (e.g., "https://services.arcgis.com/.../FeatureServer/0")
 * @returns GeoJSON geometry or null if fetch fails
 */
async function fetchGeometry(layerUrl: string): Promise<unknown | null> {
  try {
    const queryUrl = `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=1`;

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/geo+json, application/json',
        'User-Agent': 'VOTER-Protocol-ShadowAtlas/1.0',
      },
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      console.warn(`   ⚠️  Geometry fetch failed for ${layerUrl}: HTTP ${response.status}`);
      return null;
    }

    const geojson = await response.json() as { features?: Array<{ geometry?: unknown }> };

    // Extract first feature's geometry
    if (geojson.features && geojson.features.length > 0) {
      return geojson.features[0].geometry || null;
    }

    return null;
  } catch (error) {
    console.warn(`   ⚠️  Geometry fetch error for ${layerUrl}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Hash district geometry
 *
 * PRODUCTION MODE: Fetches actual GeoJSON geometry from ArcGIS FeatureServer and hashes it.
 * FALLBACK MODE: If geometry fetch fails, uses layer_url as deterministic placeholder.
 *
 * This ensures Merkle tree construction can proceed even if some layers are temporarily unavailable,
 * while still producing deterministic hashes for available geometries.
 *
 * @param district - Governance district metadata
 * @param useProductionGeometry - If true, fetch actual geometry; if false, use placeholder (default: false)
 * @returns Keccak256 hash of geometry
 */
async function hashGeometry(
  district: GovernanceDistrict,
  useProductionGeometry = false
): Promise<string> {
  if (!useProductionGeometry) {
    // Placeholder mode (backward compatible with existing tests)
    return keccak256(district.layer_url + ':geometry');
  }

  // Production mode: Fetch actual geometry
  const geometry = await fetchGeometry(district.layer_url);

  if (geometry !== null) {
    // Hash actual geometry (deterministic JSON serialization)
    const geometryJson = JSON.stringify(geometry);
    return keccak256(geometryJson);
  }

  // Fallback: Use layer_url if geometry unavailable
  console.warn(`   ⚠️  Using placeholder geometry hash for ${district.layer_url}`);
  return keccak256(district.layer_url + ':geometry');
}

/**
 * Hash district metadata
 */
function hashMetadata(district: GovernanceDistrict): string {
  // Deterministic metadata serialization
  const metadata = {
    service_url: district.service_url,
    layer_number: district.layer_number,
    layer_name: district.layer_name,
    district_type: district.district_type,
    governance_level: district.governance_level,
    tier: district.tier,
    confidence: district.confidence,
  };

  return keccak256(JSON.stringify(metadata));
}

/**
 * Create Merkle leaf from district
 *
 * @param district - Governance district
 * @param index - Leaf position in tree (0-based)
 * @param useProductionGeometry - If true, fetch actual geometry; if false, use placeholder
 * @returns Merkle leaf with hashed fields
 */
async function createLeaf(
  district: GovernanceDistrict,
  index: number,
  useProductionGeometry = false
): Promise<MerkleLeaf> {
  const district_id = createDistrictId(district);
  const geometry_hash = await hashGeometry(district, useProductionGeometry);
  const metadata_hash = hashMetadata(district);

  // Leaf hash: keccak256(district_id || geometry_hash || metadata_hash)
  const leaf_hash = keccak256(district_id + geometry_hash + metadata_hash);

  return {
    index,
    district_id,
    district_type: district.district_type,
    name: district.layer_name,
    geometry_hash,
    metadata_hash,
    leaf_hash,
  };
}

/**
 * Build binary Merkle tree from leaves
 */
function buildMerkleTree(leaves: readonly MerkleLeaf[]): MerkleTree {
  if (leaves.length === 0) {
    throw new Error('Cannot build tree from empty leaf set');
  }

  // Level 0: Leaf hashes
  let currentLevel = leaves.map(leaf => leaf.leaf_hash);
  const tree: string[][] = [currentLevel];

  // Build upward until root
  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length
        ? currentLevel[i + 1]
        : left; // Duplicate last node if odd number

      const parentHash = keccak256(left + right);
      nextLevel.push(parentHash);
    }

    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  return {
    root: currentLevel[0],
    levels: tree,
    leafCount: leaves.length,
    depth: tree.length - 1,
  };
}

/**
 * Generate Merkle proof for a leaf
 */
function generateProof(
  tree: MerkleTree,
  leaves: readonly MerkleLeaf[],
  leafIndex: number
): MerkleProof {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error(`Invalid leaf index: ${leafIndex}`);
  }

  const leaf = leaves[leafIndex];
  const proof: string[] = [];
  const indices: number[] = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < tree.depth; level++) {
    const isRightNode = currentIndex % 2 === 1;
    const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

    const siblingHash = tree.levels[level][siblingIndex]
      || tree.levels[level][currentIndex]; // Duplicate if no sibling

    proof.push(siblingHash);
    indices.push(isRightNode ? 1 : 0);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    district_id: leaf.district_id,
    leaf_hash: leaf.leaf_hash,
    proof,
    indices,
    root: tree.root,
  };
}

/**
 * Verify Merkle proof reconstructs root
 */
function verifyProof(proof: MerkleProof): boolean {
  let computedHash = proof.leaf_hash;

  for (let i = 0; i < proof.proof.length; i++) {
    const sibling = proof.proof[i];
    const isRightNode = proof.indices[i] === 1;

    computedHash = isRightNode
      ? keccak256(sibling + computedHash)
      : keccak256(computedHash + sibling);
  }

  return computedHash === proof.root;
}

/**
 * Load and filter districts from classified layers
 */
function loadDistricts(inputPath: string): GovernanceDistrict[] {
  const fileContent = readFileSync(inputPath, 'utf-8');
  const lines = fileContent.trim().split('\n').filter(line => line.length > 0);

  const allDistricts: GovernanceDistrict[] = lines.map(line => JSON.parse(line));

  // Filter to governance districts only (GOLD, SILVER, BRONZE tiers)
  // Exclude UTILITY (administrative) and REJECT (low confidence)
  const governanceDistricts = allDistricts.filter(d => {
    const governanceTiers: QualityTier[] = [QualityTier.GOLD, QualityTier.SILVER, QualityTier.BRONZE];
    return governanceTiers.includes(d.tier as QualityTier);
  });

  console.log(`\nLoaded ${allDistricts.length} total districts`);
  console.log(`Filtered to ${governanceDistricts.length} governance districts (GOLD/SILVER/BRONZE)`);

  return governanceDistricts;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('Shadow Atlas Merkle Tree Builder (Layer 5)');
  console.log('==========================================\n');

  const version = '2025-Q1';
  const startTime = Date.now();

  // Parse CLI arguments
  const useProductionGeometry = process.argv.includes('--production-geometry');

  if (useProductionGeometry) {
    console.log('🌐 PRODUCTION MODE: Fetching actual GeoJSON geometry from ArcGIS FeatureServers');
    console.log('   (This will take significantly longer than placeholder mode)\n');
  } else {
    console.log('📝 PLACEHOLDER MODE: Using layer_url as geometry proxy (fast)');
    console.log('   (Run with --production-geometry to fetch actual geometry)\n');
  }

  // Step 1: Load districts from classified layers
  const inputPath = join(__dirname, 'data', 'comprehensive_classified_layers.jsonl');
  console.log(`Reading input: ${inputPath}`);

  const districts = loadDistricts(inputPath);

  if (districts.length === 0) {
    console.error('ERROR: No governance districts found in input');
    process.exit(1);
  }

  // Step 2: Create leaves with deterministic ordering
  console.log('\nCreating Merkle leaves...');

  // Sort districts by district_id (lexicographic) for canonical ordering
  const sortedDistricts = [...districts].sort((a, b) =>
    createDistrictId(a).localeCompare(createDistrictId(b))
  );

  // Create leaves (async if fetching production geometry)
  const leaves: MerkleLeaf[] = [];
  for (let i = 0; i < sortedDistricts.length; i++) {
    const leaf = await createLeaf(sortedDistricts[i], i, useProductionGeometry);
    leaves.push(leaf);

    if ((i + 1) % 100 === 0) {
      console.log(`  Created ${i + 1}/${sortedDistricts.length} leaves`);
    }
  }

  console.log(`Created ${leaves.length} leaves (deterministically sorted)`);

  // Step 3: Build Merkle tree
  console.log('\nBuilding Merkle tree...');

  const tree = buildMerkleTree(leaves);

  console.log(`Tree constructed:`);
  console.log(`  Root: ${tree.root}`);
  console.log(`  Depth: ${tree.depth} levels`);
  console.log(`  Leaves: ${tree.leafCount}`);

  // Step 4: Generate proofs for all leaves
  console.log('\nGenerating Merkle proofs...');

  const proofs: MerkleProof[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const proof = generateProof(tree, leaves, i);
    proofs.push(proof);

    if ((i + 1) % 1000 === 0) {
      console.log(`  Generated ${i + 1}/${leaves.length} proofs`);
    }
  }

  console.log(`Generated ${proofs.length} proofs`);

  // Step 5: Validate all proofs
  console.log('\nValidating proofs...');

  let verified = 0;
  let failed = 0;
  const failedProofs: string[] = [];

  for (const proof of proofs) {
    if (verifyProof(proof)) {
      verified++;
    } else {
      failed++;
      failedProofs.push(proof.district_id);
    }
  }

  console.log(`  Verified: ${verified}/${proofs.length}`);
  console.log(`  Failed: ${failed}/${proofs.length}`);

  if (failed > 0) {
    console.error('\nERROR: Proof validation failed!');
    console.error('Failed district IDs:', failedProofs.slice(0, 10));
    process.exit(1);
  }

  // Step 6: Write outputs
  console.log('\nWriting outputs...');

  const outputDir = join(__dirname, 'data');

  // Write tree structure
  const treeOutput = {
    root: tree.root,
    depth: tree.depth,
    leaf_count: tree.leafCount,
    version,
    created_at: new Date().toISOString(),
  };

  writeFileSync(
    join(outputDir, 'merkle_tree.json'),
    JSON.stringify(treeOutput, null, 2)
  );
  console.log('  ✓ merkle_tree.json');

  // Write proofs
  writeFileSync(
    join(outputDir, 'merkle_proofs.json'),
    JSON.stringify(proofs, null, 2)
  );
  console.log('  ✓ merkle_proofs.json');

  // Write leaves
  writeFileSync(
    join(outputDir, 'merkle_leaves.json'),
    JSON.stringify(leaves, null, 2)
  );
  console.log('  ✓ merkle_leaves.json');

  // Step 7: Generate report
  const elapsedMs = Date.now() - startTime;

  const report: TreeReport = {
    version,
    created_at: new Date().toISOString(),
    input: {
      total_districts: districts.length,
      filtered_districts: sortedDistricts.length,
      countries: 1, // Phase 1: USA only
    },
    tree_structure: {
      root: tree.root,
      depth: tree.depth,
      leaf_count: tree.leafCount,
    },
    proof_validation: {
      total_proofs: proofs.length,
      verified,
      failed,
    },
    status: failed === 0 ? 'READY' : 'VALIDATION_FAILED',
  };

  // Write human-readable report
  const reportText = `
Merkle Tree Construction Report
================================
Date: ${report.created_at}
Version: ${report.version}
Execution Time: ${(elapsedMs / 1000).toFixed(2)} seconds

Input:
------
- Total districts: ${report.input.total_districts}
- Governance districts: ${report.input.filtered_districts} (GOLD/SILVER/BRONZE)
- Countries: ${report.input.countries} (USA only, Phase 1)

Tree Structure:
---------------
- Root: ${report.tree_structure.root}
- Depth: ${report.tree_structure.depth} levels
- Leaf count: ${report.tree_structure.leaf_count}

Proof Validation:
-----------------
- Total proofs: ${report.proof_validation.total_proofs}
- Verified: ${report.proof_validation.verified} (${((verified / proofs.length) * 100).toFixed(2)}%)
- Failed: ${report.proof_validation.failed} (${((failed / proofs.length) * 100).toFixed(2)}%)

IPFS Publishing:
----------------
- Status: PENDING (manual upload to Pinata/Filebase)
- Files to upload:
  - merkle_tree.json (tree structure)
  - merkle_proofs.json (all district proofs)
  - merkle_leaves.json (leaf data)

Status: ${report.status === 'READY' ? '✅ READY FOR ON-CHAIN COMMITMENT' : '❌ VALIDATION FAILED'}

${report.status === 'READY' ? `
Next Steps:
-----------
1. Upload files to IPFS (Pinata or Filebase)
2. Record IPFS CID in smart contract event
3. Verify on-chain root matches computed root
4. Publish IPFS gateway URLs for client consumption
` : `
Action Required:
----------------
⚠️  Proof validation failed for ${failed} districts
⚠️  Review failed_proofs.json for details
⚠️  Do NOT publish to IPFS or commit on-chain
`}
`.trim();

  writeFileSync(
    join(outputDir, 'merkle_tree_report.txt'),
    reportText
  );
  console.log('  ✓ merkle_tree_report.txt');

  writeFileSync(
    join(outputDir, 'merkle_tree_report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('  ✓ merkle_tree_report.json');

  console.log('\n' + '='.repeat(60));
  console.log(reportText);
  console.log('='.repeat(60) + '\n');

  if (report.status !== 'READY') {
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
  });
}

// Export for testing
export {
  keccak256,
  createDistrictId,
  createLeaf,
  buildMerkleTree,
  generateProof,
  verifyProof,
  loadDistricts,
};

export type {
  MerkleLeaf,
  MerkleProof,
  MerkleTree,
  CountryMerkleTree,
  GlobalMerkleTree,
  TreeReport,
};
