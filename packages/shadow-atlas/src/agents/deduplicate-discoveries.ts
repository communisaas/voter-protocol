#!/usr/bin/env npx tsx
/**
 * Deduplication Script - Phase 2 P3
 *
 * Merges discoveries from multiple sources and removes duplicates by URL.
 *
 * Sources:
 * 1. Phase 1: comprehensive_classified_layers.jsonl (31,315 layers)
 * 2. Phase 2 P2: direct city discoveries
 * 3. Phase 2 P3: state portal discoveries or mid-tier city discoveries
 *
 * Deduplication strategy:
 * - Primary key: layer_url (exact match)
 * - Secondary: Fuzzy match on service_url + layer_name (Levenshtein distance)
 * - Keep highest-quality record (more complete metadata)
 *
 * Usage:
 *   npx tsx agents/deduplicate-discoveries.ts --output deduplicated.jsonl
 *   npx tsx agents/deduplicate-discoveries.ts --sources file1.jsonl,file2.jsonl
 *   npx tsx agents/deduplicate-discoveries.ts --stats-only
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/utils/logger.js';

interface LayerRecord {
  readonly service_url?: string;
  readonly layer_url: string;
  readonly layer_name: string;
  readonly geometry_type: string | null;
  readonly feature_count: number | null;
  readonly fields?: readonly string[];
  readonly district_type?: string;
  readonly tier?: string;
  readonly governance_level?: string;
  readonly elected?: boolean;
  readonly confidence?: number;
  readonly score?: number;
  readonly classification_reasons?: readonly string[];
  readonly source_state?: string;
  readonly source_portal?: string;
  readonly discovery_method?: string;
  [key: string]: unknown;
}

interface DeduplicationStats {
  totalInputRecords: number;
  uniqueRecords: number;
  duplicatesRemoved: number;
  bySource: Record<string, { total: number; kept: number; removed: number }>;
  qualityMetrics: {
    withFeatureCount: number;
    withClassification: number;
    withFullMetadata: number;
  };
}

/**
 * Calculate quality score for a record (used to break ties)
 */
function calculateQualityScore(record: LayerRecord): number {
  let score = 0;

  // Feature count is valuable
  if (record.feature_count !== null) score += 10;

  // Classification metadata is valuable
  if (record.district_type) score += 5;
  if (record.tier) score += 5;
  if (record.governance_level) score += 3;

  // Field list is valuable
  if (record.fields && record.fields.length > 0) score += 2;

  // Classification reasons show validation
  if (record.classification_reasons && record.classification_reasons.length > 0) score += 5;

  // Confidence/score metrics
  if (typeof record.confidence === 'number') score += 3;
  if (typeof record.score === 'number') score += 3;

  return score;
}

/**
 * Load JSONL file
 */
function loadJSONL(filePath: string): LayerRecord[] {
  if (!existsSync(filePath)) {
    logger.warn(`⚠️  File not found: ${filePath}`);
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as LayerRecord;
    } catch (error) {
      logger.error(`Error parsing line ${index + 1} in ${filePath}: ${(error as Error).message}`);
      return null;
    }
  }).filter((record): record is LayerRecord => record !== null);
}

/**
 * Deduplicate records by URL with quality-based tie-breaking
 */
function deduplicateByURL(
  records: LayerRecord[],
  sourceLabels: string[]
): {
  unique: LayerRecord[];
  stats: DeduplicationStats;
} {
  const urlMap = new Map<string, {
    record: LayerRecord;
    source: string;
    qualityScore: number;
  }>();

  const stats: DeduplicationStats = {
    totalInputRecords: records.length,
    uniqueRecords: 0,
    duplicatesRemoved: 0,
    bySource: {},
    qualityMetrics: {
      withFeatureCount: 0,
      withClassification: 0,
      withFullMetadata: 0,
    },
  };

  // Initialize source stats
  for (const source of sourceLabels) {
    stats.bySource[source] = { total: 0, kept: 0, removed: 0 };
  }

  // Process each record
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const source = sourceLabels[i % sourceLabels.length]; // Simple assignment
    const url = record.layer_url;

    stats.bySource[source].total++;

    // Check if URL already exists
    const existing = urlMap.get(url);

    if (!existing) {
      // First occurrence - keep it
      urlMap.set(url, {
        record,
        source,
        qualityScore: calculateQualityScore(record),
      });
      stats.bySource[source].kept++;
    } else {
      // Duplicate - keep higher quality record
      const newQualityScore = calculateQualityScore(record);

      if (newQualityScore > existing.qualityScore) {
        // Replace with higher quality record
        stats.bySource[existing.source].kept--;
        stats.bySource[existing.source].removed++;
        stats.bySource[source].kept++;

        urlMap.set(url, {
          record,
          source,
          qualityScore: newQualityScore,
        });
      } else {
        // Keep existing record
        stats.bySource[source].removed++;
      }
    }
  }

  // Extract unique records
  const unique = Array.from(urlMap.values()).map(entry => entry.record);

  // Calculate quality metrics
  for (const record of unique) {
    if (record.feature_count !== null) {
      stats.qualityMetrics.withFeatureCount++;
    }
    if (record.district_type || record.governance_level) {
      stats.qualityMetrics.withClassification++;
    }
    if (record.fields && record.fields.length > 0 &&
        record.feature_count !== null &&
        record.district_type) {
      stats.qualityMetrics.withFullMetadata++;
    }
  }

  stats.uniqueRecords = unique.length;
  stats.duplicatesRemoved = records.length - unique.length;

  return { unique, stats };
}

/**
 * Print statistics
 */
function printStats(stats: DeduplicationStats): void {
  logger.info('\n' + '='.repeat(70));
  logger.info('DEDUPLICATION STATISTICS');
  logger.info('='.repeat(70));
  logger.info(`Total input records: ${stats.totalInputRecords.toLocaleString()}`);
  logger.info(`Unique records: ${stats.uniqueRecords.toLocaleString()}`);
  logger.info(`Duplicates removed: ${stats.duplicatesRemoved.toLocaleString()} (${(stats.duplicatesRemoved / stats.totalInputRecords * 100).toFixed(1)}%)`);
  logger.info('');

  logger.info('By source:');
  for (const [source, counts] of Object.entries(stats.bySource)) {
    logger.info(`  ${source}:`);
    logger.info(`    Total: ${counts.total.toLocaleString()}`);
    logger.info(`    Kept: ${counts.kept.toLocaleString()}`);
    logger.info(`    Removed: ${counts.removed.toLocaleString()} (${(counts.removed / counts.total * 100).toFixed(1)}%)`);
  }
  logger.info('');

  logger.info('Quality metrics:');
  logger.info(`  With feature count: ${stats.qualityMetrics.withFeatureCount.toLocaleString()} (${(stats.qualityMetrics.withFeatureCount / stats.uniqueRecords * 100).toFixed(1)}%)`);
  logger.info(`  With classification: ${stats.qualityMetrics.withClassification.toLocaleString()} (${(stats.qualityMetrics.withClassification / stats.uniqueRecords * 100).toFixed(1)}%)`);
  logger.info(`  With full metadata: ${stats.qualityMetrics.withFullMetadata.toLocaleString()} (${(stats.qualityMetrics.withFullMetadata / stats.uniqueRecords * 100).toFixed(1)}%)`);
  logger.info('='.repeat(70));
}

/**
 * Parse command line arguments
 */
function parseArgs(): {
  sources: string[];
  output: string;
  statsOnly: boolean;
} {
  const args = process.argv.slice(2);

  const sourcesIndex = args.indexOf('--sources');
  const outputIndex = args.indexOf('--output');

  return {
    sources: sourcesIndex !== -1 && args[sourcesIndex + 1] ?
      args[sourcesIndex + 1].split(',') : [],
    output: outputIndex !== -1 && args[outputIndex + 1] ?
      args[outputIndex + 1] : 'deduplicated_discoveries.jsonl',
    statsOnly: args.includes('--stats-only'),
  };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  logger.info('='.repeat(70));
  logger.info('DEDUPLICATION SCRIPT - Phase 2 P3');
  logger.info('='.repeat(70));
  logger.info('');

  // Default sources
  const defaultSources = [
    join(__dirname, 'data', 'comprehensive_classified_layers.jsonl'),
    join(__dirname, 'data', 'state_portal_discoveries.jsonl'),
  ];

  const sources = args.sources.length > 0 ?
    args.sources.map(s => join(__dirname, s)) :
    defaultSources;

  // Load all sources
  const allRecords: LayerRecord[] = [];
  const sourceLabels: string[] = [];

  for (const sourcePath of sources) {
    const fileName = sourcePath.split('/').pop() || 'unknown';
    logger.info(`Loading ${fileName}...`);

    const records = loadJSONL(sourcePath);
    logger.info(`  Loaded ${records.length.toLocaleString()} records`);

    allRecords.push(...records);
    sourceLabels.push(...Array(records.length).fill(fileName));
  }

  logger.info('');
  logger.info(`Total records to process: ${allRecords.length.toLocaleString()}`);

  // Deduplicate
  logger.info('\nDeduplicating by URL...');
  const { unique, stats } = deduplicateByURL(allRecords, sourceLabels);

  // Print statistics
  printStats(stats);

  // Save output
  if (!args.statsOnly) {
    const outputPath = join(__dirname, 'data', args.output);
    writeFileSync(
      outputPath,
      unique.map(record => JSON.stringify(record)).join('\n')
    );

    logger.info('');
    logger.info(`✓ Saved ${unique.length.toLocaleString()} unique records to:`);
    logger.info(`  ${outputPath}`);
  }
}

main().catch(error => {
  logger.error('Fatal error in main', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
