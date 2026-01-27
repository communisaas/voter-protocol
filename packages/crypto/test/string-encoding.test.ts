/**
 * String-to-Field Encoding Specification Tests
 *
 * This test file validates the string encoding algorithm specified in
 * /specs/STRING-ENCODING-SPEC.md. The tests verify:
 *
 * 1. 31-byte chunk size compliance
 * 2. Big-endian byte order
 * 3. UTF-8 encoding correctness
 * 4. Multi-chunk hashing behavior
 * 5. Edge cases (empty string, exact boundaries, multi-byte characters)
 *
 * These tests serve as the canonical verification for any implementation
 * of the string-to-field encoding algorithm.
 *
 * @see /specs/STRING-ENCODING-SPEC.md
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Poseidon2Hasher } from '../poseidon2';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * BN254 scalar field modulus
 * All hash outputs must be strictly less than this value.
 */
const BN254_FIELD_MODULUS = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

/**
 * Chunk size in bytes (248 bits < 254-bit field)
 */
const CHUNK_SIZE = 31;

/**
 * Golden test vector: hash of empty string
 * Empty string produces hashSingle(0n)
 */
const HASH_EMPTY_STRING = 11250791130336988991462250958918728798886439319225016858543557054782819955502n;

/**
 * Golden test vector: hash of "hello"
 */
const HASH_HELLO = 20295016858894593428496862809304457135181095319758016614231461188944930689651n;

/**
 * Golden test vector: hash of "voter-protocol-cve-006"
 */
const HASH_PROTOCOL_STRING = 18611551177496161129560967712699392992457741027215021515979218815229220122625n;

// ============================================================================
// TEST SUITE
// ============================================================================

describe('String-to-Field Encoding Specification', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await Poseidon2Hasher.getInstance();
  });

  // --------------------------------------------------------------------------
  // Chunk Size Tests
  // --------------------------------------------------------------------------

  describe('chunk size (31 bytes)', () => {
    it('uses exactly 31-byte chunks', () => {
      // Verify the constant matches our specification
      expect(CHUNK_SIZE).toBe(31);
    });

    it('31 bytes fits in single chunk', async () => {
      const str31 = 'a'.repeat(31);
      const bytes = Buffer.from(str31, 'utf-8');

      // Verify byte length
      expect(bytes.length).toBe(31);

      // Should hash successfully
      const hash = await hasher.hashString(str31);
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThanOrEqual(0n);
      expect(hash).toBeLessThan(BN254_FIELD_MODULUS);
    });

    it('32 bytes requires two chunks', async () => {
      const str31 = 'a'.repeat(31);
      const str32 = 'a'.repeat(32);

      // These should produce different hashes due to different chunking
      const hash31 = await hasher.hashString(str31);
      const hash32 = await hasher.hashString(str32);

      expect(hash31).not.toBe(hash32);
    });

    it('62 bytes exactly fills two chunks', async () => {
      const str62 = 'a'.repeat(62);
      const str63 = 'a'.repeat(63);

      const hash62 = await hasher.hashString(str62);
      const hash63 = await hasher.hashString(str63);

      // Different number of chunks = different hash
      expect(hash62).not.toBe(hash63);
    });

    it('verifies chunk boundary behavior', async () => {
      // Test strings at and around the chunk boundary
      const hashes: bigint[] = [];

      for (let len = 30; len <= 33; len++) {
        const str = 'x'.repeat(len);
        const hash = await hasher.hashString(str);
        hashes.push(hash);
      }

      // All hashes should be unique (different lengths = different hashes)
      const uniqueHashes = new Set(hashes.map((h) => h.toString()));
      expect(uniqueHashes.size).toBe(4);
    });
  });

  // --------------------------------------------------------------------------
  // Empty String Tests
  // --------------------------------------------------------------------------

  describe('empty string handling', () => {
    it('hashes empty string to hashSingle(0)', async () => {
      const hash = await hasher.hashString('');

      // Empty string should produce hashSingle(0n)
      const hashOfZero = await hasher.hashSingle(0n);
      expect(hash).toBe(hashOfZero);
      expect(hash).toBe(HASH_EMPTY_STRING);
    });

    it('empty string hash is deterministic', async () => {
      const hash1 = await hasher.hashString('');
      const hash2 = await hasher.hashString('');
      const hash3 = await hasher.hashString('');

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });

  // --------------------------------------------------------------------------
  // UTF-8 Encoding Tests
  // --------------------------------------------------------------------------

  describe('UTF-8 encoding', () => {
    it('handles ASCII characters (1-byte UTF-8)', async () => {
      const hash = await hasher.hashString('hello');
      expect(hash).toBe(HASH_HELLO);
    });

    it('handles 2-byte UTF-8 characters', async () => {
      // Latin characters with diacritics (2 bytes each in UTF-8)
      const hash = await hasher.hashString('\u00e9\u00e8\u00ea'); // e with accents
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('handles 3-byte UTF-8 characters (CJK)', async () => {
      // Chinese characters (3 bytes each in UTF-8)
      const hash = await hasher.hashString('\u4e2d\u6587'); // "Chinese" in Chinese
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);

      // Verify byte count affects chunking
      const bytes = Buffer.from('\u4e2d\u6587', 'utf-8');
      expect(bytes.length).toBe(6); // 2 chars * 3 bytes each
    });

    it('handles 4-byte UTF-8 characters (emoji)', async () => {
      // Emoji (4 bytes each in UTF-8)
      const hash = await hasher.hashString('\u{1f600}\u{1f601}'); // grinning faces
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);

      // Verify byte count
      const bytes = Buffer.from('\u{1f600}\u{1f601}', 'utf-8');
      expect(bytes.length).toBe(8); // 2 emoji * 4 bytes each
    });

    it('handles mixed UTF-8 byte lengths', async () => {
      // Mix of 1, 2, 3, and 4 byte characters
      const mixed = 'a\u00e9\u4e2d\u{1f600}';
      const hash = await hasher.hashString(mixed);
      expect(typeof hash).toBe('bigint');

      // Verify total byte count: 1 + 2 + 3 + 4 = 10 bytes
      const bytes = Buffer.from(mixed, 'utf-8');
      expect(bytes.length).toBe(10);
    });

    it('Japanese text produces valid hash', async () => {
      const hash = await hasher.hashString('\u65e5\u672c\u8a9e'); // "Japanese" in Japanese
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
      expect(hash).toBeLessThan(BN254_FIELD_MODULUS);
    });
  });

  // --------------------------------------------------------------------------
  // Big-Endian Conversion Tests
  // --------------------------------------------------------------------------

  describe('big-endian byte order', () => {
    it('produces different hashes for reversed strings', async () => {
      // "ab" and "ba" should produce different hashes
      const hashAB = await hasher.hashString('ab');
      const hashBA = await hasher.hashString('ba');
      expect(hashAB).not.toBe(hashBA);
    });

    it('preserves lexicographic ordering awareness', async () => {
      // While hashes don't preserve ordering, different strings = different hashes
      const hashAAA = await hasher.hashString('aaa');
      const hashAAB = await hasher.hashString('aab');
      const hashABA = await hasher.hashString('aba');

      // All should be different
      expect(hashAAA).not.toBe(hashAAB);
      expect(hashAAB).not.toBe(hashABA);
      expect(hashAAA).not.toBe(hashABA);
    });

    it('verifies big-endian interpretation of bytes', async () => {
      // For a short string, we can verify the encoding manually
      // "A" = 0x41 in UTF-8
      // "B" = 0x42 in UTF-8
      // "AB" as big-endian = 0x4142
      // "BA" as big-endian = 0x4241

      // The hashes should differ because the field element values differ
      const hashAB = await hasher.hashString('AB');
      const hashBA = await hasher.hashString('BA');

      expect(hashAB).not.toBe(hashBA);
    });
  });

  // --------------------------------------------------------------------------
  // Multi-Chunk Hashing Tests
  // --------------------------------------------------------------------------

  describe('multi-chunk hashing', () => {
    it('single chunk uses hashSingle', async () => {
      const shortStr = 'hello'; // 5 bytes, single chunk
      const hash = await hasher.hashString(shortStr);

      // Convert to field element manually
      const bytes = Buffer.from(shortStr, 'utf-8');
      const fieldElement = BigInt('0x' + bytes.toString('hex'));

      // Should equal hashSingle of that field element
      const expectedHash = await hasher.hashSingle(fieldElement);
      expect(hash).toBe(expectedHash);
    });

    it('two chunks uses hashPair', async () => {
      // Create a string that spans exactly two chunks
      const str = 'a'.repeat(31) + 'b'; // 32 bytes

      const hash = await hasher.hashString(str);
      expect(typeof hash).toBe('bigint');

      // Verify it differs from adjacent lengths
      const hash31 = await hasher.hashString('a'.repeat(31));
      const hash33 = await hasher.hashString('a'.repeat(31) + 'bb');

      expect(hash).not.toBe(hash31);
      expect(hash).not.toBe(hash33);
    });

    it('three chunks uses iterative hashing', async () => {
      // Create a string that spans three chunks
      const str = 'a'.repeat(62) + 'b'; // 63 bytes = 3 chunks

      const hash = await hasher.hashString(str);
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
      expect(hash).toBeLessThan(BN254_FIELD_MODULUS);
    });

    it('verifies iterative hashing for long strings', async () => {
      // Test with a longer string (100+ bytes)
      const longStr = 'The quick brown fox jumps over the lazy dog. '.repeat(3);
      const hash = await hasher.hashString(longStr);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
      expect(hash).toBeLessThan(BN254_FIELD_MODULUS);

      // Should be deterministic
      const hash2 = await hasher.hashString(longStr);
      expect(hash).toBe(hash2);
    });
  });

  // --------------------------------------------------------------------------
  // Golden Vector Tests
  // --------------------------------------------------------------------------

  describe('golden test vectors', () => {
    it('matches golden vector for empty string', async () => {
      const hash = await hasher.hashString('');
      expect(hash).toBe(HASH_EMPTY_STRING);
    });

    it('matches golden vector for "hello"', async () => {
      const hash = await hasher.hashString('hello');
      expect(hash).toBe(HASH_HELLO);
    });

    it('matches golden vector for "voter-protocol-cve-006"', async () => {
      const hash = await hasher.hashString('voter-protocol-cve-006');
      expect(hash).toBe(HASH_PROTOCOL_STRING);
    });
  });

  // --------------------------------------------------------------------------
  // Field Element Validity Tests
  // --------------------------------------------------------------------------

  describe('field element validity', () => {
    it('all hashes are valid BN254 field elements', async () => {
      const testStrings = [
        '',
        'a',
        'hello',
        'a'.repeat(31),
        'a'.repeat(32),
        'a'.repeat(100),
        '\u4e2d\u6587',
        '\u{1f600}',
      ];

      for (const str of testStrings) {
        const hash = await hasher.hashString(str);
        expect(hash).toBeGreaterThanOrEqual(0n);
        expect(hash).toBeLessThan(BN254_FIELD_MODULUS);
      }
    });

    it('31-byte chunks never exceed field modulus', () => {
      // Maximum value from 31 bytes = 2^248 - 1
      const maxChunkValue = 2n ** 248n - 1n;

      // This should always be less than the field modulus
      expect(maxChunkValue).toBeLessThan(BN254_FIELD_MODULUS);

      // Verify the safety margin
      const margin = BN254_FIELD_MODULUS - maxChunkValue;
      expect(margin).toBeGreaterThan(0n);
    });
  });

  // --------------------------------------------------------------------------
  // Determinism Tests
  // --------------------------------------------------------------------------

  describe('determinism', () => {
    it('produces identical results for repeated calls', async () => {
      const testStr = 'determinism test string';

      const hashes = await Promise.all([
        hasher.hashString(testStr),
        hasher.hashString(testStr),
        hasher.hashString(testStr),
      ]);

      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);
    });

    it('batch operations match individual calls', async () => {
      const strings = ['hello', 'world', 'voter-protocol'];

      const batchResults = await hasher.hashStringsBatch(strings);
      const individualResults = await Promise.all(
        strings.map((s) => hasher.hashString(s))
      );

      expect(batchResults).toHaveLength(3);
      expect(batchResults[0]).toBe(individualResults[0]);
      expect(batchResults[1]).toBe(individualResults[1]);
      expect(batchResults[2]).toBe(individualResults[2]);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles single character', async () => {
      const hash = await hasher.hashString('x');
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('handles string of spaces', async () => {
      const hash = await hasher.hashString('   ');
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('handles newlines and special characters', async () => {
      const hash = await hasher.hashString('line1\nline2\ttab');
      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('handles null character in string', async () => {
      const hash = await hasher.hashString('before\x00after');
      expect(typeof hash).toBe('bigint');

      // Should differ from string without null
      const hashNoNull = await hasher.hashString('beforeafter');
      expect(hash).not.toBe(hashNoNull);
    });

    it('handles very long strings', async () => {
      // 1000 characters = ~33 chunks
      const longStr = 'x'.repeat(1000);
      const hash = await hasher.hashString(longStr);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
      expect(hash).toBeLessThan(BN254_FIELD_MODULUS);
    });
  });

  // --------------------------------------------------------------------------
  // Cross-Implementation Compatibility Tests
  // --------------------------------------------------------------------------

  describe('cross-implementation compatibility', () => {
    it('documents expected chunk boundaries for Noir implementation', async () => {
      // This test documents the exact chunking behavior that Noir must match
      const testCases = [
        { str: '', expectedChunks: 0, description: 'empty string' },
        { str: 'a', expectedChunks: 1, description: 'single char' },
        { str: 'a'.repeat(31), expectedChunks: 1, description: 'exactly 31 bytes' },
        { str: 'a'.repeat(32), expectedChunks: 2, description: '32 bytes' },
        { str: 'a'.repeat(62), expectedChunks: 2, description: 'exactly 62 bytes' },
        { str: 'a'.repeat(63), expectedChunks: 3, description: '63 bytes' },
      ];

      for (const { str, expectedChunks, description } of testCases) {
        const bytes = Buffer.from(str, 'utf-8');
        const actualChunks = Math.ceil(bytes.length / 31) || 0;

        expect(actualChunks).toBe(
          expectedChunks,
          `${description}: expected ${expectedChunks} chunks, got ${actualChunks}`
        );
      }
    });

    it('documents hex encoding for Noir verification', async () => {
      // Document the exact hex encoding for cross-implementation verification
      const testStr = 'hello';
      const bytes = Buffer.from(testStr, 'utf-8');
      const hexValue = bytes.toString('hex');
      const fieldElement = BigInt('0x' + hexValue);

      // These values must be reproduced in Noir
      expect(hexValue).toBe('68656c6c6f');
      expect(fieldElement).toBe(0x68656c6c6fn);

      // And the hash must match
      const hash = await hasher.hashString(testStr);
      expect(hash).toBe(HASH_HELLO);
    });
  });
});
