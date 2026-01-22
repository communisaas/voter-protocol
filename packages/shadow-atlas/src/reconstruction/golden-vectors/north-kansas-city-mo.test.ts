/**
 * North Kansas City Golden Vector Test
 *
 * Tests the format and basic validation of the North Kansas City golden vector.
 * This test validates the data structure, not the accuracy of boundaries
 * (which requires human verification against official city records).
 *
 * TEST PHILOSOPHY:
 * - Validate JSON structure and required fields
 * - Verify GeoJSON geometry validity
 * - Document verification gaps
 * - Block deployment if accuracy claims are false
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GoldenVector } from '../types';
import { deserializeGoldenVector } from '../golden-vector-validator';

describe('North Kansas City Golden Vector', () => {
  let goldenVector: GoldenVector;

  test('loads and parses golden vector JSON', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');

    expect(() => {
      goldenVector = deserializeGoldenVector(jsonContent);
    }).not.toThrow();
  });

  test('has correct metadata', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    expect(goldenVector.cityFips).toBe('2951932');
    expect(goldenVector.cityName).toBe('North Kansas City');
    expect(goldenVector.state).toBe('MO');
    expect(goldenVector.expectedWardCount).toBe(4);
  });

  test('has all 4 ward descriptions', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    expect(goldenVector.legalDescriptions).toHaveLength(4);

    const wardIds = goldenVector.legalDescriptions.map((wd) => wd.wardId);
    expect(wardIds).toEqual(['1', '2', '3', '4']);
  });

  test('has all 4 expected polygons', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    expect(goldenVector.expectedPolygons).toHaveLength(4);

    for (const polygon of goldenVector.expectedPolygons) {
      expect(polygon.type).toBe('Feature');
      expect(polygon.geometry.type).toBe('Polygon');
      expect(polygon.properties?.wardId).toBeDefined();
    }
  });

  test('all polygons have valid closed rings', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    for (const polygon of goldenVector.expectedPolygons) {
      const ring = polygon.geometry.coordinates[0];

      // At least 4 points (triangle + closing point)
      expect(ring.length).toBeGreaterThanOrEqual(4);

      // Ring is closed (first point === last point)
      const first = ring[0];
      const last = ring[ring.length - 1];
      expect(first[0]).toBeCloseTo(last[0], 6);
      expect(first[1]).toBeCloseTo(last[1], 6);
    }
  });

  test('polygons are within expected geographic bounds', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    // North Kansas City center: 39.1367°N, 94.5690°W
    // Expected bounds: ~39.12 to 39.15°N, ~94.58 to 94.56°W
    const expectedMinLon = -94.58;
    const expectedMaxLon = -94.56;
    const expectedMinLat = 39.12;
    const expectedMaxLat = 39.15;

    for (const polygon of goldenVector.expectedPolygons) {
      const ring = polygon.geometry.coordinates[0];

      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(expectedMinLon);
        expect(lon).toBeLessThanOrEqual(expectedMaxLon);
        expect(lat).toBeGreaterThanOrEqual(expectedMinLat);
        expect(lat).toBeLessThanOrEqual(expectedMaxLat);
      }
    }
  });

  test('documents verification status and data quality warnings', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(jsonContent);

    // Must have metadata documenting approximation
    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata.precisionLevel).toBe('approximate');
    expect(parsed.metadata.verificationStatus).toBe('pending_human_verification');
    expect(parsed.metadata.dataQualityWarning).toBeDefined();

    // Must have notes warning about approximate nature
    expect(goldenVector.notes).toContain('APPROXIMATE');
    expect(goldenVector.notes).toContain('NOT be used for production');
  });

  test('provides actionable steps for obtaining accurate data', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    // Notes should include contact information
    expect(goldenVector.notes).toContain('816-274-6000');
    expect(goldenVector.notes).toContain('2010 Howell St');
    expect(goldenVector.notes).toContain('nkc.org');
  });

  test('source documents reference official redistricting page', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    for (const wardDesc of goldenVector.legalDescriptions) {
      expect(wardDesc.source.source).toContain('nkc.org');
      expect(wardDesc.source.effectiveDate).toBe('2021-11-16');
    }
  });

  test('polygons have approximate data flag in properties', () => {
    const jsonPath = join(__dirname, 'north-kansas-city-mo.json');
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    goldenVector = deserializeGoldenVector(jsonContent);

    for (const polygon of goldenVector.expectedPolygons) {
      expect(polygon.properties?.approximateData).toBe(true);
    }
  });
});

/**
 * VERIFICATION CHECKLIST (for future human verification):
 *
 * [ ] Obtain official 2021 Ward Map PDF from North Kansas City
 * [ ] Obtain ordinance/resolution text with legal descriptions
 * [ ] Extract or digitize actual boundary coordinates
 * [ ] Verify ward populations match 2020 Census data
 * [ ] Update this file with accurate coordinates
 * [ ] Remove approximateData flags from polygon properties
 * [ ] Update metadata.precisionLevel to "verified"
 * [ ] Update metadata.verificationStatus to "human_verified"
 * [ ] Update notes to reflect verification completion
 * [ ] Add contentHash to source documents
 * [ ] Document verification methodology
 *
 * CONTACT INFORMATION:
 * North Kansas City City Hall
 * 2010 Howell St
 * North Kansas City, MO 64116
 * Phone: (816) 274-6000
 * Website: https://www.nkc.org
 *
 * REQUEST:
 * - 2021 Ward Map (PDF or GIS shapefile)
 * - Ordinance or resolution text adopting new wards
 * - Any legal descriptions of ward boundaries
 */
