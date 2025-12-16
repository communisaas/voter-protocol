#!/usr/bin/env npx tsx
/**
 * Shadow Atlas Builder Script
 *
 * Downloads TIGER data, validates, and builds unified Merkle tree.
 *
 * Usage:
 *   npx tsx scripts/build-tiger-atlas.ts --layers cd,county --year 2024
 *   npx tsx scripts/build-tiger-atlas.ts --state 06 --layers cd,sldu,county
 *   npx tsx scripts/build-tiger-atlas.ts --full --year 2024 --export
 */

import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { TIGERBoundaryProvider, type TIGERLayer } from '../providers/tiger-boundary-provider.js';
import { TIGERValidator } from '../validators/tiger-validator.js';
import { MultiLayerMerkleTreeBuilder, type BoundaryLayers, type NormalizedBoundary } from '../merkle/multi-layer-builder.js';

const { values } = parseArgs({
  options: {
    layers: { type: 'string', short: 'l', default: 'cd,county' },
    state: { type: 'string', short: 's' },
    year: { type: 'string', short: 'y', default: '2024' },
    full: { type: 'boolean', short: 'f' },
    export: { type: 'boolean', short: 'e' },
    output: { type: 'string', short: 'o', default: './shadow-atlas-output' },
    help: { type: 'boolean', short: 'h' },
  },
});

function printUsage(): void {
  console.log(`
Shadow Atlas Builder

Usage:
  npx tsx scripts/build-tiger-atlas.ts [options]

Options:
  -l, --layers <list>   Layers to include: cd,sldu,sldl,county (comma-separated)
  -s, --state <fips>    Build for single state (FIPS code)
  -y, --year <year>     TIGER year (default: 2024)
  -f, --full            Include all layers (cd,sldu,sldl,county)
  -e, --export          Export tree to JSON file
  -o, --output <dir>    Output directory (default: ./shadow-atlas-output)
  -h, --help            Show this help

Examples:
  # Build CD + County tree
  npx tsx scripts/build-tiger-atlas.ts --layers cd,county

  # Build full US atlas and export
  npx tsx scripts/build-tiger-atlas.ts --full --export

  # Build California-only atlas
  npx tsx scripts/build-tiger-atlas.ts --state 06 --full --export
`);
}

async function main(): Promise<void> {
  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const year = parseInt(values.year || '2024', 10);
  const stateFips = values.state;
  const layerList: TIGERLayer[] = values.full
    ? ['cd', 'sldu', 'sldl', 'county']
    : (values.layers?.split(',') as TIGERLayer[]) || ['cd', 'county'];

  console.log(`\n🏗️  Shadow Atlas Builder`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Year: ${year}`);
  console.log(`Layers: ${layerList.join(', ')}`);
  console.log(`Scope: ${stateFips ? `State ${stateFips}` : 'National'}\n`);

  const provider = new TIGERBoundaryProvider({ year });
  const validator = new TIGERValidator();
  const builder = new MultiLayerMerkleTreeBuilder();

  // Download and transform each layer
  const boundaryLayers: BoundaryLayers = {};

  for (const layer of layerList) {
    console.log(`\n📥 Downloading ${layer.toUpperCase()}...`);

    try {
      const rawFiles = await provider.downloadLayer({ layer, stateFips, year });
      const boundaries = await provider.transform(rawFiles);

      console.log(`   ✅ ${boundaries.length} boundaries`);

      // Validate
      const validatorBoundaries = boundaries.map(b => ({
        geoid: b.id,
        name: b.name,
        geometry: b.geometry,
        properties: b.properties,
      }));
      const result = validator.validate(layer, validatorBoundaries, stateFips);

      if (result.qualityScore < 80) {
        console.log(`   ⚠️  Quality score ${result.qualityScore}/100 (below threshold)`);
      }

      // Map to Merkle builder format
      const normalizedForMerkle: NormalizedBoundary[] = boundaries.map(b => ({
        id: b.id,
        name: b.name,
        geometry: b.geometry,
        boundaryType: mapLayerToBoundaryType(layer),
        authority: 5, // Federal
      }));

      // Add to appropriate layer
      if (layer === 'cd') boundaryLayers.congressionalDistricts = normalizedForMerkle;
      if (layer === 'sldu') boundaryLayers.stateLegislativeUpper = normalizedForMerkle;
      if (layer === 'sldl') boundaryLayers.stateLegislativeLower = normalizedForMerkle;
      if (layer === 'county') boundaryLayers.counties = normalizedForMerkle;

    } catch (error) {
      console.error(`   ❌ Failed: ${(error as Error).message}`);
    }
  }

  // Build Merkle tree
  console.log(`\n🌲 Building Merkle tree...`);
  const tree = builder.buildTree(boundaryLayers);

  console.log(`\n📊 TREE STATISTICS`);
  console.log(`━━━━━━━━━━━━━━━━━━`);
  console.log(`Root: 0x${tree.root.toString(16).slice(0, 16)}...`);
  console.log(`Boundaries: ${tree.boundaryCount}`);
  console.log(`Depth: ${tree.tree.length}`);
  console.log(`Layers:`, tree.layerCounts);

  // Export if requested
  if (values.export) {
    const outputDir = values.output || './shadow-atlas-output';
    await mkdir(outputDir, { recursive: true });

    const json = builder.exportToJSON(tree);
    const filename = `shadow-atlas-${year}${stateFips ? `-${stateFips}` : ''}.json`;
    await writeFile(join(outputDir, filename), json);

    console.log(`\n📁 Exported to ${join(outputDir, filename)}`);
  }

  console.log(`\n✅ Build complete!`);
}

function mapLayerToBoundaryType(layer: TIGERLayer): string {
  switch (layer) {
    case 'cd': return 'congressional-district';
    case 'sldu': return 'state-legislative-upper';
    case 'sldl': return 'state-legislative-lower';
    case 'county': return 'county';
    default: return layer;
  }
}

main().catch((error) => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
