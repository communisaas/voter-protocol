#!/usr/bin/env tsx
/**
 * Verify Place GEOIDs Migration Status
 *
 * Quick verification script to confirm WS-A2 migration completed successfully
 */

import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FileCheck {
  path: string;
  exists: boolean;
  size?: number;
  required: boolean;
}

const files: FileCheck[] = [
  // Data files
  {
    path: '../src/data/canonical/place-geoids.json',
    exists: false,
    required: true,
  },
  // Loader files
  {
    path: '../src/data/loaders/place-geoids-loader.ts',
    exists: false,
    required: true,
  },
  // Test files
  {
    path: '../src/data/loaders/place-geoids-loader.test.ts',
    exists: false,
    required: true,
  },
  {
    path: '../src/data/loaders/place-geoids-loader-comparison.test.ts',
    exists: false,
    required: true,
  },
  // Original file (should still exist)
  {
    path: '../src/validators/place-geoids.ts',
    exists: false,
    required: true,
  },
  // Documentation
  {
    path: '../src/data/canonical/README.md',
    exists: false,
    required: true,
  },
  {
    path: '../docs/WS-A2-PLACE-GEOIDS-MIGRATION.md',
    exists: false,
    required: true,
  },
  {
    path: '../docs/WS-A2-SUMMARY.md',
    exists: false,
    required: true,
  },
];

console.log('🔍 Verifying WS-A2 Place GEOIDs Migration Status\n');

let allPassed = true;

files.forEach((file) => {
  const fullPath = join(__dirname, file.path);
  file.exists = existsSync(fullPath);

  if (file.exists) {
    const stats = statSync(fullPath);
    file.size = stats.size;
  }

  const status = file.exists ? '✅' : '❌';
  const sizeStr = file.size ? ` (${(file.size / 1024).toFixed(1)}KB)` : '';

  console.log(`${status} ${file.path}${sizeStr}`);

  if (file.required && !file.exists) {
    allPassed = false;
  }
});

console.log('\n📊 Summary:');
console.log(`   Files created: ${files.filter((f) => f.exists).length}/${files.length}`);
console.log(`   Required files: ${files.filter((f) => f.required && f.exists).length}/${files.filter((f) => f.required).length}`);

if (allPassed) {
  console.log('\n✅ Migration COMPLETE - All required files present');
  console.log('\n📋 Next steps:');
  console.log('   1. Run tests: npm test src/data/loaders/');
  console.log('   2. Migrate imports across codebase');
  console.log('   3. Delete src/validators/place-geoids.ts after migration');
} else {
  console.log('\n❌ Migration INCOMPLETE - Missing required files');
  process.exit(1);
}

// Quick data validation
console.log('\n🔬 Data Validation:');

try {
  const {
    NATIONAL_PLACE_TOTAL,
    EXPECTED_PLACE_BY_STATE,
    getPlaceGeoidsForState,
  } = await import('../src/data/loaders/place-geoids-loader.js');

  console.log(`   National total: ${NATIONAL_PLACE_TOTAL} places`);
  console.log(
    `   States covered: ${Object.keys(EXPECTED_PLACE_BY_STATE).length}`
  );

  const caPlaces = getPlaceGeoidsForState('06');
  console.log(`   California places: ${caPlaces.length}`);
  console.log(
    `   Los Angeles (0644000): ${caPlaces.includes('0644000') ? 'Found' : 'MISSING'}`
  );

  console.log('\n✅ Data validation passed');
} catch (error) {
  console.log('\n❌ Data validation failed:', error);
  process.exit(1);
}
