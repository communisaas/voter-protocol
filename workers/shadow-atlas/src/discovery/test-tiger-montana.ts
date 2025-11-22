/**
 * Test TIGER/Line Implementation - Montana House District
 *
 * Tests the complete TIGER/Line workflow:
 * 1. Download Montana House shapefile from Census
 * 2. Parse shapefile to GeoJSON
 * 3. Perform point-in-polygon lookup for Helena coordinates
 * 4. Verify result contains FIPS code and district info
 *
 * Test coordinates: Helena, MT (46.8797, -110.3626)
 * Expected: Should find a Montana State House District
 */

import { discoverBoundary } from './orchestrator';
import { createTIGERSource, boundaryTypeToTIGERDataset } from './sources/tiger-line';
import type { BoundaryDataSource, BoundaryRequest, SourceResult } from './sources/types';

// Stub Hub API source that always returns null (disabled for TIGER test)
class StubHubAPISource implements BoundaryDataSource {
  readonly name = 'Hub API (disabled)';
  async fetch(request: BoundaryRequest): Promise<SourceResult | null> {
    return null;
  }
}

async function testMontanaHouse() {
  console.log('='.repeat(80));
  console.log('Testing TIGER/Line Implementation - Montana House District');
  console.log('='.repeat(80));
  console.log();

  // Test data: Helena, Montana (state capital)
  const testRequest = {
    location: {
      lat: 46.8797,
      lng: -110.3626,
      state: 'MT'
    },
    boundaryType: 'STATE_HOUSE' as const
  };

  console.log('Test Input:');
  console.log(`  Location: Helena, MT (${testRequest.location.lat}, ${testRequest.location.lng})`);
  console.log(`  Boundary Type: ${testRequest.boundaryType}`);
  console.log();

  try {
    console.log('Starting boundary discovery...');
    console.log();

    const result = await discoverBoundary(testRequest, {
      sourceFactories: {
        hubAPI: () => new StubHubAPISource(),
        tiger: (boundaryType) => {
          return () => {
            const dataset = boundaryTypeToTIGERDataset(boundaryType);
            return createTIGERSource(dataset);
          };
        },
        statePortal: () => undefined
      },
      qualityThreshold: 60,
      logRouting: true
    });

    console.log();
    console.log('='.repeat(80));
    console.log('RESULT');
    console.log('='.repeat(80));

    if (result.success && result.data) {
      console.log('✅ SUCCESS!');
      console.log();
      console.log(`Source: ${result.source}`);
      console.log(`Score: ${result.score}`);
      console.log(`Classification: ${result.classification.type}`);
      console.log();
      console.log('Metadata:');
      console.log(`  Publisher: ${result.metadata?.publisher}`);
      console.log(`  FIPS Code: ${result.metadata?.fipsCode}`);
      console.log(`  Published: ${result.metadata?.publishedDate?.toISOString()}`);
      console.log(`  Notes: ${result.metadata?.notes}`);
      console.log();
      console.log('GeoJSON Properties:');
      console.log(JSON.stringify(result.data.properties, null, 2));
      console.log();
      console.log(`Geometry Type: ${result.data.geometry?.type}`);
      console.log(`Coordinates: ${result.data.geometry ? '✅ Present' : '❌ Missing'}`);
    } else {
      console.log('❌ FAILED!');
      console.log();
      console.log(`Error: ${result.error}`);
    }

    console.log();
    console.log('='.repeat(80));

  } catch (error) {
    console.error();
    console.error('❌ FATAL ERROR:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testMontanaHouse()
  .then(() => {
    console.log();
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error();
    console.error('Test failed with error:');
    console.error(error);
    process.exit(1);
  });
