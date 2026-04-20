/**
 * walkDirectory Tests
 *
 * Tests the directory walker used by Storacha pinning for constructing
 * UnixFS DAGs. Covers regular files, symlink skipping, depth limiting,
 * containment checks, and file content verification.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkDirectory } from '../../../distribution/services/storacha.js';

// Track temp directories for cleanup
const tempDirs: string[] = [];

function createTempDir(prefix: string = 'walk-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  tempDirs.length = 0;
});

// ============================================================================
// Regular files
// ============================================================================

describe('walkDirectory: regular files', () => {
  it('returns 3 StorachaFileLike objects for 3 files', () => {
    const root = createTempDir();
    writeFileSync(join(root, 'a.txt'), 'alpha');
    writeFileSync(join(root, 'b.txt'), 'bravo');
    writeFileSync(join(root, 'c.txt'), 'charlie');

    const results = walkDirectory(root);
    expect(results.length).toBe(3);

    const names = results.map(f => f.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('preserves relative paths with forward slashes for nested files', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'sub', 'nested.txt'), 'data');

    const results = walkDirectory(root);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('sub/nested.txt');
  });

  it('returns correct size for each file', () => {
    const root = createTempDir();
    writeFileSync(join(root, 'small.bin'), Buffer.alloc(10, 0xab));
    writeFileSync(join(root, 'bigger.bin'), Buffer.alloc(1000, 0xcd));

    const results = walkDirectory(root);
    const byName = new Map(results.map(f => [f.name, f]));

    expect(byName.get('small.bin')!.size).toBe(10);
    expect(byName.get('bigger.bin')!.size).toBe(1000);
  });

  it('returns type as application/octet-stream', () => {
    const root = createTempDir();
    writeFileSync(join(root, 'file.txt'), 'hello');

    const results = walkDirectory(root);
    expect(results[0].type).toBe('application/octet-stream');
  });
});

// ============================================================================
// Symlink handling
// ============================================================================

describe('walkDirectory: symlinks', () => {
  it('skips symlinks to files within the directory', () => {
    const root = createTempDir();
    writeFileSync(join(root, 'real.txt'), 'real content');
    symlinkSync(join(root, 'real.txt'), join(root, 'link.txt'));

    const results = walkDirectory(root);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('real.txt');
  });

  it('skips symlinks pointing outside the root directory', () => {
    const root = createTempDir();
    const outside = createTempDir('outside-');
    writeFileSync(join(outside, 'secret.txt'), 'secret');

    // Create a regular file in root
    writeFileSync(join(root, 'normal.txt'), 'normal');

    // Try to create a symlink pointing outside — this would be skipped
    // even if it weren't a symlink (containment check), but the symlink
    // check catches it first
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'));
    } catch {
      // Symlink creation may fail on some systems; test is still valid
      return;
    }

    const results = walkDirectory(root);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('normal.txt');
  });
});

// ============================================================================
// Depth limiting
// ============================================================================

describe('walkDirectory: depth limit', () => {
  it('respects default maxDepth=10 — files beyond depth 10 are excluded', () => {
    const root = createTempDir();

    // Create nested directories 12 levels deep
    let current = root;
    for (let i = 0; i < 12; i++) {
      current = join(current, `level${i}`);
      mkdirSync(current);
      writeFileSync(join(current, `file${i}.txt`), `content at depth ${i + 1}`);
    }

    const results = walkDirectory(root); // default maxDepth = 10
    const names = results.map(f => f.name);

    // Files at depth 1-10 should be included (depth starts at 0 for the walk call)
    // Depth 0 = root walk, depth 1 = level0,..., depth 10 = level9
    // level10 is at depth 11, level11 is at depth 12 — both excluded
    for (let i = 0; i < 10; i++) {
      const expected = Array.from({ length: i + 1 }, (_, j) => `level${j}`)
        .join('/') + `/file${i}.txt`;
      expect(names).toContain(expected);
    }

    // Files at depth 11 and 12 should be excluded
    const deepFile10 = Array.from({ length: 11 }, (_, j) => `level${j}`)
      .join('/') + '/file10.txt';
    expect(names).not.toContain(deepFile10);

    const deepFile11 = Array.from({ length: 12 }, (_, j) => `level${j}`)
      .join('/') + '/file11.txt';
    expect(names).not.toContain(deepFile11);
  });

  it('respects custom maxDepth=2', () => {
    const root = createTempDir();

    // Depth 0: root (walk starts here)
    writeFileSync(join(root, 'root.txt'), 'root');

    // Depth 1: sub1
    mkdirSync(join(root, 'sub1'));
    writeFileSync(join(root, 'sub1', 'file1.txt'), 'one');

    // Depth 2: sub1/sub2
    mkdirSync(join(root, 'sub1', 'sub2'));
    writeFileSync(join(root, 'sub1', 'sub2', 'file2.txt'), 'two');

    // Depth 3: sub1/sub2/sub3
    mkdirSync(join(root, 'sub1', 'sub2', 'sub3'));
    writeFileSync(join(root, 'sub1', 'sub2', 'sub3', 'file3.txt'), 'three');

    const results = walkDirectory(root, 2);
    const names = results.map(f => f.name).sort();

    // Depth 0: root.txt (included)
    // Depth 1: sub1/file1.txt (included)
    // Depth 2: sub1/sub2/file2.txt (included)
    // Depth 3: sub1/sub2/sub3/file3.txt (excluded)
    expect(names).toContain('root.txt');
    expect(names).toContain('sub1/file1.txt');
    expect(names).toContain('sub1/sub2/file2.txt');
    expect(names).not.toContain('sub1/sub2/sub3/file3.txt');
  });
});

// ============================================================================
// Empty directory
// ============================================================================

describe('walkDirectory: empty directory', () => {
  it('returns empty array for empty directory', () => {
    const root = createTempDir();
    const results = walkDirectory(root);
    expect(results).toEqual([]);
  });

  it('returns empty array for directory with only subdirectories (no files)', () => {
    const root = createTempDir();
    mkdirSync(join(root, 'empty-sub'));
    mkdirSync(join(root, 'another-empty'));

    const results = walkDirectory(root);
    expect(results).toEqual([]);
  });
});

// ============================================================================
// File content verification
// ============================================================================

describe('walkDirectory: file content', () => {
  it('arrayBuffer() returns correct content for a known file', async () => {
    const root = createTempDir();
    const content = 'Hello, Storacha!';
    writeFileSync(join(root, 'hello.txt'), content);

    const results = walkDirectory(root);
    expect(results.length).toBe(1);

    const buf = await results[0].arrayBuffer();
    const decoded = new TextDecoder().decode(buf);
    expect(decoded).toBe(content);
  });

  it('text() returns correct string content', async () => {
    const root = createTempDir();
    writeFileSync(join(root, 'msg.txt'), 'test message');

    const results = walkDirectory(root);
    const text = await results[0].text();
    expect(text).toBe('test message');
  });

  it('stream() returns a ReadableStream that produces correct data', async () => {
    const root = createTempDir();
    const data = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    writeFileSync(join(root, 'binary.bin'), data);

    const results = walkDirectory(root);
    const stream = results[0].stream();
    const reader = stream.getReader();

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Reconstruct full buffer
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    expect(combined.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(combined[i]).toBe(i);
    }
  });

  it('slice() returns a Blob subset', async () => {
    const root = createTempDir();
    writeFileSync(join(root, 'sliceable.txt'), 'abcdefghij');

    const results = walkDirectory(root);
    const sliced = results[0].slice(2, 5);
    const text = await sliced.text();
    expect(text).toBe('cde');
  });
});
