#!/usr/bin/env npx tsx
/**
 * Deep analysis of the 121 unknown layers to find any remaining recovery opportunities
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AccessibilityResult {
  url: string;
  name: string;
  status: 'ACCESSIBLE' | 'INACCESSIBLE' | 'TIMEOUT' | 'ERROR';
  hasExtent: boolean;
  hasGeometry: boolean;
  extentCenter?: { lat: number; lon: number };
  copyrightText?: string;
}

// Web Mercator to WGS84 conversion
function webMercatorToWgs84(x: number, y: number): { lat: number; lon: number } {
  const R = 6378137; // Earth's radius in meters
  const lon = (x / R) * (180 / Math.PI);
  const lat = (Math.atan(Math.exp(y / R)) * 2 - Math.PI / 2) * (180 / Math.PI);
  return { lat, lon };
}

// Check if coordinates are within continental US (precise bounds to exclude Canada)
function isWithinUS(lat: number, lon: number): boolean {
  // Continental US bounds (more precise to exclude Canada)
  // West of -95°: border is at 49°N
  // Between -95° and -82° (Great Lakes): more complex, use 42°N as safe floor
  // East of -82°: use tighter bounds to exclude Ontario

  // Southern border ~24°N, Northern border:
  // - West of Minnesota: 49°N
  // - Great Lakes region: actual US goes down to ~41°N but Canada (Ontario) extends to ~42°N
  // For safety, exclude the Ontario overlap zone (43-45°N, -82° to -74°W)

  // Alaska: lat 54-72, lon -170 to -130
  // Hawaii: lat 18-23, lon -161 to -154

  // Exclude Ontario region (southern Ontario overlaps US latitude bands)
  const inOntarioRegion = lat >= 42 && lat <= 46 && lon >= -83 && lon <= -74;
  if (inOntarioRegion) {
    return false; // Conservative: requires geocoding to confirm US vs Canada
  }

  const lowerContinental = lat >= 24 && lat <= 49 && lon >= -125 && lon <= -66;
  const alaska = lat >= 54 && lat <= 72 && lon >= -170 && lon <= -130;
  const hawaii = lat >= 18 && lat <= 23 && lon >= -161 && lon <= -154;

  return lowerContinental || alaska || hawaii;
}

// Canadian copyright patterns
const CANADIAN_COPYRIGHT_PATTERNS = [
  /canada/i,
  /ontario/i,
  /toronto/i,
  /calgary/i,
  /ottawa/i,
  /vancouver/i,
  /montreal/i,
  /quebec/i,
  /british columbia/i,
  /alberta/i,
  /manitoba/i,
  /saskatchewan/i,
  /nova scotia/i,
  /new brunswick/i,
  /city of (?:burlington|hamilton|mississauga|brampton|markham|vaughan|richmond hill)/i,
  /town of (?:newmarket|oakville|ajax|pickering|whitby|oshawa)/i,
  /region of (?:york|peel|durham|halton|waterloo)/i,
];

async function fetchWithTimeout(url: string, timeout = 5000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch {
    return null;
  }
}

async function analyzeUnknownLayer(layer: { url: string; name: string }): Promise<{
  url: string;
  name: string;
  classification: 'US_RECOVERABLE' | 'INTERNATIONAL' | 'INACCESSIBLE' | 'EMPTY' | 'UNKNOWN';
  details: string;
  location?: { lat: number; lon: number };
  copyrightText?: string;
}> {
  const result = {
    url: layer.url,
    name: layer.name,
    classification: 'UNKNOWN' as const,
    details: '',
  };

  try {
    // Fetch metadata
    const metaResponse = await fetchWithTimeout(`${layer.url}?f=json`);
    if (!metaResponse) {
      return { ...result, classification: 'INACCESSIBLE', details: 'Timeout' };
    }

    const meta = await metaResponse.json();
    if (meta.error) {
      return { ...result, classification: 'INACCESSIBLE', details: meta.error.message || 'Error' };
    }

    // Extract extent and convert to WGS84
    if (meta.extent) {
      const { xmin, xmax, ymin, ymax } = meta.extent;
      if (typeof xmin === 'number' && typeof ymin === 'number') {
        const centerX = (xmin + xmax) / 2;
        const centerY = (ymin + ymax) / 2;

        // Check if already in WGS84 (reasonable lat/lon values)
        let lat: number, lon: number;
        if (Math.abs(centerX) <= 180 && Math.abs(centerY) <= 90) {
          lat = centerY;
          lon = centerX;
        } else {
          // Convert from Web Mercator
          const wgs84 = webMercatorToWgs84(centerX, centerY);
          lat = wgs84.lat;
          lon = wgs84.lon;
        }

        const inUS = isWithinUS(lat, lon);

        // Check for geometry
        const queryResponse = await fetchWithTimeout(
          `${layer.url}/query?where=1=1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`,
          8000
        );

        let hasGeometry = false;
        if (queryResponse) {
          const queryData = await queryResponse.json();
          hasGeometry = !!queryData.features?.[0]?.geometry;
        }

        // Check for Canadian copyright patterns
        const copyrightText = meta.copyrightText || '';
        const isCanadianCopyright = CANADIAN_COPYRIGHT_PATTERNS.some(p => p.test(copyrightText));
        const isCanadianName = CANADIAN_COPYRIGHT_PATTERNS.some(p => p.test(layer.name));

        if (!hasGeometry) {
          return {
            ...result,
            classification: 'EMPTY',
            details: `Service accessible but no geometry (${inUS ? 'US' : 'International'} coords: ${lat.toFixed(2)}, ${lon.toFixed(2)})`,
            location: { lat, lon },
            copyrightText: meta.copyrightText,
          };
        }

        // If copyright or name indicates Canada, classify as international
        if (isCanadianCopyright || isCanadianName) {
          return {
            ...result,
            classification: 'INTERNATIONAL',
            details: `Canadian (copyright/name match): ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
            location: { lat, lon },
            copyrightText: meta.copyrightText,
          };
        }

        if (inUS) {
          return {
            ...result,
            classification: 'US_RECOVERABLE',
            details: `US location with geometry: ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
            location: { lat, lon },
            copyrightText: meta.copyrightText,
          };
        } else {
          return {
            ...result,
            classification: 'INTERNATIONAL',
            details: `International location: ${lat.toFixed(2)}, ${lon.toFixed(2)}`,
            location: { lat, lon },
            copyrightText: meta.copyrightText,
          };
        }
      }
    }

    return { ...result, classification: 'UNKNOWN', details: 'No extent information' };
  } catch (e) {
    return { ...result, classification: 'INACCESSIBLE', details: (e as Error).message };
  }
}

async function main(): Promise<void> {
  // Load attributed council districts
  const dataPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const allUnresolved: Array<{ url: string; name: string }> = data.unresolved;

  // Load categorization to get only the truly unknown layers
  const categorizationPath = path.join(__dirname, '../agents/data/unresolved-categorization.json');
  const categorization = JSON.parse(fs.readFileSync(categorizationPath, 'utf-8'));

  const internationalUrls = new Set(categorization.international.map((l: { url: string }) => l.url));
  const recoverableUrls = new Set(categorization.recoverable.map((l: { url: string }) => l.url));

  // Filter to get only unknown layers (not already categorized as international or recoverable)
  const unknownLayers = allUnresolved.filter(l =>
    !internationalUrls.has(l.url) && !recoverableUrls.has(l.url)
  );

  // Also filter out ElectoralDistricts template layers
  const trueUnknown = unknownLayers.filter(l => !l.url.includes('ElectoralDistricts'));

  console.log('='.repeat(80));
  console.log('DEEP UNKNOWN LAYER ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nTotal unresolved: ${allUnresolved.length}`);
  console.log(`Already categorized international: ${internationalUrls.size}`);
  console.log(`Already categorized recoverable: ${recoverableUrls.size}`);
  console.log(`ElectoralDistricts templates: ${unknownLayers.length - trueUnknown.length}`);
  console.log(`Truly unknown to analyze: ${trueUnknown.length}\n`);

  const results: Awaited<ReturnType<typeof analyzeUnknownLayer>>[] = [];
  const classifications = {
    US_RECOVERABLE: 0,
    INTERNATIONAL: 0,
    INACCESSIBLE: 0,
    EMPTY: 0,
    UNKNOWN: 0,
  };

  for (let i = 0; i < trueUnknown.length; i++) {
    const layer = trueUnknown[i];
    const result = await analyzeUnknownLayer(layer);
    results.push(result);
    classifications[result.classification]++;

    if ((i + 1) % 10 === 0) {
      console.log(`  Analyzed ${i + 1}/${trueUnknown.length}...`);
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('CLASSIFICATION RESULTS:');
  console.log('-'.repeat(60));
  console.log(`  US_RECOVERABLE:  ${classifications.US_RECOVERABLE} (${((classifications.US_RECOVERABLE / trueUnknown.length) * 100).toFixed(1)}%)`);
  console.log(`  INTERNATIONAL:   ${classifications.INTERNATIONAL} (${((classifications.INTERNATIONAL / trueUnknown.length) * 100).toFixed(1)}%)`);
  console.log(`  INACCESSIBLE:    ${classifications.INACCESSIBLE} (${((classifications.INACCESSIBLE / trueUnknown.length) * 100).toFixed(1)}%)`);
  console.log(`  EMPTY:           ${classifications.EMPTY} (${((classifications.EMPTY / trueUnknown.length) * 100).toFixed(1)}%)`);
  console.log(`  UNKNOWN:         ${classifications.UNKNOWN} (${((classifications.UNKNOWN / trueUnknown.length) * 100).toFixed(1)}%)`);

  // Show US recoverable layers
  const usRecoverable = results.filter(r => r.classification === 'US_RECOVERABLE');
  if (usRecoverable.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('US RECOVERABLE LAYERS (NEEDS GEOCODING):');
    console.log('-'.repeat(60));
    for (const layer of usRecoverable) {
      console.log(`  ${layer.name}`);
      console.log(`    Location: ${layer.location?.lat.toFixed(4)}, ${layer.location?.lon.toFixed(4)}`);
      console.log(`    URL: ${layer.url.slice(0, 70)}...`);
      if (layer.copyrightText) {
        console.log(`    Copyright: ${layer.copyrightText.slice(0, 60)}...`);
      }
    }
  }

  // Show international layers found
  const international = results.filter(r => r.classification === 'INTERNATIONAL');
  if (international.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('NEWLY IDENTIFIED INTERNATIONAL LAYERS:');
    console.log('-'.repeat(60));
    for (const layer of international.slice(0, 10)) {
      console.log(`  ${layer.name}`);
      console.log(`    Location: ${layer.location?.lat.toFixed(2)}, ${layer.location?.lon.toFixed(2)}`);
      if (layer.copyrightText) {
        console.log(`    Copyright: ${layer.copyrightText.slice(0, 60)}...`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('PRACTICAL LIMIT ANALYSIS');
  console.log('='.repeat(80));
  console.log(`
  Of ${trueUnknown.length} truly unknown layers:

  ✓ ${classifications.INACCESSIBLE} INACCESSIBLE - Deleted/token-required services (unrecoverable)
  ✓ ${classifications.INTERNATIONAL} INTERNATIONAL - Non-US layers (should be rejected)
  ✓ ${classifications.EMPTY} EMPTY - Services exist but have no geometry data
  ✓ ${classifications.US_RECOVERABLE} US_RECOVERABLE - Could be recovered via reverse geocoding
  ✓ ${classifications.UNKNOWN} UNKNOWN - Unable to classify

  CONCLUSION: ${usRecoverable.length > 0 ?
    `Found ${usRecoverable.length} additional US layers that could be recovered!` :
    'This IS the practical limit. No additional US layers with geometry found.'}
  `);

  // Write results
  const outputPath = path.join(__dirname, '../agents/data/deep-unknown-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: {
      totalUnresolved: allUnresolved.length,
      internationalAlreadyCategorized: internationalUrls.size,
      recoverableAlreadyCategorized: recoverableUrls.size,
      electoralTemplates: unknownLayers.length - trueUnknown.length,
      trulyUnknown: trueUnknown.length,
    },
    classifications,
    usRecoverable,
    international: results.filter(r => r.classification === 'INTERNATIONAL'),
    inaccessible: results.filter(r => r.classification === 'INACCESSIBLE'),
  }, null, 2));

  console.log(`Results written to: ${outputPath}`);
}

main().catch(console.error);
