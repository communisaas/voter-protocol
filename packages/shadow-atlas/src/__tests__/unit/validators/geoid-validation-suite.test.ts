/**
 * GEOID Validation Suite Tests
 *
 * Comprehensive tests for GEOID validation across all layer types.
 *
 * TEST COVERAGE:
 * - Format validation for each layer type
 * - Expected count validation
 * - Coverage validation (missing states)
 * - Edge cases (at-large states, territories, DC)
 * - Special GEOID formats (letter codes, alphanumeric)
 */

import { describe, it, expect } from 'vitest';
import {
  validateGEOIDFormat,
  validateCanonicalCoverage,
  validateExpectedCounts,
  validateLayer,
  validateAllCanonicalGEOIDs,
  generateValidationReport,
  GEOID_FORMATS,
  type ValidatableLayer,
} from '../../../validators/geoid/validation-suite.js';
import { CANONICAL_CD_GEOIDS } from '../../../validators/geoid/reference.js';

describe('GEOID Format Validation', () => {
  describe('Congressional Districts (CD)', () => {
    it('validates correct 4-digit CD GEOIDs', () => {
      expect(validateGEOIDFormat('cd', '0601')).toBe(true);
      expect(validateGEOIDFormat('cd', '0652')).toBe(true);
      expect(validateGEOIDFormat('cd', '1198')).toBe(true); // DC delegate
    });

    it('rejects invalid CD GEOID formats', () => {
      expect(validateGEOIDFormat('cd', '06001')).toBe(false); // Too long
      expect(validateGEOIDFormat('cd', '061')).toBe(false); // Too short
      expect(validateGEOIDFormat('cd', 'AB01')).toBe(false); // Letters
      expect(validateGEOIDFormat('cd', '06-01')).toBe(false); // Hyphen
    });

    it('validates at-large district GEOIDs', () => {
      expect(validateGEOIDFormat('cd', '0200')).toBe(true); // Alaska
      expect(validateGEOIDFormat('cd', '1000')).toBe(true); // Delaware
      expect(validateGEOIDFormat('cd', '5000')).toBe(true); // Vermont
      expect(validateGEOIDFormat('cd', '5600')).toBe(true); // Wyoming
    });

    it('validates territory delegate GEOIDs', () => {
      expect(validateGEOIDFormat('cd', '6000')).toBe(true); // American Samoa
      expect(validateGEOIDFormat('cd', '6600')).toBe(true); // Guam
      expect(validateGEOIDFormat('cd', '7200')).toBe(true); // Puerto Rico
      expect(validateGEOIDFormat('cd', '7800')).toBe(true); // Virgin Islands
    });
  });

  describe('State Legislative Upper (SLDU)', () => {
    it('validates correct 5-digit numeric SLDU GEOIDs', () => {
      expect(validateGEOIDFormat('sldu', '06001')).toBe(true);
      expect(validateGEOIDFormat('sldu', '06040')).toBe(true);
      expect(validateGEOIDFormat('sldu', '48031')).toBe(true);
    });

    it('validates Alaska letter-code GEOIDs', () => {
      expect(validateGEOIDFormat('sldu', '0200A')).toBe(true);
      expect(validateGEOIDFormat('sldu', '0200T')).toBe(true);
    });

    it('validates Massachusetts D## format GEOIDs', () => {
      expect(validateGEOIDFormat('sldu', '25D01')).toBe(true);
      expect(validateGEOIDFormat('sldu', '25D40')).toBe(true);
    });

    it('validates Vermont county-code GEOIDs', () => {
      expect(validateGEOIDFormat('sldu', '50ADD')).toBe(true);
      expect(validateGEOIDFormat('sldu', '50BEN')).toBe(true);
      expect(validateGEOIDFormat('sldu', '50WSR')).toBe(true);
    });

    it('rejects invalid SLDU GEOID formats', () => {
      expect(validateGEOIDFormat('sldu', '060001')).toBe(false); // Too long
      expect(validateGEOIDFormat('sldu', '0601')).toBe(false); // Too short
      expect(validateGEOIDFormat('sldu', '06-001')).toBe(false); // Hyphen
    });
  });

  describe('State Legislative Lower (SLDL)', () => {
    it('validates correct 5-digit numeric SLDL GEOIDs', () => {
      expect(validateGEOIDFormat('sldl', '06001')).toBe(true);
      expect(validateGEOIDFormat('sldl', '06080')).toBe(true);
      expect(validateGEOIDFormat('sldl', '42203')).toBe(true);
    });

    it('validates Maryland sub-district GEOIDs (A/B/C)', () => {
      expect(validateGEOIDFormat('sldl', '2401A')).toBe(true);
      expect(validateGEOIDFormat('sldl', '2401B')).toBe(true);
      expect(validateGEOIDFormat('sldl', '2401C')).toBe(true);
    });

    it('validates Minnesota A/B suffix GEOIDs', () => {
      expect(validateGEOIDFormat('sldl', '2701A')).toBe(true);
      expect(validateGEOIDFormat('sldl', '2767B')).toBe(true);
    });

    it('validates New Hampshire floterial district GEOIDs', () => {
      expect(validateGEOIDFormat('sldl', '33001')).toBe(true); // Single digit series
      expect(validateGEOIDFormat('sldl', '33101')).toBe(true); // 100 series
      expect(validateGEOIDFormat('sldl', '33542')).toBe(true); // 500 series
      expect(validateGEOIDFormat('sldl', '33906')).toBe(true); // 900 series
    });

    it('validates North Dakota A/B sub-district GEOIDs', () => {
      expect(validateGEOIDFormat('sldl', '38001')).toBe(true);
      expect(validateGEOIDFormat('sldl', '3804A')).toBe(true);
      expect(validateGEOIDFormat('sldl', '3804B')).toBe(true);
    });

    it('validates Vermont town-based district GEOIDs', () => {
      expect(validateGEOIDFormat('sldl', '50A-1')).toBe(true);
      expect(validateGEOIDFormat('sldl', '50C-F')).toBe(true);
      expect(validateGEOIDFormat('sldl', '50WAC')).toBe(true);
    });
  });

  describe('School Districts (UNSD/ELSD/SCSD)', () => {
    it('validates correct 7-digit school district GEOIDs', () => {
      expect(validateGEOIDFormat('unsd', '0600001')).toBe(true);
      expect(validateGEOIDFormat('unsd', '4801023')).toBe(true);
      expect(validateGEOIDFormat('elsd', '0900001')).toBe(true);
      expect(validateGEOIDFormat('scsd', '0400001')).toBe(true);
    });

    it('rejects invalid school district formats', () => {
      expect(validateGEOIDFormat('unsd', '060001')).toBe(false); // Too short
      expect(validateGEOIDFormat('unsd', '06000001')).toBe(false); // Too long
      expect(validateGEOIDFormat('unsd', '06-00001')).toBe(false); // Hyphen
      expect(validateGEOIDFormat('elsd', 'IL00001')).toBe(false); // Letters
    });

    it('validates special case school districts', () => {
      expect(validateGEOIDFormat('unsd', '1100030')).toBe(true); // DC single district
      expect(validateGEOIDFormat('unsd', '1500001')).toBe(true); // Hawaii statewide
    });
  });

  describe('Counties (COUNTY)', () => {
    it('validates correct 5-digit county GEOIDs', () => {
      expect(validateGEOIDFormat('county', '06001')).toBe(true);
      expect(validateGEOIDFormat('county', '48201')).toBe(true);
    });

    it('rejects invalid county formats', () => {
      expect(validateGEOIDFormat('county', '0601')).toBe(false); // Too short
      expect(validateGEOIDFormat('county', '060001')).toBe(false); // Too long
    });
  });

  describe('Voting Tabulation Districts (VTD)', () => {
    it('validates correct 11-digit VTD GEOIDs', () => {
      expect(validateGEOIDFormat('vtd', '06001000100')).toBe(true);
      expect(validateGEOIDFormat('vtd', '48201012345')).toBe(true);
    });

    it('accepts any non-empty VTD format (VEST uses local precinct IDs)', () => {
      // VEST data uses raw precinct identifiers, NOT standardized Census GEOIDs
      // Format varies by state: numeric, alphanumeric, hyphenated, etc.
      // Only empty strings should be rejected
      expect(validateGEOIDFormat('vtd', '0600100010')).toBe(true); // Short OK
      expect(validateGEOIDFormat('vtd', '060010001000')).toBe(true); // Long OK
      expect(validateGEOIDFormat('vtd', '06001-00010')).toBe(true); // Hyphen OK
      expect(validateGEOIDFormat('vtd', '1-GR')).toBe(true); // Iowa format
      expect(validateGEOIDFormat('vtd', '0')).toBe(true); // Florida format
      expect(validateGEOIDFormat('vtd', '')).toBe(false); // Empty rejected
    });
  });
});

describe('Coverage Validation', () => {
  it('validates CD coverage across all states', () => {
    const missing = validateCanonicalCoverage('cd');
    expect(missing.length).toBe(0);
  });

  it('validates SLDU coverage (excluding DC)', () => {
    const missing = validateCanonicalCoverage('sldu');
    // DC has no bicameral legislature, so it should be in canonical data with empty array
    expect(missing.length).toBe(0);
  });

  it('validates SLDL coverage (excluding DC and Nebraska)', () => {
    const missing = validateCanonicalCoverage('sldl');
    // DC and Nebraska are unicameral, should be in canonical data with empty arrays
    expect(missing.length).toBe(0);
  });

  it('validates UNSD coverage', () => {
    const missing = validateCanonicalCoverage('unsd');
    expect(missing.length).toBe(0);
  });

  it('validates ELSD coverage', () => {
    const missing = validateCanonicalCoverage('elsd');
    expect(missing.length).toBe(0);
  });

  it('validates SCSD coverage', () => {
    const missing = validateCanonicalCoverage('scsd');
    expect(missing.length).toBe(0);
  });
});

describe('Expected Count Validation', () => {
  it('validates CD counts match expected', () => {
    const mismatches = validateExpectedCounts('cd');
    expect(mismatches.length).toBe(0);
  });

  it('validates SLDU counts match expected', () => {
    const mismatches = validateExpectedCounts('sldu');
    expect(mismatches.length).toBe(0);
  });

  it('validates SLDL counts match expected', () => {
    const mismatches = validateExpectedCounts('sldl');
    expect(mismatches.length).toBe(0);
  });

  it('validates UNSD counts match expected', () => {
    const mismatches = validateExpectedCounts('unsd');
    expect(mismatches.length).toBe(0);
  });

  it('validates ELSD counts match expected', () => {
    const mismatches = validateExpectedCounts('elsd');
    expect(mismatches.length).toBe(0);
  });

  it('validates SCSD counts match expected', () => {
    const mismatches = validateExpectedCounts('scsd');
    expect(mismatches.length).toBe(0);
  });
});

describe('Layer Validation', () => {
  it('validates complete CD layer', () => {
    const result = validateLayer('cd');
    expect(result.layer).toBe('cd');
    expect(result.status).toBe('PASS');
    expect(result.statesFailed).toBe(0);
    expect(result.totalGEOIDs).toBeGreaterThan(0);
  });

  it('validates complete SLDU layer', () => {
    const result = validateLayer('sldu');
    expect(result.layer).toBe('sldu');
    expect(result.status).toBe('PASS');
    expect(result.statesFailed).toBe(0);
  });

  it('validates complete SLDL layer', () => {
    const result = validateLayer('sldl');
    expect(result.layer).toBe('sldl');
    expect(result.status).toBe('PASS');
    expect(result.statesFailed).toBe(0);
  });

  it('validates complete UNSD layer', () => {
    const result = validateLayer('unsd');
    expect(result.layer).toBe('unsd');
    expect(result.statesFailed).toBe(0);
  });

  it('validates complete ELSD layer', () => {
    const result = validateLayer('elsd');
    expect(result.layer).toBe('elsd');
    expect(result.statesFailed).toBe(0);
  });

  it('validates complete SCSD layer', () => {
    const result = validateLayer('scsd');
    expect(result.layer).toBe('scsd');
    expect(result.statesFailed).toBe(0);
  });
});

describe('Complete Validation Suite', () => {
  it('validates all layers successfully', () => {
    const report = validateAllCanonicalGEOIDs();

    expect(report.summary.layersValidated).toBeGreaterThan(0);
    expect(report.layers.length).toBe(report.summary.layersValidated);
    expect(report.timestamp).toBeDefined();
    expect(report.summary.overallStatus).toBeDefined();
  });

  it('generates formatted validation report', () => {
    const report = validateAllCanonicalGEOIDs();
    const formatted = generateValidationReport(report);

    expect(formatted).toContain('SHADOW ATLAS GEOID VALIDATION REPORT');
    expect(formatted).toContain('SUMMARY');
    expect(formatted).toContain('Overall Status:');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('includes all expected layers in report', () => {
    const report = validateAllCanonicalGEOIDs();
    const layerNames = report.layers.map((l) => l.layer);

    expect(layerNames).toContain('cd');
    expect(layerNames).toContain('sldu');
    expect(layerNames).toContain('sldl');
    expect(layerNames).toContain('unsd');
    expect(layerNames).toContain('elsd');
    expect(layerNames).toContain('scsd');
    expect(layerNames).toContain('vtd');
  });

  it('calculates correct summary statistics', () => {
    const report = validateAllCanonicalGEOIDs();

    const totalPassed = report.layers.reduce((sum, l) => sum + l.statesPassed, 0);
    const totalFailed = report.layers.reduce((sum, l) => sum + l.statesFailed, 0);

    expect(report.summary.totalStatesPassed).toBe(totalPassed);
    expect(report.summary.totalStatesFailed).toBe(totalFailed);
    expect(report.summary.totalStatesValidated).toBe(totalPassed + totalFailed);
  });
});

describe('Edge Cases', () => {
  it('handles at-large congressional districts', () => {
    // Alaska, Delaware, North Dakota, South Dakota, Vermont, Wyoming
    const atLargeStates = ['02', '10', '38', '46', '50', '56'];

    for (const fips of atLargeStates) {
      const geoids = CANONICAL_CD_GEOIDS[fips];
      expect(geoids).toBeDefined();
      expect(geoids.length).toBe(1);
      expect(geoids[0]).toMatch(/^\d{2}00$/); // Should end in 00
    }
  });

  it('handles DC non-voting delegate', () => {
    const dcGeoids = CANONICAL_CD_GEOIDS['11'];
    expect(dcGeoids).toBeDefined();
    expect(dcGeoids.length).toBe(1);
    expect(dcGeoids[0]).toBe('1198'); // DC uses district 98
  });

  it('handles Nebraska unicameral legislature', () => {
    const result = validateLayer('sldu');
    const nebraskaResult = result.stateResults.find((s) => s.stateFips === '31');

    expect(nebraskaResult).toBeDefined();
    expect(nebraskaResult?.expectedCount).toBe(49); // Unicameral uses SLDU
  });

  it('handles states with 0 expected districts', () => {
    // DC has no bicameral legislature
    const result = validateLayer('sldl');
    const dcResult = result.stateResults.find((s) => s.stateFips === '11');

    expect(dcResult).toBeDefined();
    expect(dcResult?.expectedCount).toBe(0);
    expect(dcResult?.actualCount).toBe(0);
    expect(dcResult?.valid).toBe(true);
  });

  it('handles territories correctly', () => {
    const territories = ['60', '66', '69', '72', '78'];

    for (const fips of territories) {
      const geoids = CANONICAL_CD_GEOIDS[fips];
      expect(geoids).toBeDefined();
      expect(geoids.length).toBe(1); // Each territory has 1 delegate
    }
  });

  it('validates California largest delegation', () => {
    const caGeoids = CANONICAL_CD_GEOIDS['06'];
    expect(caGeoids.length).toBe(52); // Largest delegation
  });

  it('validates Texas largest House delegation', () => {
    const txGeoids = CANONICAL_CD_GEOIDS['48'];
    expect(txGeoids.length).toBe(38); // Second largest
  });
});

describe('GEOID Format Specifications', () => {
  it('defines format specs for all layers', () => {
    const layers: ValidatableLayer[] = ['cd', 'sldu', 'sldl', 'unsd', 'elsd', 'scsd', 'county', 'vtd'];

    for (const layer of layers) {
      const format = GEOID_FORMATS[layer];
      expect(format).toBeDefined();
      expect(format.description).toBeDefined();
      // Length can be a number or 'variable'
      expect(format.length).toBeDefined();
      if (typeof format.length === 'number') {
        expect(format.length).toBeGreaterThan(0);
      } else {
        expect(format.length).toBe('variable');
      }
      expect(format.pattern).toBeInstanceOf(RegExp);
      expect(format.example).toBeDefined();
    }
  });

  it('has correct length specifications', () => {
    expect(GEOID_FORMATS.cd.length).toBe(4);
    expect(GEOID_FORMATS.sldu.length).toBe(5);
    expect(GEOID_FORMATS.sldl.length).toBe('variable'); // Vermont uses variable-length town codes
    expect(GEOID_FORMATS.unsd.length).toBe(7);
    expect(GEOID_FORMATS.elsd.length).toBe(7);
    expect(GEOID_FORMATS.scsd.length).toBe(7);
    expect(GEOID_FORMATS.county.length).toBe(5);
    // VTD uses variable-length VEST precinct identifiers (not standardized Census GEOIDs)
    expect(GEOID_FORMATS.vtd.length).toBe('variable');
  });

  it('has valid example GEOIDs', () => {
    const layers: ValidatableLayer[] = ['cd', 'sldu', 'sldl', 'unsd', 'elsd', 'scsd', 'county', 'vtd'];

    for (const layer of layers) {
      const format = GEOID_FORMATS[layer];
      const isValid = validateGEOIDFormat(layer, format.example);
      expect(isValid).toBe(true);
    }
  });
});
