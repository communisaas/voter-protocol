/**
 * PDF Text Extractor
 *
 * Extracts legal descriptions from PDF ward maps and ordinances.
 * Identifies sections containing boundary descriptions with explicit confidence levels.
 *
 * PHILOSOPHY:
 * - Extract with confidence levels (never guess silently)
 * - Preserve source metadata for provenance
 * - Identify legal description patterns (metes-and-bounds markers)
 * - Immutable readonly interfaces
 *
 * USAGE:
 * ```typescript
 * // From file path
 * const result = await extractTextFromPDF('/path/to/ordinance.pdf');
 *
 * // From URL
 * const result = await extractTextFromPDFUrl('https://city.gov/wards.pdf');
 *
 * // Extract legal descriptions
 * const descriptions = extractLegalDescriptions(result.text);
 * ```
 */

import pdfParse from 'pdf-parse';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Confidence level for extracted content
 */
export type ExtractionConfidence = 'high' | 'medium' | 'low';

/**
 * PDF metadata extracted by pdf-parse
 */
export interface PDFMetadata {
  /** PDF version */
  readonly version: string;

  /** Number of pages */
  readonly numPages: number;

  /** Document title (from metadata) */
  readonly title: string | null;

  /** Document author */
  readonly author: string | null;

  /** Document subject */
  readonly subject: string | null;

  /** Creation date */
  readonly creationDate: string | null;

  /** Modification date */
  readonly modificationDate: string | null;

  /** PDF producer software */
  readonly producer: string | null;
}

/**
 * Complete PDF extraction result
 */
export interface PDFExtractionResult {
  /** Successfully extracted */
  readonly success: boolean;

  /** Extracted text content */
  readonly text: string;

  /** PDF metadata */
  readonly metadata: PDFMetadata;

  /** SHA-256 hash of PDF file for integrity verification */
  readonly contentHash: string;

  /** Source path or URL */
  readonly source: string;

  /** File size in bytes */
  readonly fileSizeBytes: number;

  /** Extraction timestamp */
  readonly extractedAt: string;

  /** Warnings encountered during extraction */
  readonly warnings: readonly string[];

  /** Error message if extraction failed */
  readonly error: string | null;
}

/**
 * Legal description section identified in PDF text
 */
export interface LegalDescriptionSection {
  /** Section text */
  readonly text: string;

  /** Section start position in full text */
  readonly startPosition: number;

  /** Section end position in full text */
  readonly endPosition: number;

  /** Estimated page number (approximate) */
  readonly estimatedPage: number | null;

  /** Ward/district identifier mentioned (if found) */
  readonly wardIdentifier: string | null;

  /** Confidence in this being a legal description */
  readonly confidence: ExtractionConfidence;

  /** Reasons for confidence level */
  readonly confidenceReasons: readonly string[];

  /** Pattern indicators found */
  readonly indicators: {
    /** Contains "beginning at" or similar */
    readonly hasBeginningPhrase: boolean;

    /** Contains "thence" or similar transition words */
    readonly hasThencePhrase: boolean;

    /** Contains street names */
    readonly hasStreetNames: boolean;

    /** Contains directional terms (north, south, etc.) */
    readonly hasDirectionalTerms: boolean;

    /** Contains intersection references */
    readonly hasIntersections: boolean;

    /** Contains distance/measurement terms */
    readonly hasMeasurements: boolean;
  };
}

/**
 * Collection of legal descriptions extracted from PDF
 */
export interface LegalDescriptionsExtraction {
  /** Successfully found descriptions */
  readonly success: boolean;

  /** Extracted description sections */
  readonly sections: readonly LegalDescriptionSection[];

  /** Source PDF extraction result */
  readonly sourceExtraction: PDFExtractionResult;

  /** High-confidence sections (confidence >= 'high') */
  readonly highConfidenceSections: readonly LegalDescriptionSection[];

  /** Medium-confidence sections */
  readonly mediumConfidenceSections: readonly LegalDescriptionSection[];

  /** Low-confidence sections (may be false positives) */
  readonly lowConfidenceSections: readonly LegalDescriptionSection[];
}

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Legal description indicator patterns
 *
 * These patterns identify text that likely contains boundary descriptions.
 */
const LEGAL_DESCRIPTION_PATTERNS = {
  /** Beginning phrases that start boundary descriptions */
  beginningPhrases: [
    /beginning\s+at/gi,
    /commencing\s+at/gi,
    /starting\s+at/gi,
    /point\s+of\s+beginning/gi,
    /point\s+of\s+commencement/gi,
  ],

  /** Transition words used in metes-and-bounds descriptions */
  thencePhrases: [
    /\bthence\b/gi,
    /\bthen\b(?=\s+(?:north|south|east|west|along))/gi,
    /continuing/gi,
    /proceeding/gi,
  ],

  /** Street reference patterns */
  streetPatterns: [
    /\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|terrace|tr|circle|cir)\b/gi,
  ],

  /** Directional terms */
  directionalTerms: [
    /\b(?:north|south|east|west|northeast|northwest|southeast|southwest)(?:erly|ward|wards)?\b/gi,
  ],

  /** Intersection references */
  intersectionPatterns: [
    /intersection\s+(?:of|with)/gi,
    /corner\s+of/gi,
    /\bwhere\b.*?\bmeets\b/gi,
  ],

  /** Measurement terms */
  measurementPatterns: [
    /\d+\s*(?:feet|ft|foot|meters?|m|miles?|mi)/gi,
    /\d+\s*degrees?\s*\d*\'?\s*\d*\"?/gi, // Bearings
  ],

  /** Ward/district identifiers */
  wardIdentifiers: [
    /ward\s+(\d+|[A-Z])/gi,
    /district\s+(\d+|[A-Z])/gi,
    /precinct\s+(\d+)/gi,
  ],
};

/**
 * Calculate confidence based on pattern matches
 */
function calculateConfidence(indicators: LegalDescriptionSection['indicators']): {
  readonly confidence: ExtractionConfidence;
  readonly reasons: readonly string[];
} {
  const reasons: string[] = [];
  let score = 0;

  // High-value indicators
  if (indicators.hasBeginningPhrase) {
    score += 3;
    reasons.push('Contains beginning phrase (e.g., "beginning at")');
  }

  if (indicators.hasThencePhrase) {
    score += 2;
    reasons.push('Contains transition words (e.g., "thence")');
  }

  // Medium-value indicators
  if (indicators.hasStreetNames) {
    score += 2;
    reasons.push('Contains street references');
  }

  if (indicators.hasDirectionalTerms) {
    score += 1;
    reasons.push('Contains directional terms');
  }

  if (indicators.hasIntersections) {
    score += 1;
    reasons.push('Contains intersection references');
  }

  if (indicators.hasMeasurements) {
    score += 1;
    reasons.push('Contains measurements or bearings');
  }

  // Determine confidence level
  let confidence: ExtractionConfidence;
  if (score >= 5) {
    confidence = 'high';
  } else if (score >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
    if (reasons.length === 0) {
      reasons.push('Insufficient legal description markers');
    }
  }

  return { confidence, reasons: Object.freeze(reasons) };
}

/**
 * Analyze text for legal description indicators
 */
function analyzeLegalDescriptionIndicators(text: string): LegalDescriptionSection['indicators'] {
  // Reset all regex lastIndex to avoid stateful behavior with global flag
  const testPattern = (patterns: readonly RegExp[]): boolean => {
    return patterns.some((pattern) => {
      const regex = new RegExp(pattern.source, pattern.flags);
      return regex.test(text);
    });
  };

  return {
    hasBeginningPhrase: testPattern(LEGAL_DESCRIPTION_PATTERNS.beginningPhrases),
    hasThencePhrase: testPattern(LEGAL_DESCRIPTION_PATTERNS.thencePhrases),
    hasStreetNames: testPattern(LEGAL_DESCRIPTION_PATTERNS.streetPatterns),
    hasDirectionalTerms: testPattern(LEGAL_DESCRIPTION_PATTERNS.directionalTerms),
    hasIntersections: testPattern(LEGAL_DESCRIPTION_PATTERNS.intersectionPatterns),
    hasMeasurements: testPattern(LEGAL_DESCRIPTION_PATTERNS.measurementPatterns),
  };
}

/**
 * Extract ward identifier from text
 */
function extractWardIdentifier(text: string): string | null {
  for (const pattern of LEGAL_DESCRIPTION_PATTERNS.wardIdentifiers) {
    // Create fresh regex to avoid lastIndex issues
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(text);
    if (match) {
      return match[1] || match[0];
    }
  }
  return null;
}

/**
 * Estimate page number based on text position
 *
 * This is a rough estimate based on character position and average page length.
 */
function estimatePageNumber(
  position: number,
  totalLength: number,
  totalPages: number
): number {
  if (totalPages <= 1) return 1;
  const ratio = position / totalLength;
  return Math.max(1, Math.ceil(ratio * totalPages));
}

// =============================================================================
// PDF Extraction
// =============================================================================

/**
 * Compute SHA-256 hash of buffer
 */
function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extract metadata from pdf-parse result
 */
function extractMetadata(pdfData: pdfParse.Result): PDFMetadata {
  const info = pdfData.info || {};
  return {
    version: pdfData.version || 'unknown',
    numPages: pdfData.numpages || 0,
    title: info.Title || null,
    author: info.Author || null,
    subject: info.Subject || null,
    creationDate: info.CreationDate || null,
    modificationDate: info.ModDate || null,
    producer: info.Producer || null,
  };
}

/**
 * Extract text from PDF file
 *
 * @param filePath - Path to PDF file
 * @returns Extraction result with text and metadata
 */
export async function extractTextFromPDF(
  filePath: string
): Promise<PDFExtractionResult> {
  const warnings: string[] = [];

  try {
    // Read PDF file
    const buffer = await readFile(filePath);
    const contentHash = computeHash(buffer);

    // Parse PDF
    const pdfData = await pdfParse(buffer);

    // Extract metadata
    const metadata = extractMetadata(pdfData);

    // Validate extraction
    if (!pdfData.text || pdfData.text.trim().length === 0) {
      warnings.push('PDF contains no extractable text (may be scanned image)');
    }

    if (metadata.numPages === 0) {
      warnings.push('PDF reports zero pages');
    }

    return {
      success: true,
      text: pdfData.text,
      metadata,
      contentHash,
      source: filePath,
      fileSizeBytes: buffer.length,
      extractedAt: new Date().toISOString(),
      warnings: Object.freeze(warnings),
      error: null,
    };
  } catch (error) {
    return {
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
      source: filePath,
      fileSizeBytes: 0,
      extractedAt: new Date().toISOString(),
      warnings: Object.freeze(warnings),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract text from PDF at URL
 *
 * @param url - URL to PDF file
 * @returns Extraction result with text and metadata
 */
export async function extractTextFromPDFUrl(url: string): Promise<PDFExtractionResult> {
  const warnings: string[] = [];

  try {
    // Fetch PDF
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentHash = computeHash(buffer);

    // Parse PDF
    const pdfData = await pdfParse(buffer);

    // Extract metadata
    const metadata = extractMetadata(pdfData);

    // Validate extraction
    if (!pdfData.text || pdfData.text.trim().length === 0) {
      warnings.push('PDF contains no extractable text (may be scanned image)');
    }

    if (metadata.numPages === 0) {
      warnings.push('PDF reports zero pages');
    }

    return {
      success: true,
      text: pdfData.text,
      metadata,
      contentHash,
      source: url,
      fileSizeBytes: buffer.length,
      extractedAt: new Date().toISOString(),
      warnings: Object.freeze(warnings),
      error: null,
    };
  } catch (error) {
    return {
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
      source: url,
      fileSizeBytes: 0,
      extractedAt: new Date().toISOString(),
      warnings: Object.freeze(warnings),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// Legal Description Extraction
// =============================================================================

/**
 * Split text into candidate sections based on ward identifiers and paragraphs
 */
function splitIntoCandidateSections(text: string, totalPages: number): readonly LegalDescriptionSection[] {
  const sections: LegalDescriptionSection[] = [];

  // Strategy 1: Split by ward/district identifiers
  const wardPattern = /(?:ward|district|precinct)\s+(?:\d+|[A-Z])/gi;
  let match;
  const matches: Array<{ index: number; text: string }> = [];

  // Reset lastIndex to ensure we start from beginning
  wardPattern.lastIndex = 0;

  while ((match = wardPattern.exec(text)) !== null) {
    matches.push({ index: match.index, text: match[0] });
  }

  // If we found ward identifiers, split by them
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const startPos = matches[i].index;
      const endPos = i < matches.length - 1 ? matches[i + 1].index : text.length;
      const sectionText = text.substring(startPos, endPos).trim();

      if (sectionText.length < 30) continue; // Skip very short sections

      const indicators = analyzeLegalDescriptionIndicators(sectionText);
      const { confidence, reasons } = calculateConfidence(indicators);
      const wardId = extractWardIdentifier(sectionText);
      const estimatedPage = estimatePageNumber(startPos, text.length, totalPages);

      sections.push({
        text: sectionText,
        startPosition: startPos,
        endPosition: endPos,
        estimatedPage,
        wardIdentifier: wardId,
        confidence,
        confidenceReasons: reasons,
        indicators,
      });
    }
  } else {
    // Strategy 2: Split by paragraphs and look for legal descriptions
    const paragraphs = text.split(/\n\s*\n/);
    let currentPos = 0;

    for (const paragraph of paragraphs) {
      const trimmed = paragraph.trim();
      if (trimmed.length < 30) {
        currentPos += paragraph.length + 2; // Account for double newline
        continue;
      }

      const indicators = analyzeLegalDescriptionIndicators(trimmed);

      // Only include if it has at least some indicators
      if (indicators.hasBeginningPhrase ||
          indicators.hasThencePhrase ||
          (indicators.hasStreetNames && indicators.hasDirectionalTerms)) {
        const { confidence, reasons } = calculateConfidence(indicators);
        const wardId = extractWardIdentifier(trimmed);
        const startPos = currentPos;
        const endPos = currentPos + paragraph.length;
        const estimatedPage = estimatePageNumber(startPos, text.length, totalPages);

        sections.push({
          text: trimmed,
          startPosition: startPos,
          endPosition: endPos,
          estimatedPage,
          wardIdentifier: wardId,
          confidence,
          confidenceReasons: reasons,
          indicators,
        });
      }

      currentPos += paragraph.length + 2; // Account for double newline
    }
  }

  return Object.freeze(sections);
}

/**
 * Extract legal descriptions from PDF extraction result
 *
 * @param extractionResult - Result from extractTextFromPDF or extractTextFromPDFUrl
 * @returns Legal descriptions found in the PDF
 */
export function extractLegalDescriptions(
  extractionResult: PDFExtractionResult
): LegalDescriptionsExtraction {
  if (!extractionResult.success) {
    return {
      success: false,
      sections: Object.freeze([]),
      sourceExtraction: extractionResult,
      highConfidenceSections: Object.freeze([]),
      mediumConfidenceSections: Object.freeze([]),
      lowConfidenceSections: Object.freeze([]),
    };
  }

  const sections = splitIntoCandidateSections(
    extractionResult.text,
    extractionResult.metadata.numPages
  );

  // Separate by confidence level
  const highConfidenceSections = sections.filter((s) => s.confidence === 'high');
  const mediumConfidenceSections = sections.filter((s) => s.confidence === 'medium');
  const lowConfidenceSections = sections.filter((s) => s.confidence === 'low');

  return {
    success: sections.length > 0,
    sections,
    sourceExtraction: extractionResult,
    highConfidenceSections: Object.freeze(highConfidenceSections),
    mediumConfidenceSections: Object.freeze(mediumConfidenceSections),
    lowConfidenceSections: Object.freeze(lowConfidenceSections),
  };
}

/**
 * Extract legal descriptions directly from PDF file
 *
 * Convenience function that combines extraction and description identification.
 *
 * @param filePath - Path to PDF file
 * @returns Legal descriptions found in the PDF
 */
export async function extractLegalDescriptionsFromPDF(
  filePath: string
): Promise<LegalDescriptionsExtraction> {
  const extraction = await extractTextFromPDF(filePath);
  return extractLegalDescriptions(extraction);
}

/**
 * Extract legal descriptions directly from PDF URL
 *
 * Convenience function that combines extraction and description identification.
 *
 * @param url - URL to PDF file
 * @returns Legal descriptions found in the PDF
 */
export async function extractLegalDescriptionsFromPDFUrl(
  url: string
): Promise<LegalDescriptionsExtraction> {
  const extraction = await extractTextFromPDFUrl(url);
  return extractLegalDescriptions(extraction);
}
