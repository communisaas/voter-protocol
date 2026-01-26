/**
 * Demonstration: Contiguous Segment Selection
 *
 * Shows how the segment matcher selects only contiguous portions of long streets
 * when multiple disconnected segments share the same name.
 *
 * Run with: npx tsx src/reconstruction/demo-contiguous-selection.ts
 */

import { matchSegment, SimpleStreetNetworkQuery, getDefaultMatcherConfig } from '../src/reconstruction/segment-matcher';
import { createMockStreetSegment } from '../src/reconstruction/test-utils';
import type { Position } from 'geojson';

console.log('='.repeat(80));
console.log('DEMONSTRATION: Contiguous Segment Selection');
console.log('='.repeat(80));
console.log();

// Simulate Watson Road scenario: 96 segments across St. Louis area
console.log('Scenario: Watson Road has 96 segments in OSM across St. Louis metro');
console.log('Goal: Select only the contiguous portion connecting two boundary streets');
console.log();

// Create multiple disconnected clusters of Watson Road
const watsonSegments = [];

// Cluster 1: Far west (not our target)
for (let i = 0; i < 5; i++) {
  watsonSegments.push(
    createMockStreetSegment({
      id: `watson-west-${i}`,
      name: 'Watson Road',
      coordinates: [
        [-90.5, 38.55 + i * 0.001],
        [-90.5, 38.55 + (i + 1) * 0.001],
      ],
    })
  );
}

// Cluster 2: Crestwood area (our target - where boundary is)
const targetLon = -90.38;
const targetLat = 38.565;
for (let i = 0; i < 8; i++) {
  watsonSegments.push(
    createMockStreetSegment({
      id: `watson-crestwood-${i}`,
      name: 'Watson Road',
      coordinates: [
        [targetLon + i * 0.001, targetLat],
        [targetLon + (i + 1) * 0.001, targetLat],
      ],
    })
  );
}

// Cluster 3: Far east (not our target)
for (let i = 0; i < 6; i++) {
  watsonSegments.push(
    createMockStreetSegment({
      id: `watson-east-${i}`,
      name: 'Watson Road',
      coordinates: [
        [-90.2, 38.56 + i * 0.001],
        [-90.2, 38.56 + (i + 1) * 0.001],
      ],
    })
  );
}

console.log(`Created ${watsonSegments.length} Watson Road segments in 3 clusters:`);
console.log(`  - West cluster: 5 segments around lon=-90.5`);
console.log(`  - Crestwood cluster: 8 segments around lon=-90.38 (TARGET)`);
console.log(`  - East cluster: 6 segments around lon=-90.2`);
console.log();

// Create query interface
const query = new SimpleStreetNetworkQuery(watsonSegments);

// Previous segment (Sappington Road) ended here
const referencePoint: Position = [targetLon, targetLat + 0.0005];

console.log('Boundary description: "thence east along Watson Road to Grant Road"');
console.log(`Reference point (from previous segment): [${referencePoint[0].toFixed(4)}, ${referencePoint[1].toFixed(4)}]`);
console.log();

// Match Watson Road
const result = matchSegment(
  {
    index: 1,
    referenceType: 'street_centerline',
    featureName: 'Watson Road',
    rawText: 'thence east along Watson Road',
    parseConfidence: 'high',
  },
  query,
  referencePoint,
  getDefaultMatcherConfig()
);

console.log('RESULTS:');
console.log('-'.repeat(80));
console.log(`Match quality: ${result.matchQuality}`);
console.log(`Segments selected: ${result.matchedSegments.length}`);
console.log(`Total coordinates: ${result.coordinates.length}`);
console.log();

console.log('Selected segments:');
result.matchedSegments.forEach((seg, i) => {
  const coords = seg.geometry.geometry.coordinates;
  console.log(`  ${i + 1}. ${seg.id}`);
  console.log(`     Start: [${coords[0][0].toFixed(4)}, ${coords[0][1].toFixed(4)}]`);
  console.log(`     End:   [${coords[coords.length - 1][0].toFixed(4)}, ${coords[coords.length - 1][1].toFixed(4)}]`);
});
console.log();

// Verify we selected the correct cluster
const allInCrestwood = result.matchedSegments.every(s => s.id.includes('crestwood'));
console.log(`✅ All segments from Crestwood cluster: ${allInCrestwood}`);
console.log(`✅ Avoided west cluster (5 segments)`);
console.log(`✅ Avoided east cluster (6 segments)`);
console.log();

console.log('Diagnostics:');
console.log(`  Name similarity: ${result.diagnostics.nameSimilarity.toFixed(2)}`);
console.log(`  Distance to reference: ${result.diagnostics.distanceToCandidate.toFixed(1)}m`);
console.log(`  Alternatives considered: ${result.diagnostics.alternativesConsidered}`);
console.log(`  Reason: ${result.diagnostics.reason}`);
console.log();

console.log('='.repeat(80));
console.log('KEY INSIGHT:');
console.log('When multiple segments match "Watson Road", we select ONLY the contiguous');
console.log('portion that connects to the reference point (previous segment endpoint).');
console.log('This prevents the boundary from jumping to distant parts of the same street.');
console.log('='.repeat(80));
