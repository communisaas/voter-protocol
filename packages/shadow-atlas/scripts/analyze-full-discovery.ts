#!/usr/bin/env npx tsx
/**
 * Full Discovery Data Analysis
 *
 * Analyzes all 2,898+ resolved council district layers to identify
 * cities that can be confidently added to the registry.
 *
 * Run: npx tsx scripts/analyze-full-discovery.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.generated.js';

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
  metadata: {
    totalProcessed: number;
    resolvedCount: number;
  };
  resolved: AttributedLayer[];
}

// Council district name patterns (positive)
const COUNCIL_PATTERNS = [
  /council[_\s]*district/i,
  /city[_\s]*council/i,
  /council[_\s]*ward/i,
  /aldermanic/i,
  /commissioner[_\s]*district/i,
  /ward/i,
];

// Negative patterns (exclude)
const NEGATIVE_PATTERNS = [
  /precinct/i,
  /voting/i,
  /election/i,
  /school/i,
  /fire/i,
  /police/i,
  /water/i,
  /utility/i,
  /census/i,
  /tract/i,
  /block/i,
  /historical/i,
  /proposed/i,
  /draft/i,
  /county[_\s]*commission/i,
  /supervisor/i,
  /state[_\s]*senate/i,
  /state[_\s]*house/i,
  /congress/i,
  /legislative/i,
];

function scoreLayerName(name: string): number {
  // Check negative patterns first
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(name)) return 0;
  }

  let score = 0;
  for (const pattern of COUNCIL_PATTERNS) {
    if (pattern.test(name)) score += 25;
  }

  // Bonus for explicit patterns
  if (/city[_\s]*council[_\s]*district/i.test(name)) score += 25;
  if (/council[_\s]*districts?$/i.test(name)) score += 15;

  return Math.min(score, 100);
}

interface CityCandidate {
  fips: string;
  name: string;
  state: string;
  bestUrl: string;
  bestLayerName: string;
  geoConfidence: number;
  nameScore: number;
  combinedScore: number;
  layerCount: number;
  alreadyInRegistry: boolean;
}

async function main(): Promise<void> {
  const dataPath = join(process.cwd(), 'src/agents/data/attributed-council-districts.json');
  const data: AttributedData = JSON.parse(readFileSync(dataPath, 'utf-8'));

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              FULL DISCOVERY DATA ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`Total resolved layers: ${data.resolved.length}`);

  // Group layers by city (fips + name + state)
  const citiesMap = new Map<string, AttributedLayer[]>();

  for (const layer of data.resolved) {
    const key = `${layer.resolution.fips}|${layer.resolution.name}|${layer.resolution.state}`;
    if (!citiesMap.has(key)) {
      citiesMap.set(key, []);
    }
    citiesMap.get(key)!.push(layer);
  }

  console.log(`Unique city/FIPS combinations: ${citiesMap.size}`);

  // Analyze each city
  const candidates: CityCandidate[] = [];
  const existingFips = new Set(Object.keys(KNOWN_PORTALS));

  for (const [key, layers] of citiesMap) {
    const [fips, name, state] = key.split('|');

    // Score each layer and pick the best
    const scored = layers.map((layer) => ({
      layer,
      nameScore: scoreLayerName(layer.name),
      geoConfidence: layer.resolution.confidence,
      combined: scoreLayerName(layer.name) * 0.5 + layer.resolution.confidence * 0.5,
    }));

    scored.sort((a, b) => b.combined - a.combined);
    const best = scored[0];

    // Only include if name score > 0 (matches council patterns)
    if (best.nameScore > 0) {
      candidates.push({
        fips,
        name,
        state,
        bestUrl: best.layer.url,
        bestLayerName: best.layer.name,
        geoConfidence: best.geoConfidence,
        nameScore: best.nameScore,
        combinedScore: best.combined,
        layerCount: layers.length,
        alreadyInRegistry: existingFips.has(fips),
      });
    }
  }

  // Sort by combined score
  candidates.sort((a, b) => b.combinedScore - a.combinedScore);

  // Stats
  const inRegistry = candidates.filter((c) => c.alreadyInRegistry);
  const notInRegistry = candidates.filter((c) => !c.alreadyInRegistry);

  console.log(`\nCities matching council patterns: ${candidates.length}`);
  console.log(`  Already in registry: ${inRegistry.length}`);
  console.log(`  New candidates: ${notInRegistry.length}`);

  // Confidence buckets for new candidates
  const highConf = notInRegistry.filter((c) => c.combinedScore >= 70);
  const medConf = notInRegistry.filter((c) => c.combinedScore >= 50 && c.combinedScore < 70);
  const lowConf = notInRegistry.filter((c) => c.combinedScore < 50);

  console.log('\n' + '─'.repeat(70));
  console.log('NEW CANDIDATES BY CONFIDENCE');
  console.log('─'.repeat(70));
  console.log(`  High (>=70):   ${highConf.length} cities`);
  console.log(`  Medium (50-69): ${medConf.length} cities`);
  console.log(`  Low (<50):     ${lowConf.length} cities`);

  // State coverage
  const stateCount = new Map<string, number>();
  for (const c of notInRegistry) {
    stateCount.set(c.state, (stateCount.get(c.state) || 0) + 1);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('STATE COVERAGE (new candidates)');
  console.log('─'.repeat(70));
  const sortedStates = [...stateCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [state, count] of sortedStates.slice(0, 20)) {
    console.log(`  ${state}: ${count} cities`);
  }

  // Top high-confidence candidates
  console.log('\n' + '─'.repeat(70));
  console.log('TOP HIGH-CONFIDENCE NEW CANDIDATES');
  console.log('─'.repeat(70));
  for (const c of highConf.slice(0, 30)) {
    console.log(
      `  ${c.name.padEnd(25)} ${c.state} | score: ${c.combinedScore.toFixed(0)} | "${c.bestLayerName.slice(0, 40)}"`
    );
  }

  // Export all new candidates for bulk ingestion
  const exportData = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalDiscovered: candidates.length,
      alreadyInRegistry: inRegistry.length,
      newCandidates: notInRegistry.length,
      highConfidence: highConf.length,
      mediumConfidence: medConf.length,
      lowConfidence: lowConf.length,
    },
    highConfidenceCandidates: highConf.map((c) => ({
      fips: c.fips,
      name: c.name,
      state: c.state,
      url: c.bestUrl,
      layerName: c.bestLayerName,
      score: Math.round(c.combinedScore),
      geoConfidence: c.geoConfidence,
      nameScore: c.nameScore,
    })),
    mediumConfidenceCandidates: medConf.map((c) => ({
      fips: c.fips,
      name: c.name,
      state: c.state,
      url: c.bestUrl,
      layerName: c.bestLayerName,
      score: Math.round(c.combinedScore),
    })),
  };

  const outputPath = join(process.cwd(), 'src/agents/data/council-district-candidates.json');
  writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`\n📊 Full analysis exported to: ${outputPath}`);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Current registry:      ${existingFips.size} cities`);
  console.log(`  High-conf candidates:  +${highConf.length} cities`);
  console.log(`  Medium-conf candidates: +${medConf.length} cities`);
  console.log(`  Potential total:       ${existingFips.size + highConf.length + medConf.length} cities`);
}

main().catch(console.error);
