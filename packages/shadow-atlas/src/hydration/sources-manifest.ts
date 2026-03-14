/**
 * Known SHA-256 hashes for concordance source files.
 *
 * Populate by running the concordance loader with --record-hashes flag,
 * then verifying the output before adding here.
 *
 * @packageDocumentation
 */

/** Known SHA-256 hex digests keyed by download URL. */
export const SOURCE_HASHES: Record<string, string> = {
  // TODO: Populate after first verified download per country.
  // Run: npx tsx src/hydration/concordance-loader.ts --record-hashes
  //
  // 'https://www12.statcan.gc.ca/...': 'abc123...',
  // 'https://datafinder.stats.govt.nz/...': 'def456...',
};
