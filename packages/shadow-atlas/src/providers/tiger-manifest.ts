/**
 * TIGER/Line Data Integrity Manifest
 *
 * Stores SHA-256 checksums for verified TIGER/Line downloads.
 * These checksums should be updated when new TIGER vintages are released.
 *
 * SECURITY: This manifest provides cryptographic verification to protect against:
 * - Man-in-the-middle (MITM) attacks on TIGER downloads
 * - Corrupted downloads from network issues
 * - Unauthorized modifications to Census boundary data
 *
 * USAGE:
 * 1. Generate checksums: npx tsx scripts/generate-tiger-manifest.ts
 * 2. Verify downloads: Use verifyTIGERBuffer() before processing
 * 3. Update manifest when new TIGER vintages are released
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Individual TIGER file entry with integrity metadata
 */
export interface TIGERFileEntry {
  /** Relative path within TIGER archive */
  readonly path: string;

  /** SHA-256 checksum (hex-encoded) */
  readonly sha256: string;

  /** File size in bytes */
  readonly size: number;

  /** Full download URL */
  readonly url: string;

  /** Last verification date (ISO 8601) */
  readonly verifiedAt?: string;
}

/**
 * Complete TIGER manifest for a vintage year
 */
export interface TIGERManifest {
  /** TIGER vintage year */
  readonly vintage: '2024' | '2023' | '2022';

  /** Manifest version for tracking updates */
  readonly version: string;

  /** Manifest generation/update date (ISO 8601) */
  readonly generatedAt: string;

  /** SHA-256 checksums computed from official Census Bureau downloads */
  readonly source: 'census.gov';

  /** Files included in this manifest, keyed by layer identifier */
  readonly files: Readonly<Record<string, TIGERFileEntry>>;
}

/**
 * Verification options
 */
export interface TIGERVerificationOptions {
  /** Throw error on missing checksum (default: true in production) */
  readonly strictMode?: boolean;

  /** Allow empty/null checksums for development (default: false) */
  readonly allowEmptyChecksums?: boolean;

  /** Log verification results */
  readonly verbose?: boolean;
}

// ============================================================================
// Manifest Data
// ============================================================================

/**
 * TIGER 2024 Manifest
 *
 * Contains SHA-256 checksums for verified TIGER/Line 2024 downloads.
 *
 * IMPORTANT: These checksums should be generated from authoritative Census Bureau
 * downloads using: npx tsx scripts/generate-tiger-manifest.ts
 *
 * Checksums marked as empty ('') require population from Census Bureau.
 * Run the manifest generator to fetch and compute actual checksums.
 */
export const TIGER_2024_MANIFEST: TIGERManifest = {
  vintage: '2024',
  version: '1.0.0',
  generatedAt: '2026-01-26T00:00:00.000Z',
  source: 'census.gov',
  files: {
    // ========================================================================
    // Congressional Districts (119th Congress)
    // National file containing all 435 congressional districts
    // ========================================================================
    cd119: {
      path: 'tl_2024_us_cd119.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_us_cd119.zip',
    },

    // ========================================================================
    // Counties (National)
    // All 3,143 US counties
    // ========================================================================
    county: {
      path: 'tl_2024_us_county.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip',
    },

    // ========================================================================
    // States (National)
    // All 50 states + DC + territories
    // ========================================================================
    state: {
      path: 'tl_2024_us_state.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/STATE/tl_2024_us_state.zip',
    },

    // ========================================================================
    // American Indian/Alaska Native/Native Hawaiian Areas (National)
    // ========================================================================
    aiannh: {
      path: 'tl_2024_us_aiannh.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/AIANNH/tl_2024_us_aiannh.zip',
    },

    // ========================================================================
    // Core Based Statistical Areas (National)
    // Metropolitan and micropolitan statistical areas
    // ========================================================================
    cbsa: {
      path: 'tl_2024_us_cbsa.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/CBSA/tl_2024_us_cbsa.zip',
    },

    // ========================================================================
    // Military Installations (National)
    // ========================================================================
    mil: {
      path: 'tl_2024_us_mil.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/MIL/tl_2024_us_mil.zip',
    },

    // ========================================================================
    // ZIP Code Tabulation Areas (National, 2020 Census vintage)
    // ========================================================================
    zcta520: {
      path: 'tl_2024_us_zcta520.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/ZCTA520/tl_2024_us_zcta520.zip',
    },

    // ========================================================================
    // Urban Areas (National)
    // ========================================================================
    uac: {
      path: 'tl_2024_us_uac.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/UAC/tl_2024_us_uac.zip',
    },
  },
};

/**
 * TIGER 2023 Manifest (previous vintage for validation)
 */
export const TIGER_2023_MANIFEST: TIGERManifest = {
  vintage: '2023',
  version: '1.0.0',
  generatedAt: '2026-01-26T00:00:00.000Z',
  source: 'census.gov',
  files: {
    cd118: {
      path: 'tl_2023_us_cd118.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2023/CD/tl_2023_us_cd118.zip',
    },
    county: {
      path: 'tl_2023_us_county.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2023/COUNTY/tl_2023_us_county.zip',
    },
    state: {
      path: 'tl_2023_us_state.zip',
      sha256: '', // TODO: Generate from Census Bureau download
      size: 0,
      url: 'https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip',
    },
  },
};

// ============================================================================
// Manifest Registry
// ============================================================================

/**
 * All available TIGER manifests, keyed by vintage year
 */
export const TIGER_MANIFESTS: Readonly<Record<string, TIGERManifest>> = {
  '2024': TIGER_2024_MANIFEST,
  '2023': TIGER_2023_MANIFEST,
};

// ============================================================================
// Lookup Functions
// ============================================================================

/**
 * Get manifest for a specific TIGER vintage
 *
 * @param vintage - TIGER year (e.g., '2024')
 * @returns Manifest or null if not available
 */
export function getTIGERManifest(vintage: string): TIGERManifest | null {
  return TIGER_MANIFESTS[vintage] ?? null;
}

/**
 * Get the expected checksum for a TIGER file
 *
 * @param vintage - TIGER year (e.g., '2024')
 * @param fileKey - File identifier (e.g., 'cd119', 'county')
 * @returns SHA-256 checksum or null if not found
 *
 * @example
 * ```typescript
 * const checksum = getTIGERChecksum('2024', 'county');
 * if (checksum) {
 *   const result = verifyTIGERBuffer(downloadedData, checksum);
 *   if (!result.valid) {
 *     throw new Error('TIGER integrity check failed!');
 *   }
 * }
 * ```
 */
export function getTIGERChecksum(vintage: string, fileKey: string): string | null {
  const manifest = TIGER_MANIFESTS[vintage];
  if (!manifest) return null;

  const entry = manifest.files[fileKey];
  if (!entry) return null;

  // Return null for empty checksums (not yet populated)
  return entry.sha256 || null;
}

/**
 * Get full file entry for a TIGER file
 *
 * @param vintage - TIGER year
 * @param fileKey - File identifier
 * @returns File entry or null if not found
 */
export function getTIGERFileEntry(vintage: string, fileKey: string): TIGERFileEntry | null {
  const manifest = TIGER_MANIFESTS[vintage];
  if (!manifest) return null;
  return manifest.files[fileKey] ?? null;
}

/**
 * Build state-specific file key for state-level TIGER files
 *
 * @param layer - TIGER layer type (e.g., 'sldu', 'place')
 * @param stateFips - 2-digit state FIPS code
 * @returns File key for manifest lookup
 *
 * @example
 * ```typescript
 * const key = buildStateFileKey('sldu', '06'); // 'sldu_06'
 * const checksum = getTIGERChecksum('2024', key);
 * ```
 */
export function buildStateFileKey(layer: string, stateFips: string): string {
  return `${layer}_${stateFips}`;
}

/**
 * Get checksum for a state-level TIGER file
 *
 * @param vintage - TIGER year
 * @param layer - TIGER layer type
 * @param stateFips - 2-digit state FIPS code
 * @returns SHA-256 checksum or null
 */
export function getStateTIGERChecksum(
  vintage: string,
  layer: string,
  stateFips: string
): string | null {
  const fileKey = buildStateFileKey(layer, stateFips);
  return getTIGERChecksum(vintage, fileKey);
}

/**
 * Check if a manifest has populated checksums
 *
 * @param vintage - TIGER year
 * @returns True if manifest has at least one non-empty checksum
 */
export function manifestHasChecksums(vintage: string): boolean {
  const manifest = TIGER_MANIFESTS[vintage];
  if (!manifest) return false;

  return Object.values(manifest.files).some((entry) => entry.sha256 !== '');
}

/**
 * List all file keys in a manifest
 *
 * @param vintage - TIGER year
 * @returns Array of file keys
 */
export function listManifestFiles(vintage: string): readonly string[] {
  const manifest = TIGER_MANIFESTS[vintage];
  if (!manifest) return [];
  return Object.keys(manifest.files);
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate that a checksum is in correct format
 *
 * @param checksum - SHA-256 checksum to validate
 * @returns True if valid hex-encoded SHA-256
 */
export function isValidChecksum(checksum: string): boolean {
  // SHA-256 produces 64 hex characters
  return /^[a-f0-9]{64}$/i.test(checksum);
}

/**
 * Get missing checksums that need to be populated
 *
 * @param vintage - TIGER year
 * @returns Array of file keys with empty checksums
 */
export function getMissingChecksums(vintage: string): readonly string[] {
  const manifest = TIGER_MANIFESTS[vintage];
  if (!manifest) return [];

  return Object.entries(manifest.files)
    .filter(([, entry]) => !entry.sha256)
    .map(([key]) => key);
}
