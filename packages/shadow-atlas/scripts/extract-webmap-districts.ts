#!/usr/bin/env npx tsx
/**
 * Extract Council Districts from ArcGIS Webmaps
 *
 * Extracts embedded feature collections from ArcGIS webmaps
 * for cities that don't expose FeatureServer endpoints.
 */

import { extractFromWebmap, buildWebmapUrl } from '../src/utils/webmap-extractor.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface CityConfig {
  fips: string;
  cityName: string;
  state: string;
  webmapId: string;
  layerPattern: string;
  expectedCount: number;
}

const CITIES_TO_EXTRACT: CityConfig[] = [
  {
    fips: '0613756',
    cityName: 'Claremont',
    state: 'CA',
    webmapId: 'f9f59d55e7e2433b8d9a1af9f079ec82',
    layerPattern: 'council district',
    expectedCount: 5,
  },
  {
    fips: '0646114',
    cityName: 'Martinez',
    state: 'CA',
    webmapId: '5eb9a43de95845d48c8d56773d023609',
    layerPattern: 'council district',
    expectedCount: 4,
  },
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           WEBMAP COUNCIL DISTRICT EXTRACTION                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const outputDir = join(process.cwd(), 'data/curated');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}\n`);
  }

  const results: Array<{
    city: CityConfig;
    success: boolean;
    featureCount?: number;
    outputPath?: string;
    error?: string;
  }> = [];

  for (const city of CITIES_TO_EXTRACT) {
    console.log(`\n── ${city.cityName}, ${city.state} (${city.fips}) ──`);
    console.log(`  Webmap ID: ${city.webmapId}`);
    console.log(`  Layer pattern: "${city.layerPattern}"`);
    console.log(`  Expected districts: ${city.expectedCount}`);

    const url = buildWebmapUrl(city.webmapId);
    console.log(`  Fetching: ${url}`);

    const result = await extractFromWebmap(url, city.layerPattern);

    if (!result.success) {
      console.log(`  ❌ FAILED: ${result.error}`);
      results.push({ city, success: false, error: result.error });
      continue;
    }

    console.log(`  ✅ Extracted ${result.featureCount} features`);
    console.log(`  Layer: "${result.layerName}"`);
    console.log(`  Spatial ref: ${result.spatialReference?.from} → ${result.spatialReference?.to}`);

    if (result.featureCount !== city.expectedCount) {
      console.log(`  ⚠️  WARNING: Expected ${city.expectedCount}, got ${result.featureCount}`);
    }

    // Save GeoJSON
    const filename = `${city.fips}-${city.cityName.toLowerCase().replace(/\s+/g, '-')}-${city.state.toLowerCase()}.geojson`;
    const outputPath = join(outputDir, filename);
    writeFileSync(outputPath, JSON.stringify(result.featureCollection, null, 2));
    console.log(`  Saved: ${outputPath}`);

    // Print district info
    if (result.featureCollection) {
      console.log('  Districts:');
      for (const feature of result.featureCollection.features) {
        const props = feature.properties ?? {};
        const districtId = props.DISTRICT || props.District || props.district || props.NAME || props.Name || 'unknown';
        console.log(`    - ${districtId}`);
      }
    }

    results.push({
      city,
      success: true,
      featureCount: result.featureCount,
      outputPath,
    });
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`Extracted: ${succeeded.length}/${results.length} cities`);

  if (succeeded.length > 0) {
    console.log('\n✅ Succeeded:');
    for (const r of succeeded) {
      console.log(`  - ${r.city.cityName}, ${r.city.state}: ${r.featureCount} districts`);
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ Failed:');
    for (const r of failed) {
      console.log(`  - ${r.city.cityName}, ${r.city.state}: ${r.error}`);
    }
  }

  // Generate known-portals entries
  if (succeeded.length > 0) {
    console.log('\n── KNOWN-PORTALS ENTRIES ──');
    console.log('Copy these to known-portals.ts:\n');

    for (const r of succeeded) {
      const entry = {
        cityFips: r.city.fips,
        cityName: r.city.cityName,
        state: r.city.state,
        portalType: 'webmap-embedded',
        downloadUrl: buildWebmapUrl(r.city.webmapId),
        featureCount: r.featureCount,
        lastVerified: new Date().toISOString(),
        confidence: 80,
        discoveredBy: 'authoritative',
        notes: `Extracted from ArcGIS webmap - ${r.featureCount} council districts`,
        webmapLayerName: r.city.layerPattern,
        authoritativeSource: `https://www.arcgis.com/home/item.html?id=${r.city.webmapId}`,
      };

      console.log(`  '${r.city.fips}': ${JSON.stringify(entry, null, 4).replace(/\n/g, '\n  ')},\n`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
