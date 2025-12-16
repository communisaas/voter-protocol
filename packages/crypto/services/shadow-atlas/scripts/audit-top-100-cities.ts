#!/usr/bin/env npx tsx
/**
 * Top 100 Cities Coverage & Accuracy Audit
 *
 * Validates:
 * 1. Coverage: Which top 100 cities have registry entries?
 * 2. URL Health: Do download URLs return valid GeoJSON?
 * 3. Data Accuracy: Do feature counts match expected district counts?
 * 4. Provenance: Is authority/aggregator distinction correct?
 */

import { KNOWN_PORTALS, type KnownPortal } from '../registry/known-portals.js';
import { EXPECTED_DISTRICT_COUNTS, type DistrictCountRecord } from '../registry/district-count-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CityEntry {
  fips: string;
  name: string;
  state: string;
  population: number;
  rank: number;
}

interface AuditResult {
  city: CityEntry;
  hasPortal: boolean;
  portal: KnownPortal | null;
  hasExpectedCount: boolean;
  expectedCount: DistrictCountRecord | null;
  urlStatus: 'healthy' | 'error' | 'timeout' | 'untested';
  featureCountMatch: 'exact' | 'within-tolerance' | 'mismatch' | 'unknown';
  responseTimeMs: number | null;
  actualFeatureCount: number | null;
  issues: string[];
}

// Load top 1000 cities
const citiesPath = path.join(__dirname, '../data/us-cities-top-1000.json');
const allCities: CityEntry[] = JSON.parse(fs.readFileSync(citiesPath, 'utf-8'));
const top100 = allCities.slice(0, 100);

async function validateUrl(url: string, timeoutMs = 15000): Promise<{
  status: 'healthy' | 'error' | 'timeout';
  responseTimeMs: number;
  featureCount: number | null;
  error?: string;
}> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    if (!response.ok) {
      return {
        status: 'error',
        responseTimeMs: elapsed,
        featureCount: null,
        error: `HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    // Handle GeoJSON FeatureCollection
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      return {
        status: 'healthy',
        responseTimeMs: elapsed,
        featureCount: data.features.length,
      };
    }

    // Handle ArcGIS query response (features array at root)
    if (Array.isArray(data.features)) {
      return {
        status: 'healthy',
        responseTimeMs: elapsed,
        featureCount: data.features.length,
      };
    }

    return {
      status: 'error',
      responseTimeMs: elapsed,
      featureCount: null,
      error: 'Invalid GeoJSON structure',
    };
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = Date.now() - start;

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        status: 'timeout',
        responseTimeMs: elapsed,
        featureCount: null,
        error: 'Request timed out',
      };
    }

    return {
      status: 'error',
      responseTimeMs: elapsed,
      featureCount: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function auditCity(city: CityEntry, validateUrls: boolean): Promise<AuditResult> {
  const portal = KNOWN_PORTALS[city.fips] || null;
  const expectedCount = EXPECTED_DISTRICT_COUNTS[city.fips] || null;
  const issues: string[] = [];

  const result: AuditResult = {
    city,
    hasPortal: portal !== null,
    portal,
    hasExpectedCount: expectedCount !== null,
    expectedCount,
    urlStatus: 'untested',
    featureCountMatch: 'unknown',
    responseTimeMs: null,
    actualFeatureCount: null,
    issues,
  };

  // Check for coverage gaps
  if (!portal) {
    issues.push(`NO_PORTAL: City #${city.rank} missing from known-portals.ts`);
  }

  if (!expectedCount) {
    issues.push(`NO_EXPECTED_COUNT: Missing from district-count-registry.ts`);
  }

  // Validate URL if requested and portal exists
  if (validateUrls && portal) {
    const validation = await validateUrl(portal.downloadUrl);
    result.urlStatus = validation.status;
    result.responseTimeMs = validation.responseTimeMs;
    result.actualFeatureCount = validation.featureCount;

    if (validation.status !== 'healthy') {
      issues.push(`URL_${validation.status.toUpperCase()}: ${validation.error || 'Unknown'}`);
    }

    // Check feature count match
    if (validation.featureCount !== null && expectedCount !== null && expectedCount.expectedDistrictCount !== null) {
      const diff = Math.abs(validation.featureCount - expectedCount.expectedDistrictCount);
      if (diff === 0) {
        result.featureCountMatch = 'exact';
      } else if (diff <= 2) {
        result.featureCountMatch = 'within-tolerance';
        issues.push(`COUNT_TOLERANCE: Expected ${expectedCount.expectedDistrictCount}, got ${validation.featureCount}`);
      } else {
        result.featureCountMatch = 'mismatch';
        issues.push(`COUNT_MISMATCH: Expected ${expectedCount.expectedDistrictCount}, got ${validation.featureCount} (diff: ${diff})`);
      }
    } else if (validation.featureCount !== null && portal.featureCount) {
      // Compare against portal's recorded count
      const diff = Math.abs(validation.featureCount - portal.featureCount);
      if (diff === 0) {
        result.featureCountMatch = 'exact';
      } else if (diff <= 2) {
        result.featureCountMatch = 'within-tolerance';
      } else {
        result.featureCountMatch = 'mismatch';
        issues.push(`PORTAL_COUNT_DRIFT: Registry says ${portal.featureCount}, API returned ${validation.featureCount}`);
      }
    }

    // Check for stale data
    if (portal.lastVerified) {
      const lastVerified = new Date(portal.lastVerified);
      const daysSince = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 90) {
        issues.push(`STALE: Last verified ${Math.floor(daysSince)} days ago`);
      }
    }

    // Check confidence
    if (portal.confidence < 70) {
      issues.push(`LOW_CONFIDENCE: ${portal.confidence}%`);
    }
  }

  return result;
}

async function runAudit(validateUrls = false, limit = 100): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║           TOP 100 US CITIES - SHADOW ATLAS COVERAGE AUDIT           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const citiesToAudit = top100.slice(0, limit);
  const results: AuditResult[] = [];

  console.log(`Auditing ${citiesToAudit.length} cities...${validateUrls ? ' (with URL validation)' : ''}\n`);

  for (const city of citiesToAudit) {
    process.stdout.write(`  [${city.rank.toString().padStart(3)}] ${city.name}, ${city.state}... `);
    const result = await auditCity(city, validateUrls);
    results.push(result);

    if (result.hasPortal) {
      if (validateUrls) {
        const status = result.urlStatus === 'healthy' ? '✅' : result.urlStatus === 'timeout' ? '⏱️' : '❌';
        const count = result.actualFeatureCount !== null ? ` (${result.actualFeatureCount} features)` : '';
        console.log(`${status}${count}`);
      } else {
        console.log(`✅ (${result.portal?.featureCount || '?'} features, ${result.portal?.confidence}% confidence)`);
      }
    } else {
      console.log('❌ NO COVERAGE');
    }
  }

  // Summary statistics
  const covered = results.filter(r => r.hasPortal).length;
  const uncovered = results.filter(r => !r.hasPortal);
  const healthy = results.filter(r => r.urlStatus === 'healthy').length;
  const errors = results.filter(r => r.urlStatus === 'error' || r.urlStatus === 'timeout');
  const exactMatches = results.filter(r => r.featureCountMatch === 'exact').length;
  const mismatches = results.filter(r => r.featureCountMatch === 'mismatch');

  console.log('\n' + '═'.repeat(74));
  console.log('\n📊 COVERAGE SUMMARY\n');
  console.log(`  Cities audited:     ${results.length}`);
  console.log(`  With portal entry:  ${covered} (${((covered / results.length) * 100).toFixed(1)}%)`);
  console.log(`  Missing coverage:   ${uncovered.length}`);

  if (validateUrls) {
    console.log(`\n📡 URL HEALTH\n`);
    console.log(`  Healthy URLs:       ${healthy}/${covered}`);
    console.log(`  Errors/Timeouts:    ${errors.length}`);

    console.log(`\n🔢 DATA ACCURACY\n`);
    console.log(`  Exact count match:  ${exactMatches}`);
    console.log(`  Count mismatches:   ${mismatches.length}`);
  }

  // Population coverage
  const coveredPop = results.filter(r => r.hasPortal).reduce((sum, r) => sum + r.city.population, 0);
  const totalPop = results.reduce((sum, r) => sum + r.city.population, 0);
  console.log(`\n👥 POPULATION COVERAGE\n`);
  console.log(`  Covered:            ${(coveredPop / 1_000_000).toFixed(1)}M`);
  console.log(`  Total (top ${limit}):    ${(totalPop / 1_000_000).toFixed(1)}M`);
  console.log(`  Coverage rate:      ${((coveredPop / totalPop) * 100).toFixed(1)}%`);

  // List uncovered cities
  if (uncovered.length > 0) {
    console.log('\n⚠️  UNCOVERED CITIES (by population rank)\n');
    for (const r of uncovered.slice(0, 20)) {
      console.log(`  #${r.city.rank.toString().padStart(3)} ${r.city.name}, ${r.city.state} (pop: ${(r.city.population / 1000).toFixed(0)}K)`);
    }
    if (uncovered.length > 20) {
      console.log(`  ... and ${uncovered.length - 20} more`);
    }
  }

  // List problematic entries
  if (errors.length > 0) {
    console.log('\n🚨 URL ERRORS\n');
    for (const r of errors) {
      console.log(`  ${r.city.name}, ${r.city.state}: ${r.issues.find(i => i.startsWith('URL_'))}`);
    }
  }

  if (mismatches.length > 0) {
    console.log('\n⚠️  COUNT MISMATCHES\n');
    for (const r of mismatches) {
      const issue = r.issues.find(i => i.includes('MISMATCH'));
      console.log(`  ${r.city.name}, ${r.city.state}: ${issue}`);
    }
  }

  console.log('\n' + '═'.repeat(74));
}

// Parse CLI args
const args = process.argv.slice(2);
const validateUrls = args.includes('--validate') || args.includes('-v');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100;

runAudit(validateUrls, limit).catch(console.error);
