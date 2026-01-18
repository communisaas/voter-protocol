#!/usr/bin/env npx tsx
/**
 * WS-2: Feature Count Audit Script
 *
 * Analyzes KNOWN_PORTALS entries to identify:
 * - HIGH (>25 features): Likely wrong data type (precincts, census tracts)
 * - NORMAL (3-25 features): Plausible council districts
 * - LOW (<3 features): Possibly incomplete
 *
 * For anomalous entries, fetches actual data and inspects field names
 * to detect wrong data types (PRECINCT, TRACT, BLOCK, etc.)
 */

import { KNOWN_PORTALS, type KnownPortal } from '../src/core/registry/known-portals.js';

// ==============================================================================
// Configuration
// ==============================================================================

const THRESHOLDS = {
  HIGH: 25,  // >25 features suggests precincts/tracts, not council districts
  LOW: 3,   // <3 features suggests incomplete data
};

// Field name patterns that indicate wrong data types
const SUSPICIOUS_FIELD_PATTERNS = {
  PRECINCT: /precinct|prec|pct|voting/i,
  CENSUS_TRACT: /tract|census_tract|geoid|tractce/i,
  BLOCK_GROUP: /block.*group|blkgrp|bg|cbsa/i,
  CENSUS_BLOCK: /block(?!.*group)|blk(?!.*grp)|tabblock/i,
  VTD: /vtd|voting.*tabulation|vt_d/i,
  SCHOOL: /school|elementary|middle|high.*school|unified/i,
  ZIP: /zip|postal|zcta/i,
};

// Field name patterns that confirm council districts
const CONFIRMING_FIELD_PATTERNS = {
  COUNCIL: /council|city.*council|council.*dist/i,
  DISTRICT: /^district$|^dist$|dist_num|district_num|district_id/i,
  WARD: /^ward$|ward_num|ward_id/i,
  ALDERMAN: /alderman|aldermanic/i,
  MEMBER: /council.*member|member.*district/i,
};

// Known legitimate high-count cities (major metros with 25+ districts)
const KNOWN_LARGE_CITIES: Record<string, { expected: number; reason: string }> = {
  '3651000': { expected: 51, reason: 'NYC has 51 council districts' },
  '1714000': { expected: 50, reason: 'Chicago has 50 aldermanic wards' },
  '0644000': { expected: 15, reason: 'Los Angeles has 15 council districts' },
  '4835000': { expected: 35, reason: 'Houston has 35 council districts (11 at-large + 24 district)' },
};

// ==============================================================================
// Types
// ==============================================================================

type FeatureCategory = 'HIGH' | 'NORMAL' | 'LOW';

interface FieldAnalysis {
  allFields: string[];
  suspiciousFields: { field: string; type: string }[];
  confirmingFields: { field: string; type: string }[];
  verdict: 'CONFIRMED_WRONG' | 'CONFIRMED_CORRECT' | 'INCONCLUSIVE';
}

interface AuditResult {
  fips: string;
  cityName: string;
  state: string;
  featureCount: number;
  category: FeatureCategory;
  downloadUrl: string;
  notes?: string;
  fieldAnalysis?: FieldAnalysis;
  fetchError?: string;
  actualFeatureCount?: number;
  recommendation: 'KEEP' | 'QUARANTINE' | 'INVESTIGATE';
  reason: string;
}

interface AuditSummary {
  timestamp: string;
  totalEntries: number;
  categories: {
    HIGH: number;
    NORMAL: number;
    LOW: number;
  };
  recommendations: {
    KEEP: number;
    QUARANTINE: number;
    INVESTIGATE: number;
  };
  highFeatureEntries: AuditResult[];
  lowFeatureEntries: AuditResult[];
}

// ==============================================================================
// Analysis Functions
// ==============================================================================

function categorizeByFeatureCount(count: number): FeatureCategory {
  if (count > THRESHOLDS.HIGH) return 'HIGH';
  if (count < THRESHOLDS.LOW) return 'LOW';
  return 'NORMAL';
}

function analyzeFieldNames(fields: string[]): FieldAnalysis {
  const suspiciousFields: { field: string; type: string }[] = [];
  const confirmingFields: { field: string; type: string }[] = [];

  for (const field of fields) {
    // Check for suspicious patterns
    for (const [type, pattern] of Object.entries(SUSPICIOUS_FIELD_PATTERNS)) {
      if (pattern.test(field)) {
        suspiciousFields.push({ field, type });
        break;
      }
    }

    // Check for confirming patterns
    for (const [type, pattern] of Object.entries(CONFIRMING_FIELD_PATTERNS)) {
      if (pattern.test(field)) {
        confirmingFields.push({ field, type });
        break;
      }
    }
  }

  // Determine verdict
  let verdict: FieldAnalysis['verdict'] = 'INCONCLUSIVE';

  if (suspiciousFields.length > 0 && confirmingFields.length === 0) {
    verdict = 'CONFIRMED_WRONG';
  } else if (confirmingFields.length > 0 && suspiciousFields.length === 0) {
    verdict = 'CONFIRMED_CORRECT';
  } else if (confirmingFields.length > suspiciousFields.length) {
    verdict = 'CONFIRMED_CORRECT';
  } else if (suspiciousFields.length > confirmingFields.length) {
    verdict = 'CONFIRMED_WRONG';
  }

  return {
    allFields: fields,
    suspiciousFields,
    confirmingFields,
    verdict,
  };
}

async function fetchAndAnalyzeEntry(entry: KnownPortal): Promise<{
  fieldAnalysis?: FieldAnalysis;
  actualFeatureCount?: number;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(entry.downloadUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/geo+json, application/json',
        'User-Agent': 'ShadowAtlas-Audit/1.0',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json() as {
      features?: Array<{ properties?: Record<string, unknown> }>;
    };

    if (!data.features || !Array.isArray(data.features)) {
      return { error: 'Invalid GeoJSON: no features array' };
    }

    const actualFeatureCount = data.features.length;

    // Extract field names from first feature
    const firstFeature = data.features[0];
    if (!firstFeature?.properties) {
      return { actualFeatureCount, error: 'No properties in first feature' };
    }

    const fields = Object.keys(firstFeature.properties);
    const fieldAnalysis = analyzeFieldNames(fields);

    return { fieldAnalysis, actualFeatureCount };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    if (errorMessage.includes('abort')) {
      return { error: 'Request timeout (30s)' };
    }
    return { error: errorMessage };
  }
}

function determineRecommendation(
  entry: KnownPortal,
  category: FeatureCategory,
  fieldAnalysis?: FieldAnalysis,
  actualFeatureCount?: number
): { recommendation: AuditResult['recommendation']; reason: string } {
  const fips = entry.cityFips;

  // Check if it's a known large city
  if (KNOWN_LARGE_CITIES[fips]) {
    const expected = KNOWN_LARGE_CITIES[fips].expected;
    if (Math.abs(entry.featureCount - expected) <= 5) {
      return {
        recommendation: 'KEEP',
        reason: KNOWN_LARGE_CITIES[fips].reason,
      };
    }
  }

  // HIGH feature count analysis
  if (category === 'HIGH') {
    if (fieldAnalysis?.verdict === 'CONFIRMED_WRONG') {
      const suspiciousTypes = [...new Set(fieldAnalysis.suspiciousFields.map(f => f.type))];
      return {
        recommendation: 'QUARANTINE',
        reason: `Field names indicate wrong data type: ${suspiciousTypes.join(', ')}`,
      };
    }
    if (fieldAnalysis?.verdict === 'CONFIRMED_CORRECT') {
      return {
        recommendation: 'KEEP',
        reason: `High feature count but field names confirm council districts`,
      };
    }
    // High count with no confirming evidence
    return {
      recommendation: 'INVESTIGATE',
      reason: `${entry.featureCount} features exceeds typical council district count (4-15). May be precincts/tracts.`,
    };
  }

  // LOW feature count analysis
  if (category === 'LOW') {
    if (entry.featureCount === 1) {
      return {
        recommendation: 'QUARANTINE',
        reason: 'Single feature cannot represent district boundaries',
      };
    }
    if (entry.featureCount === 2) {
      return {
        recommendation: 'INVESTIGATE',
        reason: 'Only 2 features - possibly incomplete or wrong layer',
      };
    }
    // featureCount < 3 (already checked 1 and 2)
    return {
      recommendation: 'INVESTIGATE',
      reason: `Only ${entry.featureCount} features - verify this is complete data`,
    };
  }

  // NORMAL range
  if (actualFeatureCount !== undefined && Math.abs(actualFeatureCount - entry.featureCount) > 2) {
    return {
      recommendation: 'INVESTIGATE',
      reason: `Recorded count (${entry.featureCount}) differs from actual (${actualFeatureCount})`,
    };
  }

  return {
    recommendation: 'KEEP',
    reason: 'Feature count within normal range for council districts',
  };
}

// ==============================================================================
// Main Audit Function
// ==============================================================================

async function runAudit(fetchData: boolean = false): Promise<AuditSummary> {
  const entries = Object.entries(KNOWN_PORTALS);
  const results: AuditResult[] = [];

  console.log(`\n${'='.repeat(80)}`);
  console.log('KNOWN_PORTALS Feature Count Audit');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`Total entries: ${entries.length}`);
  console.log(`Fetch actual data: ${fetchData ? 'YES' : 'NO (use --fetch to enable)'}\n`);

  // Categorize all entries
  const categories = { HIGH: 0, NORMAL: 0, LOW: 0 };
  const highEntries: Array<[string, KnownPortal]> = [];
  const lowEntries: Array<[string, KnownPortal]> = [];

  for (const [fips, entry] of entries) {
    const category = categorizeByFeatureCount(entry.featureCount);
    categories[category]++;

    if (category === 'HIGH') highEntries.push([fips, entry]);
    if (category === 'LOW') lowEntries.push([fips, entry]);
  }

  console.log('Feature Count Distribution:');
  console.log(`  HIGH (>${THRESHOLDS.HIGH}):  ${categories.HIGH} entries`);
  console.log(`  NORMAL (${THRESHOLDS.LOW}-${THRESHOLDS.HIGH}): ${categories.NORMAL} entries`);
  console.log(`  LOW (<${THRESHOLDS.LOW}):    ${categories.LOW} entries`);
  console.log('');

  // Process HIGH entries
  console.log(`\n${'='.repeat(80)}`);
  console.log(`HIGH FEATURE COUNT ENTRIES (>${THRESHOLDS.HIGH} features)`);
  console.log(`${'='.repeat(80)}\n`);

  for (const [fips, entry] of highEntries.sort((a, b) => b[1].featureCount - a[1].featureCount)) {
    console.log(`\n--- ${entry.cityName}, ${entry.state} (FIPS: ${fips}) ---`);
    console.log(`  Feature count: ${entry.featureCount}`);
    console.log(`  Portal type: ${entry.portalType}`);
    console.log(`  Notes: ${entry.notes || 'None'}`);

    let fieldAnalysis: FieldAnalysis | undefined;
    let actualFeatureCount: number | undefined;
    let fetchError: string | undefined;

    if (fetchData) {
      console.log('  Fetching data...');
      const fetchResult = await fetchAndAnalyzeEntry(entry);
      fieldAnalysis = fetchResult.fieldAnalysis;
      actualFeatureCount = fetchResult.actualFeatureCount;
      fetchError = fetchResult.error;

      if (fetchError) {
        console.log(`  Fetch error: ${fetchError}`);
      } else {
        console.log(`  Actual feature count: ${actualFeatureCount}`);
        if (fieldAnalysis) {
          console.log(`  Fields: ${fieldAnalysis.allFields.slice(0, 10).join(', ')}${fieldAnalysis.allFields.length > 10 ? '...' : ''}`);
          if (fieldAnalysis.suspiciousFields.length > 0) {
            console.log(`  SUSPICIOUS fields: ${fieldAnalysis.suspiciousFields.map(f => `${f.field} (${f.type})`).join(', ')}`);
          }
          if (fieldAnalysis.confirmingFields.length > 0) {
            console.log(`  CONFIRMING fields: ${fieldAnalysis.confirmingFields.map(f => `${f.field} (${f.type})`).join(', ')}`);
          }
          console.log(`  Field verdict: ${fieldAnalysis.verdict}`);
        }
      }
    }

    const { recommendation, reason } = determineRecommendation(
      entry,
      'HIGH',
      fieldAnalysis,
      actualFeatureCount
    );

    console.log(`  RECOMMENDATION: ${recommendation}`);
    console.log(`  Reason: ${reason}`);

    results.push({
      fips,
      cityName: entry.cityName,
      state: entry.state,
      featureCount: entry.featureCount,
      category: 'HIGH',
      downloadUrl: entry.downloadUrl,
      notes: entry.notes,
      fieldAnalysis,
      fetchError,
      actualFeatureCount,
      recommendation,
      reason,
    });
  }

  // Process LOW entries
  console.log(`\n${'='.repeat(80)}`);
  console.log(`LOW FEATURE COUNT ENTRIES (<${THRESHOLDS.LOW} features)`);
  console.log(`${'='.repeat(80)}\n`);

  for (const [fips, entry] of lowEntries.sort((a, b) => a[1].featureCount - b[1].featureCount)) {
    console.log(`\n--- ${entry.cityName}, ${entry.state} (FIPS: ${fips}) ---`);
    console.log(`  Feature count: ${entry.featureCount}`);
    console.log(`  Portal type: ${entry.portalType}`);
    console.log(`  Notes: ${entry.notes || 'None'}`);

    let fieldAnalysis: FieldAnalysis | undefined;
    let actualFeatureCount: number | undefined;
    let fetchError: string | undefined;

    if (fetchData) {
      console.log('  Fetching data...');
      const fetchResult = await fetchAndAnalyzeEntry(entry);
      fieldAnalysis = fetchResult.fieldAnalysis;
      actualFeatureCount = fetchResult.actualFeatureCount;
      fetchError = fetchResult.error;

      if (fetchError) {
        console.log(`  Fetch error: ${fetchError}`);
      } else {
        console.log(`  Actual feature count: ${actualFeatureCount}`);
        if (fieldAnalysis) {
          console.log(`  Fields: ${fieldAnalysis.allFields.slice(0, 10).join(', ')}${fieldAnalysis.allFields.length > 10 ? '...' : ''}`);
        }
      }
    }

    const { recommendation, reason } = determineRecommendation(
      entry,
      'LOW',
      fieldAnalysis,
      actualFeatureCount
    );

    console.log(`  RECOMMENDATION: ${recommendation}`);
    console.log(`  Reason: ${reason}`);

    results.push({
      fips,
      cityName: entry.cityName,
      state: entry.state,
      featureCount: entry.featureCount,
      category: 'LOW',
      downloadUrl: entry.downloadUrl,
      notes: entry.notes,
      fieldAnalysis,
      fetchError,
      actualFeatureCount,
      recommendation,
      reason,
    });
  }

  // Summary
  const recommendations = { KEEP: 0, QUARANTINE: 0, INVESTIGATE: 0 };
  for (const result of results) {
    recommendations[result.recommendation]++;
  }

  // Add NORMAL entries as KEEP
  recommendations.KEEP += categories.NORMAL;

  console.log(`\n${'='.repeat(80)}`);
  console.log('AUDIT SUMMARY');
  console.log(`${'='.repeat(80)}\n`);
  console.log(`Total entries analyzed: ${entries.length}`);
  console.log(`\nBy category:`);
  console.log(`  HIGH (>${THRESHOLDS.HIGH}):  ${categories.HIGH}`);
  console.log(`  NORMAL (${THRESHOLDS.LOW}-${THRESHOLDS.HIGH}): ${categories.NORMAL}`);
  console.log(`  LOW (<${THRESHOLDS.LOW}):    ${categories.LOW}`);
  console.log(`\nRecommendations:`);
  console.log(`  KEEP:        ${recommendations.KEEP}`);
  console.log(`  QUARANTINE:  ${recommendations.QUARANTINE}`);
  console.log(`  INVESTIGATE: ${recommendations.INVESTIGATE}`);

  return {
    timestamp: new Date().toISOString(),
    totalEntries: entries.length,
    categories,
    recommendations,
    highFeatureEntries: results.filter(r => r.category === 'HIGH'),
    lowFeatureEntries: results.filter(r => r.category === 'LOW'),
  };
}

// ==============================================================================
// Markdown Report Generation
// ==============================================================================

function generateMarkdownReport(summary: AuditSummary): string {
  const lines: string[] = [];

  lines.push('# Feature Count Audit Results');
  lines.push('');
  lines.push(`**Generated:** ${summary.timestamp}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Entries | ${summary.totalEntries} |`);
  lines.push(`| HIGH (>${THRESHOLDS.HIGH} features) | ${summary.categories.HIGH} |`);
  lines.push(`| NORMAL (${THRESHOLDS.LOW}-${THRESHOLDS.HIGH} features) | ${summary.categories.NORMAL} |`);
  lines.push(`| LOW (<${THRESHOLDS.LOW} features) | ${summary.categories.LOW} |`);
  lines.push('');
  lines.push('### Recommendations');
  lines.push('');
  lines.push('| Recommendation | Count |');
  lines.push('|----------------|-------|');
  lines.push(`| KEEP | ${summary.recommendations.KEEP} |`);
  lines.push(`| QUARANTINE | ${summary.recommendations.QUARANTINE} |`);
  lines.push(`| INVESTIGATE | ${summary.recommendations.INVESTIGATE} |`);
  lines.push('');

  // Reference: Typical Council District Counts
  lines.push('## Reference: Typical Council District Counts');
  lines.push('');
  lines.push('| City Size | Population | Expected Districts |');
  lines.push('|-----------|------------|-------------------|');
  lines.push('| Small | <50k | 4-7 |');
  lines.push('| Medium | 50k-200k | 5-9 |');
  lines.push('| Large | 200k-1M | 7-15 |');
  lines.push('| Major Metro | >1M | 9-51 |');
  lines.push('');

  // HIGH feature count entries
  lines.push('## HIGH Feature Count Entries (>25 features)');
  lines.push('');
  lines.push('These entries have unusually high feature counts that may indicate:');
  lines.push('- Precincts (typically 100s-1000s per city)');
  lines.push('- Census tracts or block groups');
  lines.push('- VTDs (Voting Tabulation Districts)');
  lines.push('- Other non-council-district data');
  lines.push('');

  if (summary.highFeatureEntries.length === 0) {
    lines.push('*No entries with HIGH feature count*');
  } else {
    lines.push('| City | State | FIPS | Features | Recommendation | Reason |');
    lines.push('|------|-------|------|----------|----------------|--------|');

    for (const entry of summary.highFeatureEntries.sort((a, b) => b.featureCount - a.featureCount)) {
      const actualStr = entry.actualFeatureCount !== undefined
        ? ` (actual: ${entry.actualFeatureCount})`
        : '';
      lines.push(`| ${entry.cityName} | ${entry.state} | ${entry.fips} | ${entry.featureCount}${actualStr} | **${entry.recommendation}** | ${entry.reason} |`);
    }
  }
  lines.push('');

  // Detailed HIGH entries
  lines.push('### Detailed Analysis: HIGH Feature Count');
  lines.push('');

  for (const entry of summary.highFeatureEntries.sort((a, b) => b.featureCount - a.featureCount)) {
    lines.push(`#### ${entry.cityName}, ${entry.state}`);
    lines.push('');
    lines.push(`- **FIPS:** ${entry.fips}`);
    lines.push(`- **Feature Count:** ${entry.featureCount}${entry.actualFeatureCount !== undefined ? ` (actual: ${entry.actualFeatureCount})` : ''}`);
    lines.push(`- **Recommendation:** ${entry.recommendation}`);
    lines.push(`- **Reason:** ${entry.reason}`);

    if (entry.notes) {
      lines.push(`- **Notes:** ${entry.notes}`);
    }

    if (entry.fieldAnalysis) {
      lines.push(`- **Field Verdict:** ${entry.fieldAnalysis.verdict}`);
      lines.push(`- **All Fields:** \`${entry.fieldAnalysis.allFields.join('`, `')}\``);

      if (entry.fieldAnalysis.suspiciousFields.length > 0) {
        lines.push(`- **Suspicious Fields:** ${entry.fieldAnalysis.suspiciousFields.map(f => `\`${f.field}\` (${f.type})`).join(', ')}`);
      }
      if (entry.fieldAnalysis.confirmingFields.length > 0) {
        lines.push(`- **Confirming Fields:** ${entry.fieldAnalysis.confirmingFields.map(f => `\`${f.field}\` (${f.type})`).join(', ')}`);
      }
    }

    if (entry.fetchError) {
      lines.push(`- **Fetch Error:** ${entry.fetchError}`);
    }

    lines.push('');
  }

  // LOW feature count entries
  lines.push('## LOW Feature Count Entries (<3 features)');
  lines.push('');
  lines.push('These entries have unusually low feature counts that may indicate:');
  lines.push('- Incomplete data');
  lines.push('- Wrong layer selected');
  lines.push('- City boundary instead of districts');
  lines.push('- At-large representation (no districts)');
  lines.push('');

  if (summary.lowFeatureEntries.length === 0) {
    lines.push('*No entries with LOW feature count*');
  } else {
    lines.push('| City | State | FIPS | Features | Recommendation | Reason |');
    lines.push('|------|-------|------|----------|----------------|--------|');

    for (const entry of summary.lowFeatureEntries.sort((a, b) => a.featureCount - b.featureCount)) {
      const actualStr = entry.actualFeatureCount !== undefined
        ? ` (actual: ${entry.actualFeatureCount})`
        : '';
      lines.push(`| ${entry.cityName} | ${entry.state} | ${entry.fips} | ${entry.featureCount}${actualStr} | **${entry.recommendation}** | ${entry.reason} |`);
    }
  }
  lines.push('');

  // Detailed LOW entries
  lines.push('### Detailed Analysis: LOW Feature Count');
  lines.push('');

  for (const entry of summary.lowFeatureEntries.sort((a, b) => a.featureCount - b.featureCount)) {
    lines.push(`#### ${entry.cityName}, ${entry.state}`);
    lines.push('');
    lines.push(`- **FIPS:** ${entry.fips}`);
    lines.push(`- **Feature Count:** ${entry.featureCount}${entry.actualFeatureCount !== undefined ? ` (actual: ${entry.actualFeatureCount})` : ''}`);
    lines.push(`- **Recommendation:** ${entry.recommendation}`);
    lines.push(`- **Reason:** ${entry.reason}`);

    if (entry.notes) {
      lines.push(`- **Notes:** ${entry.notes}`);
    }

    if (entry.fieldAnalysis) {
      lines.push(`- **All Fields:** \`${entry.fieldAnalysis.allFields.join('`, `')}\``);
    }

    if (entry.fetchError) {
      lines.push(`- **Fetch Error:** ${entry.fetchError}`);
    }

    lines.push('');
  }

  // Quarantine list
  const quarantineEntries = [...summary.highFeatureEntries, ...summary.lowFeatureEntries]
    .filter(e => e.recommendation === 'QUARANTINE');

  if (quarantineEntries.length > 0) {
    lines.push('## Quarantine List');
    lines.push('');
    lines.push('The following entries should be removed or moved to a quarantine registry:');
    lines.push('');
    lines.push('```typescript');
    lines.push('// Entries to quarantine (wrong data type or incomplete)');
    lines.push('const QUARANTINE_FIPS = [');
    for (const entry of quarantineEntries) {
      lines.push(`  '${entry.fips}', // ${entry.cityName}, ${entry.state} - ${entry.reason}`);
    }
    lines.push('];');
    lines.push('```');
    lines.push('');
  }

  // Investigation list
  const investigateEntries = [...summary.highFeatureEntries, ...summary.lowFeatureEntries]
    .filter(e => e.recommendation === 'INVESTIGATE');

  if (investigateEntries.length > 0) {
    lines.push('## Investigation Required');
    lines.push('');
    lines.push('The following entries need manual verification:');
    lines.push('');
    lines.push('| City | State | FIPS | Features | Reason |');
    lines.push('|------|-------|------|----------|--------|');
    for (const entry of investigateEntries) {
      lines.push(`| ${entry.cityName} | ${entry.state} | ${entry.fips} | ${entry.featureCount} | ${entry.reason} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ==============================================================================
// Main
// ==============================================================================

async function main() {
  const args = process.argv.slice(2);
  const fetchData = args.includes('--fetch');
  const outputJson = args.includes('--json');
  const generateReport = args.includes('--report') || !outputJson;

  const summary = await runAudit(fetchData);

  if (outputJson) {
    console.log('\n--- JSON OUTPUT ---\n');
    console.log(JSON.stringify(summary, null, 2));
  }

  if (generateReport) {
    const report = generateMarkdownReport(summary);
    const reportPath = new URL('../docs/feature-count-audit-results.md', import.meta.url);
    const fs = await import('fs');
    fs.writeFileSync(reportPath, report);
    console.log(`\nReport written to: docs/feature-count-audit-results.md`);
  }
}

main().catch(console.error);
