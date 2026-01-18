#!/usr/bin/env npx tsx
/**
 * Add Missing Top 50 Cities to Registry
 *
 * Extracts best discovery URLs for missing cities and generates
 * registry entries for manual review.
 *
 * Run: npx tsx scripts/add-missing-cities.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Missing cities from top 50
const MISSING_CITIES = [
  { fips: '1235000', name: 'Jacksonville', state: 'FL', rank: 12, councilSize: 19 },
  { fips: '3240000', name: 'Las Vegas', state: 'NV', rank: 27, councilSize: 6 },
  { fips: '4748000', name: 'Memphis', state: 'TN', rank: 28, councilSize: 13 },
  { fips: '5553000', name: 'Milwaukee', state: 'WI', rank: 31, councilSize: 15 },
  { fips: '3502000', name: 'Albuquerque', state: 'NM', rank: 32, councilSize: 9 },
  { fips: '0477000', name: 'Tucson', state: 'AZ', rank: 33, councilSize: 6 },
  { fips: '0627000', name: 'Fresno', state: 'CA', rank: 34, councilSize: 7 },
  { fips: '0664000', name: 'Sacramento', state: 'CA', rank: 35, councilSize: 8 },
  { fips: '0446000', name: 'Mesa', state: 'AZ', rank: 36, councilSize: 6 },
  { fips: '1304000', name: 'Atlanta', state: 'GA', rank: 37, councilSize: 12 },
  { fips: '3755000', name: 'Raleigh', state: 'NC', rank: 41, councilSize: 8 },
  { fips: '1245000', name: 'Miami', state: 'FL', rank: 42, councilSize: 5 },
  { fips: '0643000', name: 'Long Beach', state: 'CA', rank: 43, councilSize: 9 },
  { fips: '5182000', name: 'Virginia Beach', state: 'VA', rank: 44, councilSize: 10 },
  { fips: '4075000', name: 'Tulsa', state: 'OK', rank: 47, councilSize: 9 },
  { fips: '1271000', name: 'Tampa', state: 'FL', rank: 48, councilSize: 7 },
  { fips: '2079000', name: 'Wichita', state: 'KS', rank: 50, councilSize: 6 },
];

interface AttributedLayer {
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

interface AttributedData {
  resolved: AttributedLayer[];
}

// Council district name patterns
const COUNCIL_PATTERNS = [
  /council[_\s]*district/i,
  /city[_\s]*council/i,
  /ward/i,
  /aldermanic/i,
];

function scoreLayerName(name: string): number {
  let score = 0;
  for (const pattern of COUNCIL_PATTERNS) {
    if (pattern.test(name)) score += 30;
  }
  if (/council[_\s]*districts?$/i.test(name)) score += 20;
  return Math.min(score, 100);
}

async function main(): Promise<void> {
  const dataPath = join(process.cwd(), 'src/agents/data/attributed-council-districts.json');
  const data: AttributedData = JSON.parse(readFileSync(dataPath, 'utf-8'));

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              REGISTRY ENTRIES FOR MISSING CITIES');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const newEntries: string[] = [];

  for (const city of MISSING_CITIES) {
    // Find all layers attributed to this city
    const cityLayers = data.resolved.filter((l) => {
      const nameMatch = l.resolution.name.toLowerCase() === city.name.toLowerCase();
      const stateMatch = l.resolution.state === city.state;
      return nameMatch && stateMatch;
    });

    if (cityLayers.length === 0) {
      console.log(`❌ ${city.rank}. ${city.name}, ${city.state} - NO DISCOVERY DATA`);
      continue;
    }

    // Score and sort layers
    const scored = cityLayers.map((l) => ({
      layer: l,
      nameScore: scoreLayerName(l.name),
      combined: scoreLayerName(l.name) * 0.6 + l.resolution.confidence * 0.4,
    }));
    scored.sort((a, b) => b.combined - a.combined);

    const best = scored[0];

    // Generate download URL
    let downloadUrl = best.layer.url;
    if (!downloadUrl.includes('query?') && !downloadUrl.includes('geojson')) {
      // Add GeoJSON query params for FeatureServer/MapServer URLs
      downloadUrl += '/query?where=1%3D1&outFields=*&f=geojson';
    }

    console.log(`✅ ${city.rank}. ${city.name}, ${city.state}`);
    console.log(`   Layer: "${best.layer.name}"`);
    console.log(`   Score: ${best.combined.toFixed(0)} (name: ${best.nameScore}, geo: ${best.layer.resolution.confidence})`);
    console.log(`   URL: ${downloadUrl}`);
    console.log('');

    // Generate registry entry
    const entry = `  '${city.fips}': {
    cityFips: '${city.fips}',
    cityName: '${city.name}',
    state: '${city.state}',
    portalType: 'arcgis',
    downloadUrl: '${downloadUrl}',
    featureCount: ${city.councilSize},
    lastVerified: '${new Date().toISOString()}',
    confidence: ${Math.round(best.combined)},
    discoveredBy: 'automated',
    notes: '${city.name} City Council Districts - ${city.councilSize} districts, discovered from attributed-council-districts.json',
  },`;

    newEntries.push(entry);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                     REGISTRY ENTRIES TO ADD');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('// AUTO-GENERATED - Add to known-portals.ts\n');
  for (const entry of newEntries) {
    console.log(entry);
    console.log('');
  }
}

main().catch(console.error);
