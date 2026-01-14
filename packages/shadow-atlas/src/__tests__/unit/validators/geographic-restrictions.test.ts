/**
 * Geographic Restrictions Tests
 *
 * Tests for TIGER layer geographic restrictions.
 *
 * NECTA (New England City and Town Areas) is a statistical concept that
 * ONLY applies to New England. The Census Bureau uses towns (not counties)
 * as building blocks in New England because towns are the primary local
 * government there.
 *
 * NEW ENGLAND STATES (allowed for NECTA):
 * - 09 = Connecticut
 * - 23 = Maine
 * - 25 = Massachusetts
 * - 33 = New Hampshire
 * - 44 = Rhode Island
 * - 50 = Vermont
 *
 * RELATED NECTA LAYERS (all New England only):
 * - necta - New England City and Town Areas
 * - cnecta - Combined NECTAs
 * - nectadiv - NECTA Divisions
 */

import { describe, it, expect } from 'vitest';
import { TIGERValidator } from '../../../validators/tiger/validator.js';
import type { NormalizedBoundary } from '../../../validators/tiger/validator.js';
import {
  NEW_ENGLAND_FIPS,
  USVI_FIPS,
  EXPECTED_ESTATE_COUNT,
  LAYER_TOPOLOGY_RULES,
} from '../../../validators/topology/rules.js';
import type { Polygon } from 'geojson';

describe('Geographic Restrictions', () => {
  const validator = new TIGERValidator();

  /**
   * Create a valid polygon for testing
   */
  function createValidPolygon(): Polygon {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [-71.0, 42.0],
          [-71.0, 43.0],
          [-70.0, 43.0],
          [-70.0, 42.0],
          [-71.0, 42.0], // Closed ring
        ],
      ],
    };
  }

  describe('NECTA Layer Restrictions', () => {
    const nectaLayers = ['necta', 'cnecta', 'nectadiv'] as const;

    describe('should allow NECTA layers for New England states', () => {
      // Test each New England state
      const newEnglandStates = [
        { fips: '09', name: 'Connecticut' },
        { fips: '23', name: 'Maine' },
        { fips: '25', name: 'Massachusetts' },
        { fips: '33', name: 'New Hampshire' },
        { fips: '44', name: 'Rhode Island' },
        { fips: '50', name: 'Vermont' },
      ];

      for (const state of newEnglandStates) {
        for (const layer of nectaLayers) {
          it(`should allow ${layer.toUpperCase()} for ${state.name} (FIPS ${state.fips})`, () => {
            const boundaries: NormalizedBoundary[] = [
              {
                geoid: `${state.fips}001`,
                name: `Test ${layer.toUpperCase()} Area`,
                geometry: createValidPolygon(),
                properties: {},
              },
            ];

            const result = validator.validateCompleteness(layer, boundaries, state.fips);

            // Should not fail due to geographic restriction
            // May fail due to count mismatch if expected count differs, but NOT due to geo restriction
            expect(result.summary).not.toContain('only valid for New England');
          });
        }
      }
    });

    describe('should reject NECTA layers for non-New England states', () => {
      // Test sample non-New England states
      const nonNewEnglandStates = [
        { fips: '06', name: 'California' },
        { fips: '48', name: 'Texas' },
        { fips: '12', name: 'Florida' },
        { fips: '36', name: 'New York' },
        { fips: '17', name: 'Illinois' },
        { fips: '42', name: 'Pennsylvania' },
        { fips: '01', name: 'Alabama' },
        { fips: '56', name: 'Wyoming' },
      ];

      for (const state of nonNewEnglandStates) {
        for (const layer of nectaLayers) {
          it(`should reject ${layer.toUpperCase()} for ${state.name} (FIPS ${state.fips})`, () => {
            const boundaries: NormalizedBoundary[] = [
              {
                geoid: `${state.fips}001`,
                name: `Test ${layer.toUpperCase()} Area`,
                geometry: createValidPolygon(),
                properties: {},
              },
            ];

            const result = validator.validateCompleteness(layer, boundaries, state.fips);

            expect(result.valid).toBe(false);
            expect(result.summary).toContain('only valid for New England');
            expect(result.summary).toContain(layer.toUpperCase());
            expect(result.expected).toBe(0);
            expect(result.actual).toBe(0);
            expect(result.percentage).toBe(0);
          });
        }
      }
    });

    it('should reject NECTA for territories', () => {
      const territories = [
        { fips: '60', name: 'American Samoa' },
        { fips: '66', name: 'Guam' },
        { fips: '69', name: 'Northern Mariana Islands' },
        { fips: '72', name: 'Puerto Rico' },
        { fips: '78', name: 'US Virgin Islands' },
      ];

      for (const territory of territories) {
        const boundaries: NormalizedBoundary[] = [
          {
            geoid: `${territory.fips}001`,
            name: 'Test NECTA Area',
            geometry: createValidPolygon(),
            properties: {},
          },
        ];

        const result = validator.validateCompleteness('necta', boundaries, territory.fips);

        expect(result.valid).toBe(false);
        expect(result.summary).toContain('only valid for New England');
      }
    });
  });

  describe('Non-NECTA layers should not have geographic restrictions', () => {
    const nonNectaLayers = [
      'cd',
      'sldu',
      'sldl',
      'county',
      'place',
      'cdp',
      'zcta',
      'vtd',
      'cousub',
      'unsd',
      'elsd',
      'scsd',
    ] as const;

    for (const layer of nonNectaLayers) {
      it(`should allow ${layer.toUpperCase()} for any state`, () => {
        // Test with a non-New England state (California)
        const boundaries: NormalizedBoundary[] = [
          {
            geoid: '0600001',
            name: `Test ${layer.toUpperCase()} Area`,
            geometry: createValidPolygon(),
            properties: {
              GEOID: '0600001',
              NAME: `Test ${layer.toUpperCase()} Area`,
              STATEFP: '06',
            },
          },
        ];

        const result = validator.validateCompleteness(layer, boundaries, '06');

        // Should not fail due to geographic restriction
        // May fail due to count mismatch, but NOT due to geo restriction
        expect(result.summary).not.toContain('only valid for New England');
      });
    }
  });

  describe('NEW_ENGLAND_FIPS constant', () => {
    it('should contain exactly 6 New England states', () => {
      expect(NEW_ENGLAND_FIPS).toHaveLength(6);
    });

    it('should contain the correct FIPS codes', () => {
      expect(NEW_ENGLAND_FIPS).toContain('09'); // Connecticut
      expect(NEW_ENGLAND_FIPS).toContain('23'); // Maine
      expect(NEW_ENGLAND_FIPS).toContain('25'); // Massachusetts
      expect(NEW_ENGLAND_FIPS).toContain('33'); // New Hampshire
      expect(NEW_ENGLAND_FIPS).toContain('44'); // Rhode Island
      expect(NEW_ENGLAND_FIPS).toContain('50'); // Vermont
    });

    it('should not contain non-New England states', () => {
      expect(NEW_ENGLAND_FIPS).not.toContain('06'); // California
      expect(NEW_ENGLAND_FIPS).not.toContain('36'); // New York
      expect(NEW_ENGLAND_FIPS).not.toContain('34'); // New Jersey
    });
  });

  describe('LAYER_TOPOLOGY_RULES configuration', () => {
    it('should have allowedStateFips for NECTA layer', () => {
      expect(LAYER_TOPOLOGY_RULES.necta.allowedStateFips).toBeDefined();
      expect(LAYER_TOPOLOGY_RULES.necta.allowedStateFips).toEqual(NEW_ENGLAND_FIPS);
    });

    it('should have allowedStateFips for CNECTA layer', () => {
      expect(LAYER_TOPOLOGY_RULES.cnecta.allowedStateFips).toBeDefined();
      expect(LAYER_TOPOLOGY_RULES.cnecta.allowedStateFips).toEqual(NEW_ENGLAND_FIPS);
    });

    it('should have allowedStateFips for NECTADIV layer', () => {
      expect(LAYER_TOPOLOGY_RULES.nectadiv.allowedStateFips).toBeDefined();
      expect(LAYER_TOPOLOGY_RULES.nectadiv.allowedStateFips).toEqual(NEW_ENGLAND_FIPS);
    });

    it('should NOT have allowedStateFips for non-NECTA layers', () => {
      // Most layers should not have geographic restrictions
      expect(LAYER_TOPOLOGY_RULES.cd.allowedStateFips).toBeUndefined();
      expect(LAYER_TOPOLOGY_RULES.county.allowedStateFips).toBeUndefined();
      expect(LAYER_TOPOLOGY_RULES.place.allowedStateFips).toBeUndefined();
      expect(LAYER_TOPOLOGY_RULES.vtd.allowedStateFips).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle NECTA layer without stateFips (national query)', () => {
      // When no stateFips is provided, geographic restriction should not apply
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '25001',
          name: 'Test NECTA Area',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validateCompleteness('necta', boundaries);

      // Should not fail due to geographic restriction when no state specified
      expect(result.summary).not.toContain('only valid for New England');
    });

    it('should include state name in error message', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '06001',
          name: 'Test NECTA Area',
          geometry: createValidPolygon(),
          properties: {},
        },
      ];

      const result = validator.validateCompleteness('necta', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.summary).toContain('California');
    });

    it('should work with empty boundaries array for restricted state', () => {
      const boundaries: NormalizedBoundary[] = [];

      const result = validator.validateCompleteness('necta', boundaries, '06');

      // Should still fail due to geographic restriction, not due to empty array
      expect(result.valid).toBe(false);
      expect(result.summary).toContain('only valid for New England');
    });
  });

  // ============================================================================
  // Estate Layer Restrictions (WP-GEO-2)
  // ============================================================================

  describe('Estate Layer Restrictions', () => {
    /**
     * Estates are a unique administrative division that exists ONLY in the
     * US Virgin Islands (FIPS 78). They are the USVI equivalent of counties.
     *
     * There are exactly 3 estates:
     * - St. Croix
     * - St. John
     * - St. Thomas
     *
     * No other US state or territory has estates.
     */

    describe('should allow Estate layer for US Virgin Islands', () => {
      it('should allow estate for USVI (FIPS 78)', () => {
        const boundaries: NormalizedBoundary[] = [
          {
            geoid: '78001',
            name: 'St. Croix',
            geometry: createValidPolygon(),
            properties: { GEOID: '78001', NAME: 'St. Croix', STATEFP: '78' },
          },
          {
            geoid: '78002',
            name: 'St. John',
            geometry: createValidPolygon(),
            properties: { GEOID: '78002', NAME: 'St. John', STATEFP: '78' },
          },
          {
            geoid: '78003',
            name: 'St. Thomas',
            geometry: createValidPolygon(),
            properties: { GEOID: '78003', NAME: 'St. Thomas', STATEFP: '78' },
          },
        ];

        const result = validator.validateCompleteness('estate', boundaries, '78');

        // Should not fail due to geographic restriction
        expect(result.summary).not.toContain('only valid for US Virgin Islands');
      });

      it('should accept exactly 3 estates for USVI', () => {
        // checkGeographicRestriction returns expectedCount for estate layer
        const result = validator.checkGeographicRestriction('estate', '78');

        expect(result.valid).toBe(true);
        expect(result.expectedCount).toBe(EXPECTED_ESTATE_COUNT);
        expect(result.expectedCount).toBe(3);
      });
    });

    describe('should reject Estate layer for non-USVI states', () => {
      // Test sample continental US states
      const nonUSVIStates = [
        { fips: '01', name: 'Alabama' },
        { fips: '06', name: 'California' },
        { fips: '12', name: 'Florida' },
        { fips: '17', name: 'Illinois' },
        { fips: '36', name: 'New York' },
        { fips: '48', name: 'Texas' },
        { fips: '53', name: 'Washington' },
        { fips: '25', name: 'Massachusetts' }, // New England but still no estates
      ];

      for (const state of nonUSVIStates) {
        it(`should reject estate for ${state.name} (FIPS ${state.fips})`, () => {
          const boundaries: NormalizedBoundary[] = [
            {
              geoid: `${state.fips}001`,
              name: 'Test Estate Area',
              geometry: createValidPolygon(),
              properties: {},
            },
          ];

          const result = validator.validateCompleteness('estate', boundaries, state.fips);

          expect(result.valid).toBe(false);
          expect(result.summary).toContain('only valid for US Virgin Islands');
          expect(result.summary).toContain('FIPS 78');
          expect(result.expected).toBe(0);
          expect(result.actual).toBe(0);
        });
      }
    });

    describe('should reject Estate layer for other territories', () => {
      const otherTerritories = [
        { fips: '60', name: 'American Samoa' },
        { fips: '66', name: 'Guam' },
        { fips: '69', name: 'Northern Mariana Islands' },
        { fips: '72', name: 'Puerto Rico' },
      ];

      for (const territory of otherTerritories) {
        it(`should reject estate for ${territory.name} (FIPS ${territory.fips})`, () => {
          const boundaries: NormalizedBoundary[] = [
            {
              geoid: `${territory.fips}001`,
              name: 'Test Estate Area',
              geometry: createValidPolygon(),
              properties: {},
            },
          ];

          const result = validator.validateCompleteness('estate', boundaries, territory.fips);

          expect(result.valid).toBe(false);
          expect(result.summary).toContain('only valid for US Virgin Islands');
        });
      }
    });

    describe('Estate layer national query behavior', () => {
      it('should allow estate layer without stateFips (national query)', () => {
        // National query should not trigger geographic restriction
        const boundaries: NormalizedBoundary[] = [
          {
            geoid: '78001',
            name: 'St. Croix',
            geometry: createValidPolygon(),
            properties: {},
          },
          {
            geoid: '78002',
            name: 'St. John',
            geometry: createValidPolygon(),
            properties: {},
          },
          {
            geoid: '78003',
            name: 'St. Thomas',
            geometry: createValidPolygon(),
            properties: {},
          },
        ];

        const result = validator.validateCompleteness('estate', boundaries);

        // Should not fail due to geographic restriction when no state specified
        expect(result.summary).not.toContain('only valid for US Virgin Islands');
      });

      it('should return expectedCount=3 for national estate query', () => {
        const result = validator.checkGeographicRestriction('estate');

        expect(result.valid).toBe(true);
        expect(result.expectedCount).toBe(3);
      });
    });
  });

  // ============================================================================
  // Estate Constants Tests
  // ============================================================================

  describe('USVI_FIPS constant', () => {
    it('should contain exactly 1 territory (USVI)', () => {
      expect(USVI_FIPS).toHaveLength(1);
    });

    it('should contain FIPS code 78', () => {
      expect(USVI_FIPS).toContain('78');
    });

    it('should not contain other territories', () => {
      expect(USVI_FIPS).not.toContain('60'); // American Samoa
      expect(USVI_FIPS).not.toContain('66'); // Guam
      expect(USVI_FIPS).not.toContain('69'); // Northern Mariana Islands
      expect(USVI_FIPS).not.toContain('72'); // Puerto Rico
    });
  });

  describe('EXPECTED_ESTATE_COUNT constant', () => {
    it('should equal exactly 3', () => {
      expect(EXPECTED_ESTATE_COUNT).toBe(3);
    });
  });

  describe('LAYER_TOPOLOGY_RULES Estate configuration', () => {
    it('should have allowedStateFips for Estate layer', () => {
      expect(LAYER_TOPOLOGY_RULES.estate.allowedStateFips).toBeDefined();
      expect(LAYER_TOPOLOGY_RULES.estate.allowedStateFips).toEqual(USVI_FIPS);
    });

    it('should have estate layer configured for tiling within parent', () => {
      expect(LAYER_TOPOLOGY_RULES.estate.mustTileWithinParent).toBe(true);
    });

    it('should not allow overlaps for estate layer', () => {
      expect(LAYER_TOPOLOGY_RULES.estate.overlapsPermitted).toBe(false);
    });
  });

  // ============================================================================
  // checkGeographicRestriction Direct Tests
  // ============================================================================

  describe('checkGeographicRestriction method', () => {
    describe('Estate layer direct checks', () => {
      it('should return valid=true for estate with USVI FIPS', () => {
        const result = validator.checkGeographicRestriction('estate', '78');
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(result.expectedCount).toBe(3);
      });

      it('should return valid=false with reason for estate with non-USVI FIPS', () => {
        const result = validator.checkGeographicRestriction('estate', '06');
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Estate layer only valid for US Virgin Islands');
        expect(result.reason).toContain('FIPS 78');
        expect(result.reason).toContain('California');
      });

      it('should return valid=true with expectedCount for estate national query', () => {
        const result = validator.checkGeographicRestriction('estate');
        expect(result.valid).toBe(true);
        expect(result.expectedCount).toBe(3);
      });
    });

    describe('Non-restricted layers', () => {
      const nonRestrictedLayers = ['county', 'place', 'vtd', 'unsd'] as const;

      for (const layer of nonRestrictedLayers) {
        it(`should return valid=true for ${layer} regardless of state`, () => {
          const result = validator.checkGeographicRestriction(layer, '06');
          expect(result.valid).toBe(true);
          expect(result.reason).toBeUndefined();
        });
      }
    });
  });
});

// ============================================================================
// At-Large Congressional District Tests (WP-GEO-3)
// ============================================================================

/**
 * At-Large Congressional District Tests
 *
 * Six states have only ONE congressional district (at-large representation):
 * - 02 = Alaska, 10 = Delaware, 38 = North Dakota
 * - 46 = South Dakota, 50 = Vermont, 56 = Wyoming
 *
 * Five territories have 1 non-voting delegate:
 * - 60 = American Samoa, 66 = Guam, 69 = Northern Mariana Islands
 * - 72 = Puerto Rico (resident commissioner), 78 = US Virgin Islands
 *
 * TIGER files for at-large states sometimes contain placeholder features
 * with "ZZZ" or "00" district codes that must be filtered before validation.
 */
describe('At-Large Congressional Districts', () => {
  const validator = new TIGERValidator();

  /**
   * Create a valid polygon for CD testing
   */
  function createCDPolygon(): Polygon {
    return {
      type: 'Polygon',
      coordinates: [
        [
          [-122.0, 47.0],
          [-122.0, 48.0],
          [-121.0, 48.0],
          [-121.0, 47.0],
          [-122.0, 47.0], // Closed ring
        ],
      ],
    };
  }

  /**
   * Create a congressional district boundary for testing
   */
  function createCDBoundary(
    stateFips: string,
    districtCode: string,
    name: string
  ): NormalizedBoundary {
    return {
      geoid: `${stateFips}${districtCode}`,
      name,
      geometry: createCDPolygon(),
      properties: {
        GEOID: `${stateFips}${districtCode}`,
        NAMELSAD: name,
        STATEFP: stateFips,
        CD119FP: districtCode,
      },
    };
  }

  describe('isAtLargeCongressionalState', () => {
    it('should identify at-large states', () => {
      // At-large states (1 voting representative)
      expect(validator.isAtLargeCongressionalState('02')).toBe(true); // Alaska
      expect(validator.isAtLargeCongressionalState('10')).toBe(true); // Delaware
      expect(validator.isAtLargeCongressionalState('38')).toBe(true); // North Dakota
      expect(validator.isAtLargeCongressionalState('46')).toBe(true); // South Dakota
      expect(validator.isAtLargeCongressionalState('50')).toBe(true); // Vermont
      expect(validator.isAtLargeCongressionalState('56')).toBe(true); // Wyoming
    });

    it('should identify territory delegates', () => {
      // Territory delegates (non-voting)
      expect(validator.isAtLargeCongressionalState('60')).toBe(true); // American Samoa
      expect(validator.isAtLargeCongressionalState('66')).toBe(true); // Guam
      expect(validator.isAtLargeCongressionalState('69')).toBe(true); // Northern Mariana Islands
      expect(validator.isAtLargeCongressionalState('72')).toBe(true); // Puerto Rico
      expect(validator.isAtLargeCongressionalState('78')).toBe(true); // US Virgin Islands
    });

    it('should return false for multi-district states', () => {
      expect(validator.isAtLargeCongressionalState('06')).toBe(false); // California (52 CDs)
      expect(validator.isAtLargeCongressionalState('48')).toBe(false); // Texas (38 CDs)
      expect(validator.isAtLargeCongressionalState('12')).toBe(false); // Florida (28 CDs)
      expect(validator.isAtLargeCongressionalState('36')).toBe(false); // New York (26 CDs)
    });
  });

  describe('isPlaceholderDistrictCode', () => {
    it('should identify placeholder codes', () => {
      expect(validator.isPlaceholderDistrictCode('ZZ')).toBe(true);
      expect(validator.isPlaceholderDistrictCode('00')).toBe(true);
      expect(validator.isPlaceholderDistrictCode('98')).toBe(true);
      expect(validator.isPlaceholderDistrictCode('99')).toBe(true);
    });

    it('should be case-insensitive for ZZ', () => {
      expect(validator.isPlaceholderDistrictCode('zz')).toBe(true);
      expect(validator.isPlaceholderDistrictCode('Zz')).toBe(true);
    });

    it('should return false for valid district codes', () => {
      expect(validator.isPlaceholderDistrictCode('01')).toBe(false);
      expect(validator.isPlaceholderDistrictCode('02')).toBe(false);
      expect(validator.isPlaceholderDistrictCode('52')).toBe(false);
    });
  });

  describe('filterPlaceholderDistricts', () => {
    it('should filter ZZ placeholder districts', () => {
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('02', '01', 'Alaska At-Large'),
        createCDBoundary('02', 'ZZ', 'Alaska Placeholder'),
      ];

      const filtered = validator.filterPlaceholderDistricts(boundaries);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].geoid).toBe('0201');
    });

    it('should keep 00 district for at-large states (Wyoming)', () => {
      // Wyoming is at-large - district code 00 is VALID, not a placeholder
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('56', '00', 'Wyoming At-Large'),
        createCDBoundary('56', 'ZZ', 'Wyoming Placeholder'),
      ];

      const filtered = validator.filterPlaceholderDistricts(boundaries);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].geoid).toBe('5600');
    });

    it('should filter 98 and 99 placeholder districts', () => {
      // Vermont is at-large - uses district code 00
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('50', '00', 'Vermont At-Large'),
        createCDBoundary('50', '98', 'Vermont Overseas'),
        createCDBoundary('50', '99', 'Vermont Undefined'),
      ];

      const filtered = validator.filterPlaceholderDistricts(boundaries);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].geoid).toBe('5000');
    });

    it('should not filter valid district codes', () => {
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('06', '01', 'California District 1'),
        createCDBoundary('06', '02', 'California District 2'),
        createCDBoundary('06', '52', 'California District 52'),
      ];

      const filtered = validator.filterPlaceholderDistricts(boundaries);

      expect(filtered).toHaveLength(3);
    });

    it('should handle mixed valid and placeholder districts', () => {
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('06', '01', 'California District 1'),
        createCDBoundary('06', 'ZZ', 'California Placeholder 1'),
        createCDBoundary('06', '02', 'California District 2'),
        createCDBoundary('06', '00', 'California Placeholder 2'),
        createCDBoundary('06', '03', 'California District 3'),
      ];

      const filtered = validator.filterPlaceholderDistricts(boundaries);

      expect(filtered).toHaveLength(3);
      expect(filtered.map(b => b.geoid)).toEqual(['0601', '0602', '0603']);
    });
  });

  describe('validateCompleteness with at-large states', () => {
    // NOTE: At-large states use district code '00' (not '01') per Census TIGER convention
    // This differs from multi-district states where '00' is a placeholder

    it('should validate Alaska with 1 CD boundary (district 00)', () => {
      // Alaska at-large uses GEOID 0200 (state 02 + district 00)
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('02', '00', 'Alaska At-Large'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '02');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(1);
      expect(result.summary).toContain('Complete');
    });

    it('should filter placeholder and validate Alaska correctly', () => {
      // TIGER data contains valid district 00 + ZZ placeholder
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('02', '00', 'Alaska At-Large'),
        createCDBoundary('02', 'ZZ', 'Alaska Placeholder'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '02');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(1);
      expect(result.summary).toContain('filtered 1 placeholder');
    });

    it('should validate Delaware with 1 CD boundary (district 00)', () => {
      // Delaware at-large uses GEOID 1000 (state 10 + district 00)
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('10', '00', 'Delaware At-Large'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '10');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(1);
    });

    it('should validate Wyoming with district 00 (at-large)', () => {
      // Wyoming at-large uses GEOID 5600 (state 56 + district 00)
      // District 00 is VALID for at-large states, not a placeholder
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('56', '00', 'Wyoming At-Large'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '56');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(1);
    });

    it('should validate territory delegate (Puerto Rico uses 00)', () => {
      // Puerto Rico resident commissioner uses GEOID 7200
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('72', '00', 'Puerto Rico Resident Commissioner'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '72');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(1);
    });
  });

  describe('validateCompleteness with multi-district states', () => {
    it('should validate California with 52 CD boundaries (no filtering needed)', () => {
      const boundaries: NormalizedBoundary[] = Array.from({ length: 52 }, (_, i) =>
        createCDBoundary('06', String(i + 1).padStart(2, '0'), `California District ${i + 1}`)
      );

      const result = validator.validateCompleteness('cd', boundaries, '06');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(52);
      expect(result.actual).toBe(52);
      expect(result.summary).not.toContain('filtered');
    });

    it('should filter placeholders from California data', () => {
      // California has 52 real districts + some placeholders
      const boundaries: NormalizedBoundary[] = [
        ...Array.from({ length: 52 }, (_, i) =>
          createCDBoundary('06', String(i + 1).padStart(2, '0'), `California District ${i + 1}`)
        ),
        createCDBoundary('06', 'ZZ', 'California Placeholder'),
        createCDBoundary('06', '99', 'California Undefined'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '06');

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(52);
      expect(result.actual).toBe(52);
      expect(result.summary).toContain('filtered 2 placeholder');
    });

    it('should detect missing CD even after filtering', () => {
      // California with 51 real districts + 1 placeholder = still incomplete
      const boundaries: NormalizedBoundary[] = [
        ...Array.from({ length: 51 }, (_, i) =>
          createCDBoundary('06', String(i + 1).padStart(2, '0'), `California District ${i + 1}`)
        ),
        createCDBoundary('06', 'ZZ', 'California Placeholder'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '06');

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(52);
      expect(result.actual).toBe(51);
      expect(result.summary).toContain('count mismatch');
      expect(result.summary).toContain('filtered 1 placeholder');
    });
  });

  describe('at-large edge cases', () => {
    it('should handle empty boundary array for at-large state', () => {
      const boundaries: NormalizedBoundary[] = [];

      const result = validator.validateCompleteness('cd', boundaries, '02');

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(0);
    });

    it('should handle all-placeholder boundary array', () => {
      // Test with only TRUE placeholders (ZZ, 98, 99) - NOT 00
      // For at-large states, 00 is the VALID district, not a placeholder
      const boundaries: NormalizedBoundary[] = [
        createCDBoundary('02', 'ZZ', 'Alaska Placeholder 1'),
        createCDBoundary('02', '99', 'Alaska Placeholder 2'),
      ];

      const result = validator.validateCompleteness('cd', boundaries, '02');

      expect(result.valid).toBe(false);
      expect(result.expected).toBe(1);
      expect(result.actual).toBe(0);
      expect(result.summary).toContain('filtered 2 placeholder');
    });

    it('should not filter non-CD layers', () => {
      // SLDU with codes that look like placeholders
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '02001', // Alaska SLDU 1
          name: 'Alaska Senate District 1',
          geometry: createCDPolygon(),
          properties: {
            GEOID: '02001',
            NAMELSAD: 'State Senate District 1',
            STATEFP: '02',
            SLDUST: '001',
          },
        },
      ];

      // Should not filter - SLDU layer doesn't use placeholder filtering
      const result = validator.validateCompleteness('sldu', boundaries, '02');

      // This won't be valid due to count mismatch (Alaska has 20 SLDU),
      // but the point is that no filtering occurred
      expect(result.actual).toBe(1);
      expect(result.summary).not.toContain('filtered');
    });

    it('should handle malformed GEOID gracefully', () => {
      const boundaries: NormalizedBoundary[] = [
        {
          geoid: '02', // Too short - malformed
          name: 'Malformed District',
          geometry: createCDPolygon(),
          properties: {},
        },
        createCDBoundary('02', '01', 'Alaska At-Large'),
      ];

      // Should not crash, and should keep malformed GEOID (will fail format validation)
      const filtered = validator.filterPlaceholderDistricts(boundaries);
      expect(filtered).toHaveLength(2); // Malformed kept, valid kept

      const result = validator.validateCompleteness('cd', boundaries, '02');
      expect(result.valid).toBe(false); // Invalid GEOID format
      expect(result.summary).toContain('invalid GEOID');
    });
  });
});
