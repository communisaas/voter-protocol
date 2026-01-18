#!/usr/bin/env npx tsx
import { extractFromWebmap, buildWebmapUrl } from '../src/utils/webmap-extractor.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const url = buildWebmapUrl('5eb9a43de95845d48c8d56773d023609');
  console.log('Fetching:', url);

  const result = await extractFromWebmap(url, 'Adopted');

  if (result.success) {
    console.log('✅ Extracted', result.featureCount, 'features');
    console.log('Layer:', result.layerName);

    const outputPath = join(process.cwd(), 'data/curated/0646114-martinez-ca.geojson');
    writeFileSync(outputPath, JSON.stringify(result.featureCollection, null, 2));
    console.log('Saved:', outputPath);

    console.log('Districts:');
    for (const f of result.featureCollection?.features ?? []) {
      const p = f.properties ?? {};
      console.log(' -', p.District || p.DISTRICT || p.NAME || p.Name || JSON.stringify(p).slice(0, 50));
    }

    // Print entry for known-portals
    console.log('\n── KNOWN-PORTALS ENTRY ──');
    const entry = {
      cityFips: '0646114',
      cityName: 'Martinez',
      state: 'CA',
      portalType: 'webmap-embedded',
      downloadUrl: url,
      featureCount: result.featureCount,
      lastVerified: new Date().toISOString(),
      confidence: 80,
      discoveredBy: 'authoritative',
      notes: `Extracted from ArcGIS webmap - ${result.featureCount} council districts`,
      webmapLayerName: 'Adopted Districts',
      authoritativeSource: 'https://www.arcgis.com/home/item.html?id=5eb9a43de95845d48c8d56773d023609',
    };
    console.log(JSON.stringify(entry, null, 2));
  } else {
    console.log('❌ Failed:', result.error);
  }
}

main().catch(console.error);
