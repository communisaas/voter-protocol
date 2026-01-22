/**
 * Legal Description Parser
 *
 * Parses legal descriptions of ward/district boundaries from ordinances,
 * PDFs, and other municipal documents into structured segment data.
 *
 * PHILOSOPHY:
 * - Parse with explicit confidence (never guess silently)
 * - Preserve raw text for human review
 * - Handle metes-and-bounds, street-based, and hybrid descriptions
 * - Output structured segments for street-snap matching
 */

import type {
  BoundarySegmentDescription,
  CardinalDirection,
  SegmentReferenceType,
  WardLegalDescription,
  SourceDocument,
  ParserConfig,
} from './types';
import {
  normalizeStreetName,
  extractStreetCandidates,
  getDefaultNormalization,
} from './street-normalizer';

// =============================================================================
// Parser Configuration
// =============================================================================

/**
 * Default parser configuration
 */
export function getDefaultParserConfig(): ParserConfig {
  return {
    normalization: getDefaultNormalization(),
    patterns: {
      streetCenterline: [
        // "along Main Street"
        /along\s+(?:the\s+)?(?:centerline\s+of\s+)?(.+?)(?:\s+to\s+|\s+from\s+|,|;|$)/gi,
        // "on Elm Avenue"
        /on\s+(?:the\s+)?(.+?)(?:\s+to\s+|\s+from\s+|,|;|$)/gi,
        // "following Oak Road"
        /following\s+(?:the\s+)?(.+?)(?:\s+to\s+|\s+from\s+|,|;|$)/gi,
      ],
      intersection: [
        // "intersection of Main Street and Elm Avenue"
        /intersection\s+(?:of|with)\s+(.+?)\s+(?:and|with)\s+(.+?)(?:,|;|$)/gi,
        // "where Main Street meets Elm Avenue"
        /where\s+(.+?)\s+meets\s+(.+?)(?:,|;|$)/gi,
        // "at the corner of Main and Elm"
        /(?:at\s+)?(?:the\s+)?corner\s+of\s+(.+?)\s+and\s+(.+?)(?:,|;|$)/gi,
      ],
      direction: [
        // "north", "northerly", "in a northerly direction"
        /\b(north|south|east|west|northeast|northwest|southeast|southwest)(?:erly|ward|wards)?\b/gi,
        // "in a northerly direction"
        /in\s+a\s+(north|south|east|west|northeast|northwest|southeast|southwest)(?:erly|ward)?\s+direction/gi,
      ],
      municipalBoundary: [
        // "along the city limits"
        /along\s+(?:the\s+)?(?:city\s+limits?|municipal\s+boundar(?:y|ies)|corporate\s+limits?)/gi,
        // "to the city boundary"
        /to\s+(?:the\s+)?(?:city\s+limits?|municipal\s+boundar(?:y|ies)|corporate\s+limits?)/gi,
      ],
      naturalFeature: [
        // "along the river"
        /along\s+(?:the\s+)?(?:centerline\s+of\s+)?(?:the\s+)?(.+?\s+(?:river|creek|stream|branch|bayou|run|brook))/gi,
        // "following the creek"
        /following\s+(?:the\s+)?(.+?\s+(?:river|creek|stream|branch|bayou|run|brook))/gi,
      ],
    },
    fuzzyMatchThreshold: 0.85,
    maxSnapDistance: 50, // meters
  };
}

// =============================================================================
// Segment Parsing
// =============================================================================

/**
 * Intermediate parsed segment (before validation)
 */
interface ParsedSegmentCandidate {
  readonly rawText: string;
  readonly referenceType: SegmentReferenceType;
  readonly featureName: string;
  readonly direction: CardinalDirection | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly parseNotes: string;
}

/**
 * Parse a single text segment into a structured boundary segment
 *
 * @param text - Raw text of the segment
 * @param config - Parser configuration
 * @returns Parsed segment candidate
 */
function parseSegmentText(
  text: string,
  config: ParserConfig
): ParsedSegmentCandidate {
  let trimmed = text.trim();
  let referenceType: SegmentReferenceType = 'street_centerline';
  let featureName = '';
  let direction: CardinalDirection | null = null;
  let from: string | null = null;
  let to: string | null = null;
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let parseNotes = '';

  // Check for starting point marker (intersection, not a traversal)
  if (trimmed.startsWith('STARTING_POINT:')) {
    trimmed = trimmed.replace('STARTING_POINT:', '').trim();
    // Extract the intersection streets
    const intersectionMatch = trimmed.match(/intersection\s+of\s+(.+?)\s+and\s+(.+?)(?:;|$)/i);
    if (intersectionMatch) {
      referenceType = 'coordinate'; // Starting point, will be resolved to coordinates
      featureName = `intersection:${intersectionMatch[1].trim()}:${intersectionMatch[2].trim()}`;
      confidence = 'high';
      parseNotes = 'Starting point intersection - resolve to coordinates';
      return { rawText: trimmed, referenceType, featureName, direction, from, to, confidence, parseNotes };
    }
  }

  // Check for municipal boundary
  for (const pattern of config.patterns.municipalBoundary) {
    if (pattern.test(trimmed)) {
      referenceType = 'municipal_boundary';
      featureName = 'city limits';
      confidence = 'high';
      parseNotes = 'Matched municipal boundary pattern';
      return { rawText: trimmed, referenceType, featureName, direction, from, to, confidence, parseNotes };
    }
    pattern.lastIndex = 0; // Reset regex
  }

  // Check for natural feature
  for (const pattern of config.patterns.naturalFeature) {
    const match = pattern.exec(trimmed);
    if (match) {
      referenceType = 'natural_feature';
      featureName = match[1].trim();
      confidence = 'high';
      parseNotes = 'Matched natural feature pattern';
      pattern.lastIndex = 0;
      return { rawText: trimmed, referenceType, featureName, direction, from, to, confidence, parseNotes };
    }
    pattern.lastIndex = 0;
  }

  // Check for railroad
  if (/railroad|rail\s+road|railway|rr\s+right.?of.?way/i.test(trimmed)) {
    referenceType = 'railroad';
    const rrMatch = trimmed.match(/(?:along\s+(?:the\s+)?)?(.+?\s+(?:railroad|railway|rail\s+road))/i);
    featureName = rrMatch ? rrMatch[1].trim() : 'railroad right-of-way';
    confidence = 'high';
    parseNotes = 'Matched railroad pattern';
    return { rawText: trimmed, referenceType, featureName, direction, from, to, confidence, parseNotes };
  }

  // Check for highway
  if (/\b(?:i-?\d+|us-?\d+|us\s+highway|state\s+(?:route|road|highway)|sr-?\d+|interstate)\b/i.test(trimmed)) {
    referenceType = 'highway';
    // Extract highway designation
    const hwMatch = trimmed.match(
      /\b(i-?\d+|us-?\s*\d+|us\s+highway\s+\d+|state\s+(?:route|road|highway)\s+\d+|sr-?\s*\d+|interstate\s+\d+)\b/i
    );
    featureName = hwMatch ? hwMatch[1].trim() : trimmed;
    confidence = 'high';
    parseNotes = 'Matched highway pattern';
    return { rawText: trimmed, referenceType, featureName, direction, from, to, confidence, parseNotes };
  }

  // Extract direction
  for (const pattern of config.patterns.direction) {
    const match = pattern.exec(trimmed);
    if (match) {
      const dirText = match[1].toLowerCase();
      direction = normalizeDirection(dirText);
      pattern.lastIndex = 0;
      break;
    }
    pattern.lastIndex = 0;
  }

  // Try to extract street name using patterns
  for (const pattern of config.patterns.streetCenterline) {
    const match = pattern.exec(trimmed);
    if (match) {
      featureName = match[1].trim();
      confidence = 'high';
      parseNotes = 'Matched street centerline pattern';
      pattern.lastIndex = 0;
      break;
    }
    pattern.lastIndex = 0;
  }

  // If no pattern match, try extracting street candidates
  if (!featureName) {
    const candidates = extractStreetCandidates(trimmed);
    if (candidates.length > 0) {
      featureName = candidates[0];
      confidence = 'medium';
      parseNotes = `Extracted from text (${candidates.length} candidate(s))`;
    }
  }

  // Last resort: use the whole text as the feature name
  if (!featureName) {
    featureName = trimmed;
    confidence = 'low';
    parseNotes = 'No pattern match, using raw text';
  }

  // Try to extract from/to points
  const fromMatch = trimmed.match(/from\s+(?:the\s+)?(?:intersection\s+(?:of|with)\s+)?(.+?)(?:\s+to\s+|,|;|$)/i);
  if (fromMatch) {
    from = fromMatch[1].trim();
  }

  const toMatch = trimmed.match(/to\s+(?:the\s+)?(?:intersection\s+(?:of|with)\s+)?(.+?)(?:,|;|$)/i);
  if (toMatch) {
    to = toMatch[1].trim();
  }

  return {
    rawText: trimmed,
    referenceType,
    featureName,
    direction,
    from,
    to,
    confidence,
    parseNotes,
  };
}

/**
 * Normalize direction text to CardinalDirection
 */
function normalizeDirection(text: string): CardinalDirection | null {
  const normalized = text.toLowerCase().trim();
  const dirMap: Record<string, CardinalDirection> = {
    'north': 'north',
    'northerly': 'northerly',
    'south': 'south',
    'southerly': 'southerly',
    'east': 'east',
    'easterly': 'easterly',
    'west': 'west',
    'westerly': 'westerly',
    'northeast': 'northeast',
    'northwest': 'northwest',
    'southeast': 'southeast',
    'southwest': 'southwest',
  };
  return dirMap[normalized] ?? null;
}

/**
 * Split a legal description into individual segments
 *
 * Legal descriptions typically use semicolons, "thence", or numbered lists
 * to separate boundary segments.
 */
function splitIntoSegments(text: string): readonly string[] {
  // First, try splitting by "thence" (common in metes-and-bounds)
  if (/\bthence\b/i.test(text)) {
    let segments = text.split(/\bthence\b/i).map((s) => s.trim()).filter((s) => s.length > 0);

    // Check if first segment is just a "Beginning at intersection" marker
    // These are starting points, not traversal segments
    if (segments.length > 1 && /^(?:Ward\s+\d+:\s*)?Beginning\s+at\s+(?:the\s+)?intersection/i.test(segments[0])) {
      // This is a starting point marker, not a segment to traverse
      // We'll keep it but mark it specially by prepending "STARTING_POINT:"
      segments[0] = `STARTING_POINT:${segments[0]}`;
    }

    if (segments.length > 1) {
      return segments;
    }
  }

  // Try splitting by semicolons
  if (text.includes(';')) {
    const segments = text.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    if (segments.length > 1) {
      return segments;
    }
  }

  // Try splitting by numbered list patterns
  const numberedPattern = /(?:^|\n)\s*(?:\d+[.)\]]|\([a-z]\)|\([0-9]+\))\s*/g;
  if (numberedPattern.test(text)) {
    numberedPattern.lastIndex = 0;
    const segments = text.split(numberedPattern).map((s) => s.trim()).filter((s) => s.length > 0);
    if (segments.length > 1) {
      return segments;
    }
  }

  // Try splitting by "then" or "and then"
  if (/\b(?:and\s+)?then\b/i.test(text)) {
    const segments = text.split(/\b(?:and\s+)?then\b/i).map((s) => s.trim()).filter((s) => s.length > 0);
    if (segments.length > 1) {
      return segments;
    }
  }

  // Try splitting by commas followed by directional words
  const commaDirectionPattern = /,\s*(?=(?:north|south|east|west|along|following|to\s+the)\b)/gi;
  const commaSegments = text.split(commaDirectionPattern).map((s) => s.trim()).filter((s) => s.length > 0);
  if (commaSegments.length > 1) {
    return commaSegments;
  }

  // Return as single segment if no pattern matched
  return [text.trim()];
}

// =============================================================================
// Main Parser Functions
// =============================================================================

/**
 * Result of parsing a complete legal description
 */
export interface ParseResult {
  /** Successfully parsed */
  readonly success: boolean;

  /** Parsed segments */
  readonly segments: readonly BoundarySegmentDescription[];

  /** Parse diagnostics */
  readonly diagnostics: {
    /** Total segments found */
    readonly totalSegments: number;
    /** High confidence segments */
    readonly highConfidenceCount: number;
    /** Medium confidence segments */
    readonly mediumConfidenceCount: number;
    /** Low confidence segments */
    readonly lowConfidenceCount: number;
    /** Parsing warnings */
    readonly warnings: readonly string[];
  };
}

/**
 * Parse a complete legal description into structured segments
 *
 * @param text - Full legal description text
 * @param config - Parser configuration (optional, uses defaults)
 * @returns Parse result with segments and diagnostics
 */
export function parseLegalDescription(
  text: string,
  config: ParserConfig = getDefaultParserConfig()
): ParseResult {
  const warnings: string[] = [];

  // Split into raw segments
  const rawSegments = splitIntoSegments(text);

  if (rawSegments.length === 0) {
    return {
      success: false,
      segments: [],
      diagnostics: {
        totalSegments: 0,
        highConfidenceCount: 0,
        mediumConfidenceCount: 0,
        lowConfidenceCount: 0,
        warnings: ['No segments found in legal description'],
      },
    };
  }

  // Parse each segment
  const parsedCandidates = rawSegments.map((raw) => parseSegmentText(raw, config));

  // Convert to BoundarySegmentDescription
  const segments: BoundarySegmentDescription[] = parsedCandidates.map(
    (candidate, index) => ({
      index,
      referenceType: candidate.referenceType,
      featureName: candidate.featureName,
      direction: candidate.direction ?? undefined,
      from: candidate.from ?? undefined,
      to: candidate.to ?? undefined,
      rawText: candidate.rawText,
      parseConfidence: candidate.confidence,
    })
  );

  // Check for closed ring (first and last segments should connect)
  if (segments.length >= 3) {
    const first = segments[0];
    const last = segments[segments.length - 1];

    // Normalize names for comparison
    const firstName = normalizeStreetName(first.featureName);
    const lastName = normalizeStreetName(last.featureName);

    // Check if boundary might not close
    if (firstName.coreName !== lastName.coreName && !last.to) {
      warnings.push(
        `Boundary may not close: first segment starts at "${first.featureName}", last segment ends at "${last.featureName}"`
      );
    }
  }

  // Count confidence levels
  const highCount = segments.filter((s) => s.parseConfidence === 'high').length;
  const mediumCount = segments.filter((s) => s.parseConfidence === 'medium').length;
  const lowCount = segments.filter((s) => s.parseConfidence === 'low').length;

  // Add warning if too many low-confidence segments
  if (lowCount > segments.length / 2) {
    warnings.push(
      `${lowCount} of ${segments.length} segments have low parse confidence - manual review recommended`
    );
  }

  return {
    success: true,
    segments: Object.freeze(segments),
    diagnostics: {
      totalSegments: segments.length,
      highConfidenceCount: highCount,
      mediumConfidenceCount: mediumCount,
      lowConfidenceCount: lowCount,
      warnings: Object.freeze(warnings),
    },
  };
}

/**
 * Parse a complete ward legal description including metadata
 *
 * @param params - Ward metadata and legal description text
 * @param config - Parser configuration
 * @returns Complete WardLegalDescription
 */
export function parseWardDescription(params: {
  readonly cityFips: string;
  readonly cityName: string;
  readonly state: string;
  readonly wardId: string;
  readonly wardName: string;
  readonly descriptionText: string;
  readonly source: SourceDocument;
  readonly population?: number;
  readonly notes?: string;
}, config?: ParserConfig): { readonly description: WardLegalDescription; readonly parseResult: ParseResult } {
  const parseResult = parseLegalDescription(params.descriptionText, config);

  const description: WardLegalDescription = {
    cityFips: params.cityFips,
    cityName: params.cityName,
    state: params.state,
    wardId: params.wardId,
    wardName: params.wardName,
    segments: parseResult.segments,
    source: params.source,
    population: params.population,
    notes: params.notes,
  };

  return { description, parseResult };
}

/**
 * Validate parsed segments for common issues
 *
 * @param segments - Parsed boundary segments
 * @returns Array of validation issues
 */
export function validateParsedSegments(
  segments: readonly BoundarySegmentDescription[]
): readonly string[] {
  const issues: string[] = [];

  if (segments.length < 3) {
    issues.push(`Only ${segments.length} segments - need at least 3 to form a closed polygon`);
  }

  // Check for duplicate consecutive segments
  for (let i = 1; i < segments.length; i++) {
    const prev = normalizeStreetName(segments[i - 1].featureName);
    const curr = normalizeStreetName(segments[i].featureName);
    if (prev.normalized === curr.normalized && prev.normalized.length > 0) {
      issues.push(`Duplicate consecutive segment at index ${i}: "${segments[i].featureName}"`);
    }
  }

  // Check for segments with empty feature names
  segments.forEach((seg, idx) => {
    if (!seg.featureName || seg.featureName.trim().length === 0) {
      issues.push(`Segment ${idx} has empty feature name`);
    }
  });

  // Check for too many low-confidence segments
  const lowConfCount = segments.filter((s) => s.parseConfidence === 'low').length;
  if (lowConfCount > 0) {
    issues.push(
      `${lowConfCount} segment(s) have low parse confidence: ${segments
        .filter((s) => s.parseConfidence === 'low')
        .map((s) => `"${s.rawText.substring(0, 50)}..."`)
        .join(', ')}`
    );
  }

  return Object.freeze(issues);
}
