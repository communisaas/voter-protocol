#!/usr/bin/env npx tsx
/**
 * Merge the 37 recoverable layers into the resolved set
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
  suggestedFips: string;
  suggestedName: string;
  suggestedState: string;
  recoveryMethod: string;
}

async function main(): Promise<void> {
  // Load resolved layers
  const attributedPath = path.join(__dirname, '../agents/data/attributed-council-districts.json');
  const attributed = JSON.parse(fs.readFileSync(attributedPath, 'utf-8'));

  // Load categorization with recoverable layers
  const categorizationPath = path.join(__dirname, '../agents/data/unresolved-categorization.json');
  const categorization = JSON.parse(fs.readFileSync(categorizationPath, 'utf-8'));

  const resolved: ResolvedLayer[] = attributed.resolved;
  const recoverable: RecoverableLayer[] = categorization.recoverable;

  console.log('='.repeat(80));
  console.log('MERGING RECOVERABLE LAYERS');
  console.log('='.repeat(80));
  console.log(`\nResolved layers: ${resolved.length}`);
  console.log(`Recoverable layers: ${recoverable.length}\n`);

  // Convert recoverable to resolved format
  const existingUrls = new Set(resolved.map(l => l.url));
  let added = 0;

  for (const layer of recoverable) {
    if (existingUrls.has(layer.url)) {
      console.log(`  SKIP (duplicate): ${layer.suggestedName}, ${layer.suggestedState}`);
      continue;
    }

    resolved.push({
      url: layer.url,
      name: layer.name,
      resolution: {
        fips: layer.suggestedFips,
        name: layer.suggestedName,
        state: layer.suggestedState,
        method: `PATTERN_${layer.recoveryMethod}`,
        confidence: 80, // Pattern matching is reasonably confident
      },
    });
    added++;
    console.log(`  ADD: ${layer.suggestedName}, ${layer.suggestedState}`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Added ${added} recoverable layers`);
  console.log(`Total resolved: ${resolved.length}`);

  // Calculate final stats
  const citiesByState: Record<string, Set<string>> = {};
  for (const layer of resolved) {
    const state = layer.resolution.state;
    if (!citiesByState[state]) {
      citiesByState[state] = new Set();
    }
    citiesByState[state].add(layer.resolution.name);
  }

  const totalCities = Object.values(citiesByState).reduce((sum, set) => sum + set.size, 0);
  const totalStates = Object.keys(citiesByState).length;

  // Update attributed data
  attributed.resolved = resolved;
  attributed.metadata.resolvedCount = resolved.length;
  attributed.metadata.mergedRecoverable = added;
  attributed.metadata.finalMergeAt = new Date().toISOString();

  // Write merged data
  fs.writeFileSync(attributedPath, JSON.stringify(attributed, null, 2));

  console.log(`\nFINAL COVERAGE:`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Layers:  ${resolved.length}`);
  console.log(`  Cities:  ${totalCities}`);
  console.log(`  States:  ${totalStates}`);
  console.log(`\nUpdated: ${attributedPath}`);
}

main().catch(console.error);
