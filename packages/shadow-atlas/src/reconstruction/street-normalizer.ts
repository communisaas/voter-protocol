/**
 * Street Name Normalizer
 *
 * Normalizes street names from legal descriptions to match OSM/TIGER data.
 * Handles abbreviations, suffixes, directions, and common variations.
 *
 * PHILOSOPHY:
 * - Deterministic normalization (same input → same output)
 * - Preserve semantic meaning while removing syntactic variation
 * - Return both normalized and canonical forms for fuzzy matching
 */

import type { StreetNameNormalization } from './types';

// =============================================================================
// Normalization Maps (Immutable)
// =============================================================================

/**
 * Street suffix expansions (abbreviation → full form)
 * Source: USPS Publication 28, Appendix C
 */
const SUFFIX_EXPANSIONS: ReadonlyMap<string, string> = new Map([
  // Common suffixes
  ['st', 'street'],
  ['str', 'street'],
  ['ave', 'avenue'],
  ['av', 'avenue'],
  ['blvd', 'boulevard'],
  ['bl', 'boulevard'],
  ['dr', 'drive'],
  ['drv', 'drive'],
  ['rd', 'road'],
  ['ln', 'lane'],
  ['ct', 'court'],
  ['crt', 'court'],
  ['pl', 'place'],
  ['cir', 'circle'],
  ['cr', 'circle'],
  ['way', 'way'],
  ['wy', 'way'],
  ['pkwy', 'parkway'],
  ['pky', 'parkway'],
  ['hwy', 'highway'],
  ['hw', 'highway'],
  ['fwy', 'freeway'],
  ['expy', 'expressway'],
  ['exp', 'expressway'],
  ['ter', 'terrace'],
  ['terr', 'terrace'],
  ['trl', 'trail'],
  ['tr', 'trail'],
  ['pass', 'pass'],
  ['path', 'path'],
  ['pike', 'pike'],
  ['sq', 'square'],
  ['plz', 'plaza'],
  ['pt', 'point'],
  ['xing', 'crossing'],
  ['crk', 'creek'],
  ['brg', 'bridge'],
  ['aly', 'alley'],
  ['anx', 'annex'],
  ['arc', 'arcade'],
  ['bch', 'beach'],
  ['bnd', 'bend'],
  ['blf', 'bluff'],
  ['brk', 'brook'],
  ['byp', 'bypass'],
  ['cswy', 'causeway'],
  ['ctr', 'center'],
  ['clb', 'club'],
  ['cmn', 'common'],
  ['cors', 'corners'],
  ['crst', 'crest'],
  ['cv', 'cove'],
  ['dl', 'dale'],
  ['dm', 'dam'],
  ['dv', 'divide'],
  ['est', 'estate'],
  ['ext', 'extension'],
  ['fld', 'field'],
  ['flt', 'flat'],
  ['frd', 'ford'],
  ['frst', 'forest'],
  ['frg', 'forge'],
  ['frk', 'fork'],
  ['gdn', 'garden'],
  ['gtwy', 'gateway'],
  ['gln', 'glen'],
  ['grn', 'green'],
  ['grv', 'grove'],
  ['hbr', 'harbor'],
  ['hvn', 'haven'],
  ['hts', 'heights'],
  ['hl', 'hill'],
  ['holw', 'hollow'],
  ['inlt', 'inlet'],
  ['is', 'island'],
  ['jct', 'junction'],
  ['ky', 'key'],
  ['knl', 'knoll'],
  ['lk', 'lake'],
  ['lndg', 'landing'],
  ['ldg', 'lodge'],
  ['lp', 'loop'],
  ['mall', 'mall'],
  ['mnr', 'manor'],
  ['mdw', 'meadow'],
  ['ml', 'mill'],
  ['mtn', 'mountain'],
  ['mt', 'mount'],
  ['nck', 'neck'],
  ['orch', 'orchard'],
  ['ovl', 'oval'],
  ['park', 'park'],
  ['pne', 'pine'],
  ['pln', 'plain'],
  ['plns', 'plains'],
  ['prt', 'port'],
  ['pr', 'prairie'],
  ['radl', 'radial'],
  ['rnch', 'ranch'],
  ['rpd', 'rapid'],
  ['rpds', 'rapids'],
  ['rst', 'rest'],
  ['rdg', 'ridge'],
  ['riv', 'river'],
  ['rvr', 'river'],
  ['run', 'run'],
  ['shl', 'shoal'],
  ['shr', 'shore'],
  ['spg', 'spring'],
  ['spur', 'spur'],
  ['sta', 'station'],
  ['strm', 'stream'],
  ['smt', 'summit'],
  ['tunl', 'tunnel'],
  ['tpke', 'turnpike'],
  ['un', 'union'],
  ['vly', 'valley'],
  ['vw', 'view'],
  ['vlg', 'village'],
  ['vis', 'vista'],
  ['wk', 'walk'],
  ['wl', 'well'],
  ['wls', 'wells'],
]);

/**
 * Directional prefix/suffix expansions
 */
const DIRECTION_EXPANSIONS: ReadonlyMap<string, string> = new Map([
  ['n', 'north'],
  ['s', 'south'],
  ['e', 'east'],
  ['w', 'west'],
  ['ne', 'northeast'],
  ['nw', 'northwest'],
  ['se', 'southeast'],
  ['sw', 'southwest'],
  ['no', 'north'],
  ['so', 'south'],
]);

/**
 * Common abbreviations and alternate names
 */
const COMMON_ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  // MLK variations
  ['mlk', 'martin luther king'],
  ['mlk jr', 'martin luther king junior'],
  ['mlk jr.', 'martin luther king junior'],
  ['m.l.k.', 'martin luther king'],
  ['dr mlk', 'doctor martin luther king'],
  ['dr. mlk', 'doctor martin luther king'],

  // Highway designations
  ['us', 'us highway'],
  ['sr', 'state route'],
  ['cr', 'county road'],
  ['fm', 'farm to market'],
  ['rm', 'ranch to market'],
  ['ih', 'interstate highway'],
  ['i', 'interstate'],

  // Common words
  ['st', 'saint'], // Note: context-dependent (saint vs street)
  ['ft', 'fort'],
  ['mt', 'mount'],
  ['pt', 'point'],
  ['jfk', 'john f kennedy'],
  ['fdr', 'franklin d roosevelt'],
  ['lbj', 'lyndon b johnson'],

  // Building/location types
  ['bldg', 'building'],
  ['apt', 'apartment'],
  ['ste', 'suite'],
  ['fl', 'floor'],
  ['rm', 'room'],
]);

/**
 * Stop words to remove (articles, prepositions that don't affect matching)
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the',
  'of',
  'and',
  'at',
  'to',
  'in',
  'on',
  'a',
  'an',
]);

/**
 * Ordinal number patterns
 */
const ORDINAL_PATTERNS: ReadonlyMap<RegExp, string> = new Map([
  [/\b1st\b/gi, 'first'],
  [/\b2nd\b/gi, 'second'],
  [/\b3rd\b/gi, 'third'],
  [/\b4th\b/gi, 'fourth'],
  [/\b5th\b/gi, 'fifth'],
  [/\b6th\b/gi, 'sixth'],
  [/\b7th\b/gi, 'seventh'],
  [/\b8th\b/gi, 'eighth'],
  [/\b9th\b/gi, 'ninth'],
  [/\b10th\b/gi, 'tenth'],
  [/\b11th\b/gi, 'eleventh'],
  [/\b12th\b/gi, 'twelfth'],
]);

// =============================================================================
// Normalization Functions
// =============================================================================

/**
 * Result of street name normalization
 */
export interface NormalizedStreetName {
  /** Original input */
  readonly original: string;

  /** Fully normalized form (lowercase, expanded, stop words removed) */
  readonly normalized: string;

  /** Tokens after normalization */
  readonly tokens: readonly string[];

  /** Detected direction prefix (if any) */
  readonly directionPrefix: string | null;

  /** Detected direction suffix (if any) */
  readonly directionSuffix: string | null;

  /** Detected street type suffix */
  readonly streetType: string | null;

  /** Core name without direction/type */
  readonly coreName: string;
}

/**
 * Normalize a street name for matching
 *
 * @param input - Raw street name from legal description or GIS data
 * @returns Normalized street name with metadata
 */
export function normalizeStreetName(input: string): NormalizedStreetName {
  const original = input;

  // Step 1: Lowercase and remove extra whitespace
  let working = input.toLowerCase().trim();
  working = working.replace(/\s+/g, ' ');

  // Step 2: Remove punctuation except hyphens in compound names
  working = working.replace(/[.,;:'"()[\]{}!?]/g, '');

  // Step 3: Expand ordinals
  for (const [pattern, replacement] of ORDINAL_PATTERNS) {
    working = working.replace(pattern, replacement);
  }

  // Step 4: Tokenize
  const tokens = working.split(' ').filter((t) => t.length > 0);

  // Step 5: Detect and expand direction prefix
  let directionPrefix: string | null = null;
  if (tokens.length > 0) {
    const firstToken = tokens[0];
    const expanded = DIRECTION_EXPANSIONS.get(firstToken);
    if (expanded) {
      directionPrefix = expanded;
      tokens[0] = expanded;
    } else if (
      ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'].includes(
        firstToken
      )
    ) {
      directionPrefix = firstToken;
    }
  }

  // Step 6: Detect and expand direction suffix
  let directionSuffix: string | null = null;
  if (tokens.length > 1) {
    const lastToken = tokens[tokens.length - 1];
    const expanded = DIRECTION_EXPANSIONS.get(lastToken);
    if (expanded) {
      directionSuffix = expanded;
      tokens[tokens.length - 1] = expanded;
    } else if (
      ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'].includes(
        lastToken
      )
    ) {
      directionSuffix = lastToken;
    }
  }

  // Step 7: Detect and expand street type suffix
  let streetType: string | null = null;
  if (tokens.length > 0) {
    // Check second-to-last token if last is a direction
    const typeIndex = directionSuffix && tokens.length > 1 ? tokens.length - 2 : tokens.length - 1;
    const typeToken = tokens[typeIndex];
    const expanded = SUFFIX_EXPANSIONS.get(typeToken);
    if (expanded) {
      streetType = expanded;
      tokens[typeIndex] = expanded;
    } else if (SUFFIX_EXPANSIONS.has(typeToken.replace(/s$/, ''))) {
      // Handle plurals (e.g., "streets" → "street")
      const singular = typeToken.replace(/s$/, '');
      streetType = SUFFIX_EXPANSIONS.get(singular) ?? null;
      if (streetType) {
        tokens[typeIndex] = streetType;
      }
    }
  }

  // Step 8: Expand common abbreviations
  for (let i = 0; i < tokens.length; i++) {
    const expanded = COMMON_ABBREVIATIONS.get(tokens[i]);
    if (expanded) {
      // Split expanded form into multiple tokens
      const expandedTokens = expanded.split(' ');
      tokens.splice(i, 1, ...expandedTokens);
      i += expandedTokens.length - 1;
    }
  }

  // Step 9: Remove stop words (but keep if it's the only word)
  const filteredTokens =
    tokens.length > 1 ? tokens.filter((t) => !STOP_WORDS.has(t)) : tokens;

  // Step 10: Extract core name (without direction and type)
  const coreTokens = filteredTokens.filter((t) => {
    if (t === directionPrefix || t === directionSuffix) return false;
    if (t === streetType) return false;
    return true;
  });
  const coreName = coreTokens.join(' ');

  // Step 11: Build normalized form
  const normalized = filteredTokens.join(' ');

  return {
    original,
    normalized,
    tokens: Object.freeze([...filteredTokens]),
    directionPrefix,
    directionSuffix,
    streetType,
    coreName,
  };
}

/**
 * Calculate similarity between two normalized street names
 * Uses Levenshtein distance normalized to [0, 1]
 *
 * @param a - First normalized name
 * @param b - Second normalized name
 * @returns Similarity score (1.0 = exact match, 0.0 = completely different)
 */
export function streetNameSimilarity(a: NormalizedStreetName, b: NormalizedStreetName): number {
  // Exact match on normalized form
  if (a.normalized === b.normalized) {
    return 1.0;
  }

  // Exact match on core name (ignore direction/type differences)
  if (a.coreName === b.coreName && a.coreName.length > 0) {
    return 0.95;
  }

  // Levenshtein distance on normalized form
  const distance = levenshteinDistance(a.normalized, b.normalized);
  const maxLength = Math.max(a.normalized.length, b.normalized.length);

  if (maxLength === 0) return 1.0;

  return 1.0 - distance / maxLength;
}

/**
 * Calculate Levenshtein edit distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two street names likely refer to the same street
 *
 * @param a - First street name
 * @param b - Second street name
 * @param threshold - Minimum similarity score (default: 0.85)
 * @returns True if names are similar enough to be the same street
 */
export function areStreetNamesEquivalent(
  a: string,
  b: string,
  threshold: number = 0.85
): boolean {
  const normalizedA = normalizeStreetName(a);
  const normalizedB = normalizeStreetName(b);
  return streetNameSimilarity(normalizedA, normalizedB) >= threshold;
}

/**
 * Get the default normalization configuration
 */
export function getDefaultNormalization(): StreetNameNormalization {
  return {
    suffixExpansions: SUFFIX_EXPANSIONS,
    directionExpansions: DIRECTION_EXPANSIONS,
    abbreviations: COMMON_ABBREVIATIONS,
    stopWords: STOP_WORDS,
  };
}

/**
 * Extract potential street names from a legal description text segment
 *
 * @param text - Raw text from legal description
 * @returns Array of potential street name candidates
 */
export function extractStreetCandidates(text: string): readonly string[] {
  const candidates: string[] = [];

  // Pattern: "along <street name>"
  const alongPattern = /along\s+(?:the\s+)?(.+?)(?:\s+to\s+|\s+from\s+|,|;|$)/gi;
  let match;
  while ((match = alongPattern.exec(text)) !== null) {
    candidates.push(match[1].trim());
  }

  // Pattern: "on <street name>"
  const onPattern = /on\s+(?:the\s+)?(.+?)(?:\s+to\s+|\s+from\s+|,|;|$)/gi;
  while ((match = onPattern.exec(text)) !== null) {
    candidates.push(match[1].trim());
  }

  // Pattern: "<direction> on <street name>"
  const dirOnPattern =
    /(?:north|south|east|west|northerly|southerly|easterly|westerly)\s+on\s+(.+?)(?:\s+to\s+|,|;|$)/gi;
  while ((match = dirOnPattern.exec(text)) !== null) {
    candidates.push(match[1].trim());
  }

  // Pattern: "intersection of/with <street name>"
  const intersectionPattern = /intersection\s+(?:of|with)\s+(.+?)(?:\s+and\s+|\s+with\s+|,|;|$)/gi;
  while ((match = intersectionPattern.exec(text)) !== null) {
    candidates.push(match[1].trim());
  }

  // Pattern: "<street name> Street/Avenue/Road/etc"
  const suffixPattern =
    /\b([A-Z][a-zA-Z\s]+?)\s+(?:Street|Avenue|Boulevard|Drive|Road|Lane|Court|Place|Circle|Way|Parkway|Highway)\b/g;
  while ((match = suffixPattern.exec(text)) !== null) {
    candidates.push(match[0].trim());
  }

  // Deduplicate
  return [...new Set(candidates)];
}
