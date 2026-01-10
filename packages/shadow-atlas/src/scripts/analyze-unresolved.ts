#!/usr/bin/env npx tsx
/**
 * Analyze unresolved layers to understand failure patterns
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UnresolvedLayer {
  url: string;
  name: string;
  failureReason?: string;
  metadata?: {
    name?: string;
    description?: string;
    copyrightText?: string;
    extent?: {
      spatialReference?: { wkid?: number; latestWkid?: number };
    };
  };
  centroidResult?: string;
  geocodeResult?: string;
}

async function fetchWithTimeout(url: string, timeout = 10000): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    return null;
  }
}

async function analyzeLayer(url: string, name: string): Promise<UnresolvedLayer> {
  const result: UnresolvedLayer = { url, name };
  const failures: string[] = [];

  // Step 1: Fetch metadata
  try {
    const metaResponse = await fetchWithTimeout(`${url}?f=json`);
    if (!metaResponse) {
      failures.push('METADATA_TIMEOUT');
    } else if (!metaResponse.ok) {
      failures.push(`METADATA_HTTP_${metaResponse.status}`);
    } else {
      const meta = await metaResponse.json();
      result.metadata = {
        name: meta.name,
        description: meta.description,
        copyrightText: meta.copyrightText,
        extent: meta.extent,
      };

      if (!meta.extent) {
        failures.push('NO_EXTENT');
      }
    }
  } catch (e) {
    failures.push(`METADATA_ERROR: ${(e as Error).message}`);
  }

  // Step 2: Query for geometry
  try {
    const queryUrl = `${url}/query?where=1=1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`;
    const queryResponse = await fetchWithTimeout(queryUrl, 15000);

    if (!queryResponse) {
      failures.push('QUERY_TIMEOUT');
    } else if (!queryResponse.ok) {
      failures.push(`QUERY_HTTP_${queryResponse.status}`);
    } else {
      const data = await queryResponse.json();

      if (data.error) {
        failures.push(`QUERY_ERROR: ${data.error.message || data.error.code}`);
        result.centroidResult = JSON.stringify(data.error);
      } else if (!data.features || data.features.length === 0) {
        failures.push('NO_FEATURES');
        result.centroidResult = 'Empty features array';
      } else if (!data.features[0].geometry) {
        failures.push('NO_GEOMETRY');
        result.centroidResult = 'Feature has no geometry';
      } else {
        const geom = data.features[0].geometry;
        let centroid: { lat: number; lon: number } | null = null;

        if (geom.rings && geom.rings[0]) {
          const ring = geom.rings[0];
          let sumX = 0, sumY = 0;
          for (const [x, y] of ring) {
            sumX += x;
            sumY += y;
          }
          centroid = { lon: sumX / ring.length, lat: sumY / ring.length };
        } else if (typeof geom.x === 'number' && typeof geom.y === 'number') {
          centroid = { lon: geom.x, lat: geom.y };
        }

        if (centroid) {
          result.centroidResult = `${centroid.lat.toFixed(4)}, ${centroid.lon.toFixed(4)}`;

          // Step 3: Try Census geocoder
          const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${centroid.lon}&y=${centroid.lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=28&format=json`;
          const geocodeResponse = await fetchWithTimeout(geocodeUrl);

          if (!geocodeResponse) {
            failures.push('GEOCODE_TIMEOUT');
          } else if (!geocodeResponse.ok) {
            failures.push(`GEOCODE_HTTP_${geocodeResponse.status}`);
          } else {
            const geocodeData = await geocodeResponse.json();
            const place = geocodeData.result?.geographies?.['Incorporated Places']?.[0];

            if (!place) {
              // Check if it's in a county but not an incorporated place
              const county = geocodeData.result?.geographies?.['Counties']?.[0];
              if (county) {
                failures.push('NOT_INCORPORATED_PLACE');
                result.geocodeResult = `In ${county.NAME}, but not in an incorporated city`;
              } else if (centroid.lon < -130 || centroid.lon > -65 || centroid.lat < 24 || centroid.lat > 50) {
                failures.push('OUTSIDE_CONUS');
                result.geocodeResult = `Coordinates outside continental US: ${centroid.lat.toFixed(2)}, ${centroid.lon.toFixed(2)}`;
              } else {
                failures.push('NO_CENSUS_PLACE');
                result.geocodeResult = 'Geocoder returned no place';
              }
            } else {
              // This shouldn't happen if we got here - it means geocoding worked
              result.geocodeResult = `${place.NAME} (${place.GEOID})`;
            }
          }
        } else {
          failures.push('GEOMETRY_PARSE_ERROR');
        }
      }
    }
  } catch (e) {
    failures.push(`QUERY_EXCEPTION: ${(e as Error).message}`);
  }

  result.failureReason = failures.join(' | ');
  return result;
}

async function main(): Promise<void> {
  const resultsPath = path.join(__dirname, '../agents/data/edge-case-analysis-results.json');
  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  // Get a sample of layers to analyze in detail
  const needsReview = results.needsReview.slice(0, 200);

  console.log('='.repeat(80));
  console.log('UNRESOLVED LAYER ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nAnalyzing ${needsReview.length} layers to identify failure patterns...\n`);

  const analyzed: UnresolvedLayer[] = [];
  const failureCategories: Record<string, number> = {};

  for (let i = 0; i < needsReview.length; i++) {
    const layer = needsReview[i];
    const analysis = await analyzeLayer(layer.url, layer.name);
    analyzed.push(analysis);

    // Categorize failures
    const reasons = analysis.failureReason?.split(' | ') || [];
    for (const reason of reasons) {
      const category = reason.split(':')[0];
      failureCategories[category] = (failureCategories[category] || 0) + 1;
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  Analyzed ${i + 1}/${needsReview.length}...`);
    }
  }

  // Identify truly unresolved (no geocode result but had failures)
  const unresolved = analyzed.filter(a =>
    a.failureReason &&
    !a.geocodeResult?.includes('(') // No GEOID means not resolved
  );

  console.log('\n' + '-'.repeat(80));
  console.log('FAILURE CATEGORY BREAKDOWN');
  console.log('-'.repeat(80));

  for (const [category, count] of Object.entries(failureCategories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category.padEnd(30)} ${count}`);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('SAMPLE UNRESOLVED LAYERS');
  console.log('-'.repeat(80));

  // Group by primary failure reason
  const byFailure: Record<string, UnresolvedLayer[]> = {};
  for (const layer of unresolved) {
    const primary = layer.failureReason?.split(' | ')[0]?.split(':')[0] || 'UNKNOWN';
    if (!byFailure[primary]) byFailure[primary] = [];
    byFailure[primary].push(layer);
  }

  for (const [failure, layers] of Object.entries(byFailure)) {
    console.log(`\n--- ${failure} (${layers.length} layers) ---`);
    for (const layer of layers.slice(0, 3)) {
      console.log(`  ${layer.name}`);
      console.log(`    URL: ${layer.url}`);
      if (layer.centroidResult) console.log(`    Centroid: ${layer.centroidResult}`);
      if (layer.geocodeResult) console.log(`    Geocode: ${layer.geocodeResult}`);
      if (layer.metadata?.copyrightText) console.log(`    Copyright: ${layer.metadata.copyrightText.slice(0, 50)}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`
  Total analyzed: ${analyzed.length}
  Resolved: ${analyzed.length - unresolved.length}
  Unresolved: ${unresolved.length}

  Top failure reasons:
${Object.entries(failureCategories)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([k, v]) => `    - ${k}: ${v}`)
  .join('\n')}
  `);

  // Write detailed results
  const outputPath = path.join(__dirname, '../agents/data/unresolved-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    summary: {
      total: analyzed.length,
      unresolved: unresolved.length,
      failureCategories,
    },
    unresolved: unresolved.map(u => ({
      name: u.name,
      url: u.url,
      failure: u.failureReason,
      centroid: u.centroidResult,
      geocode: u.geocodeResult,
      copyright: u.metadata?.copyrightText,
    })),
  }, null, 2));

  console.log(`Detailed results written to: ${outputPath}`);
}

main().catch(console.error);
