#!/usr/bin/env npx tsx
/**
 * Validated Bulk Council District Ingestion
 *
 * ARCHITECTURE:
 * Uses the unified IngestionValidator to validate candidates BEFORE manual merge.
 * Supports configurable validation tiers (STRUCTURE → SANITY → FULL).
 *
 * VALIDATION TIERS:
 *   --tier=structure  : HTTP fetch + GeoJSON structure only (~1-2s/city)
 *   --tier=sanity     : + Pre-validation sanity checks (~10ms additional)
 *   --tier=full       : + Tessellation proof (~500-2000ms additional)
 *
 * USAGE:
 *   npx tsx scripts/validated-bulk-ingest.ts                    # Default: SANITY tier
 *   npx tsx scripts/validated-bulk-ingest.ts --tier=full        # Full tessellation proof
 *   npx tsx scripts/validated-bulk-ingest.ts --medium           # Include medium confidence
 *   npx tsx scripts/validated-bulk-ingest.ts --concurrency=10   # Parallel workers
 *
 * OUTPUT:
 *   - src/agents/data/validated-bulk-entries.ts  : Entries ready for manual merge
 *   - src/agents/data/bulk-validation-report.json : Full diagnostics
 *
 * PATTERNS PRESERVED:
 *   - Never auto-modifies known-portals.ts (human review required)
 *   - Quarantine check prevents re-testing known-bad entries
 *   - At-large check skips cities without geographic districts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
  IngestionValidator,
  ValidationTier,
  AuthorityLevel,
  type IngestionValidationResult,
  type BatchValidationSummary,
} from '../src/validators/council/index.js';
import { KNOWN_PORTALS } from '../src/core/registry/known-portals.js';

// FIPS corrections for county → city mapping (must match ingestion-validator.ts)
const FIPS_CORRECTIONS: Record<string, string> = {
  '35057': '3525800',  // Torrance County → Farmington city, NM
  '41059': '4133700',  // Umatilla County → Hermiston city, OR
  '15003': '1571550',  // Honolulu County → Urban Honolulu CDP, HI
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface Candidate {
  fips: string;
  name: string;
  state: string;
  url: string;
  layerName: string;
  score: number;
  geoConfidence?: number;
  nameScore?: number;
}

interface CandidatesData {
  generatedAt: string;
  summary: {
    highConfidence: number;
    mediumConfidence: number;
  };
  highConfidenceCandidates: Candidate[];
  mediumConfidenceCandidates: Candidate[];
}

interface Config {
  tier: ValidationTier;
  includeMedium: boolean;
  concurrency: number;
  outputDir: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI PARSING
// ═══════════════════════════════════════════════════════════════════════════

function parseArgs(): Config {
  const args = process.argv.slice(2);

  let tier = ValidationTier.SANITY;
  let includeMedium = false;
  let concurrency = 5;

  for (const arg of args) {
    if (arg.startsWith('--tier=')) {
      const value = arg.split('=')[1].toLowerCase();
      if (value === 'structure') tier = ValidationTier.STRUCTURE;
      else if (value === 'sanity') tier = ValidationTier.SANITY;
      else if (value === 'full') tier = ValidationTier.FULL;
    }
    if (arg === '--medium') includeMedium = true;
    if (arg.startsWith('--concurrency=')) {
      concurrency = parseInt(arg.split('=')[1], 10) || 5;
    }
  }

  return {
    tier,
    includeMedium,
    concurrency,
    outputDir: join(process.cwd(), 'src/agents/data'),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// URL BUILDER
// ═══════════════════════════════════════════════════════════════════════════

function buildQueryUrl(baseUrl: string): string {
  if (baseUrl.includes('query?') || baseUrl.includes('.geojson')) {
    return baseUrl;
  }
  return `${baseUrl}/query?where=1%3D1&outFields=*&f=geojson`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const config = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         VALIDATED BULK COUNCIL DISTRICT INGESTION              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Validation tier: ${config.tier.toUpperCase()}`);
  console.log(`Include medium confidence: ${config.includeMedium}`);
  console.log(`Concurrency: ${config.concurrency}\n`);

  // Load candidates
  const candidatesPath = join(process.cwd(), 'src/agents/data/council-district-candidates.json');
  if (!existsSync(candidatesPath)) {
    console.error(`Candidates file not found: ${candidatesPath}`);
    console.error('Run discovery first to generate candidates.');
    process.exit(1);
  }

  const candidatesData: CandidatesData = JSON.parse(readFileSync(candidatesPath, 'utf-8'));
  console.log(`Candidates file: ${candidatesPath}`);
  console.log(`  High confidence: ${candidatesData.summary.highConfidence}`);
  console.log(`  Medium confidence: ${candidatesData.summary.mediumConfidence}\n`);

  // Build candidate list
  let candidates = [...candidatesData.highConfidenceCandidates];
  if (config.includeMedium) {
    candidates = [...candidates, ...candidatesData.mediumConfidenceCandidates];
  }

  // Apply FIPS corrections before registry check
  // This ensures county→city corrections are considered when filtering
  const correctedCandidates = candidates.map((c) => ({
    ...c,
    fips: FIPS_CORRECTIONS[c.fips] ?? c.fips,
    originalFips: c.fips,
  }));

  // Filter out already-known portals (using corrected FIPS)
  const existingFips = new Set(Object.keys(KNOWN_PORTALS));
  const newCandidates = correctedCandidates.filter((c) => !existingFips.has(c.fips));

  console.log(`Total candidates: ${candidates.length}`);
  console.log(`Already in registry: ${candidates.length - newCandidates.length}`);
  console.log(`New candidates to validate: ${newCandidates.length}\n`);

  if (newCandidates.length === 0) {
    console.log('No new candidates to validate. Exiting.');
    return;
  }

  // Prepare validation inputs
  const validationInputs = newCandidates.map((c) => ({
    fips: c.fips,
    url: buildQueryUrl(c.url),
    authorityLevel: scoreToAuthorityLevel(c.score),
  }));

  // Run validation
  console.log('Starting validation...\n');
  const startTime = Date.now();

  const validator = new IngestionValidator();
  const results = await validator.validateBatch(
    validationInputs,
    { tier: config.tier },
    config.concurrency
  );

  const summary = validator.summarizeBatch(results);
  const elapsedMs = Date.now() - startTime;

  // Print results
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`Total validated: ${summary.totalCandidates}`);
  console.log(`  Passed: ${summary.passed} (${summary.passRate.toFixed(1)}%)`);
  console.log(`  Failed: ${summary.failed} (${(100 - summary.passRate).toFixed(1)}%)`);
  console.log(`  Avg time: ${summary.avgProcessingTimeMs}ms/city`);
  console.log(`  Total time: ${(elapsedMs / 1000).toFixed(1)}s\n`);

  console.log('Failures by stage:');
  for (const [stage, count] of Object.entries(summary.failuresByStage)) {
    console.log(`  ${stage}: ${count}`);
  }

  console.log('\nAchieved tier distribution:');
  console.log(`  STRUCTURE: ${summary.byTier.structure}`);
  console.log(`  SANITY: ${summary.byTier.sanity}`);
  console.log(`  FULL: ${summary.byTier.full}`);

  // Generate outputs
  const passedEntries = Array.from(results.entries())
    .filter(([_, r]) => r.valid)
    .map(([fips, result]) => {
      const candidate = newCandidates.find((c) => c.fips === fips)!;
      return {
        fips,
        cityName: result.city.name ?? candidate.name,
        state: result.city.state ?? candidate.state,
        url: buildQueryUrl(candidate.url),
        featureCount: result.featureCount.actual,
        confidence: candidate.score,
        authorityLevel: result.authorityLevel,
        validationTier: result.achievedTier,
        layerName: candidate.layerName,
      };
    });

  // Write validated entries
  ensureDir(config.outputDir);

  const entriesContent = generateEntriesFile(passedEntries);
  const entriesPath = join(config.outputDir, 'validated-bulk-entries.ts');
  writeFileSync(entriesPath, entriesContent, 'utf-8');
  console.log(`\nWrote ${passedEntries.length} validated entries to: ${entriesPath}`);

  // Write full report
  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      tier: config.tier,
      includeMedium: config.includeMedium,
      concurrency: config.concurrency,
    },
    summary,
    elapsedMs,
    passedEntries,
    failedCities: summary.failedCities,
    detailedResults: Object.fromEntries(
      Array.from(results.entries()).map(([fips, r]) => [
        fips,
        {
          valid: r.valid,
          failureStage: r.failureStage,
          achievedTier: r.achievedTier,
          status: r.status,
          remediation: r.remediation,
          featureCount: r.featureCount,
          processingTimeMs: r.processingTimeMs,
        },
      ])
    ),
  };

  const reportPath = join(config.outputDir, 'bulk-validation-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`Wrote validation report to: ${reportPath}`);

  // Print failed cities (first 10)
  if (summary.failedCities.length > 0) {
    console.log('\n── FAILED CITIES (first 10) ──');
    for (const city of summary.failedCities.slice(0, 10)) {
      console.log(`  ${city.name ?? city.fips} (${city.fips})`);
      console.log(`    Stage: ${city.stage}`);
      console.log(`    Reason: ${city.reason.slice(0, 80)}...`);
    }
    if (summary.failedCities.length > 10) {
      console.log(`  ... and ${summary.failedCities.length - 10} more (see report)`);
    }
  }

  console.log('\n── NEXT STEPS ──');
  console.log('1. Review validated-bulk-entries.ts');
  console.log('2. Manually merge approved entries into known-portals.ts');
  console.log('3. Run: npx tsx scripts/run-tessellation-validation.ts');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function scoreToAuthorityLevel(score: number): AuthorityLevel {
  // Map discovery score to authority level
  if (score >= 90) return AuthorityLevel.MUNICIPAL_OFFICIAL;
  if (score >= 70) return AuthorityLevel.COMMERCIAL_AGGREGATOR;
  if (score >= 50) return AuthorityLevel.COMMUNITY_MAINTAINED;
  return AuthorityLevel.UNKNOWN;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

interface ValidatedEntry {
  fips: string;
  cityName: string;
  state: string;
  url: string;
  featureCount: number;
  confidence: number;
  authorityLevel: AuthorityLevel;
  validationTier: string | null;
  layerName: string;
}

function generateEntriesFile(entries: ValidatedEntry[]): string {
  const lines = [
    '/**',
    ' * Validated Bulk Ingestion Entries',
    ' *',
    ` * Generated: ${new Date().toISOString()}`,
    ` * Total entries: ${entries.length}`,
    ' *',
    ' * USAGE: Review and merge into known-portals.ts',
    ' */',
    '',
    "import type { KnownPortal } from '../../core/registry/known-portals.js';",
    '',
    'export const VALIDATED_ENTRIES: Record<string, KnownPortal> = {',
  ];

  for (const entry of entries) {
    lines.push(`  '${entry.fips}': {`);
    lines.push(`    cityFips: '${entry.fips}',`);
    lines.push(`    cityName: '${escapeString(entry.cityName)}',`);
    lines.push(`    state: '${entry.state}',`);
    lines.push(`    portalType: 'arcgis',`);
    lines.push(`    downloadUrl: '${escapeString(entry.url)}',`);
    lines.push(`    featureCount: ${entry.featureCount},`);
    lines.push(`    lastVerified: '${new Date().toISOString()}',`);
    lines.push(`    confidence: ${entry.confidence},`);
    lines.push(`    discoveredBy: 'automated',`);
    lines.push(`    notes: '${escapeString(entry.layerName)} - validated at ${entry.validationTier} tier',`);
    lines.push('  },');
    lines.push('');
  }

  lines.push('};');
  lines.push('');
  lines.push(`export const VALIDATED_ENTRY_COUNT = ${entries.length};`);
  lines.push('');

  return lines.join('\n');
}

function escapeString(s: string): string {
  return s.replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
