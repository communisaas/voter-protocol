/**
 * TIGER/Line Data Integrity Verifier
 *
 * Provides cryptographic verification for Census TIGER/Line downloads.
 * Uses SHA-256 checksums to detect MITM attacks and data corruption.
 *
 * SECURITY CRITICAL:
 * - Always verify downloads before processing boundary data
 * - Failed verification should abort ingestion immediately
 * - Log all verification failures for security monitoring
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { logger } from '../core/utils/logger.js';
import {
  getTIGERChecksum,
  getStateTIGERChecksum,
  isValidChecksum,
  type TIGERVerificationOptions,
} from './tiger-manifest.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of integrity verification
 */
export interface VerificationResult {
  /** Whether verification passed */
  readonly valid: boolean;

  /** Expected SHA-256 checksum */
  readonly expectedHash: string;

  /** Actual computed SHA-256 checksum */
  readonly actualHash: string;

  /** File size in bytes */
  readonly fileSize: number;

  /** Verification timestamp */
  readonly verifiedAt: string;

  /** Human-readable status message */
  readonly message: string;
}

/**
 * TIGER integrity verification error
 *
 * Thrown when cryptographic verification fails.
 * Contains detailed information for security logging and debugging.
 */
export class TIGERIntegrityError extends Error {
  readonly code = 'TIGER_INTEGRITY_ERROR';

  constructor(
    /** File identifier (layer name, URL, or path) */
    readonly fileId: string,
    /** Verification result details */
    readonly result: VerificationResult,
    /** Original URL if available */
    readonly sourceUrl?: string
  ) {
    super(
      `TIGER integrity check FAILED for ${fileId}\n` +
        `Expected: ${result.expectedHash}\n` +
        `Got:      ${result.actualHash}\n` +
        `Size:     ${result.fileSize} bytes\n` +
        `This may indicate a MITM attack or corrupted download.`
    );
    this.name = 'TIGERIntegrityError';
  }
}

/**
 * Error thrown when no checksum is available for verification
 */
export class TIGERChecksumMissingError extends Error {
  readonly code = 'TIGER_CHECKSUM_MISSING';

  constructor(
    readonly fileKey: string,
    readonly vintage: string
  ) {
    super(
      `No checksum available for TIGER file: ${fileKey} (vintage ${vintage})\n` +
        `Run 'npx tsx scripts/generate-tiger-manifest.ts' to populate checksums.`
    );
    this.name = 'TIGERChecksumMissingError';
  }
}

// ============================================================================
// Core Verification Functions
// ============================================================================

/**
 * Compute SHA-256 checksum of a Buffer
 *
 * @param data - Data to hash
 * @returns Hex-encoded SHA-256 checksum
 */
export function computeSHA256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Verify a Buffer against expected hash
 *
 * @param data - Downloaded data to verify
 * @param expectedHash - Expected SHA-256 checksum
 * @returns Verification result
 *
 * @example
 * ```typescript
 * const response = await fetch(tigerUrl);
 * const data = Buffer.from(await response.arrayBuffer());
 * const result = verifyTIGERBuffer(data, expectedChecksum);
 *
 * if (!result.valid) {
 *   throw new TIGERIntegrityError('county', result, tigerUrl);
 * }
 * ```
 */
export function verifyTIGERBuffer(data: Buffer, expectedHash: string): VerificationResult {
  const actualHash = computeSHA256(data);
  const valid = actualHash.toLowerCase() === expectedHash.toLowerCase();

  return {
    valid,
    expectedHash: expectedHash.toLowerCase(),
    actualHash: actualHash.toLowerCase(),
    fileSize: data.length,
    verifiedAt: new Date().toISOString(),
    message: valid
      ? `Verification passed: SHA-256 matches expected value`
      : `VERIFICATION FAILED: Hash mismatch detected`,
  };
}

/**
 * Verify a downloaded TIGER file against the manifest
 *
 * @param filePath - Path to downloaded file
 * @param expectedHash - Expected SHA-256 checksum
 * @returns Verification result
 */
export async function verifyTIGERFile(
  filePath: string,
  expectedHash: string
): Promise<VerificationResult> {
  const fileBuffer = await fs.readFile(filePath);
  return verifyTIGERBuffer(fileBuffer, expectedHash);
}

/**
 * Verify a TIGER file using manifest lookup
 *
 * @param filePath - Path to downloaded file
 * @param vintage - TIGER year (e.g., '2024')
 * @param fileKey - File identifier in manifest
 * @param options - Verification options
 * @returns Verification result
 * @throws TIGERChecksumMissingError if no checksum available and strictMode enabled
 *
 * @example
 * ```typescript
 * const result = await verifyTIGERFileFromManifest(
 *   '/cache/tl_2024_us_county.zip',
 *   '2024',
 *   'county'
 * );
 *
 * if (!result.valid) {
 *   throw new TIGERIntegrityError('county', result);
 * }
 * ```
 */
export async function verifyTIGERFileFromManifest(
  filePath: string,
  vintage: string,
  fileKey: string,
  options: TIGERVerificationOptions = {}
): Promise<VerificationResult | null> {
  const { strictMode = true, allowEmptyChecksums = false, verbose = false } = options;

  const expectedHash = getTIGERChecksum(vintage, fileKey);

  if (!expectedHash) {
    if (strictMode && !allowEmptyChecksums) {
      throw new TIGERChecksumMissingError(fileKey, vintage);
    }

    if (verbose) {
      logger.warn('No checksum available for TIGER file', {
        fileKey,
        vintage,
        filePath,
      });
    }

    return null;
  }

  const result = await verifyTIGERFile(filePath, expectedHash);

  if (verbose) {
    if (result.valid) {
      logger.info('TIGER verification passed', {
        fileKey,
        vintage,
        hash: result.actualHash.slice(0, 16) + '...',
        size: result.fileSize,
      });
    } else {
      logger.error('TIGER verification FAILED', {
        fileKey,
        vintage,
        expected: expectedHash.slice(0, 16) + '...',
        actual: result.actualHash.slice(0, 16) + '...',
        size: result.fileSize,
      });
    }
  }

  return result;
}

// ============================================================================
// Download and Verify Functions
// ============================================================================

/**
 * Download and verify a TIGER file in one operation
 *
 * This function:
 * 1. Downloads the file from Census Bureau
 * 2. Computes SHA-256 checksum of downloaded data
 * 3. Verifies against expected checksum
 * 4. Throws on verification failure
 *
 * @param url - TIGER download URL
 * @param expectedHash - Expected SHA-256 checksum
 * @param options - Download options
 * @returns Verified file data as Buffer
 * @throws TIGERIntegrityError on verification failure
 *
 * @example
 * ```typescript
 * const checksum = getTIGERChecksum('2024', 'county');
 * if (!checksum) {
 *   throw new Error('No checksum available');
 * }
 *
 * const data = await downloadAndVerifyTIGER(
 *   'https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip',
 *   checksum
 * );
 *
 * // Process verified data
 * await extractShapefile(data);
 * ```
 */
export async function downloadAndVerifyTIGER(
  url: string,
  expectedHash: string,
  options: {
    timeout?: number;
    verbose?: boolean;
  } = {}
): Promise<Buffer> {
  const { timeout = 120000, verbose = false } = options;

  if (verbose) {
    logger.info('Downloading TIGER file with verification', {
      url,
      expectedHash: expectedHash.slice(0, 16) + '...',
    });
  }

  // Download with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas TIGER Verifier)',
      },
    });

    if (!response.ok) {
      throw new Error(`TIGER download failed: ${response.status} ${response.statusText}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    const result = verifyTIGERBuffer(data, expectedHash);

    if (!result.valid) {
      throw new TIGERIntegrityError(url, result, url);
    }

    if (verbose) {
      logger.info('TIGER download verified successfully', {
        url,
        size: data.length,
        hash: result.actualHash.slice(0, 16) + '...',
      });
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download TIGER file with optional verification (when checksum available)
 *
 * Use this function when checksums may not be available for all files.
 * Falls back to unverified download when no checksum exists.
 *
 * @param url - TIGER download URL
 * @param vintage - TIGER year
 * @param fileKey - File identifier in manifest
 * @param options - Download and verification options
 * @returns Downloaded data and verification result
 */
export async function downloadTIGERWithOptionalVerification(
  url: string,
  vintage: string,
  fileKey: string,
  options: TIGERVerificationOptions & { timeout?: number } = {}
): Promise<{
  data: Buffer;
  verified: boolean;
  result: VerificationResult | null;
}> {
  const { timeout = 120000, verbose = false } = options;

  // Download file
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VOTER-Protocol/1.0 (Shadow Atlas TIGER Verifier)',
      },
    });

    if (!response.ok) {
      throw new Error(`TIGER download failed: ${response.status} ${response.statusText}`);
    }

    const data = Buffer.from(await response.arrayBuffer());

    // Attempt verification
    const expectedHash = getTIGERChecksum(vintage, fileKey);

    if (!expectedHash) {
      if (verbose) {
        logger.warn('No checksum available, proceeding without verification', {
          fileKey,
          vintage,
          url,
        });
      }

      return {
        data,
        verified: false,
        result: null,
      };
    }

    const result = verifyTIGERBuffer(data, expectedHash);

    if (!result.valid) {
      throw new TIGERIntegrityError(fileKey, result, url);
    }

    if (verbose) {
      logger.info('TIGER download verified successfully', {
        fileKey,
        vintage,
        hash: result.actualHash.slice(0, 16) + '...',
      });
    }

    return {
      data,
      verified: true,
      result,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// State-Level Verification
// ============================================================================

/**
 * Verify a state-level TIGER file
 *
 * @param data - Downloaded file data
 * @param vintage - TIGER year
 * @param layer - TIGER layer type (e.g., 'sldu', 'place')
 * @param stateFips - 2-digit state FIPS code
 * @param options - Verification options
 * @returns Verification result or null if no checksum available
 */
export function verifyStateTIGERBuffer(
  data: Buffer,
  vintage: string,
  layer: string,
  stateFips: string,
  options: TIGERVerificationOptions = {}
): VerificationResult | null {
  const { strictMode = true, allowEmptyChecksums = false, verbose = false } = options;

  const expectedHash = getStateTIGERChecksum(vintage, layer, stateFips);

  if (!expectedHash) {
    if (strictMode && !allowEmptyChecksums) {
      throw new TIGERChecksumMissingError(`${layer}_${stateFips}`, vintage);
    }

    if (verbose) {
      logger.warn('No checksum available for state TIGER file', {
        layer,
        stateFips,
        vintage,
      });
    }

    return null;
  }

  const result = verifyTIGERBuffer(data, expectedHash);

  if (verbose) {
    if (result.valid) {
      logger.info('State TIGER verification passed', {
        layer,
        stateFips,
        vintage,
        hash: result.actualHash.slice(0, 16) + '...',
      });
    } else {
      logger.error('State TIGER verification FAILED', {
        layer,
        stateFips,
        vintage,
        expected: expectedHash.slice(0, 16) + '...',
        actual: result.actualHash.slice(0, 16) + '...',
      });
    }
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a verification summary for logging
 *
 * @param results - Array of verification results
 * @returns Summary object for logging
 */
export function createVerificationSummary(
  results: readonly (VerificationResult | null)[]
): {
  total: number;
  verified: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  const nonNull = results.filter((r): r is VerificationResult => r !== null);

  return {
    total: results.length,
    verified: nonNull.length,
    passed: nonNull.filter((r) => r.valid).length,
    failed: nonNull.filter((r) => !r.valid).length,
    skipped: results.length - nonNull.length,
  };
}

/**
 * Validate checksum format
 *
 * @param checksum - Checksum string to validate
 * @returns True if valid SHA-256 hex string
 */
export function validateChecksumFormat(checksum: string): boolean {
  return isValidChecksum(checksum);
}

/**
 * Format verification result for logging
 *
 * @param result - Verification result
 * @returns Formatted string
 */
export function formatVerificationResult(result: VerificationResult): string {
  if (result.valid) {
    return `VERIFIED: ${result.actualHash.slice(0, 16)}... (${result.fileSize} bytes)`;
  } else {
    return (
      `FAILED: Expected ${result.expectedHash.slice(0, 16)}... ` +
      `got ${result.actualHash.slice(0, 16)}... (${result.fileSize} bytes)`
    );
  }
}
