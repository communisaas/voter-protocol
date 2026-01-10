#!/usr/bin/env npx tsx
/**
 * Check accessibility of unresolved layers and categorize failure reasons
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface UnresolvedLayer {
  url: string;
  name: string;
}

interface AccessibilityResult {
  url: string;
  name: string;
  status: 'ACCESSIBLE' | 'INACCESSIBLE' | 'TIMEOUT' | 'ERROR';
  hasExtent: boolean;
  hasGeometry: boolean;
  extentCenter?: { lat: number; lon: number };
  copyrightText?: string;
  errorMessage?: string;
}

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

async function checkLayer(layer: UnresolvedLayer): Promise<AccessibilityResult> {
  const result: AccessibilityResult = {
    url: layer.url,
    name: layer.name,
    status: 'ERROR',
    hasExtent: false,
    hasGeometry: false,
  };

  try {
    // Check metadata
    const metaResponse = await fetchWithTimeout(`${layer.url}?f=json`);
    if (!metaResponse) {
      result.status = 'TIMEOUT';
      return result;
    }

    const meta = await metaResponse.json();
    if (meta.error) {
      result.status = 'INACCESSIBLE';
      result.errorMessage = meta.error.message;
      return result;
    }

    result.status = 'ACCESSIBLE';
    result.copyrightText = meta.copyrightText;

    if (meta.extent) {
      result.hasExtent = true;
      const { xmin, xmax, ymin, ymax } = meta.extent;
      if (typeof xmin === 'number' && typeof ymin === 'number') {
        result.extentCenter = {
          lon: (xmin + xmax) / 2,
          lat: (ymin + ymax) / 2,
        };
      }
    }

    // Check for geometry
    const queryResponse = await fetchWithTimeout(
      `${layer.url}/query?where=1=1&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`,
      8000
    );
    if (queryResponse) {
      const queryData = await queryResponse.json();
      if (queryData.features?.[0]?.geometry) {
        result.hasGeometry = true;
      }
    }

    return result;
  } catch (e) {
    result.errorMessage = (e as Error).message;
    return result;
  }
}

async function main(): Promise<void> {
  const dataPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const unresolved: UnresolvedLayer[] = data.unresolved;

  // Filter out already-categorized international layers
  const categorizationPath = path.join(__dirname, '../agents/data/unresolved-categorization.json');
  const categorization = JSON.parse(fs.readFileSync(categorizationPath, 'utf-8'));
  const internationalUrls = new Set(categorization.international.map((l: { url: string }) => l.url));
  const recoverableUrls = new Set(categorization.recoverable.map((l: { url: string }) => l.url));

  const toCheck = unresolved.filter(
    (l) => !internationalUrls.has(l.url) && !recoverableUrls.has(l.url)
  );

  console.log('='.repeat(80));
  console.log('LAYER ACCESSIBILITY CHECK');
  console.log('='.repeat(80));
  console.log(`\nTotal unresolved: ${unresolved.length}`);
  console.log(`Already categorized (international): ${internationalUrls.size}`);
  console.log(`Already categorized (recoverable): ${recoverableUrls.size}`);
  console.log(`Checking: ${toCheck.length}\n`);

  const results: AccessibilityResult[] = [];
  const stats = {
    accessible: 0,
    inaccessible: 0,
    timeout: 0,
    error: 0,
    hasExtent: 0,
    hasGeometry: 0,
  };

  for (let i = 0; i < Math.min(toCheck.length, 100); i++) {
    const layer = toCheck[i];
    const result = await checkLayer(layer);
    results.push(result);

    stats[result.status.toLowerCase() as keyof typeof stats]++;
    if (result.hasExtent) stats.hasExtent++;
    if (result.hasGeometry) stats.hasGeometry++;

    if ((i + 1) % 10 === 0) {
      console.log(`  Checked ${i + 1}/${Math.min(toCheck.length, 100)}...`);
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('ACCESSIBILITY BREAKDOWN:');
  console.log('-'.repeat(60));
  console.log(`  ACCESSIBLE:   ${stats.accessible} (${((stats.accessible / results.length) * 100).toFixed(1)}%)`);
  console.log(`  INACCESSIBLE: ${stats.inaccessible} (${((stats.inaccessible / results.length) * 100).toFixed(1)}%)`);
  console.log(`  TIMEOUT:      ${stats.timeout} (${((stats.timeout / results.length) * 100).toFixed(1)}%)`);
  console.log(`  ERROR:        ${stats.error} (${((stats.error / results.length) * 100).toFixed(1)}%)`);

  console.log('\n' + '-'.repeat(60));
  console.log('DATA AVAILABILITY (of accessible layers):');
  console.log('-'.repeat(60));
  console.log(`  Has extent:   ${stats.hasExtent} (${((stats.hasExtent / stats.accessible) * 100).toFixed(1)}%)`);
  console.log(`  Has geometry: ${stats.hasGeometry} (${((stats.hasGeometry / stats.accessible) * 100).toFixed(1)}%)`);

  // Analyze accessible layers without geometry
  const accessibleNoGeometry = results.filter((r) => r.status === 'ACCESSIBLE' && !r.hasGeometry);
  const accessibleWithGeometry = results.filter((r) => r.status === 'ACCESSIBLE' && r.hasGeometry);

  console.log('\n' + '-'.repeat(60));
  console.log('ACCESSIBLE LAYERS WITH GEOMETRY (could be recovered):');
  console.log('-'.repeat(60));
  for (const layer of accessibleWithGeometry.slice(0, 10)) {
    console.log(`  ${layer.name}`);
    if (layer.extentCenter) {
      console.log(`    Center: ${layer.extentCenter.lat.toFixed(4)}, ${layer.extentCenter.lon.toFixed(4)}`);
    }
    if (layer.copyrightText) {
      console.log(`    Copyright: ${layer.copyrightText.slice(0, 60)}...`);
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('ACCESSIBLE BUT NO GEOMETRY (empty services):');
  console.log('-'.repeat(60));
  for (const layer of accessibleNoGeometry.slice(0, 5)) {
    console.log(`  ${layer.name}`);
    console.log(`    URL: ${layer.url.slice(0, 70)}...`);
  }

  // Check for Canadian patterns in accessible layers
  const canadianCopyright = results.filter(
    (r) => r.copyrightText && /calgary|canada|ontario|quebec|british columbia|alberta/i.test(r.copyrightText)
  );
  if (canadianCopyright.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('CANADIAN LAYERS DETECTED (should be rejected):');
    console.log('-'.repeat(60));
    for (const layer of canadianCopyright) {
      console.log(`  ${layer.name} - ${layer.copyrightText?.slice(0, 50)}...`);
    }
  }

  // Write results
  const outputPath = path.join(__dirname, '../agents/data/accessibility-check-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({ stats, results }, null, 2));
  console.log(`\nResults written to: ${outputPath}`);
}

main().catch(console.error);
