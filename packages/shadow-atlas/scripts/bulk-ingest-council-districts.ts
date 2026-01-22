#!/usr/bin/env npx tsx
/**
 * Bulk Council District Ingestion Pipeline
 *
 * Downloads, validates, and ingests council district boundaries
 * from discovered candidates into the known-portals registry.
 *
 * Run: npx tsx scripts/bulk-ingest-council-districts.ts
 *      npx tsx scripts/bulk-ingest-council-districts.ts --medium  # Include medium confidence
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

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

interface ValidationResult {
  candidate: Candidate;
  valid: boolean;
  featureCount: number | null;
  error?: string;
  downloadUrl: string;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Bulk-Ingestion)',
        Accept: 'application/geo+json, application/json',
      },
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

function buildQueryUrl(baseUrl: string): string {
  // If URL already has query params, use as-is
  if (baseUrl.includes('query?') || baseUrl.includes('.geojson')) {
    return baseUrl;
  }
  // Add standard GeoJSON query params
  return `${baseUrl}/query?where=1%3D1&outFields=*&f=geojson`;
}

async function validateCandidate(candidate: Candidate): Promise<ValidationResult> {
  const downloadUrl = buildQueryUrl(candidate.url);
  const result: ValidationResult = {
    candidate,
    valid: false,
    featureCount: null,
    downloadUrl,
  };

  try {
    const response = await fetchWithTimeout(downloadUrl);

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const data = await response.json();

    // Validate GeoJSON structure
    if (!data || typeof data !== 'object') {
      result.error = 'Not an object';
      return result;
    }

    let features: unknown[] | null = null;

    if (Array.isArray((data as Record<string, unknown>).features)) {
      features = (data as Record<string, unknown>).features as unknown[];
    } else if ((data as Record<string, unknown>).type === 'Feature') {
      features = [data];
    }

    if (!features || features.length === 0) {
      result.error = 'No features';
      return result;
    }

    // Check for geometry
    const hasGeometry = features.some((f) => {
      if (!f || typeof f !== 'object') return false;
      const feature = f as Record<string, unknown>;
      return feature.geometry !== null && feature.geometry !== undefined;
    });

    if (!hasGeometry) {
      result.error = 'No geometry';
      return result;
    }

    // Valid if we got here with features
    result.featureCount = features.length;

    // Sanity check: council districts should be 1-100 features typically
    if (features.length > 0 && features.length <= 100) {
      result.valid = true;
    } else if (features.length > 100) {
      result.error = `Too many features (${features.length})`;
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    if (result.error.includes('aborted')) {
      result.error = 'Timeout';
    }
    return result;
  }
}

function generateRegistryEntry(result: ValidationResult): string {
  const { candidate, featureCount, downloadUrl } = result;
  const confidence = Math.min(candidate.score, 95); // Cap at 95 for automated discovery

  return `  '${candidate.fips}': {
    cityFips: '${candidate.fips}',
    cityName: '${candidate.name.replace(/'/g, "\\'")}',
    state: '${candidate.state}',
    portalType: 'arcgis',
    downloadUrl: '${downloadUrl}',
    featureCount: ${featureCount},
    lastVerified: '${new Date().toISOString().split('T')[0]}T00:00:00.000Z',
    confidence: ${confidence},
    discoveredBy: 'automated',
    notes: '${candidate.name.replace(/'/g, "\\'")} ${candidate.state} - ${featureCount} districts, bulk ingested from "${candidate.layerName.slice(0, 40).replace(/'/g, "\\'")}"',
  },`;
}

async function main(): Promise<void> {
  const includeMedium = process.argv.includes('--medium');

  const dataPath = join(process.cwd(), 'src/agents/data/council-district-candidates.json');
  const data: CandidatesData = JSON.parse(readFileSync(dataPath, 'utf-8'));

  // Load existing registry FIPS to skip (from generated file)
  const { KNOWN_PORTALS } = await import('../src/core/registry/known-portals.generated.js');
  const existingFips = new Set(Object.keys(KNOWN_PORTALS));

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('           BULK COUNCIL DISTRICT INGESTION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let candidates = data.highConfidenceCandidates.filter((c) => !existingFips.has(c.fips));

  if (includeMedium) {
    const mediumNew = data.mediumConfidenceCandidates.filter((c) => !existingFips.has(c.fips));
    candidates = [...candidates, ...mediumNew];
    console.log(`Mode: HIGH + MEDIUM confidence`);
  } else {
    console.log(`Mode: HIGH confidence only (use --medium for more)`);
  }

  console.log(`Existing registry entries: ${existingFips.size}`);
  console.log(`Candidates to validate: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('No new candidates to process!');
    return;
  }

  // Process in batches
  const batchSize = 10;
  const validResults: ValidationResult[] = [];
  const failedResults: ValidationResult[] = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);

    process.stdout.write(`\r  Validating ${i + batch.length}/${candidates.length}...`);

    const results = await Promise.all(batch.map(validateCandidate));

    for (const result of results) {
      if (result.valid) {
        validResults.push(result);
      } else {
        failedResults.push(result);
      }
    }

    // Rate limiting
    if (i + batchSize < candidates.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log('\n\n' + '─'.repeat(70));
  console.log('VALIDATION RESULTS');
  console.log('─'.repeat(70));
  console.log(`  Valid:   ${validResults.length}/${candidates.length}`);
  console.log(`  Failed:  ${failedResults.length}/${candidates.length}`);

  // Group valid results by state
  const byState = new Map<string, ValidationResult[]>();
  for (const r of validResults) {
    const state = r.candidate.state;
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state)!.push(r);
  }

  console.log('\n' + '─'.repeat(70));
  console.log('VALID ENTRIES BY STATE');
  console.log('─'.repeat(70));
  for (const [state, results] of [...byState.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const totalDistricts = results.reduce((sum, r) => sum + (r.featureCount || 0), 0);
    console.log(`  ${state}: ${results.length} cities, ${totalDistricts} districts`);
  }

  // Generate registry entries
  if (validResults.length > 0) {
    console.log('\n' + '─'.repeat(70));
    console.log('GENERATING REGISTRY ENTRIES');
    console.log('─'.repeat(70));

    const entries = validResults.map(generateRegistryEntry);

    const outputPath = join(process.cwd(), 'src/agents/data/bulk-registry-entries.ts');
    const output = `// BULK INGESTED ENTRIES - ${new Date().toISOString()}
// Generated by bulk-ingest-council-districts.ts
// Copy these entries to known-portals.ts

export const BULK_ENTRIES = {
${entries.join('\n\n')}
};

// Statistics:
// - Total entries: ${validResults.length}
// - Total districts: ${validResults.reduce((sum, r) => sum + (r.featureCount || 0), 0)}
// - States covered: ${byState.size}
`;

    writeFileSync(outputPath, output);
    console.log(`\n📄 Registry entries written to: ${outputPath}`);

    // Also write a summary JSON
    const summaryPath = join(process.cwd(), 'src/agents/data/bulk-ingestion-results.json');
    const summary = {
      timestamp: new Date().toISOString(),
      mode: includeMedium ? 'high+medium' : 'high-only',
      validated: validResults.length,
      failed: failedResults.length,
      totalDistricts: validResults.reduce((sum, r) => sum + (r.featureCount || 0), 0),
      byState: Object.fromEntries(
        [...byState.entries()].map(([state, results]) => [
          state,
          {
            cities: results.length,
            districts: results.reduce((sum, r) => sum + (r.featureCount || 0), 0),
          },
        ])
      ),
      validCities: validResults.map((r) => ({
        fips: r.candidate.fips,
        name: r.candidate.name,
        state: r.candidate.state,
        featureCount: r.featureCount,
        score: r.candidate.score,
      })),
      failedCities: failedResults.slice(0, 50).map((r) => ({
        name: r.candidate.name,
        state: r.candidate.state,
        error: r.error,
      })),
    };
    writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`📊 Summary written to: ${summaryPath}`);
  }

  // Print failed cities for review
  if (failedResults.length > 0) {
    console.log('\n' + '─'.repeat(70));
    console.log('FAILED VALIDATIONS (sample)');
    console.log('─'.repeat(70));
    for (const r of failedResults.slice(0, 20)) {
      console.log(`  ${r.candidate.name}, ${r.candidate.state}: ${r.error}`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  Previous registry:     ${existingFips.size} cities`);
  console.log(`  New valid entries:     +${validResults.length} cities`);
  console.log(`  New districts:         +${validResults.reduce((sum, r) => sum + (r.featureCount || 0), 0)}`);
  console.log(`  Potential new total:   ${existingFips.size + validResults.length} cities`);
  console.log(`\nNext: Review and merge entries from bulk-registry-entries.ts`);
}

main().catch(console.error);
