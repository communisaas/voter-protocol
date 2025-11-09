#!/usr/bin/env tsx

/**
 * Cicero API Coverage Update Script
 *
 * Queries Cicero's FREE coverage endpoint to determine which cities have
 * city council district data available. This allows us to "fence in" addresses
 * that can use Cicero ($0.03/lookup) vs fallback to Census API (FREE).
 *
 * Usage:
 *   npx tsx scripts/update-cicero-coverage.ts
 *   npx tsx scripts/update-cicero-coverage.ts --dry-run
 *
 * Cost: $0 (coverage endpoint is FREE, 0 credits)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CICERO_API_BASE = 'https://app.cicerodata.com/v3.1';
const COVERAGE_ENDPOINT = `${CICERO_API_BASE}/coverage`;

interface CiceroChamber {
  id: string;
  name: string;
  type: string; // 'LOCAL_COUNCIL', 'UPPER', 'LOWER', etc.
}

interface CiceroLocality {
  id: string;
  name: string;
  state: string;
  chambers: CiceroChamber[];
}

interface CiceroState {
  id: string;
  name: string;
  code: string;
  localities: CiceroLocality[];
  chambers: CiceroChamber[];
}

interface CiceroCountry {
  id: string;
  name: string;
  code: string;
  states: CiceroState[];
  chambers: CiceroChamber[];
}

interface CiceroCoverageResponse {
  countries: CiceroCountry[];
}

interface CityCoverageMap {
  [cityState: string]: {
    city: string;
    state: string;
    hasLocalCouncil: boolean;
    chambers: string[];
  };
}

async function fetchCiceroCoverage(apiKey?: string): Promise<CiceroCoverageResponse> {
  const url = apiKey
    ? `${COVERAGE_ENDPOINT}?key=${apiKey}`
    : COVERAGE_ENDPOINT;

  console.log(`📡 Fetching Cicero coverage from: ${COVERAGE_ENDPOINT}`);
  console.log(`   Cost: $0 (FREE endpoint, 0 credits)\n`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

function extractCityCoverage(coverage: CiceroCoverageResponse): CityCoverageMap {
  const cityMap: CityCoverageMap = {};

  // Focus on United States
  const usa = coverage.countries.find(c => c.code === 'US');
  if (!usa) {
    throw new Error('United States not found in coverage data');
  }

  console.log(`🇺🇸 United States Coverage:`);
  console.log(`   States with data: ${usa.states.length}\n`);

  // Iterate through states
  for (const state of usa.states) {
    console.log(`📍 ${state.name} (${state.code}):`);

    if (!state.localities || state.localities.length === 0) {
      console.log(`   No localities with local council data\n`);
      continue;
    }

    console.log(`   Localities: ${state.localities.length}`);

    // Iterate through localities (cities/counties)
    for (const locality of state.localities) {
      const key = `${locality.name}, ${state.code}`;

      const chambers = locality.chambers.map(c => c.type);
      const hasLocalCouncil = chambers.includes('LOCAL_COUNCIL');

      cityMap[key] = {
        city: locality.name,
        state: state.code,
        hasLocalCouncil,
        chambers
      };

      if (hasLocalCouncil) {
        console.log(`   ✅ ${locality.name} - LOCAL_COUNCIL`);
      }
    }

    console.log('');
  }

  return cityMap;
}

function generateCoverageReport(cityMap: CityCoverageMap): string {
  const cities = Object.values(cityMap);
  const withCouncil = cities.filter(c => c.hasLocalCouncil);

  const report = `# Cicero API Coverage Report

**Last Updated:** ${new Date().toISOString().split('T')[0]}
**Total Cities:** ${cities.length}
**With City Council Data:** ${withCouncil.length}
**Coverage:** ${Math.round(withCouncil.length / cities.length * 100)}%

## Cities with Local Council Coverage

| City | State | Chambers |
|------|-------|----------|
${withCouncil.map(c =>
  `| ${c.city} | ${c.state} | ${c.chambers.join(', ')} |`
).join('\n')}

## Usage

This coverage map allows us to "fence in" addresses that can use Cicero's city council
district lookups ($0.03/address) vs fallback to Census API (FREE congressional/state legislature).

\`\`\`typescript
import coverage from './cicero-coverage.json';

function canUseCiceroForCityCouncil(city: string, state: string): boolean {
  const key = \`\${city}, \${state}\`;
  return coverage[key]?.hasLocalCouncil || false;
}

// Example
if (canUseCiceroForCityCouncil('Orlando', 'FL')) {
  // Offer user city council verification ($0.03)
  console.log('City council verification available');
} else {
  // Use FREE Census API for congressional district
  console.log('Using congressional district (FREE)');
}
\`\`\`

## Data Source

- **Endpoint:** \`GET https://app.cicerodata.com/v3.1/coverage\`
- **Cost:** $0 (FREE, 0 credits)
- **Update Frequency:** Monthly (automated via GitHub Actions)

## Next Steps

1. Check if we already have FREE GIS data for this city:
   - \`/packages/crypto/data/city-council-districts/{city}.geojson\`
2. If YES: Use FREE GIS + Geocodio geocoding ($0.0005)
3. If NO: Offer Cicero lookup ($0.03) with user consent
4. If user declines: Fallback to Census API (FREE congressional/state)

**Generated:** ${new Date().toISOString()}
`;

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const apiKey = process.env.CICERO_API_KEY;

  console.log('🏛️  Cicero API Coverage Update\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be written\n');
  }

  if (!apiKey) {
    console.log('⚠️  CICERO_API_KEY not set - using unauthenticated endpoint');
    console.log('   (This may have rate limits, but coverage endpoint is FREE)\n');
  }

  try {
    // Fetch coverage data (FREE)
    const coverage = await fetchCiceroCoverage(apiKey);

    // Extract city-level coverage map
    const cityMap = extractCityCoverage(coverage);

    // Summary
    const totalCities = Object.keys(cityMap).length;
    const withCouncil = Object.values(cityMap).filter(c => c.hasLocalCouncil).length;

    console.log('='.repeat(80));
    console.log('📊 COVERAGE SUMMARY\n');
    console.log(`Total Cities: ${totalCities}`);
    console.log(`With City Council Data: ${withCouncil}`);
    console.log(`Coverage: ${Math.round(withCouncil / totalCities * 100)}%`);
    console.log('='.repeat(80) + '\n');

    if (dryRun) {
      console.log('🔍 DRY RUN - Would save to:');
      console.log(`   ${path.join(__dirname, '../packages/crypto/data/cicero-coverage.json')}`);
      console.log(`   ${path.join(__dirname, '../packages/crypto/data/CICERO-COVERAGE-REPORT.md')}`);
      return;
    }

    // Save coverage map (JSON)
    const jsonPath = path.join(__dirname, '../packages/crypto/data/cicero-coverage.json');
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(cityMap, null, 2),
      'utf-8'
    );
    console.log(`✅ Saved: ${jsonPath}`);

    // Save coverage report (Markdown)
    const reportPath = path.join(__dirname, '../packages/crypto/data/CICERO-COVERAGE-REPORT.md');
    const report = generateCoverageReport(cityMap);
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`✅ Saved: ${reportPath}`);

    // Check for changes (git diff)
    const { execSync } = await import('child_process');
    try {
      const diff = execSync('git diff --stat packages/crypto/data/cicero-coverage.json', {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf-8'
      });

      if (diff.trim()) {
        console.log('\n⚠️  Coverage data changed:');
        console.log(diff);
        console.log('Run `git diff packages/crypto/data/cicero-coverage.json` to review changes.');
      } else {
        console.log('\n✅ No changes from previous coverage data');
      }
    } catch {
      // Ignore git errors (file may not be tracked yet)
    }

  } catch (error) {
    console.error('\n❌ Error fetching coverage:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { fetchCiceroCoverage, extractCityCoverage };
