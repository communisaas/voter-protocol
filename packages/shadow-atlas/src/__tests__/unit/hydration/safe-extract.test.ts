/**
 * Tests for zip-slip path traversal prevention.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { safeZipEntryPath } from '../../../hydration/safe-extract.js';

const TARGET_DIR = '/tmp/extract-target';

describe('safeZipEntryPath', () => {
  it('resolves normal entry to correct absolute path', () => {
    const result = safeZipEntryPath('data.txt', TARGET_DIR);
    expect(result).toBe(path.resolve(TARGET_DIR, 'data.txt'));
  });

  it('resolves deeply nested normal paths', () => {
    const result = safeZipEntryPath('data/state/file.txt', TARGET_DIR);
    expect(result).toBe(path.resolve(TARGET_DIR, 'data/state/file.txt'));
  });

  it('throws on relative path traversal (../../../etc/passwd)', () => {
    expect(() => safeZipEntryPath('../../../etc/passwd', TARGET_DIR)).toThrow(
      'Zip-slip detected',
    );
  });

  it('throws on path traversal with nested prefix (foo/../../etc/passwd)', () => {
    expect(() => safeZipEntryPath('foo/../../etc/passwd', TARGET_DIR)).toThrow(
      'Zip-slip detected',
    );
  });

  it('throws on absolute paths (/etc/passwd)', () => {
    expect(() => safeZipEntryPath('/etc/passwd', TARGET_DIR)).toThrow(
      'Zip-slip detected',
    );
  });

  it('allows entry that resolves to the target directory itself', () => {
    // path.resolve('/tmp/extract-target', '.') === '/tmp/extract-target'
    const result = safeZipEntryPath('.', TARGET_DIR);
    expect(result).toBe(path.resolve(TARGET_DIR));
  });

  it('includes the offending entry name in the error message', () => {
    expect(() => safeZipEntryPath('../sneaky.txt', TARGET_DIR)).toThrow(
      '"../sneaky.txt"',
    );
  });
});
