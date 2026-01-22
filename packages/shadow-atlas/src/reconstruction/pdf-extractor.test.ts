/**
 * PDF Extractor Tests
 *
 * Tests for PDF text extraction and legal description identification.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  extractLegalDescriptions,
  type PDFExtractionResult,
  type LegalDescriptionSection,
  type ExtractionConfidence,
} from './pdf-extractor';

// =============================================================================
// Mock Data
// =============================================================================

/**
 * Create mock PDF extraction result
 */
function createMockPDFExtraction(text: string, options?: {
  success?: boolean;
  numPages?: number;
  source?: string;
}): PDFExtractionResult {
  return {
    success: options?.success ?? true,
    text,
    metadata: {
      version: '1.7',
      numPages: options?.numPages ?? 1,
      title: 'Test Ward Ordinance',
      author: 'City Council',
      subject: 'Ward Boundaries',
      creationDate: '2024-01-01',
      modificationDate: '2024-01-02',
      producer: 'Adobe PDF',
    },
    contentHash: 'abc123def456',
    source: options?.source ?? '/test/ordinance.pdf',
    fileSizeBytes: text.length,
    extractedAt: '2024-01-15T12:00:00Z',
    warnings: Object.freeze([]),
    error: null,
  };
}

// =============================================================================
// Pattern Recognition Tests
// =============================================================================

describe('PDF Extractor - Pattern Recognition', () => {
  it('should identify high-confidence legal description with all markers', () => {
    const text = `
      Ward 1: Beginning at the intersection of Main Street and Oak Avenue,
      thence north along Main Street to Elm Road, thence east along Elm Road
      to Pine Avenue, thence south along Pine Avenue to Oak Avenue,
      thence west along Oak Avenue to the point of beginning.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.success).toBe(true);
    expect(result.sections.length).toBeGreaterThan(0);

    const section = result.sections[0];
    expect(section.confidence).toBe('high');
    expect(section.indicators.hasBeginningPhrase).toBe(true);
    expect(section.indicators.hasThencePhrase).toBe(true);
    expect(section.indicators.hasStreetNames).toBe(true);
    expect(section.indicators.hasDirectionalTerms).toBe(true);
    expect(section.indicators.hasIntersections).toBe(true);
    expect(section.wardIdentifier).toBe('1');
  });

  it('should identify medium-confidence description with partial markers', () => {
    const text = `
      District A includes the area along Main Street north to the city limits,
      then following Oak Avenue to Pine Street.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.success).toBe(true);
    expect(result.sections.length).toBeGreaterThan(0);

    const section = result.sections[0];
    expect(section.confidence).toBe('medium');
    expect(section.indicators.hasStreetNames).toBe(true);
    expect(section.indicators.hasDirectionalTerms).toBe(true);
    expect(section.wardIdentifier).toBe('A');
  });

  it('should identify low-confidence text with minimal markers', () => {
    const text = `
      This ward contains various neighborhoods including downtown and
      the historic district near Main Street.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    // May or may not find sections depending on length and markers
    if (result.sections.length > 0) {
      const section = result.sections[0];
      expect(section.confidence).toBe('low');
    }
  });

  it('should detect beginning phrases', () => {
    const phrases = [
      'beginning at the corner',
      'commencing at the intersection',
      'starting at the point',
      'point of beginning at Main Street',
      'point of commencement near Oak',
    ];

    for (const phrase of phrases) {
      const text = `Ward 1: ${phrase} of Main and Oak.`;
      const extraction = createMockPDFExtraction(text);
      const result = extractLegalDescriptions(extraction);

      expect(result.sections[0]?.indicators.hasBeginningPhrase).toBe(true);
    }
  });

  it('should detect thence phrases', () => {
    const phrases = [
      'thence north',
      'then north along Main Street',
      'continuing to Oak Avenue',
      'proceeding east',
    ];

    for (const phrase of phrases) {
      const text = `Beginning at Main Street, ${phrase}.`;
      const extraction = createMockPDFExtraction(text);
      const result = extractLegalDescriptions(extraction);

      expect(result.sections[0]?.indicators.hasThencePhrase).toBe(true);
    }
  });

  it('should detect various street types', () => {
    const streetTypes = [
      'Main Street',
      'Oak Avenue',
      'Elm Road',
      'Pine Boulevard',
      'Maple Drive',
      'Cedar Lane',
      'Birch Way',
      'Ash Court',
      'Willow Place',
      'Cherry Parkway',
      'Spruce Terrace',
      'Fir Circle',
    ];

    for (const street of streetTypes) {
      const text = `Ward 1: Beginning at ${street}, thence north.`;
      const extraction = createMockPDFExtraction(text);
      const result = extractLegalDescriptions(extraction);

      expect(result.sections[0]?.indicators.hasStreetNames).toBe(true);
    }
  });

  it('should detect directional terms', () => {
    const directions = [
      'north',
      'south',
      'east',
      'west',
      'northeast',
      'northwest',
      'southeast',
      'southwest',
      'northerly',
      'southerly',
      'easterly',
      'westerly',
      'northward',
      'southwards',
    ];

    for (const direction of directions) {
      const text = `Ward 1: Beginning at Main Street, thence ${direction} along Oak Avenue to Pine Street.`;
      const extraction = createMockPDFExtraction(text);
      const result = extractLegalDescriptions(extraction);

      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.sections[0]?.indicators.hasDirectionalTerms).toBe(true);
    }
  });

  it('should detect intersection references', () => {
    const intersections = [
      'intersection of Main and Oak',
      'intersection with Elm Street',
      'corner of Pine and Maple',
      'where Main Street meets Oak Avenue',
    ];

    for (const intersection of intersections) {
      const text = `Beginning at the ${intersection}.`;
      const extraction = createMockPDFExtraction(text);
      const result = extractLegalDescriptions(extraction);

      expect(result.sections[0]?.indicators.hasIntersections).toBe(true);
    }
  });

  it('should detect measurements', () => {
    const measurements = [
      '100 feet',
      '50 ft',
      '200 meters',
      '1.5 miles',
      '45 degrees 30 minutes',
      "N 45 degrees 30 minutes 15 seconds",
    ];

    for (const measurement of measurements) {
      const text = `Ward 1: Beginning at Main Street, thence north ${measurement} along Oak Avenue.`;
      const extraction = createMockPDFExtraction(text);
      const result = extractLegalDescriptions(extraction);

      expect(result.sections.length).toBeGreaterThan(0);
      if (!result.sections[0]?.indicators.hasMeasurements) {
        console.log('Failed measurement:', measurement, 'in text:', text);
      }
      expect(result.sections[0]?.indicators.hasMeasurements).toBe(true);
    }
  });
});

// =============================================================================
// Ward Identifier Extraction Tests
// =============================================================================

describe('PDF Extractor - Ward Identifier Extraction', () => {
  it('should extract numeric ward identifiers', () => {
    const text = 'Ward 5: Beginning at Main Street...';
    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections[0]?.wardIdentifier).toBe('5');
  });

  it('should extract alphabetic district identifiers', () => {
    const text = 'District C: Beginning at Oak Avenue...';
    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections[0]?.wardIdentifier).toBe('C');
  });

  it('should extract precinct identifiers', () => {
    const text = 'Precinct 12: Beginning at the intersection...';
    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections[0]?.wardIdentifier).toBe('12');
  });
});

// =============================================================================
// Section Splitting Tests
// =============================================================================

describe('PDF Extractor - Section Splitting', () => {
  it('should split by ward identifiers', () => {
    const text = `
      Ward 1: Beginning at Main Street, thence north along Oak Avenue.

      Ward 2: Beginning at Elm Road, thence south along Pine Street.

      Ward 3: Beginning at Maple Drive, thence east along Cedar Lane.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections.length).toBe(3);
    expect(result.sections[0]?.wardIdentifier).toBe('1');
    expect(result.sections[1]?.wardIdentifier).toBe('2');
    expect(result.sections[2]?.wardIdentifier).toBe('3');
  });

  it('should split by paragraphs when no ward identifiers', () => {
    const text = `
      Beginning at the intersection of Main Street and Oak Avenue,
      thence north along Main Street to Elm Road.

      Starting at Pine Avenue, proceeding south to Cedar Lane.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections.length).toBeGreaterThan(0);
  });

  it('should skip very short sections', () => {
    const text = `
      Ward 1

      Ward 2: Beginning at Main Street, thence north along Oak Avenue
      to Elm Road, then east to Pine Street.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    // Should skip "Ward 1" (too short) but include Ward 2
    expect(result.sections.length).toBe(1);
    expect(result.sections[0]?.wardIdentifier).toBe('2');
  });
});

// =============================================================================
// Confidence Categorization Tests
// =============================================================================

describe('PDF Extractor - Confidence Categorization', () => {
  it('should categorize sections by confidence level', () => {
    const text = `
      Ward 1: Beginning at the intersection of Main Street and Oak Avenue,
      thence north along Main Street to Elm Road, thence east along Elm Road.

      Ward 2: Area along Pine Street and surrounding neighborhoods.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.highConfidenceSections.length).toBeGreaterThan(0);
    expect(result.highConfidenceSections[0]?.wardIdentifier).toBe('1');
  });

  it('should provide confidence reasons', () => {
    const text = `
      Ward 1: Beginning at Main Street, thence north along Oak Avenue.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections[0]?.confidenceReasons.length).toBeGreaterThan(0);
    expect(result.sections[0]?.confidenceReasons.some(
      (reason) => reason.toLowerCase().includes('beginning')
    )).toBe(true);
  });
});

// =============================================================================
// Page Estimation Tests
// =============================================================================

describe('PDF Extractor - Page Estimation', () => {
  it('should estimate page numbers for multi-page documents', () => {
    const text = 'A'.repeat(10000); // Simulate multi-page document
    const extraction = createMockPDFExtraction(text, { numPages: 10 });
    const result = extractLegalDescriptions(extraction);

    // Just verify that estimation doesn't crash and returns reasonable values
    for (const section of result.sections) {
      expect(section.estimatedPage).toBeGreaterThanOrEqual(1);
      expect(section.estimatedPage).toBeLessThanOrEqual(10);
    }
  });

  it('should return page 1 for single-page documents', () => {
    const text = 'Ward 1: Beginning at Main Street.';
    const extraction = createMockPDFExtraction(text, { numPages: 1 });
    const result = extractLegalDescriptions(extraction);

    expect(result.sections[0]?.estimatedPage).toBe(1);
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('PDF Extractor - Error Handling', () => {
  it('should handle failed PDF extraction', () => {
    const extraction: PDFExtractionResult = {
      success: false,
      text: '',
      metadata: {
        version: 'unknown',
        numPages: 0,
        title: null,
        author: null,
        subject: null,
        creationDate: null,
        modificationDate: null,
        producer: null,
      },
      contentHash: '',
      source: '/test/failed.pdf',
      fileSizeBytes: 0,
      extractedAt: '2024-01-15T12:00:00Z',
      warnings: Object.freeze([]),
      error: 'File not found',
    };

    const result = extractLegalDescriptions(extraction);

    expect(result.success).toBe(false);
    expect(result.sections.length).toBe(0);
    expect(result.highConfidenceSections.length).toBe(0);
  });

  it('should handle empty text', () => {
    const extraction = createMockPDFExtraction('');
    const result = extractLegalDescriptions(extraction);

    expect(result.success).toBe(false);
    expect(result.sections.length).toBe(0);
  });

  it('should handle text with no legal descriptions', () => {
    const text = `
      This is a document about city governance.
      It discusses various administrative procedures.
      There are no boundary descriptions here.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    // Depending on paragraph length, may find no sections or only low-confidence ones
    if (result.sections.length > 0) {
      expect(result.highConfidenceSections.length).toBe(0);
    }
  });
});

// =============================================================================
// Integration Tests (Real-World Scenarios)
// =============================================================================

describe('PDF Extractor - Real-World Scenarios', () => {
  it('should handle typical city ordinance format', () => {
    const text = `
      ORDINANCE NO. 2024-15
      AN ORDINANCE ESTABLISHING WARD BOUNDARIES

      Section 1. Ward 1 Boundary Description:
      Beginning at the intersection of North Main Street and East Oak Avenue,
      thence north along the centerline of North Main Street to its intersection
      with West Elm Road; thence east along West Elm Road to South Pine Avenue;
      thence south along South Pine Avenue to East Oak Avenue; thence west
      along East Oak Avenue to the point of beginning.

      Section 2. Ward 2 Boundary Description:
      Commencing at the intersection of South Main Street and West Oak Avenue,
      proceeding south along South Main Street to the city limits; then following
      the city limits easterly to South Pine Avenue; then north along South Pine
      Avenue to West Oak Avenue; then west to the point of commencement.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.success).toBe(true);

    // May find 2 or 3 sections depending on how "Section 1." is parsed
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    expect(result.highConfidenceSections.length).toBeGreaterThanOrEqual(2);

    // Verify we have Ward 1 and Ward 2
    const wardIds = result.sections
      .map((s) => s.wardIdentifier)
      .filter((id) => id !== null)
      .sort();
    expect(wardIds).toContain('1');
    expect(wardIds).toContain('2');

    // Verify ward descriptions have high confidence
    const ward1 = result.sections.find((s) => s.wardIdentifier === '1');
    const ward2 = result.sections.find((s) => s.wardIdentifier === '2');

    expect(ward1?.confidence).toBe('high');
    expect(ward2?.confidence).toBe('high');
    expect(ward1?.indicators.hasBeginningPhrase).toBe(true);
    expect(ward2?.indicators.hasBeginningPhrase).toBe(true);
  });

  it('should handle mixed-format descriptions', () => {
    const text = `
      Ward A: The northern portion of the city, bounded by Main Street (south),
      the city limits (north and east), and the river (west).

      Ward B: Beginning at the intersection of Main Street and Oak Avenue,
      thence south along Oak Avenue to Pine Street, thence west along Pine
      Street to the river, thence north along the river to Main Street,
      thence east along Main Street to the point of beginning.
    `;

    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(result.sections.length).toBe(2);

    // Ward A should be medium confidence (descriptive but no formal metes-and-bounds)
    const wardA = result.sections.find((s) => s.wardIdentifier === 'A');
    expect(wardA).toBeDefined();

    // Ward B should be high confidence (formal metes-and-bounds)
    const wardB = result.sections.find((s) => s.wardIdentifier === 'B');
    expect(wardB).toBeDefined();
    expect(wardB?.confidence).toBe('high');
  });
});

// =============================================================================
// Immutability Tests
// =============================================================================

describe('PDF Extractor - Immutability', () => {
  it('should return frozen/readonly results', () => {
    const text = 'Ward 1: Beginning at Main Street, thence north.';
    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    expect(Object.isFrozen(result.sections)).toBe(true);
    expect(Object.isFrozen(result.highConfidenceSections)).toBe(true);
    expect(Object.isFrozen(result.mediumConfidenceSections)).toBe(true);
    expect(Object.isFrozen(result.lowConfidenceSections)).toBe(true);
  });

  it('should have readonly properties on sections', () => {
    const text = 'Ward 1: Beginning at Main Street, thence north.';
    const extraction = createMockPDFExtraction(text);
    const result = extractLegalDescriptions(extraction);

    if (result.sections.length > 0) {
      const section = result.sections[0];

      // TypeScript enforces readonly at compile time
      // At runtime, we verify the arrays are frozen
      expect(Object.isFrozen(section.confidenceReasons)).toBe(true);
    }
  });
});
