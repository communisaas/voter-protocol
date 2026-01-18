#!/usr/bin/env npx tsx
/**
 * WS-1: Quarantine Suspicious Registry Entries
 *
 * PURPOSE: Identifies and quarantines known-portal entries with suspicious URL patterns
 * that suggest wrong data layers (pavement, sewer, parcels, etc.) rather than council districts.
 *
 * CLASSIFICATION:
 * - DEFINITE_WRONG_DATA: Quarantine immediately (pavement, road centerlines, sewer, utility, etc.)
 * - REQUIRES_REVIEW: Flag but keep (census, precinct, election, voting - may be valid related data)
 *
 * OUTPUT:
 * - Generates quarantined-portals.ts with entries to remove
 * - Prints summary statistics
 * - Does NOT modify known-portals.ts (that's a separate step after review)
 */

import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// PATTERN DEFINITIONS
// =============================================================================

/**
 * Patterns that DEFINITELY indicate wrong data layers
 * These should be quarantined immediately
 */
const DEFINITE_WRONG_DATA_PATTERNS = [
  { pattern: /pavement/i, label: 'pavement', reason: 'Pavement condition data, not council districts' },
  { pattern: /road(?!.*district)/i, label: 'road', reason: 'Road/street infrastructure data' },
  { pattern: /street.*centerline/i, label: 'street-centerline', reason: 'Street centerline GIS data' },
  { pattern: /utility/i, label: 'utility', reason: 'Utility infrastructure data' },
  { pattern: /sewer/i, label: 'sewer', reason: 'Sewer infrastructure data' },
  { pattern: /water.*main/i, label: 'water-main', reason: 'Water main infrastructure data' },
  { pattern: /zoning/i, label: 'zoning', reason: 'Zoning district data, not council districts' },
  { pattern: /parcel/i, label: 'parcel', reason: 'Property parcel data' },
  { pattern: /tax(?!.*district)/i, label: 'tax', reason: 'Tax/assessment data' },
  { pattern: /property(?!.*district)/i, label: 'property', reason: 'Property/real estate data' },
  { pattern: /flood/i, label: 'flood', reason: 'Flood zone/FEMA data' },
];

/**
 * Patterns that REQUIRE human review
 * These might be valid (e.g., "voting district" could mean council ward)
 * or might be wrong (e.g., pure precinct data)
 */
const REQUIRES_REVIEW_PATTERNS = [
  { pattern: /census(?!.*district)/i, label: 'census', reason: 'Census tract/block data - may not be council districts' },
  { pattern: /tract/i, label: 'tract', reason: 'Census tract data - may not be council districts' },
  { pattern: /precinct(?!.*council)/i, label: 'precinct', reason: 'Voting precinct data - may be valid or may be wrong layer' },
  { pattern: /police(?!.*council)/i, label: 'police', reason: 'Police district data - different from council districts' },
  { pattern: /fire(?!.*council)/i, label: 'fire', reason: 'Fire district data - different from council districts' },
  { pattern: /school(?!.*council)/i, label: 'school', reason: 'School district data - different from council districts' },
  { pattern: /election(?!.*council)/i, label: 'election', reason: 'Election district data - may or may not be council wards' },
  { pattern: /voting(?!.*council)/i, label: 'voting', reason: 'Voting district data - may or may not be council wards' },
];

// =============================================================================
// TYPES
// =============================================================================

interface QuarantinedEntry extends KnownPortal {
  /** Why this entry was quarantined */
  quarantineReason: string;
  /** Pattern that triggered quarantine */
  matchedPattern: string;
  /** Classification level */
  classification: 'DEFINITE_WRONG_DATA' | 'REQUIRES_REVIEW';
}

interface AnalysisResult {
  quarantined: QuarantinedEntry[];
  flaggedForReview: QuarantinedEntry[];
  clean: KnownPortal[];
}

// =============================================================================
// ANALYSIS LOGIC
// =============================================================================

function analyzeEntry(fips: string, portal: KnownPortal): QuarantinedEntry | null {
  const urlLower = portal.downloadUrl.toLowerCase();

  // Check DEFINITE_WRONG_DATA patterns first
  for (const { pattern, label, reason } of DEFINITE_WRONG_DATA_PATTERNS) {
    if (pattern.test(urlLower)) {
      return {
        ...portal,
        quarantineReason: reason,
        matchedPattern: label,
        classification: 'DEFINITE_WRONG_DATA',
      };
    }
  }

  // Check REQUIRES_REVIEW patterns
  for (const { pattern, label, reason } of REQUIRES_REVIEW_PATTERNS) {
    if (pattern.test(urlLower)) {
      return {
        ...portal,
        quarantineReason: reason,
        matchedPattern: label,
        classification: 'REQUIRES_REVIEW',
      };
    }
  }

  return null;
}

function analyzeAllEntries(): AnalysisResult {
  const result: AnalysisResult = {
    quarantined: [],
    flaggedForReview: [],
    clean: [],
  };

  for (const [fips, portal] of Object.entries(KNOWN_PORTALS)) {
    const analysis = analyzeEntry(fips, portal);

    if (analysis) {
      if (analysis.classification === 'DEFINITE_WRONG_DATA') {
        result.quarantined.push(analysis);
      } else {
        result.flaggedForReview.push(analysis);
      }
    } else {
      result.clean.push(portal);
    }
  }

  return result;
}

// =============================================================================
// OUTPUT GENERATION
// =============================================================================

function generateQuarantineFile(entries: QuarantinedEntry[]): string {
  const header = `/**
 * Quarantined Portal Entries
 *
 * PURPOSE: Entries removed from known-portals.ts due to suspicious URL patterns
 * suggesting wrong data layers (pavement conditions, sewer lines, etc.)
 *
 * GENERATED: ${new Date().toISOString()}
 * GENERATOR: scripts/quarantine-suspicious-entries.ts
 *
 * WORKFLOW:
 * 1. Script identifies suspicious patterns in URLs
 * 2. Entries moved here with documented rationale
 * 3. Human review can restore entries if they're actually valid
 * 4. After review, these can be permanently deleted or restored
 *
 * NOTE: These entries are NOT deleted - they're quarantined for potential restoration
 */

import type { PortalType } from '../types/discovery.js';

/**
 * Quarantined portal entry with documented reason for removal
 */
export interface QuarantinedPortal {
  /** 7-digit Census PLACE FIPS code */
  readonly cityFips: string;

  /** City name (human-readable) */
  readonly cityName: string;

  /** State abbreviation (e.g., "TX", "WA") */
  readonly state: string;

  /** Portal type */
  readonly portalType: PortalType;

  /** Direct download URL (GeoJSON) */
  readonly downloadUrl: string;

  /** Number of districts/features */
  readonly featureCount: number;

  /** Last successful validation timestamp (ISO 8601) */
  readonly lastVerified: string;

  /** Validation confidence score (0-100) */
  readonly confidence: number;

  /** How this entry was discovered */
  readonly discoveredBy: 'manual' | 'automated' | 'pr-contribution' | string;

  /** Optional notes (for manual entries) */
  readonly notes?: string;

  /** WHY this entry was quarantined */
  readonly quarantineReason: string;

  /** Pattern that triggered quarantine (e.g., "pavement", "sewer") */
  readonly matchedPattern: string;

  /** When this entry was quarantined */
  readonly quarantinedAt: string;
}

/**
 * Quarantined portals (indexed by FIPS code)
 *
 * CLASSIFICATION: DEFINITE_WRONG_DATA
 * These entries have URLs clearly indicating wrong data layers
 */
export const QUARANTINED_PORTALS: Record<string, QuarantinedPortal> = {
`;

  const entries_code = entries
    .map((entry) => {
      const notes = entry.notes ? `\n    notes: ${JSON.stringify(entry.notes)},` : '';
      return `  '${entry.cityFips}': {
    cityFips: '${entry.cityFips}',
    cityName: '${entry.cityName}',
    state: '${entry.state}',
    portalType: '${entry.portalType}',
    downloadUrl: '${entry.downloadUrl}',
    featureCount: ${entry.featureCount},
    lastVerified: '${entry.lastVerified}',
    confidence: ${entry.confidence},
    discoveredBy: '${entry.discoveredBy}',${notes}
    quarantineReason: '${entry.quarantineReason}',
    matchedPattern: '${entry.matchedPattern}',
    quarantinedAt: '${new Date().toISOString()}',
  },`;
    })
    .join('\n\n');

  const footer = `
};

/**
 * Count of quarantined entries
 */
export const QUARANTINE_COUNT = ${entries.length};

/**
 * Quarantine summary by pattern
 */
export const QUARANTINE_SUMMARY = ${JSON.stringify(
    entries.reduce(
      (acc, e) => {
        acc[e.matchedPattern] = (acc[e.matchedPattern] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    null,
    2
  )};
`;

  return header + entries_code + footer;
}

function printSummary(result: AnalysisResult): void {
  const total = Object.keys(KNOWN_PORTALS).length;

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' WS-1: REGISTRY QUARANTINE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`Total entries analyzed: ${total}\n`);

  // Quarantined entries (DEFINITE_WRONG_DATA)
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(' QUARANTINED (DEFINITE_WRONG_DATA)');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(`Count: ${result.quarantined.length} entries\n`);

  // Group by pattern
  const quarantineByPattern = result.quarantined.reduce(
    (acc, e) => {
      if (!acc[e.matchedPattern]) acc[e.matchedPattern] = [];
      acc[e.matchedPattern].push(e);
      return acc;
    },
    {} as Record<string, QuarantinedEntry[]>
  );

  for (const [pattern, entries] of Object.entries(quarantineByPattern)) {
    console.log(`  [${pattern.toUpperCase()}] - ${entries.length} entries:`);
    for (const e of entries.slice(0, 5)) {
      console.log(`    - ${e.cityName}, ${e.state} (${e.cityFips})`);
      console.log(`      URL: ${e.downloadUrl.slice(0, 70)}...`);
    }
    if (entries.length > 5) {
      console.log(`    ... and ${entries.length - 5} more`);
    }
    console.log();
  }

  // Flagged for review (REQUIRES_REVIEW)
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(' FLAGGED FOR REVIEW (REQUIRES_REVIEW)');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(`Count: ${result.flaggedForReview.length} entries\n`);

  const reviewByPattern = result.flaggedForReview.reduce(
    (acc, e) => {
      if (!acc[e.matchedPattern]) acc[e.matchedPattern] = [];
      acc[e.matchedPattern].push(e);
      return acc;
    },
    {} as Record<string, QuarantinedEntry[]>
  );

  for (const [pattern, entries] of Object.entries(reviewByPattern)) {
    console.log(`  [${pattern.toUpperCase()}] - ${entries.length} entries:`);
    for (const e of entries.slice(0, 3)) {
      console.log(`    - ${e.cityName}, ${e.state} (${e.cityFips})`);
      console.log(`      Reason: ${e.quarantineReason}`);
    }
    if (entries.length > 3) {
      console.log(`    ... and ${entries.length - 3} more`);
    }
    console.log();
  }

  // Summary stats
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Total entries:        ${total}`);
  console.log(`  Quarantined:          ${result.quarantined.length} (${((result.quarantined.length / total) * 100).toFixed(1)}%)`);
  console.log(`  Flagged for review:   ${result.flaggedForReview.length} (${((result.flaggedForReview.length / total) * 100).toFixed(1)}%)`);
  console.log(`  Clean entries:        ${result.clean.length} (${((result.clean.length / total) * 100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  console.log('Analyzing registry entries...\n');

  const result = analyzeAllEntries();

  // Print summary to console
  printSummary(result);

  // Generate quarantine file (only DEFINITE_WRONG_DATA entries)
  if (result.quarantined.length > 0) {
    const fileContent = generateQuarantineFile(result.quarantined);
    const outputPath = path.join(
      import.meta.dirname || process.cwd(),
      '../src/core/registry/quarantined-portals.ts'
    );

    fs.writeFileSync(outputPath, fileContent, 'utf-8');
    console.log(`Quarantine file written to: ${outputPath}`);
    console.log(`Contains ${result.quarantined.length} entries for removal.\n`);
  } else {
    console.log('No entries need quarantining.\n');
  }

  // Generate review file (REQUIRES_REVIEW entries)
  if (result.flaggedForReview.length > 0) {
    const reviewPath = path.join(
      import.meta.dirname || process.cwd(),
      '../src/core/registry/review-needed-portals.json'
    );

    const reviewData = {
      generatedAt: new Date().toISOString(),
      count: result.flaggedForReview.length,
      note: 'These entries have URLs that might indicate wrong data layers but require human review',
      entries: result.flaggedForReview.map((e) => ({
        fips: e.cityFips,
        city: e.cityName,
        state: e.state,
        pattern: e.matchedPattern,
        reason: e.quarantineReason,
        url: e.downloadUrl,
        featureCount: e.featureCount,
        confidence: e.confidence,
      })),
    };

    fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2), 'utf-8');
    console.log(`Review file written to: ${reviewPath}`);
    console.log(`Contains ${result.flaggedForReview.length} entries for manual review.\n`);
  }

  console.log('NEXT STEPS:');
  console.log('1. Review quarantined-portals.ts - verify entries are actually wrong');
  console.log('2. Review review-needed-portals.json - decide which to keep/remove');
  console.log('3. Run removal script to update known-portals.ts (separate step)');
}

main().catch(console.error);
