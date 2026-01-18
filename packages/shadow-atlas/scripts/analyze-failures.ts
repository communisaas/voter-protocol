#!/usr/bin/env npx tsx
/**
 * Failure Analysis Script
 * Identifies data quality issues in the registry
 */

import { KNOWN_PORTALS } from '../src/core/registry/known-portals.js';

const suspiciousPatterns = [
  { pattern: /pavement/i, label: 'pavement' },
  { pattern: /road/i, label: 'road' },
  { pattern: /street.*centerline/i, label: 'street-centerline' },
  { pattern: /utility/i, label: 'utility' },
  { pattern: /sewer/i, label: 'sewer' },
  { pattern: /water.*main/i, label: 'water-main' },
  { pattern: /zoning/i, label: 'zoning' },
  { pattern: /parcel/i, label: 'parcel' },
  { pattern: /tax/i, label: 'tax' },
  { pattern: /property/i, label: 'property' },
  { pattern: /flood/i, label: 'flood' },
  { pattern: /census/i, label: 'census' },
  { pattern: /tract/i, label: 'tract' },
  { pattern: /precinct/i, label: 'precinct' },
  { pattern: /police/i, label: 'police' },
  { pattern: /fire/i, label: 'fire' },
  { pattern: /school/i, label: 'school' },
  { pattern: /election/i, label: 'election' },
  { pattern: /voting/i, label: 'voting' },
];

const portals = Object.values(KNOWN_PORTALS);

interface Issue {
  fips: string;
  cityName: string;
  state: string;
  issue: string;
  url: string;
}

const suspicious: Issue[] = [];
const highFeatureCount: Issue[] = [];
const lowFeatureCount: Issue[] = [];

for (const p of portals) {
  const urlLower = p.downloadUrl.toLowerCase();

  // Check for suspicious service names
  for (const { pattern, label } of suspiciousPatterns) {
    if (pattern.test(urlLower)) {
      suspicious.push({
        fips: p.cityFips,
        cityName: p.cityName,
        state: p.state,
        issue: `URL contains "${label}"`,
        url: p.downloadUrl.slice(0, 80),
      });
      break;
    }
  }

  // High feature counts (most cities have 4-15 council districts)
  if (p.featureCount && p.featureCount > 25) {
    highFeatureCount.push({
      fips: p.cityFips,
      cityName: p.cityName,
      state: p.state,
      issue: `${p.featureCount} features (expected 4-15)`,
      url: p.downloadUrl.slice(0, 80),
    });
  }

  // Very low feature counts (likely wrong data)
  if (p.featureCount && p.featureCount < 3) {
    lowFeatureCount.push({
      fips: p.cityFips,
      cityName: p.cityName,
      state: p.state,
      issue: `Only ${p.featureCount} feature(s)`,
      url: p.downloadUrl.slice(0, 80),
    });
  }
}

console.log('=== REGISTRY DATA QUALITY ANALYSIS ===\n');
console.log(`Total entries: ${portals.length}`);

console.log('\n--- SUSPICIOUS URL PATTERNS ---');
console.log(`Found ${suspicious.length} entries with potentially wrong data layers:\n`);
for (const s of suspicious.slice(0, 15)) {
  console.log(`  ${s.cityName}, ${s.state} (${s.fips})`);
  console.log(`    Issue: ${s.issue}`);
  console.log(`    URL: ${s.url}...`);
}
if (suspicious.length > 15) console.log(`  ... and ${suspicious.length - 15} more`);

console.log('\n--- HIGH FEATURE COUNTS (>25) ---');
console.log(`Found ${highFeatureCount.length} entries:\n`);
for (const s of highFeatureCount.slice(0, 10)) {
  console.log(`  ${s.cityName}, ${s.state}: ${s.issue}`);
}

console.log('\n--- LOW FEATURE COUNTS (<3) ---');
console.log(`Found ${lowFeatureCount.length} entries:\n`);
for (const s of lowFeatureCount.slice(0, 10)) {
  console.log(`  ${s.cityName}, ${s.state}: ${s.issue}`);
}

// Summary
console.log('\n=== SUMMARY ===');
console.log(`Suspicious URLs: ${suspicious.length} (${((suspicious.length / portals.length) * 100).toFixed(1)}%)`);
console.log(`High feature count: ${highFeatureCount.length}`);
console.log(`Low feature count: ${lowFeatureCount.length}`);
console.log(`Estimated clean entries: ${portals.length - suspicious.length - highFeatureCount.length - lowFeatureCount.length}`);
