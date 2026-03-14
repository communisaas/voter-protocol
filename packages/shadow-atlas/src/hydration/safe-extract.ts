/**
 * Safe ZIP Extraction Utility
 *
 * Prevents zip-slip path traversal attacks by validating that all
 * extracted entry paths resolve within the target directory.
 *
 * @packageDocumentation
 */

import path from 'node:path';

/**
 * Validates that a ZIP entry path resolves within the target directory.
 * Prevents zip-slip path traversal attacks.
 *
 * @param entryName - The file path from the ZIP entry
 * @param targetDir - The directory entries should be extracted into
 * @returns The resolved absolute path for the entry
 * @throws Error if the entry would resolve outside the target directory
 */
export function safeZipEntryPath(entryName: string, targetDir: string): string {
  const resolvedTarget = path.resolve(targetDir);
  const resolved = path.resolve(targetDir, entryName);
  const normalizedTarget = resolvedTarget + path.sep;
  if (!resolved.startsWith(normalizedTarget) && resolved !== resolvedTarget) {
    throw new Error(`Zip-slip detected: entry "${entryName}" resolves outside target directory`);
  }
  return resolved;
}
