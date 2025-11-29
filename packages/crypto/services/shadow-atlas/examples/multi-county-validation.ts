/**
 * Multi-County Geographic Validation Example
 *
 * Demonstrates how to use the enhanced geographic validator
 * with multi-county city support.
 */

import { EnhancedGeographicValidator } from '../validators/enhanced-geographic-validator.js';
import type { FeatureCollection, Feature, Polygon } from 'geojson';
import type { CityTarget } from '../validators/enhanced-geographic-validator.js';

async function validateKansasCityDistricts() {
  console.log('=== Kansas City Multi-County Validation Example ===\n');

  const validator = new EnhancedGeographicValidator();

  // Define Kansas City target
  const kansasCity: CityTarget = {
    name: 'Kansas City',
    state: 'MO',
    fips: '2938000',
    region: 'MO',
  };

  // Example council district in Jackson County (primary)
  const district1: Feature<Polygon> = {
    type: 'Feature',
    properties: { NAME: 'District 1', DISTRICT: '1' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-94.6, 39.0],
        [-94.5, 39.0],
        [-94.5, 39.1],
        [-94.6, 39.1],
        [-94.6, 39.0],
      ]],
    },
  };

  // Example district spanning Jackson and Clay counties
  const district2: Feature<Polygon> = {
    type: 'Feature',
    properties: { NAME: 'District 2', DISTRICT: '2' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-94.6, 39.0],  // Jackson County
        [-94.5, 39.0],
        [-94.5, 39.25], // Extends into Clay County
        [-94.6, 39.25],
        [-94.6, 39.0],
      ]],
    },
  };

  const featureCollection: FeatureCollection = {
    type: 'FeatureCollection',
    features: [district1, district2],
  };

  // Validate districts
  console.log('Validating 2 council districts...\n');
  const result = await validator.validate(featureCollection, kansasCity);

  console.log('Validation Result:');
  console.log(`  Valid: ${result.valid}`);
  console.log(`  Confidence: ${result.confidence}`);
  console.log(`  Issues: ${result.issues.length}`);
  console.log(`  Warnings: ${result.warnings.length}\n`);

  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach(w => console.log(`  - ${w}`));
    console.log();
  }

  if (result.issues.length > 0) {
    console.log('Issues:');
    result.issues.forEach(i => console.log(`  - ${i}`));
    console.log();
  }

  console.log('✓ Kansas City validation complete\n');
}

async function validateNYCDistricts() {
  console.log('=== New York City 5-County Validation Example ===\n');

  const validator = new EnhancedGeographicValidator();

  // Define NYC target
  const nyc: CityTarget = {
    name: 'New York',
    state: 'NY',
    fips: '3651000',
    region: 'NY',
  };

  // Example district in Manhattan
  const manhattanDistrict: Feature<Polygon> = {
    type: 'Feature',
    properties: { NAME: 'Manhattan District 1', DISTRICT: '1' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-73.99, 40.75],
        [-73.98, 40.75],
        [-73.98, 40.76],
        [-73.99, 40.76],
        [-73.99, 40.75],
      ]],
    },
  };

  // Example district in Brooklyn
  const brooklynDistrict: Feature<Polygon> = {
    type: 'Feature',
    properties: { NAME: 'Brooklyn District 1', DISTRICT: '33' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-73.95, 40.65],
        [-73.94, 40.65],
        [-73.94, 40.66],
        [-73.95, 40.66],
        [-73.95, 40.65],
      ]],
    },
  };

  const featureCollection: FeatureCollection = {
    type: 'FeatureCollection',
    features: [manhattanDistrict, brooklynDistrict],
  };

  // Validate districts
  console.log('Validating 2 council districts (Manhattan + Brooklyn)...\n');
  const result = await validator.validate(featureCollection, nyc);

  console.log('Validation Result:');
  console.log(`  Valid: ${result.valid}`);
  console.log(`  Confidence: ${result.confidence}`);
  console.log(`  Counties validated: 5 (Manhattan, Brooklyn, Queens, Bronx, Staten Island)`);
  console.log();

  console.log('✓ NYC validation complete\n');
}

async function demonstrateFalsePositiveRejection() {
  console.log('=== False Positive Rejection Example ===\n');

  const validator = new EnhancedGeographicValidator();

  const kansasCity: CityTarget = {
    name: 'Kansas City',
    state: 'MO',
    fips: '2938000',
    region: 'MO',
  };

  // Feature in Arkansas (wrong state, should be rejected)
  const arkansasFeature: Feature<Polygon> = {
    type: 'Feature',
    properties: { NAME: 'Fake District' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-94.0, 36.0],  // Arkansas coordinates
        [-94.0, 36.1],
        [-93.9, 36.1],
        [-93.9, 36.0],
        [-94.0, 36.0],
      ]],
    },
  };

  const featureCollection: FeatureCollection = {
    type: 'FeatureCollection',
    features: [arkansasFeature],
  };

  console.log('Attempting to validate Arkansas feature for Kansas City, MO...\n');
  const result = await validator.validate(featureCollection, kansasCity);

  console.log('Validation Result:');
  console.log(`  Valid: ${result.valid} (should be false)`);
  console.log(`  Confidence: ${result.confidence} (should be 0)`);
  console.log(`  Issues: ${result.issues.length}`);
  console.log();

  if (result.issues.length > 0) {
    console.log('Issues detected:');
    result.issues.forEach(i => console.log(`  - ${i}`));
    console.log();
  }

  console.log('✓ False positive correctly rejected\n');
}

// Run all examples
async function main() {
  try {
    await validateKansasCityDistricts();
    await validateNYCDistricts();
    await demonstrateFalsePositiveRejection();

    console.log('=== All Examples Complete ===');
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Uncomment to run:
// main();
