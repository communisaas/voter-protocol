/**
 * Shadow Atlas Serving Layer - Example Usage
 *
 * Demonstrates complete workflow:
 * 1. Initialize services
 * 2. Start HTTP API
 * 3. Perform lookups
 * 4. Monitor health
 * 5. Sync updates
 */

import { DistrictLookupService } from './district-service';
import { ProofService } from './proof-generator';
import { SyncService } from './sync-service';
import { ShadowAtlasAPI } from './api';
import type { DistrictBoundary } from './types';

/**
 * Example 1: Basic lookup service
 */
async function exampleLookupService() {
  console.log('\n=== Example 1: Basic Lookup Service ===\n');

  // Initialize lookup service
  const lookupService = new DistrictLookupService('/data/shadow-atlas-v1.db', 10000, 3600);

  // Perform lookup
  const result = lookupService.lookup(21.3099, -157.8581);

  if (result.district) {
    console.log('District found:', result.district.name);
    console.log('Latency:', result.latencyMs.toFixed(2), 'ms');
    console.log('Cache hit:', result.cacheHit);
  } else {
    console.log('No district found at coordinates');
  }

  // Get metrics
  const metrics = lookupService.getMetrics();
  console.log('\nMetrics:');
  console.log('  Total queries:', metrics.totalQueries);
  console.log('  Cache hit rate:', (metrics.cacheHitRate * 100).toFixed(1), '%');
  console.log('  Latency p50:', metrics.latencyP50.toFixed(2), 'ms');
  console.log('  Latency p95:', metrics.latencyP95.toFixed(2), 'ms');
  console.log('  Latency p99:', metrics.latencyP99.toFixed(2), 'ms');

  lookupService.close();
}

/**
 * Example 2: Proof generation and verification
 */
async function exampleProofService() {
  console.log('\n=== Example 2: Proof Generation ===\n');

  // Mock districts and addresses (in production, load from database)
  const mockDistricts: DistrictBoundary[] = [
    {
      id: 'usa-hi-honolulu-district-1',
      name: 'Honolulu City Council District 1',
      jurisdiction: 'USA/Hawaii/Honolulu',
      districtType: 'council',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-157.9, 21.3], [-157.8, 21.3], [-157.8, 21.4], [-157.9, 21.4], [-157.9, 21.3]]],
      },
      provenance: {
        source: 'https://geodata.hawaii.gov/...',
        authority: 'state-gis',
        timestamp: Date.now(),
        method: 'ArcGIS REST API',
        responseHash: 'sha256:abc123...',
      },
    },
  ];

  const mockAddresses = mockDistricts.map((d) => d.id);

  // Initialize proof service
  const proofService = new ProofService(mockDistricts, mockAddresses);

  // Generate proof
  const districtId = 'usa-hi-honolulu-district-1';
  const proof = proofService.generateProof(districtId);

  console.log('Generated Merkle proof for:', districtId);
  console.log('  Root:', '0x' + proof.root.toString(16));
  console.log('  Leaf:', '0x' + proof.leaf.toString(16));
  console.log('  Siblings:', proof.siblings.length);
  console.log('  Path indices:', proof.pathIndices);

  // Verify proof
  const isValid = proofService.verifyProof(proof);
  console.log('\nProof valid:', isValid ? '✅' : '❌');
}

/**
 * Example 3: IPFS sync service
 */
async function exampleSyncService() {
  console.log('\n=== Example 3: IPFS Sync Service ===\n');

  const syncService = new SyncService('https://ipfs.io', '/snapshots', 3600);

  // Set initial CID
  syncService.setCurrentCID('QmXyz789initial');

  // Check for updates
  console.log('Checking for updates...');
  const hasUpdates = await syncService.checkForUpdates();

  if (hasUpdates) {
    console.log('✅ New snapshot downloaded and validated');
  } else {
    console.log('✅ Already on latest snapshot');
  }

  // Get latest snapshot metadata
  const snapshot = await syncService.getLatestSnapshot();
  if (snapshot) {
    console.log('\nCurrent snapshot:');
    console.log('  CID:', snapshot.cid);
    console.log('  Merkle root:', '0x' + snapshot.merkleRoot.toString(16));
    console.log('  District count:', snapshot.districtCount);
    console.log('  Version:', snapshot.version);
  }

  // List all snapshots
  const snapshots = await syncService.listSnapshots();
  console.log('\nAvailable snapshots:', snapshots.length);
  snapshots.slice(0, 3).forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.cid} (${s.districtCount} districts)`);
  });

  syncService.stop();
}

/**
 * Example 4: Complete API server
 */
async function exampleAPIServer() {
  console.log('\n=== Example 4: HTTP API Server ===\n');

  // Initialize services
  const lookupService = new DistrictLookupService('/data/shadow-atlas-v1.db');

  const mockDistricts: DistrictBoundary[] = [];
  const mockAddresses: string[] = [];
  const proofService = new ProofService(mockDistricts, mockAddresses);

  const syncService = new SyncService('https://ipfs.io', '/snapshots');

  // Create API server
  const api = new ShadowAtlasAPI(
    lookupService,
    proofService,
    syncService,
    3000, // port
    '0.0.0.0', // host
    ['*'], // CORS origins
    60 // rate limit per minute
  );

  // Start server
  console.log('Starting Shadow Atlas API server...\n');
  api.start();

  // Server runs until stopped
  // In production, handle SIGTERM/SIGINT for graceful shutdown
  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    api.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    api.stop();
    process.exit(0);
  });
}

/**
 * Example 5: Load testing simulation
 */
async function exampleLoadTesting() {
  console.log('\n=== Example 5: Load Testing Simulation ===\n');

  const lookupService = new DistrictLookupService('/data/shadow-atlas-v1.db');

  // Generate random coordinates within US bounds
  const randomCoordinates = (): [number, number] => {
    const lat = 25 + Math.random() * 25; // 25°N to 50°N
    const lon = -125 + Math.random() * 50; // -125°W to -75°W
    return [lat, lon];
  };

  // Perform 1000 queries
  const queryCount = 1000;
  const startTime = performance.now();

  for (let i = 0; i < queryCount; i++) {
    const [lat, lon] = randomCoordinates();
    lookupService.lookup(lat, lon);
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;

  // Get metrics
  const metrics = lookupService.getMetrics();

  console.log('Load test results:');
  console.log('  Total queries:', queryCount);
  console.log('  Total time:', totalTime.toFixed(2), 'ms');
  console.log('  Average throughput:', (queryCount / (totalTime / 1000)).toFixed(2), 'queries/sec');
  console.log('  Cache hit rate:', (metrics.cacheHitRate * 100).toFixed(1), '%');
  console.log('  Latency p50:', metrics.latencyP50.toFixed(2), 'ms');
  console.log('  Latency p95:', metrics.latencyP95.toFixed(2), 'ms');
  console.log('  Latency p99:', metrics.latencyP99.toFixed(2), 'ms');

  // Check if meets performance targets
  const meetsTargets =
    metrics.latencyP50 < 20 &&
    metrics.latencyP95 < 50 &&
    metrics.latencyP99 < 100 &&
    metrics.cacheHitRate > 0.8;

  console.log('\nPerformance targets:', meetsTargets ? '✅ MET' : '❌ NOT MET');

  lookupService.close();
}

/**
 * Example 6: Client-side verification
 */
function exampleClientVerification() {
  console.log('\n=== Example 6: Client-Side Verification ===\n');

  // Simulate client receiving proof from server
  const mockProof = {
    root: BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
    leaf: BigInt('0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'),
    siblings: [
      BigInt('0x1111111111111111111111111111111111111111111111111111111111111111'),
      BigInt('0x2222222222222222222222222222222222222222222222222222222222222222'),
    ],
    pathIndices: [0, 1],
  };

  // Client verification function (runs in browser)
  function verifyMerkleProof(proof: typeof mockProof, expectedRoot: bigint): boolean {
    let hash = proof.leaf;

    for (let i = 0; i < proof.siblings.length; i++) {
      const sibling = proof.siblings[i];
      const isLeftChild = proof.pathIndices[i] === 0;

      // In production: Use WASM Poseidon hash
      // hash = poseidonHash(isLeftChild ? hash : sibling, isLeftChild ? sibling : hash);

      // For demo: XOR (REPLACE with Poseidon)
      hash = isLeftChild ? hash ^ sibling : sibling ^ hash;
    }

    return hash === expectedRoot;
  }

  // Verify proof
  const isValid = verifyMerkleProof(mockProof, mockProof.root);
  console.log('Client verification:', isValid ? '✅ VALID' : '❌ INVALID');
  console.log('\nClient workflow:');
  console.log('  1. ✅ Received district + proof from server');
  console.log('  2. ✅ Verified Merkle proof cryptographically');
  console.log('  3. 🔄 Generate ZK proof in browser (8-15s)');
  console.log('  4. 🔄 Submit ZK proof on-chain (Scroll L2)');
}

/**
 * Run all examples
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Shadow Atlas Serving Layer - Examples');
  console.log('='.repeat(60));

  try {
    // Run examples sequentially
    await exampleLookupService();
    await exampleProofService();
    await exampleSyncService();
    await exampleLoadTesting();
    exampleClientVerification();

    // Uncomment to run API server
    // await exampleAPIServer();
  } catch (error) {
    console.error('\n❌ Example failed:', error);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ All examples completed successfully');
  console.log('='.repeat(60));
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export {
  exampleLookupService,
  exampleProofService,
  exampleSyncService,
  exampleAPIServer,
  exampleLoadTesting,
  exampleClientVerification,
};
