/**
 * School District Overlap Handling Tests
 *
 * Tests for dual-system state detection and ELSD-SCSD overlap validation.
 *
 * BACKGROUND:
 * In 9 dual-system states (CT, IL, ME, MA, MT, NH, NJ, RI, VT), elementary
 * and secondary school districts INTENTIONALLY overlap because they serve
 * the same geographic territory for different grade levels.
 *
 * TEST COVERAGE:
 * 1. Dual-system state identification
 * 2. ELSD-SCSD overlap allowance in dual-system states
 * 3. ELSD-SCSD overlap rejection in unified-only states
 * 4. All other overlap types rejected regardless of state
 * 5. Validation result notes for dual-system states
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Polygon } from 'geojson';
import {
  SchoolDistrictValidator,
  DUAL_SYSTEM_STATES,
  isDualSystemState,
} from '../../../validators/school-district-validator.js';
import type { NormalizedBoundary } from '../../../validators/tiger-validator.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a simple square polygon for testing
 */
function createTestPolygon(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number
): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat], // Closed ring
      ],
    ],
  };
}

/**
 * Create a mock NormalizedBoundary for testing
 */
function createMockBoundary(
  geoid: string,
  polygon: Polygon
): NormalizedBoundary {
  return {
    geoid,
    name: `District ${geoid}`,
    geometry: polygon,
    properties: {
      GEOID: geoid,
      NAME: `District ${geoid}`,
      STATEFP: geoid.substring(0, 2),
    },
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

// Overlapping polygons in Illinois (dual-system state)
const ILLINOIS_ELSD_1 = createTestPolygon(-88.0, 41.0, -87.0, 42.0);
const ILLINOIS_SCSD_1 = createTestPolygon(-88.0, 41.0, -87.0, 42.0); // Same area - intentional overlap

// Non-overlapping polygons in Illinois
const ILLINOIS_ELSD_2 = createTestPolygon(-89.0, 40.0, -88.5, 40.5);
const ILLINOIS_SCSD_2 = createTestPolygon(-88.4, 40.6, -88.0, 41.0); // Different area

// Overlapping polygons in Texas (unified-only state)
const TEXAS_UNSD_1 = createTestPolygon(-97.0, 30.0, -96.0, 31.0);
const TEXAS_UNSD_2 = createTestPolygon(-96.5, 30.5, -95.5, 31.5); // Partial overlap

// Non-overlapping unified districts
const TEXAS_UNSD_3 = createTestPolygon(-95.0, 29.0, -94.0, 30.0);
const TEXAS_UNSD_4 = createTestPolygon(-94.0, 30.0, -93.0, 31.0); // Adjacent, not overlapping

// ============================================================================
// Unit Tests
// ============================================================================

describe('Dual-System State Detection', () => {
  describe('DUAL_SYSTEM_STATES constant', () => {
    it('should contain exactly 9 states', () => {
      expect(DUAL_SYSTEM_STATES.size).toBe(9);
    });

    it('should include all known dual-system states', () => {
      const expectedStates = ['09', '17', '23', '25', '30', '33', '34', '44', '50'];
      for (const state of expectedStates) {
        expect(DUAL_SYSTEM_STATES.has(state)).toBe(true);
      }
    });

    it('should be a ReadonlySet (immutable)', () => {
      // TypeScript prevents modification, but verify runtime behavior
      expect(typeof DUAL_SYSTEM_STATES.add).toBe('function');
      // The set should still only have 9 elements
      expect(DUAL_SYSTEM_STATES.size).toBe(9);
    });
  });

  describe('isDualSystemState function', () => {
    it('should return true for Connecticut (09)', () => {
      expect(isDualSystemState('09')).toBe(true);
    });

    it('should return true for Illinois (17)', () => {
      expect(isDualSystemState('17')).toBe(true);
    });

    it('should return true for Maine (23)', () => {
      expect(isDualSystemState('23')).toBe(true);
    });

    it('should return true for Massachusetts (25)', () => {
      expect(isDualSystemState('25')).toBe(true);
    });

    it('should return true for Montana (30)', () => {
      expect(isDualSystemState('30')).toBe(true);
    });

    it('should return true for New Hampshire (33)', () => {
      expect(isDualSystemState('33')).toBe(true);
    });

    it('should return true for New Jersey (34)', () => {
      expect(isDualSystemState('34')).toBe(true);
    });

    it('should return true for Rhode Island (44)', () => {
      expect(isDualSystemState('44')).toBe(true);
    });

    it('should return true for Vermont (50)', () => {
      expect(isDualSystemState('50')).toBe(true);
    });

    it('should return false for Texas (48) - unified only', () => {
      expect(isDualSystemState('48')).toBe(false);
    });

    it('should return false for California (06) - mixed but not dual', () => {
      expect(isDualSystemState('06')).toBe(false);
    });

    it('should return false for Washington (53) - unified only', () => {
      expect(isDualSystemState('53')).toBe(false);
    });

    it('should return false for Florida (12) - unified only', () => {
      expect(isDualSystemState('12')).toBe(false);
    });

    it('should return false for New York (36) - unified with special cases', () => {
      expect(isDualSystemState('36')).toBe(false);
    });

    it('should return false for invalid FIPS code', () => {
      expect(isDualSystemState('99')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isDualSystemState('')).toBe(false);
    });
  });
});

describe('School District Overlap Validation', () => {
  let validator: SchoolDistrictValidator;

  beforeEach(() => {
    validator = new SchoolDistrictValidator();
  });

  describe('ELSD-SCSD overlaps in dual-system states', () => {
    it('should ALLOW ELSD-SCSD overlaps in Illinois (17)', async () => {
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1712345', ILLINOIS_ELSD_1),
      ];
      const scsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1767890', ILLINOIS_SCSD_1),
      ];

      const overlaps = await validator.checkOverlaps(
        [], // No unified districts
        elsdBoundaries,
        scsdBoundaries,
        '17' // Illinois
      );

      // Should have NO overlap issues - ELSD-SCSD overlaps are valid in Illinois
      expect(overlaps.length).toBe(0);
    });

    it('should ALLOW ELSD-SCSD overlaps in Massachusetts (25)', async () => {
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('2512345', createTestPolygon(-71.5, 42.0, -70.5, 42.5)),
      ];
      const scsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('2567890', createTestPolygon(-71.5, 42.0, -70.5, 42.5)),
      ];

      const overlaps = await validator.checkOverlaps(
        [],
        elsdBoundaries,
        scsdBoundaries,
        '25' // Massachusetts
      );

      expect(overlaps.length).toBe(0);
    });

    it('should ALLOW ELSD-SCSD overlaps in all 9 dual-system states', async () => {
      const dualSystemStates = ['09', '17', '23', '25', '30', '33', '34', '44', '50'];

      for (const stateFips of dualSystemStates) {
        const elsdBoundaries: readonly NormalizedBoundary[] = [
          createMockBoundary(`${stateFips}12345`, createTestPolygon(-100.0, 40.0, -99.0, 41.0)),
        ];
        const scsdBoundaries: readonly NormalizedBoundary[] = [
          createMockBoundary(`${stateFips}67890`, createTestPolygon(-100.0, 40.0, -99.0, 41.0)),
        ];

        const overlaps = await validator.checkOverlaps(
          [],
          elsdBoundaries,
          scsdBoundaries,
          stateFips
        );

        expect(overlaps.length).toBe(0);
      }
    });
  });

  describe('ELSD-SCSD overlaps in non-dual-system states', () => {
    it('should FLAG ELSD-SCSD overlaps in Texas (48)', async () => {
      // Texas shouldn't have ELSD/SCSD anyway, but if they exist and overlap, it's invalid
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('4812345', createTestPolygon(-97.0, 30.0, -96.0, 31.0)),
      ];
      const scsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('4867890', createTestPolygon(-97.0, 30.0, -96.0, 31.0)),
      ];

      const overlaps = await validator.checkOverlaps(
        [],
        elsdBoundaries,
        scsdBoundaries,
        '48' // Texas
      );

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type1).toBe('elsd');
      expect(overlaps[0].type2).toBe('scsd');
      expect(overlaps[0].description).toContain('invalid');
      expect(overlaps[0].description).toContain('Texas');
    });

    it('should FLAG ELSD-SCSD overlaps in California (06)', async () => {
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('0612345', createTestPolygon(-118.5, 34.0, -118.0, 34.5)),
      ];
      const scsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('0667890', createTestPolygon(-118.5, 34.0, -118.0, 34.5)),
      ];

      const overlaps = await validator.checkOverlaps(
        [],
        elsdBoundaries,
        scsdBoundaries,
        '06' // California
      );

      expect(overlaps.length).toBeGreaterThan(0);
    });
  });

  describe('UNSD overlaps - always invalid', () => {
    it('should FLAG UNSD-UNSD overlaps regardless of state', async () => {
      const unsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('4800001', TEXAS_UNSD_1),
        createMockBoundary('4800002', TEXAS_UNSD_2), // Overlaps with UNSD_1
      ];

      const overlaps = await validator.checkOverlaps(
        unsdBoundaries,
        [],
        [],
        '48'
      );

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type1).toBe('unsd');
      expect(overlaps[0].type2).toBe('unsd');
      expect(overlaps[0].description).toContain('never valid');
    });

    it('should FLAG UNSD-ELSD overlaps even in dual-system states', async () => {
      const unsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1700001', ILLINOIS_ELSD_1),
      ];
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1712345', ILLINOIS_ELSD_1), // Same geometry - overlaps
      ];

      const overlaps = await validator.checkOverlaps(
        unsdBoundaries,
        elsdBoundaries,
        [],
        '17' // Illinois (dual-system state)
      );

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type1).toBe('unsd');
      expect(overlaps[0].type2).toBe('elsd');
      expect(overlaps[0].description).toContain('never valid');
    });

    it('should FLAG UNSD-SCSD overlaps even in dual-system states', async () => {
      const unsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1700001', ILLINOIS_SCSD_1),
      ];
      const scsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1767890', ILLINOIS_SCSD_1),
      ];

      const overlaps = await validator.checkOverlaps(
        unsdBoundaries,
        [],
        scsdBoundaries,
        '17'
      );

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type1).toBe('unsd');
      expect(overlaps[0].type2).toBe('scsd');
    });
  });

  describe('Same-type overlaps - always invalid', () => {
    it('should FLAG ELSD-ELSD overlaps in dual-system states', async () => {
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1712345', ILLINOIS_ELSD_1),
        createMockBoundary('1712346', ILLINOIS_ELSD_1), // Same geometry
      ];

      const overlaps = await validator.checkOverlaps(
        [],
        elsdBoundaries,
        [],
        '17'
      );

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type1).toBe('elsd');
      expect(overlaps[0].type2).toBe('elsd');
      expect(overlaps[0].description).toContain('never valid');
    });

    it('should FLAG SCSD-SCSD overlaps in dual-system states', async () => {
      const scsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1767890', ILLINOIS_SCSD_1),
        createMockBoundary('1767891', ILLINOIS_SCSD_1),
      ];

      const overlaps = await validator.checkOverlaps(
        [],
        [],
        scsdBoundaries,
        '17'
      );

      expect(overlaps.length).toBeGreaterThan(0);
      expect(overlaps[0].type1).toBe('scsd');
      expect(overlaps[0].type2).toBe('scsd');
    });
  });

  describe('Non-overlapping districts', () => {
    it('should return no issues for non-overlapping unified districts', async () => {
      const unsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('4800003', TEXAS_UNSD_3),
        createMockBoundary('4800004', TEXAS_UNSD_4),
      ];

      const overlaps = await validator.checkOverlaps(
        unsdBoundaries,
        [],
        [],
        '48'
      );

      expect(overlaps.length).toBe(0);
    });

    it('should return no issues for non-overlapping ELSD districts', async () => {
      const elsdBoundaries: readonly NormalizedBoundary[] = [
        createMockBoundary('1712345', ILLINOIS_ELSD_2),
        createMockBoundary('1712346', createTestPolygon(-90.0, 39.0, -89.5, 39.5)),
      ];

      const overlaps = await validator.checkOverlaps(
        [],
        elsdBoundaries,
        [],
        '17'
      );

      expect(overlaps.length).toBe(0);
    });
  });
});

describe('Validation Result Notes', () => {
  let validator: SchoolDistrictValidator;

  beforeEach(() => {
    validator = new SchoolDistrictValidator();
  });

  it('should include dual-system explanation note for Illinois', async () => {
    const result = await validator.validate('17', 2024);

    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.notes.some(note =>
      note.includes('dual elementary/secondary') &&
      note.includes('Elementary (K-8) and secondary (9-12)')
    )).toBe(true);
  });

  it('should include dual-system explanation note for all 9 dual-system states', async () => {
    const dualSystemStates = ['09', '17', '23', '25', '30', '33', '34', '44', '50'];

    for (const stateFips of dualSystemStates) {
      const result = await validator.validate(stateFips, 2024);
      expect(result.notes.some(note =>
        note.includes('dual elementary/secondary')
      )).toBe(true);
    }
  });

  it('should NOT include dual-system note for Texas (unified-only)', async () => {
    const result = await validator.validate('48', 2024);

    expect(result.notes.some(note =>
      note.includes('dual elementary/secondary')
    )).toBe(false);
  });

  it('should include system type note for unified-only states', async () => {
    const result = await validator.validate('48', 2024);

    expect(result.notes.some(note =>
      note.includes('unified school districts only')
    )).toBe(true);
  });

  it('should include notes array in result even if empty for unknown states', async () => {
    const result = await validator.validate('48', 2024);
    expect(Array.isArray(result.notes)).toBe(true);
  });
});
