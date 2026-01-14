/**
 * Atomic Write Utilities
 *
 * Provides atomic file write operations to prevent data corruption from crashes
 * during write operations. Uses write-to-temp-then-rename pattern which is
 * atomic on POSIX systems.
 *
 * **Why this matters:**
 * - Crash during JSON.stringify write = corrupted checkpoint file
 * - Corrupted checkpoint = lost progress, potential data loss
 * - Atomic write ensures either old data OR new data exists, never partial
 *
 * **Pattern:**
 * 1. Write to temporary file (unique name with PID to prevent conflicts)
 * 2. Rename temp file to target path (atomic operation on POSIX)
 * 3. Cleanup temp file on error
 */

import { writeFile, rename, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Atomically write string data to file
 *
 * @param filePath - Target file path
 * @param data - String data to write
 * @param encoding - File encoding (default: 'utf-8')
 * @throws Error if write or rename fails
 *
 * @example
 * ```typescript
 * const checkpoint = { lastIndex: 100, timestamp: Date.now() };
 * await atomicWriteFile('/path/to/checkpoint.json', JSON.stringify(checkpoint, null, 2));
 * ```
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  // Ensure parent directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Use PID + timestamp to prevent conflicts between concurrent processes
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    // Write to temporary file
    await writeFile(tempPath, data, encoding);

    // Atomic rename (POSIX guarantees atomicity)
    await rename(tempPath, filePath);
  } catch (error) {
    // Cleanup temp file on error (best effort, ignore if already gone)
    await unlink(tempPath).catch(() => {
      /* ignore cleanup errors */
    });
    throw error;
  }
}

/**
 * Atomically write JSON data to file
 *
 * Convenience wrapper around atomicWriteFile for JSON data.
 *
 * @param filePath - Target file path
 * @param data - Data to serialize as JSON
 * @param space - JSON.stringify space parameter (default: 2 for pretty-print)
 * @throws Error if serialization, write, or rename fails
 *
 * @example
 * ```typescript
 * const checkpoint = { lastIndex: 100, results: [...] };
 * await atomicWriteJSON('/path/to/checkpoint.json', checkpoint);
 * ```
 */
export async function atomicWriteJSON(
  filePath: string,
  data: unknown,
  space: number | string = 2
): Promise<void> {
  const json = JSON.stringify(data, null, space);
  await atomicWriteFile(filePath, json, 'utf-8');
}

/**
 * Synchronous atomic write (for edge cases where async not available)
 *
 * **WARNING:** Only use in CLI scripts where blocking is acceptable.
 * NEVER use in API/serving code paths.
 *
 * @param filePath - Target file path
 * @param data - String data to write
 * @param encoding - File encoding (default: 'utf-8')
 * @throws Error if write or rename fails
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string,
  encoding: BufferEncoding = 'utf-8'
): void {
  const fs = require('fs');
  const path = require('path');

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, data, encoding);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Cleanup temp file on error
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore cleanup errors */
    }
    throw error;
  }
}

/**
 * Synchronous atomic JSON write
 *
 * @param filePath - Target file path
 * @param data - Data to serialize as JSON
 * @param space - JSON.stringify space parameter (default: 2)
 * @throws Error if serialization, write, or rename fails
 */
export function atomicWriteJSONSync(
  filePath: string,
  data: unknown,
  space: number | string = 2
): void {
  const json = JSON.stringify(data, null, space);
  atomicWriteFileSync(filePath, json, 'utf-8');
}
