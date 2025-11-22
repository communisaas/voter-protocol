/**
 * Autonomous Top 50 Discovery Script
 *
 * MISSION: Find city council district URLs for Top 50 cities NOT in known-portals registry
 *
 * STRATEGY:
 * 1. Diff district-count-registry.ts vs known-portals.ts to find missing cities
 * 2. For each missing city, run ALL scanners in parallel:
 *    - ArcGIS Hub scanner
 *    - Socrata scanner
 *    - Authoritative multi-path scanner
 * 3. Download and validate each candidate with PostDownloadValidator
 * 4. Match feature count against expected count (±2 tolerance)
 * 5. Output JSON with new entries (confidence ≥60%)
 *
 * SUCCESS CRITERIA: ≥15/24 cities discovered (63% success rate)
 */

import { EXPECTED_DISTRICT_COUNTS } from '../registry/district-count-registry.js';
import { KNOWN_PORTALS } from '../registry/known-portals.js';
import { ArcGISHubScanner } from '../scanners/arcgis-hub.js';
import { SocrataScanner } from '../scanners/socrata.js';
import { AuthoritativeMultiPathScanner } from '../scanners/authoritative-multi-path.js';
import { PostDownloadValidator } from '../acquisition/post-download-validator.js';
import type { CityTarget } from '../validators/enhanced-geographic-validator.js';
import type { PortalCandidate } from '../scanners/arcgis-hub.js';
import type { KnownPortal } from '../registry/known-portals.js';

interface DiscoveryResult {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly success: boolean;
  readonly candidate?: KnownPortal;
  readonly failureReason?: string;
  readonly candidatesAttempted: number;
}

/**
 * Get list of missing cities (in district-count-registry but NOT in known-portals)
 */
function getMissingCities(): CityTarget[] {
  const missing: CityTarget[] = [];

  for (const [fips, record] of Object.entries(EXPECTED_DISTRICT_COUNTS)) {
    // Skip if already in known-portals
    if (KNOWN_PORTALS[fips]) {
      continue;
    }

    // Skip at-large cities (no geographic districts to map)
    if (record.expectedDistrictCount === null) {
      console.log(`⏭️  Skipping ${record.cityName}, ${record.state} (at-large governance)`);
      continue;
    }

    missing.push({
      fips,
      name: record.cityName,
      state: record.state,
    });
  }

  return missing;
}

/**
 * Download and validate a candidate URL
 */
async function downloadAndValidate(
  candidate: PortalCandidate,
  expectedCount: number
): Promise<{ valid: boolean; confidence: number; reason?: string }> {
  try {
    console.log(`      📥 Downloading: ${candidate.downloadUrl.substring(0, 80)}...`);

    const response = await fetch(candidate.downloadUrl);

    if (!response.ok) {
      return { valid: false, confidence: 0, reason: `HTTP ${response.status}` };
    }

    const geojson = await response.json();

    // Validate with PostDownloadValidator
    const validator = new PostDownloadValidator({
      minFeatures: 1,
      maxFeatures: 100, // Reject if >100 (likely precincts)
      requirePolygons: true,
      strictBounds: true,
    });

    const validation = validator.validate(geojson, {
      source: candidate.downloadUrl,
      city: candidate.title,
    });

    if (!validation.valid) {
      return {
        valid: false,
        confidence: validation.confidence,
        reason: validation.issues.join('; '),
      };
    }

    // Check feature count against expected count (±2 tolerance)
    const featureCount = validation.metadata.featureCount;
    const countDiff = Math.abs(featureCount - expectedCount);

    if (countDiff > 2) {
      return {
        valid: false,
        confidence: 40,
        reason: `Feature count mismatch: got ${featureCount}, expected ${expectedCount} (diff: ${countDiff})`,
      };
    }

    // Exact match → 100% confidence
    // Within tolerance (≤2 diff) → 70% confidence
    const countConfidence = countDiff === 0 ? 100 : 70;

    // Combine validation confidence + count confidence
    const finalConfidence = Math.min(validation.confidence, countConfidence);

    return {
      valid: true,
      confidence: finalConfidence,
    };
  } catch (error) {
    return {
      valid: false,
      confidence: 0,
      reason: `Download error: ${(error as Error).message}`,
    };
  }
}

/**
 * Discover URL for a single city
 */
async function discoverCity(city: CityTarget): Promise<DiscoveryResult> {
  console.log(`\n🔍 Discovering: ${city.name}, ${city.state} (FIPS ${city.fips})`);

  const expectedCount = EXPECTED_DISTRICT_COUNTS[city.fips]?.expectedDistrictCount;
  if (expectedCount === null || expectedCount === undefined) {
    return {
      cityFips: city.fips,
      cityName: city.name,
      state: city.state,
      success: false,
      failureReason: 'No expected count in registry',
      candidatesAttempted: 0,
    };
  }

  console.log(`   Expected: ${expectedCount} districts`);

  // Initialize scanners
  const arcgisScanner = new ArcGISHubScanner();
  const socrataScanner = new SocrataScanner();
  const authScanner = new AuthoritativeMultiPathScanner();

  // Run all scanners in parallel
  console.log(`   Running 3 scanners in parallel...`);

  const [arcgisCandidates, socrataCandidates, authCandidates] = await Promise.all([
    arcgisScanner.search(city).catch((err) => {
      console.warn(`   ⚠️ ArcGIS scanner failed: ${err.message}`);
      return [];
    }),
    socrataScanner.search(city).catch((err) => {
      console.warn(`   ⚠️ Socrata scanner failed: ${err.message}`);
      return [];
    }),
    authScanner.search(city).catch((err) => {
      console.warn(`   ⚠️ Authoritative scanner failed: ${err.message}`);
      return [];
    }),
  ]);

  // Combine all candidates
  const allCandidates = [...arcgisCandidates, ...socrataCandidates, ...authCandidates];

  console.log(`   Found ${allCandidates.length} candidates to validate`);

  if (allCandidates.length === 0) {
    return {
      cityFips: city.fips,
      cityName: city.name,
      state: city.state,
      success: false,
      failureReason: 'No candidates found by any scanner',
      candidatesAttempted: 0,
    };
  }

  // Try each candidate (sorted by initial score)
  const sortedCandidates = allCandidates.sort((a, b) => b.score - a.score);

  for (let i = 0; i < sortedCandidates.length; i++) {
    const candidate = sortedCandidates[i];

    console.log(`   Trying candidate ${i + 1}/${sortedCandidates.length}:`);
    console.log(`      Title: ${candidate.title}`);
    console.log(`      Source: ${candidate.portalType}`);
    console.log(`      Initial score: ${candidate.score}`);

    const validation = await downloadAndValidate(candidate, expectedCount);

    if (validation.valid && validation.confidence >= 60) {
      console.log(`   ✅ SUCCESS! Confidence: ${validation.confidence}%`);

      // Convert to KnownPortal format
      const knownPortal: KnownPortal = {
        cityFips: city.fips,
        cityName: city.name,
        state: city.state,
        portalType: candidate.portalType === 'arcgis-hub' || candidate.portalType === 'arcgis-online'
          ? 'arcgis'
          : candidate.portalType === 'socrata'
          ? 'socrata'
          : 'municipal-gis',
        downloadUrl: candidate.downloadUrl,
        featureCount: expectedCount,
        lastVerified: new Date().toISOString(),
        confidence: validation.confidence,
        discoveredBy: 'automated',
        notes: `${city.name} ${city.state} City Council Districts - Autonomous discovery 2025-11-20`,
      };

      return {
        cityFips: city.fips,
        cityName: city.name,
        state: city.state,
        success: true,
        candidate: knownPortal,
        candidatesAttempted: i + 1,
      };
    } else {
      console.log(`   ❌ Validation failed: ${validation.reason || 'Low confidence'}`);
      console.log(`      Confidence: ${validation.confidence}%`);
    }
  }

  return {
    cityFips: city.fips,
    cityName: city.name,
    state: city.state,
    success: false,
    failureReason: `All ${sortedCandidates.length} candidates failed validation`,
    candidatesAttempted: sortedCandidates.length,
  };
}

/**
 * Main discovery function
 */
async function main(): Promise<void> {
  console.log('🚀 AUTONOMOUS TOP 50 DISCOVERY');
  console.log('================================\n');

  const missingCities = getMissingCities();

  console.log(`📊 Status:`);
  console.log(`   Total Top 50 cities: ${Object.keys(EXPECTED_DISTRICT_COUNTS).length}`);
  console.log(`   Already in registry: ${Object.keys(KNOWN_PORTALS).length}`);
  console.log(`   Missing (to discover): ${missingCities.length}\n`);

  if (missingCities.length === 0) {
    console.log('✅ All Top 50 cities already in registry!');
    return;
  }

  console.log(`🎯 Target: ≥${Math.ceil(missingCities.length * 0.63)} cities (63% success rate)\n`);

  // Discover each missing city
  const results: DiscoveryResult[] = [];

  for (const city of missingCities) {
    const result = await discoverCity(city);
    results.push(result);

    // Add delay between cities to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Summary
  console.log('\n\n📊 DISCOVERY SUMMARY');
  console.log('===================\n');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful: ${successful.length}/${missingCities.length} (${Math.round((successful.length / missingCities.length) * 100)}%)`);
  console.log(`❌ Failed: ${failed.length}/${missingCities.length}`);

  if (successful.length > 0) {
    console.log('\n✅ SUCCESSFUL DISCOVERIES:');
    for (const result of successful) {
      console.log(`   - ${result.cityName}, ${result.state} (${result.candidate?.confidence}% confidence)`);
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ FAILED CITIES:');
    for (const result of failed) {
      console.log(`   - ${result.cityName}, ${result.state}: ${result.failureReason}`);
    }
  }

  // Write results to JSON file
  const outputPath = '/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/discovery-results-top50-expansion.json';

  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      total: missingCities.length,
      successful: successful.length,
      failed: failed.length,
      successRate: Math.round((successful.length / missingCities.length) * 100),
    },
    discoveries: successful.map((r) => r.candidate),
    failures: failed.map((r) => ({
      cityFips: r.cityFips,
      cityName: r.cityName,
      state: r.state,
      reason: r.failureReason,
      candidatesAttempted: r.candidatesAttempted,
    })),
  };

  await Bun.write(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 Results written to: ${outputPath}`);

  // Exit with success if we hit our target (≥63% success)
  const targetSuccess = Math.ceil(missingCities.length * 0.63);
  if (successful.length >= targetSuccess) {
    console.log(`\n🎉 SUCCESS! Hit target of ${targetSuccess} cities`);
    process.exit(0);
  } else {
    console.log(`\n⚠️  Below target: needed ${targetSuccess}, got ${successful.length}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
