#!/usr/bin/env npx tsx
/**
 * Top 50 US Cities Council District Coverage Analysis
 *
 * Analyzes attributed-council-districts.json to identify:
 * 1. Which top 50 cities have discovery pointers
 * 2. Layer confidence scores
 * 3. Gaps requiring manual curation
 *
 * Run: npx tsx scripts/analyze-top50-coverage.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Top 50 US cities by population (2024 Census estimates)
const TOP_50_CITIES = [
  { rank: 1, name: 'New York', state: 'NY', population: 8336817, councilSize: 51 },
  { rank: 2, name: 'Los Angeles', state: 'CA', population: 3979576, councilSize: 15 },
  { rank: 3, name: 'Chicago', state: 'IL', population: 2693976, councilSize: 50 },
  { rank: 4, name: 'Houston', state: 'TX', population: 2304580, councilSize: 16 },
  { rank: 5, name: 'Phoenix', state: 'AZ', population: 1608139, councilSize: 8 },
  { rank: 6, name: 'Philadelphia', state: 'PA', population: 1576251, councilSize: 10 },
  { rank: 7, name: 'San Antonio', state: 'TX', population: 1532233, councilSize: 10 },
  { rank: 8, name: 'San Diego', state: 'CA', population: 1423851, councilSize: 9 },
  { rank: 9, name: 'Dallas', state: 'TX', population: 1306707, councilSize: 14 },
  { rank: 10, name: 'San Jose', state: 'CA', population: 1013240, councilSize: 10 },
  { rank: 11, name: 'Austin', state: 'TX', population: 978908, councilSize: 10 },
  { rank: 12, name: 'Jacksonville', state: 'FL', population: 954614, councilSize: 19 },
  { rank: 13, name: 'Fort Worth', state: 'TX', population: 938029, councilSize: 9 },
  { rank: 14, name: 'Columbus', state: 'OH', population: 905748, councilSize: 7 },
  { rank: 15, name: 'Charlotte', state: 'NC', population: 879709, councilSize: 7 },
  { rank: 16, name: 'Indianapolis', state: 'IN', population: 887642, councilSize: 25 },
  { rank: 17, name: 'San Francisco', state: 'CA', population: 873965, councilSize: 11 },
  { rank: 18, name: 'Seattle', state: 'WA', population: 749256, councilSize: 7 },
  { rank: 19, name: 'Denver', state: 'CO', population: 715522, councilSize: 13 },
  { rank: 20, name: 'Washington', state: 'DC', population: 689545, councilSize: 8 },
  { rank: 21, name: 'Boston', state: 'MA', population: 675647, councilSize: 13 },
  { rank: 22, name: 'El Paso', state: 'TX', population: 678815, councilSize: 8 },
  { rank: 23, name: 'Nashville', state: 'TN', population: 689447, councilSize: 40 },
  { rank: 24, name: 'Detroit', state: 'MI', population: 639111, councilSize: 7 },
  { rank: 25, name: 'Oklahoma City', state: 'OK', population: 681054, councilSize: 8 },
  { rank: 26, name: 'Portland', state: 'OR', population: 652503, councilSize: 5 },
  { rank: 27, name: 'Las Vegas', state: 'NV', population: 660929, councilSize: 6 },
  { rank: 28, name: 'Memphis', state: 'TN', population: 633104, councilSize: 13 },
  { rank: 29, name: 'Louisville', state: 'KY', population: 622930, councilSize: 26 },
  { rank: 30, name: 'Baltimore', state: 'MD', population: 585708, councilSize: 14 },
  { rank: 31, name: 'Milwaukee', state: 'WI', population: 577222, councilSize: 15 },
  { rank: 32, name: 'Albuquerque', state: 'NM', population: 564559, councilSize: 9 },
  { rank: 33, name: 'Tucson', state: 'AZ', population: 542629, councilSize: 6 },
  { rank: 34, name: 'Fresno', state: 'CA', population: 542107, councilSize: 7 },
  { rank: 35, name: 'Sacramento', state: 'CA', population: 524943, councilSize: 8 },
  { rank: 36, name: 'Mesa', state: 'AZ', population: 511648, councilSize: 6 },
  { rank: 37, name: 'Atlanta', state: 'GA', population: 498715, councilSize: 12 },
  { rank: 38, name: 'Kansas City', state: 'MO', population: 508090, councilSize: 6 },
  { rank: 39, name: 'Colorado Springs', state: 'CO', population: 478961, councilSize: 9 },
  { rank: 40, name: 'Omaha', state: 'NE', population: 485616, councilSize: 7 },
  { rank: 41, name: 'Raleigh', state: 'NC', population: 467665, councilSize: 8 },
  { rank: 42, name: 'Miami', state: 'FL', population: 439890, councilSize: 5 },
  { rank: 43, name: 'Long Beach', state: 'CA', population: 466742, councilSize: 9 },
  { rank: 44, name: 'Virginia Beach', state: 'VA', population: 459470, councilSize: 10 },
  { rank: 45, name: 'Oakland', state: 'CA', population: 433031, councilSize: 7 },
  { rank: 46, name: 'Minneapolis', state: 'MN', population: 425115, councilSize: 13 },
  { rank: 47, name: 'Tulsa', state: 'OK', population: 413066, councilSize: 9 },
  { rank: 48, name: 'Tampa', state: 'FL', population: 392890, councilSize: 7 },
  { rank: 49, name: 'Arlington', state: 'TX', population: 394266, councilSize: 8 },
  { rank: 50, name: 'Wichita', state: 'KS', population: 397532, councilSize: 6 },
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
  metadata: {
    totalProcessed: number;
    resolvedCount: number;
  };
  resolved: AttributedLayer[];
}

// Council district name patterns
const COUNCIL_PATTERNS = [
  /council[_\s]*district/i,
  /city[_\s]*council/i,
  /ward/i,
  /aldermanic/i,
  /commissioner[_\s]*district/i,
];

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
];

function scoreLayerName(name: string): number {
  // Check negative patterns first
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(name)) return 0;
  }

  // Score positive patterns
  let score = 0;
  for (const pattern of COUNCIL_PATTERNS) {
    if (pattern.test(name)) score += 30;
  }

  // Bonus for explicit "council districts"
  if (/council\s*districts?$/i.test(name)) score += 20;

  return Math.min(score, 100);
}

function analyzeCity(
  city: typeof TOP_50_CITIES[0],
  layers: AttributedLayer[]
): {
  discovered: boolean;
  layerCount: number;
  bestLayer: AttributedLayer | null;
  bestScore: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  issues: string[];
} {
  // Find layers attributed to this city
  const cityLayers = layers.filter(
    (l) =>
      l.resolution.name.toLowerCase() === city.name.toLowerCase() &&
      l.resolution.state === city.state
  );

  if (cityLayers.length === 0) {
    return {
      discovered: false,
      layerCount: 0,
      bestLayer: null,
      bestScore: 0,
      confidence: 'none',
      issues: ['No discovery pointers found'],
    };
  }

  // Score each layer
  const scoredLayers = cityLayers.map((layer) => ({
    layer,
    nameScore: scoreLayerName(layer.name),
    combinedScore: scoreLayerName(layer.name) * 0.6 + layer.resolution.confidence * 0.4,
  }));

  // Sort by combined score
  scoredLayers.sort((a, b) => b.combinedScore - a.combinedScore);

  const best = scoredLayers[0];
  const issues: string[] = [];

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' | 'none';

  if (best.combinedScore >= 60 && best.layer.resolution.confidence >= 75) {
    confidence = 'high';
  } else if (best.combinedScore >= 40 && best.layer.resolution.confidence >= 60) {
    confidence = 'medium';
  } else if (best.combinedScore >= 20) {
    confidence = 'low';
    issues.push(`Low name match score: ${best.nameScore}`);
  } else {
    confidence = 'low';
    issues.push('No layers match council district patterns');
  }

  // Check for potential duplicates or wrong layer types
  if (best.nameScore === 0) {
    issues.push(`Best layer "${best.layer.name}" doesn't match council patterns`);
  }

  return {
    discovered: true,
    layerCount: cityLayers.length,
    bestLayer: best.layer,
    bestScore: best.combinedScore,
    confidence,
    issues,
  };
}

async function main(): Promise<void> {
  const dataPath = join(
    process.cwd(),
    'src/agents/data/attributed-council-districts.json'
  );

  console.log('Loading attributed council districts...');
  const data: AttributedData = JSON.parse(readFileSync(dataPath, 'utf-8'));

  console.log(`Total discovered layers: ${data.resolved.length}\n`);

  // Analyze each city
  const results = TOP_50_CITIES.map((city) => ({
    city,
    analysis: analyzeCity(city, data.resolved),
  }));

  // Summary tables
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                    TOP 50 CITIES COVERAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // High confidence cities
  const highConf = results.filter((r) => r.analysis.confidence === 'high');
  console.log(`\n✅ HIGH CONFIDENCE (${highConf.length} cities):`);
  console.log('─'.repeat(80));
  for (const { city, analysis } of highConf) {
    console.log(
      `  ${city.rank.toString().padStart(2)}. ${city.name.padEnd(20)} ${city.state} | ` +
        `${analysis.layerCount} layers | Best: "${analysis.bestLayer?.name}" (${analysis.bestScore.toFixed(0)})`
    );
  }

  // Medium confidence cities
  const medConf = results.filter((r) => r.analysis.confidence === 'medium');
  console.log(`\n⚠️  MEDIUM CONFIDENCE (${medConf.length} cities):`);
  console.log('─'.repeat(80));
  for (const { city, analysis } of medConf) {
    console.log(
      `  ${city.rank.toString().padStart(2)}. ${city.name.padEnd(20)} ${city.state} | ` +
        `${analysis.layerCount} layers | Best: "${analysis.bestLayer?.name}" (${analysis.bestScore.toFixed(0)})`
    );
  }

  // Low confidence cities
  const lowConf = results.filter((r) => r.analysis.confidence === 'low');
  console.log(`\n⚡ LOW CONFIDENCE (${lowConf.length} cities) - need manual review:`);
  console.log('─'.repeat(80));
  for (const { city, analysis } of lowConf) {
    const layerInfo = analysis.bestLayer
      ? `"${analysis.bestLayer.name}" (${analysis.bestScore.toFixed(0)})`
      : 'No matching layers';
    console.log(
      `  ${city.rank.toString().padStart(2)}. ${city.name.padEnd(20)} ${city.state} | ` +
        `${analysis.layerCount} layers | ${layerInfo}`
    );
    for (const issue of analysis.issues) {
      console.log(`      └─ ${issue}`);
    }
  }

  // Missing cities
  const missing = results.filter((r) => r.analysis.confidence === 'none');
  console.log(`\n❌ MISSING (${missing.length} cities) - no discovery pointers:`);
  console.log('─'.repeat(80));
  for (const { city } of missing) {
    console.log(
      `  ${city.rank.toString().padStart(2)}. ${city.name.padEnd(20)} ${city.state} | ` +
        `Expected ${city.councilSize} districts`
    );
  }

  // Summary statistics
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  High Confidence:    ${highConf.length}/50 cities (${((highConf.length / 50) * 100).toFixed(0)}%)`);
  console.log(`  Medium Confidence:  ${medConf.length}/50 cities (${((medConf.length / 50) * 100).toFixed(0)}%)`);
  console.log(`  Low Confidence:     ${lowConf.length}/50 cities (${((lowConf.length / 50) * 100).toFixed(0)}%)`);
  console.log(`  Missing:            ${missing.length}/50 cities (${((missing.length / 50) * 100).toFixed(0)}%)`);
  console.log('');
  console.log(`  Total Population in High+Medium: ${(highConf.concat(medConf).reduce((sum, r) => sum + r.city.population, 0) / 1e6).toFixed(1)}M`);
  console.log(`  Total Population Missing:        ${(missing.reduce((sum, r) => sum + r.city.population, 0) / 1e6).toFixed(1)}M`);

  // Export actionable data
  const actionable = {
    timestamp: new Date().toISOString(),
    summary: {
      highConfidence: highConf.length,
      mediumConfidence: medConf.length,
      lowConfidence: lowConf.length,
      missing: missing.length,
    },
    highConfidenceCities: highConf.map((r) => ({
      rank: r.city.rank,
      name: r.city.name,
      state: r.city.state,
      councilSize: r.city.councilSize,
      bestLayerUrl: r.analysis.bestLayer?.url,
      bestLayerName: r.analysis.bestLayer?.name,
      score: r.analysis.bestScore,
    })),
    missingCities: missing.map((r) => ({
      rank: r.city.rank,
      name: r.city.name,
      state: r.city.state,
      councilSize: r.city.councilSize,
      population: r.city.population,
    })),
    lowConfidenceCities: lowConf.map((r) => ({
      rank: r.city.rank,
      name: r.city.name,
      state: r.city.state,
      issues: r.analysis.issues,
      layerCount: r.analysis.layerCount,
    })),
  };

  const outputPath = join(process.cwd(), 'src/agents/data/top50-coverage-analysis.json');
  const { writeFileSync } = await import('fs');
  writeFileSync(outputPath, JSON.stringify(actionable, null, 2));
  console.log(`\n📊 Detailed analysis written to: ${outputPath}`);
}

main().catch(console.error);
