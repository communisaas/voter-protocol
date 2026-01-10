#!/usr/bin/env npx tsx
/**
 * Finalize council district resolution by merging recoverable layers
 * and calculating final coverage statistics
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ResolvedLayer {
  url: string;
  name: string;
  resolution: {
    fips: string;
    name: string;
    state: string;
    method: string;
    confidence: number;
  };
}

interface RecoverableLayer {
  url: string;
  name: string;
  features: number;
  confidence: number;
  warnings: string[];
  suggestedFips: string;
  suggestedName: string;
  suggestedState: string;
  recoveryMethod: string;
}

async function main(): Promise<void> {
  // Load existing attributed data
  const attributedPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');
  const attributedData = JSON.parse(fs.readFileSync(attributedPath, 'utf-8'));
  const existingResolved: ResolvedLayer[] = attributedData.resolved;

  // Load categorization results
  const categorizationPath = path.join(__dirname, '../agents/data/unresolved-categorization.json');
  const categorizationData = JSON.parse(fs.readFileSync(categorizationPath, 'utf-8'));
  const recoverable: RecoverableLayer[] = categorizationData.recoverable;
  const international = categorizationData.international;

  console.log('='.repeat(80));
  console.log('FINALIZING COUNCIL DISTRICT RESOLUTION');
  console.log('='.repeat(80));

  console.log(`\nExisting resolved: ${existingResolved.length}`);
  console.log(`Recoverable layers: ${recoverable.length}`);
  console.log(`International (rejected): ${international.length}`);

  // Convert recoverable to resolved format
  const newlyResolved: ResolvedLayer[] = recoverable.map((layer) => ({
    url: layer.url,
    name: layer.name,
    resolution: {
      fips: layer.suggestedFips,
      name: layer.suggestedName,
      state: layer.suggestedState,
      method: 'PATTERN_MATCH',
      confidence: 75,
    },
  }));

  // Merge resolved layers
  const allResolved = [...existingResolved, ...newlyResolved];

  // Calculate statistics
  const byState: Record<string, number> = {};
  const byCity: Record<string, { fips: string; count: number }> = {};
  const byMethod: Record<string, number> = {};

  for (const layer of allResolved) {
    const state = layer.resolution.state;
    const cityKey = `${layer.resolution.name}, ${state}`;

    byState[state] = (byState[state] || 0) + 1;
    if (!byCity[cityKey]) {
      byCity[cityKey] = { fips: layer.resolution.fips, count: 0 };
    }
    byCity[cityKey].count++;
    byMethod[layer.resolution.method] = (byMethod[layer.resolution.method] || 0) + 1;
  }

  // Print statistics
  console.log('\n' + '-'.repeat(60));
  console.log('RESOLUTION BY METHOD:');
  console.log('-'.repeat(60));
  for (const [method, count] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${method.padEnd(25)} ${count}`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('TOP STATES BY LAYER COUNT:');
  console.log('-'.repeat(60));
  for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${state.padEnd(10)} ${count}`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('TOP CITIES BY LAYER COUNT:');
  console.log('-'.repeat(60));
  for (const [city, data] of Object.entries(byCity).sort((a, b) => b[1].count - a[1].count).slice(0, 20)) {
    console.log(`  ${city.padEnd(35)} ${data.count} (FIPS: ${data.fips})`);
  }

  // Calculate unique cities
  const uniqueCities = Object.keys(byCity).length;
  const uniqueStates = Object.keys(byState).length;

  console.log('\n' + '='.repeat(80));
  console.log('FINAL COVERAGE SUMMARY');
  console.log('='.repeat(80));
  console.log(`
  LAYER COUNTS:
  - Originally resolved:       ${existingResolved.length}
  - Newly recovered:           ${newlyResolved.length}
  - Total resolved:            ${allResolved.length}
  - International (rejected):  ${international.length}
  - Remaining unresolved:      ${attributedData.unresolved.length - recoverable.length - international.length}

  UNIQUE JURISDICTIONS:
  - Unique cities/counties:    ${uniqueCities}
  - Unique states:             ${uniqueStates}

  RESOLUTION QUALITY:
  - EXTENT_GEOCODE (85%):      ${byMethod['EXTENT_GEOCODE'] || 0}
  - NAME_PARSE (75%):          ${byMethod['NAME_PARSE'] || 0}
  - PATTERN_MATCH (75%):       ${byMethod['PATTERN_MATCH'] || 0}
  - WKID_STATE (40%):          ${byMethod['WKID_STATE'] || 0}
  `);

  // Write final results
  const finalOutputPath = path.join(__dirname, '../agents/data/final-council-districts.json');
  fs.writeFileSync(finalOutputPath, JSON.stringify({
    metadata: {
      generatedAt: new Date().toISOString(),
      totalLayers: allResolved.length,
      uniqueCities: uniqueCities,
      uniqueStates: uniqueStates,
      originalResolved: existingResolved.length,
      newlyRecovered: newlyResolved.length,
      internationalRejected: international.length,
    },
    byMethod,
    byState,
    topCities: Object.entries(byCity)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([city, data]) => ({ city, fips: data.fips, count: data.count })),
    layers: allResolved,
  }, null, 2));

  console.log(`Final results written to: ${finalOutputPath}`);
}

main().catch(console.error);
