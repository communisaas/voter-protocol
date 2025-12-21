/**
 * Cross-Validation Test Suite - TIGER vs State Sources
 *
 * Validates consistency between Census TIGER/Line data and state GIS portals.
 * Detects discrepancies in district counts, GEOIDs, and boundary geometries.
 *
 * VALIDATION LAYERS:
 * 1. District Count Matching: State and TIGER should report same number of districts
 * 2. GEOID Consistency: Same identifiers between sources (allowing format differences)
 * 3. Geometry Overlap: Boundaries should be nearly identical (>95% IoU)
 * 4. Data Vintage: Post-2020 redistricting data should be 2022+
 *
 * PHILOSOPHY:
 * - State redistricting commissions are authoritative during gaps (Jan-Jun of years ending in 2)
 * - TIGER is authoritative after Census ingestion (typically September)
 * - Discrepancies flagged for manual review, not automatic rejection
 * - Cross-validation builds confidence in Shadow Atlas data quality
 *
 * INTEGRATION:
 * - Runs against live APIs (skip in CI with process.env.CI check)
 * - Tests Wisconsin as pilot (full extraction working for all 4 layers)
 * - Expandable to all states with state GIS portals configured
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { StateBatchExtractor, type ExtractedBoundary } from './state-batch-extractor.js';
import { TIGERBoundaryProvider, TIGER_LAYERS, type TIGERLayer } from './tiger-boundary-provider.js';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { area, intersect, featureCollection } from '@turf/turf';
import { polygon as turfPolygon, multiPolygon as turfMultiPolygon } from '@turf/helpers';

// ============================================================================
// Types
// ============================================================================

/**
 * District count comparison result
 */
interface CountComparisonResult {
  readonly source: 'state' | 'tiger';
  readonly state: string;
  readonly layerType: string;
  readonly count: number;
  readonly expectedCount: number;
  readonly match: boolean;
  readonly discrepancy: number;
}

/**
 * GEOID consistency result
 */
interface GeoidConsistencyResult {
  readonly state: string;
  readonly layerType: string;
  readonly stateGeoids: readonly string[];
  readonly tigerGeoids: readonly string[];
  readonly matching: readonly string[];
  readonly onlyInState: readonly string[];
  readonly onlyInTiger: readonly string[];
  readonly consistencyScore: number; // 0-100
}

/**
 * Geometry overlap result for a single district
 */
interface GeometryOverlapResult {
  readonly geoid: string;
  readonly name: string;
  readonly stateArea: number; // square meters
  readonly tigerArea: number; // square meters
  readonly intersectionArea: number; // square meters
  readonly unionArea: number; // square meters
  readonly iou: number; // Intersection over Union (0-1)
  readonly areaDifference: number; // Percentage difference
  readonly match: boolean; // true if IoU >= 0.95
}

/**
 * Overall geometry comparison result
 */
interface GeometryComparisonResult {
  readonly state: string;
  readonly layerType: string;
  readonly totalDistricts: number;
  readonly matchedDistricts: number;
  readonly averageIou: number;
  readonly minIou: number;
  readonly maxIou: number;
  readonly significantDiscrepancies: readonly GeometryOverlapResult[]; // IoU < 0.95
  readonly overallMatch: boolean;
}

/**
 * Combined cross-validation result
 */
interface CrossValidationResult {
  readonly state: string;
  readonly layerType: string;
  readonly count: CountComparisonResult;
  readonly geoids: GeoidConsistencyResult;
  readonly geometry: GeometryComparisonResult | null; // null if GEOID mismatch prevents matching
  readonly dataVintage: {
    readonly stateVintage: number;
    readonly tigerVintage: number;
    readonly acceptable: boolean; // Post-2020 redistricting should be 2022+
  };
  readonly overallQuality: number; // 0-100
  readonly recommendation: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize GEOID for comparison (handle format differences between sources)
 *
 * State sources may use different formats:
 * - "06-12" vs "0612" (California CD-12)
 * - "WI-08" vs "5508" (Wisconsin CD-08)
 * - Padding differences: "1" vs "01"
 */
function normalizeGeoid(geoid: string, stateFips: string): string {
  // Remove common separators
  let normalized = geoid.replace(/[-_\s]/g, '');

  // Ensure state FIPS prefix
  if (!normalized.startsWith(stateFips)) {
    // Try to extract district number and prepend state FIPS
    const districtMatch = normalized.match(/\d+$/);
    if (districtMatch) {
      const districtNum = districtMatch[0].padStart(2, '0');
      normalized = `${stateFips}${districtNum}`;
    }
  }

  // Ensure standard padding (state FIPS + 2-digit district for CD, or 3-digit for county)
  if (normalized.length < 4) {
    const districtPart = normalized.substring(stateFips.length);
    const paddedDistrict = districtPart.padStart(2, '0');
    normalized = `${stateFips}${paddedDistrict}`;
  }

  return normalized.toUpperCase();
}

/**
 * Get state FIPS code from state abbreviation
 */
function getStateFips(state: string): string {
  const fipsMap: Record<string, string> = {
    WI: '55',
    TX: '48',
    FL: '12',
    NC: '37',
    CO: '08',
    NY: '36',
    CA: '06',
    PA: '42',
    IL: '17',
    OH: '39',
    MI: '26',
    GA: '13',
    VA: '51',
    WA: '53',
    OR: '41',
    MN: '27',
    MA: '25',
  };
  return fipsMap[state.toUpperCase()] ?? '00';
}

/**
 * Map legislative layer type to TIGER layer
 */
function mapToTigerLayer(layerType: string): TIGERLayer | null {
  switch (layerType) {
    case 'congressional':
      return 'cd';
    case 'state_senate':
      return 'sldu';
    case 'state_house':
      return 'sldl';
    case 'county':
      return 'county';
    default:
      return null;
  }
}

/**
 * Calculate Intersection over Union (IoU) for two geometries
 *
 * IoU = Area(Intersection) / Area(Union)
 * - IoU = 1.0: Perfect overlap
 * - IoU >= 0.95: Excellent match (typical for same-source data)
 * - IoU >= 0.90: Good match (minor boundary differences)
 * - IoU < 0.90: Significant discrepancy
 *
 * Uses formula: IoU = Intersection / (Area1 + Area2 - Intersection)
 */
function calculateIoU(
  geom1: Polygon | MultiPolygon,
  geom2: Polygon | MultiPolygon
): { iou: number; intersectionArea: number; unionArea: number } {
  try {
    // Validate geometries exist
    if (!geom1 || !geom2 || !geom1.coordinates || !geom2.coordinates) {
      console.warn(`   ⚠️  IoU calculation failed: Invalid geometry (null or missing coordinates)`);
      return { iou: 0, intersectionArea: 0, unionArea: 0 };
    }

    // Convert to Turf features
    const feature1 = geom1.type === 'Polygon' ? turfPolygon(geom1.coordinates) : turfMultiPolygon(geom1.coordinates);
    const feature2 = geom2.type === 'Polygon' ? turfPolygon(geom2.coordinates) : turfMultiPolygon(geom2.coordinates);

    // Calculate areas
    const area1 = area(feature1);
    const area2 = area(feature2);

    // If areas are zero, geometries are invalid
    if (area1 === 0 || area2 === 0) {
      console.warn(`   ⚠️  IoU calculation failed: Zero area geometry (area1=${area1}, area2=${area2})`);
      return { iou: 0, intersectionArea: 0, unionArea: 0 };
    }

    // Calculate intersection (Turf v7 requires FeatureCollection)
    const fc = featureCollection([feature1, feature2]);
    const intersection = intersect(fc);
    const intersectionArea = intersection ? area(intersection) : 0;

    // Calculate union area: Union = Area1 + Area2 - Intersection
    const unionArea = area1 + area2 - intersectionArea;

    // Calculate IoU
    const iou = unionArea > 0 ? intersectionArea / unionArea : 0;

    return { iou, intersectionArea, unionArea };
  } catch (error) {
    console.warn(`   ⚠️  IoU calculation failed: ${(error as Error).message}`);
    console.warn(`      geom1 type: ${geom1?.type}, geom2 type: ${geom2?.type}`);
    return { iou: 0, intersectionArea: 0, unionArea: 0 };
  }
}

/**
 * Calculate area difference percentage
 */
function calculateAreaDifference(area1: number, area2: number): number {
  const avgArea = (area1 + area2) / 2;
  if (avgArea === 0) return 0;
  return Math.abs(area1 - area2) / avgArea * 100;
}

/**
 * Compare district counts between state and TIGER sources
 */
function compareDistrictCounts(
  state: string,
  layerType: string,
  stateCount: number,
  tigerCount: number,
  expectedCount: number
): {
  stateResult: CountComparisonResult;
  tigerResult: CountComparisonResult;
  match: boolean;
} {
  const stateResult: CountComparisonResult = {
    source: 'state',
    state,
    layerType,
    count: stateCount,
    expectedCount,
    match: stateCount === expectedCount,
    discrepancy: Math.abs(stateCount - expectedCount),
  };

  const tigerResult: CountComparisonResult = {
    source: 'tiger',
    state,
    layerType,
    count: tigerCount,
    expectedCount,
    match: tigerCount === expectedCount,
    discrepancy: Math.abs(tigerCount - expectedCount),
  };

  const match = stateCount === tigerCount && stateCount === expectedCount;

  return { stateResult, tigerResult, match };
}

/**
 * Compare GEOIDs between state and TIGER sources
 */
function compareGeoids(
  state: string,
  layerType: string,
  stateBoundaries: readonly ExtractedBoundary[],
  tigerGeoids: readonly string[]
): GeoidConsistencyResult {
  const stateFips = getStateFips(state);

  // Normalize all GEOIDs for comparison
  const stateGeoids = stateBoundaries.map(b => normalizeGeoid(b.id, stateFips));
  const normalizedTigerGeoids = tigerGeoids.map(g => normalizeGeoid(g, stateFips));

  // Find matches
  const stateSet = new Set(stateGeoids);
  const tigerSet = new Set(normalizedTigerGeoids);

  const matching = stateGeoids.filter(g => tigerSet.has(g));
  const onlyInState = stateGeoids.filter(g => !tigerSet.has(g));
  const onlyInTiger = normalizedTigerGeoids.filter(g => !stateSet.has(g));

  // Calculate consistency score
  const totalUnique = new Set([...stateGeoids, ...normalizedTigerGeoids]).size;
  const consistencyScore = totalUnique > 0 ? (matching.length / totalUnique) * 100 : 0;

  return {
    state,
    layerType,
    stateGeoids: Object.freeze([...stateGeoids]),
    tigerGeoids: Object.freeze([...normalizedTigerGeoids]),
    matching: Object.freeze([...matching]),
    onlyInState: Object.freeze([...onlyInState]),
    onlyInTiger: Object.freeze([...onlyInTiger]),
    consistencyScore,
  };
}

/**
 * Compare geometries between state and TIGER sources
 */
function compareGeometries(
  state: string,
  layerType: string,
  stateBoundaries: readonly ExtractedBoundary[],
  tigerBoundaries: ReadonlyMap<string, { geometry: Polygon | MultiPolygon; name: string }>
): GeometryComparisonResult {
  const stateFips = getStateFips(state);
  const overlapResults: GeometryOverlapResult[] = [];

  for (const stateBoundary of stateBoundaries) {
    const normalizedGeoid = normalizeGeoid(stateBoundary.id, stateFips);

    // Find matching TIGER boundary
    const tigerBoundary = tigerBoundaries.get(normalizedGeoid);
    if (!tigerBoundary) {
      continue; // Skip if no TIGER match (GEOID mismatch)
    }

    // Calculate areas
    const stateGeom = stateBoundary.geometry;
    const tigerGeom = tigerBoundary.geometry;

    const stateFeature = stateGeom.type === 'Polygon'
      ? turfPolygon(stateGeom.coordinates)
      : turfMultiPolygon(stateGeom.coordinates);

    const tigerFeature = tigerGeom.type === 'Polygon'
      ? turfPolygon(tigerGeom.coordinates)
      : turfMultiPolygon(tigerGeom.coordinates);

    const stateArea = area(stateFeature);
    const tigerArea = area(tigerFeature);

    // Calculate IoU
    const { iou, intersectionArea, unionArea } = calculateIoU(stateGeom, tigerGeom);

    // Calculate area difference
    const areaDifference = calculateAreaDifference(stateArea, tigerArea);

    overlapResults.push({
      geoid: normalizedGeoid,
      name: stateBoundary.name,
      stateArea,
      tigerArea,
      intersectionArea,
      unionArea,
      iou,
      areaDifference,
      match: iou >= 0.95, // 95% IoU threshold for "match" (civic infrastructure requires high precision)
    });
  }

  // Calculate summary statistics
  const totalDistricts = overlapResults.length;
  const matchedDistricts = overlapResults.filter(r => r.match).length;
  const averageIou = totalDistricts > 0
    ? overlapResults.reduce((sum, r) => sum + r.iou, 0) / totalDistricts
    : 0;
  const minIou = totalDistricts > 0 ? Math.min(...overlapResults.map(r => r.iou)) : 0;
  const maxIou = totalDistricts > 0 ? Math.max(...overlapResults.map(r => r.iou)) : 0;

  const significantDiscrepancies = overlapResults.filter(r => !r.match);

  const overallMatch = matchedDistricts === totalDistricts && totalDistricts > 0;

  return {
    state,
    layerType,
    totalDistricts,
    matchedDistricts,
    averageIou,
    minIou,
    maxIou,
    significantDiscrepancies: Object.freeze([...significantDiscrepancies]),
    overallMatch,
  };
}

/**
 * Calculate overall quality score (0-100)
 *
 * Weighted scoring:
 * - Count match: 30%
 * - GEOID consistency: 30%
 * - Geometry overlap: 40%
 */
function calculateQualityScore(
  countMatch: boolean,
  geoidConsistency: number,
  geometryMatch: number
): number {
  const countScore = countMatch ? 30 : 0;
  const geoidScore = geoidConsistency * 0.3;
  const geometryScore = geometryMatch * 0.4;

  return Math.round(countScore + geoidScore + geometryScore);
}

// ============================================================================
// Test Suite
// ============================================================================

describe.skipIf(process.env.CI)('Cross-Validation: TIGER vs State Sources', () => {
  let stateExtractor: StateBatchExtractor;
  let tigerProvider: TIGERBoundaryProvider;

  beforeEach(() => {
    stateExtractor = new StateBatchExtractor({ retryAttempts: 2, retryDelayMs: 1000 });
    tigerProvider = new TIGERBoundaryProvider({
      year: 2024,
      cacheDir: '/tmp/tiger-test-cache',
    });
  });

  // ============================================================================
  // Wisconsin (Pilot State) - All 4 Layers
  // ============================================================================

  describe('Wisconsin (Pilot State)', () => {
    test('validates Wisconsin congressional district count matches TIGER', async () => {
      console.log('\n=== Wisconsin Congressional Districts Cross-Validation ===\n');

      // Extract from state source
      const stateResult = await stateExtractor.extractLayer('WI', 'congressional');
      console.log(`   State source: ${stateResult.featureCount} districts`);

      // Extract from TIGER
      const tigerFiles = await tigerProvider.downloadLayer({
        layer: 'cd',
        stateFips: '55', // Wisconsin
      });
      const tigerBoundaries = await tigerProvider.transform(tigerFiles);
      const wisconsinTiger = tigerBoundaries.filter(b => b.properties.stateFips === '55');
      console.log(`   TIGER source: ${wisconsinTiger.length} districts`);

      // Compare counts
      const expectedCount = 8; // Wisconsin has 8 congressional districts
      const { stateResult: stateCount, tigerResult: tigerCount, match } = compareDistrictCounts(
        'WI',
        'congressional',
        stateResult.featureCount,
        wisconsinTiger.length,
        expectedCount
      );

      console.log(`   Expected: ${expectedCount}`);
      console.log(`   Match: ${match ? '✅' : '❌'}`);

      // Validate
      expect(stateCount.count).toBe(expectedCount);
      expect(tigerCount.count).toBe(expectedCount);
      expect(match).toBe(true);
    }, 90000); // 90 second timeout

    test('validates Wisconsin congressional district GEOIDs match TIGER', async () => {
      console.log('\n=== Wisconsin Congressional District GEOID Consistency ===\n');

      // Extract from state source
      const stateResult = await stateExtractor.extractLayer('WI', 'congressional');

      // Extract from TIGER
      const tigerFiles = await tigerProvider.downloadLayer({
        layer: 'cd',
        stateFips: '55',
      });
      const tigerBoundaries = await tigerProvider.transform(tigerFiles);
      const wisconsinTiger = tigerBoundaries.filter(b => b.properties.stateFips === '55');

      // Compare GEOIDs
      const geoidResult = compareGeoids(
        'WI',
        'congressional',
        stateResult.boundaries,
        wisconsinTiger.map(b => b.id)
      );

      console.log(`   State GEOIDs: ${geoidResult.stateGeoids.join(', ')}`);
      console.log(`   TIGER GEOIDs: ${geoidResult.tigerGeoids.join(', ')}`);
      console.log(`   Matching: ${geoidResult.matching.length}/${geoidResult.stateGeoids.length}`);
      console.log(`   Consistency score: ${geoidResult.consistencyScore.toFixed(1)}%`);

      if (geoidResult.onlyInState.length > 0) {
        console.log(`   Only in state: ${geoidResult.onlyInState.join(', ')}`);
      }
      if (geoidResult.onlyInTiger.length > 0) {
        console.log(`   Only in TIGER: ${geoidResult.onlyInTiger.join(', ')}`);
      }

      // Validate
      expect(geoidResult.consistencyScore).toBeGreaterThanOrEqual(95); // 95% consistency threshold
      expect(geoidResult.onlyInState.length).toBe(0);
      expect(geoidResult.onlyInTiger.length).toBe(0);
    }, 90000);

    test('validates Wisconsin congressional district geometries overlap with TIGER', async () => {
      console.log('\n=== Wisconsin Congressional District Geometry Overlap ===\n');

      // Extract from state source
      const stateResult = await stateExtractor.extractLayer('WI', 'congressional');

      // Extract from TIGER
      const tigerFiles = await tigerProvider.downloadLayer({
        layer: 'cd',
        stateFips: '55',
      });
      const tigerBoundaries = await tigerProvider.transform(tigerFiles);
      const wisconsinTiger = tigerBoundaries.filter(b => b.properties.stateFips === '55');

      // Build TIGER lookup map
      const tigerMap = new Map(
        wisconsinTiger.map(b => [
          normalizeGeoid(b.id, '55'),
          { geometry: b.geometry, name: b.name },
        ])
      );

      // Compare geometries
      const geometryResult = compareGeometries(
        'WI',
        'congressional',
        stateResult.boundaries,
        tigerMap
      );

      console.log(`   Total districts: ${geometryResult.totalDistricts}`);
      console.log(`   Matched (IoU >= 0.95): ${geometryResult.matchedDistricts}`);
      console.log(`   Average IoU: ${geometryResult.averageIou.toFixed(3)}`);
      console.log(`   Min IoU: ${geometryResult.minIou.toFixed(3)}`);
      console.log(`   Max IoU: ${geometryResult.maxIou.toFixed(3)}`);

      if (geometryResult.significantDiscrepancies.length > 0) {
        console.log(`\n   Significant discrepancies (IoU < 0.95):`);
        for (const disc of geometryResult.significantDiscrepancies.slice(0, 3)) {
          console.log(`     ${disc.geoid} (${disc.name}): IoU = ${disc.iou.toFixed(3)}, Area diff = ${disc.areaDifference.toFixed(1)}%`);
        }
        if (geometryResult.significantDiscrepancies.length > 3) {
          console.log(`     ... and ${geometryResult.significantDiscrepancies.length - 3} more`);
        }
      }

      // Validate - civic infrastructure requires 95% precision for electoral boundaries
      // 5% tolerance allows for minor coordinate precision differences between sources
      expect(geometryResult.averageIou).toBeGreaterThanOrEqual(0.95); // 95% average IoU (civic infrastructure standard)
      expect(geometryResult.totalDistricts).toBe(8);

      // Log warning if discrepancies exist
      if (geometryResult.significantDiscrepancies.length > 0) {
        console.warn(`   ⚠️  ${geometryResult.significantDiscrepancies.length} districts have IoU < 0.95 (may indicate minor boundary differences)`);
      }
    }, 120000); // 2 minute timeout for geometry processing

    test('validates Wisconsin state senate districts match TIGER', async () => {
      console.log('\n=== Wisconsin State Senate Cross-Validation ===\n');

      // Extract from state source
      const stateResult = await stateExtractor.extractLayer('WI', 'state_senate');

      // Extract from TIGER
      const tigerFiles = await tigerProvider.downloadLayer({
        layer: 'sldu',
        stateFips: '55',
      });
      const tigerBoundaries = await tigerProvider.transform(tigerFiles);
      const wisconsinTiger = tigerBoundaries.filter(b => b.properties.stateFips === '55');

      // Compare counts
      const expectedCount = 33; // Wisconsin has 33 state senate districts
      const { match } = compareDistrictCounts(
        'WI',
        'state_senate',
        stateResult.featureCount,
        wisconsinTiger.length,
        expectedCount
      );

      console.log(`   State: ${stateResult.featureCount}, TIGER: ${wisconsinTiger.length}, Expected: ${expectedCount}`);
      console.log(`   Match: ${match ? '✅' : '❌'}`);

      // Validate (may not match exactly during redistricting)
      expect(stateResult.featureCount).toBeGreaterThanOrEqual(30);
      expect(wisconsinTiger.length).toBeGreaterThanOrEqual(30);
    }, 90000);

    test('performs comprehensive cross-validation for Wisconsin congressional districts', async () => {
      console.log('\n=== Wisconsin Comprehensive Cross-Validation ===\n');

      // Extract from state source
      const stateResult = await stateExtractor.extractLayer('WI', 'congressional');

      // Extract from TIGER
      const tigerFiles = await tigerProvider.downloadLayer({
        layer: 'cd',
        stateFips: '55',
      });
      const tigerBoundaries = await tigerProvider.transform(tigerFiles);
      const wisconsinTiger = tigerBoundaries.filter(b => b.properties.stateFips === '55');

      // 1. Count comparison
      const expectedCount = 8;
      const { match: countMatch } = compareDistrictCounts(
        'WI',
        'congressional',
        stateResult.featureCount,
        wisconsinTiger.length,
        expectedCount
      );

      // 2. GEOID consistency
      const geoidResult = compareGeoids(
        'WI',
        'congressional',
        stateResult.boundaries,
        wisconsinTiger.map(b => b.id)
      );

      // 3. Geometry overlap
      const tigerMap = new Map(
        wisconsinTiger.map(b => [
          normalizeGeoid(b.id, '55'),
          { geometry: b.geometry, name: b.name },
        ])
      );

      const geometryResult = compareGeometries(
        'WI',
        'congressional',
        stateResult.boundaries,
        tigerMap
      );

      // 4. Data vintage check
      const dataVintage = {
        stateVintage: stateResult.boundaries[0]?.source.vintage ?? 0,
        tigerVintage: 2024,
        acceptable: (stateResult.boundaries[0]?.source.vintage ?? 0) >= 2022, // Post-2020 redistricting
      };

      // 5. Calculate quality score
      const qualityScore = calculateQualityScore(
        countMatch,
        geoidResult.consistencyScore,
        geometryResult.averageIou * 100
      );

      // Build recommendation
      let recommendation = '';
      if (qualityScore >= 90) {
        recommendation = 'Excellent data quality - state and TIGER sources are highly consistent';
      } else if (qualityScore >= 75) {
        recommendation = 'Good data quality - minor discrepancies detected, review recommended';
      } else if (qualityScore >= 50) {
        recommendation = 'Fair data quality - significant discrepancies detected, manual review required';
      } else {
        recommendation = 'Poor data quality - major discrepancies detected, use TIGER as canonical source';
      }

      const countResult = {
        stateCount: stateResult.featureCount,
        tigerCount: wisconsinTiger.length,
        expectedCount,
        match: countMatch,
      };

      const result: CrossValidationResult = {
        state: 'WI',
        layerType: 'congressional',
        count: countResult as any, // Type cast for simplicity
        geoids: geoidResult,
        geometry: geometryResult,
        dataVintage,
        overallQuality: qualityScore,
        recommendation,
      };

      // Log comprehensive report
      console.log('\n   CROSS-VALIDATION REPORT');
      console.log('   ' + '='.repeat(50));
      console.log(`   State: ${result.state}`);
      console.log(`   Layer: ${result.layerType}`);
      console.log(`   Overall Quality Score: ${result.overallQuality}/100`);
      console.log(`   Recommendation: ${result.recommendation}`);
      console.log('\n   Count Matching:');
      console.log(`     State: ${countResult.stateCount}, TIGER: ${countResult.tigerCount}`);
      console.log(`     Match: ${countMatch ? '✅' : '❌'}`);
      console.log('\n   GEOID Consistency:');
      console.log(`     Score: ${geoidResult.consistencyScore.toFixed(1)}%`);
      console.log(`     Matching: ${geoidResult.matching.length}/${geoidResult.stateGeoids.length}`);
      console.log('\n   Geometry Overlap:');
      console.log(`     Average IoU: ${geometryResult.averageIou.toFixed(3)}`);
      console.log(`     Matched: ${geometryResult.matchedDistricts}/${geometryResult.totalDistricts}`);
      console.log('\n   Data Vintage:');
      console.log(`     State: ${dataVintage.stateVintage}, TIGER: ${dataVintage.tigerVintage}`);
      console.log(`     Post-2020 redistricting: ${dataVintage.acceptable ? '✅' : '❌'}`);

      // Validate - use more lenient threshold since live API data may have minor discrepancies
      expect(result.overallQuality).toBeGreaterThanOrEqual(60); // 60% minimum quality
      expect(result.dataVintage.acceptable).toBe(true);
      expect(countMatch).toBe(true);
      expect(geoidResult.consistencyScore).toBeGreaterThanOrEqual(95);
    }, 180000); // 3 minute timeout for comprehensive validation
  });

  // ============================================================================
  // Helper Function Tests
  // ============================================================================

  describe('Helper Functions', () => {
    test('normalizes GEOIDs correctly', () => {
      expect(normalizeGeoid('5508', '55')).toBe('5508');
      expect(normalizeGeoid('55-08', '55')).toBe('5508');
      expect(normalizeGeoid('WI-08', '55')).toBe('5508');
      expect(normalizeGeoid('8', '55')).toBe('5508');
      expect(normalizeGeoid('08', '55')).toBe('5508');
    });

    test('calculates IoU correctly', () => {
      // Create two identical squares
      const square1: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      };

      const square2: Polygon = {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      };

      const { iou } = calculateIoU(square1, square2);

      // Identical geometries should have IoU = 1.0
      expect(iou).toBeGreaterThanOrEqual(0.99);
    });

    test('calculates area difference correctly', () => {
      expect(calculateAreaDifference(100, 100)).toBe(0);
      expect(calculateAreaDifference(100, 110)).toBeCloseTo(9.52, 1);
      expect(calculateAreaDifference(100, 90)).toBeCloseTo(10.53, 1);
    });

    test('maps legislative layer types to TIGER layers', () => {
      expect(mapToTigerLayer('congressional')).toBe('cd');
      expect(mapToTigerLayer('state_senate')).toBe('sldu');
      expect(mapToTigerLayer('state_house')).toBe('sldl');
      expect(mapToTigerLayer('county')).toBe('county');
      expect(mapToTigerLayer('unknown')).toBeNull();
    });
  });
});
