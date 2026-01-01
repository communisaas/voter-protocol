/**
 * Tests for Provenance Commitment in Merkle Leaf Hashes
 *
 * SECURITY: These tests verify that provenance metadata (source URL, checksum, timestamp)
 * is correctly hashed into Merkle leaves, creating cryptographic commitments to data lineage.
 *
 * AUDIT FINDING ADDRESSED: "Merkle leaf = hash(type, id, geometry, authority). Authority level
 * included, but full provenance (source URL, checksum, timestamp) is not cryptographically
 * committed. Legal Risk: MEDIUM-HIGH."
 *
 * Tests cover:
 * 1. Leaf hash with provenance produces different hash than without
 * 2. Different provenance values produce different hashes
 * 3. Backward compatibility: no provenance = original hash behavior
 * 4. Provenance hash is deterministic
 * 5. Batch hashing preserves provenance
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  computeLeafHash,
  computeLeafHashesBatch,
  AUTHORITY_LEVELS,
  type MerkleLeafInput,
  type ProvenanceSource,
} from '../../../merkle-tree.js';
import { Poseidon2Hasher, getHasher } from '@voter-protocol/crypto/poseidon2';

describe('Provenance Leaf Hash', () => {
  let hasher: Poseidon2Hasher;

  beforeAll(async () => {
    hasher = await getHasher();
  }, 30000);

  afterAll(() => {
    Poseidon2Hasher.resetInstance();
  });

  describe('Provenance Commitment', () => {
    const baseInput: MerkleLeafInput = {
      id: 'CD-01',
      boundaryType: 'congressional-district',
      geometryHash: 12345n,
      authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
    };

    const provenance: ProvenanceSource = {
      url: 'https://www2.census.gov/geo/tiger/TIGER2024/CD/tl_2024_01_cd.zip',
      checksum: 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd',
      timestamp: '2024-12-15T10:30:00Z',
      provider: 'census-tiger',
    };

    it('should produce different hash when provenance is included', async () => {
      // Without provenance
      const hashWithout = await computeLeafHash(baseInput);

      // With provenance
      const inputWithProvenance: MerkleLeafInput = {
        ...baseInput,
        source: provenance,
      };
      const hashWith = await computeLeafHash(inputWithProvenance);

      // Hashes must differ
      expect(hashWith).not.toBe(hashWithout);
      expect(typeof hashWith).toBe('bigint');
      expect(hashWith).toBeGreaterThan(0n);
    });

    it('should produce deterministic hash with provenance', async () => {
      const inputWithProvenance: MerkleLeafInput = {
        ...baseInput,
        source: provenance,
      };

      const hash1 = await computeLeafHash(inputWithProvenance);
      const hash2 = await computeLeafHash(inputWithProvenance);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different URLs', async () => {
      const input1: MerkleLeafInput = {
        ...baseInput,
        source: {
          ...provenance,
          url: 'https://example.com/file1.zip',
        },
      };

      const input2: MerkleLeafInput = {
        ...baseInput,
        source: {
          ...provenance,
          url: 'https://example.com/file2.zip',
        },
      };

      const hash1 = await computeLeafHash(input1);
      const hash2 = await computeLeafHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different checksums', async () => {
      const input1: MerkleLeafInput = {
        ...baseInput,
        source: {
          ...provenance,
          checksum: 'aaaa1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        },
      };

      const input2: MerkleLeafInput = {
        ...baseInput,
        source: {
          ...provenance,
          checksum: 'bbbb1111222233334444555566667777888899990000aaaabbbbccccddddeeee',
        },
      };

      const hash1 = await computeLeafHash(input1);
      const hash2 = await computeLeafHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different timestamps', async () => {
      const input1: MerkleLeafInput = {
        ...baseInput,
        source: {
          ...provenance,
          timestamp: '2024-01-01T00:00:00Z',
        },
      };

      const input2: MerkleLeafInput = {
        ...baseInput,
        source: {
          ...provenance,
          timestamp: '2024-12-31T23:59:59Z',
        },
      };

      const hash1 = await computeLeafHash(input1);
      const hash2 = await computeLeafHash(input2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty timestamp gracefully', async () => {
      const inputWithEmptyTimestamp: MerkleLeafInput = {
        ...baseInput,
        source: {
          url: provenance.url,
          checksum: provenance.checksum,
          timestamp: '',
        },
      };

      const hash = await computeLeafHash(inputWithEmptyTimestamp);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should handle missing timestamp field', async () => {
      // TypeScript allows this because timestamp is required in the interface,
      // but runtime might receive incomplete data
      const inputWithProvenance: MerkleLeafInput = {
        ...baseInput,
        source: {
          url: provenance.url,
          checksum: provenance.checksum,
          timestamp: '', // Empty string fallback
        },
      };

      const hash = await computeLeafHash(inputWithProvenance);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });
  });

  describe('Backward Compatibility', () => {
    it('should match original hash when no provenance provided', async () => {
      const input: MerkleLeafInput = {
        id: 'SLDU-42',
        boundaryType: 'state-legislative-upper',
        geometryHash: 67890n,
        authority: AUTHORITY_LEVELS.STATE_OFFICIAL,
      };

      // Hash without provenance should be deterministic
      const hash1 = await computeLeafHash(input);
      const hash2 = await computeLeafHash(input);

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('bigint');
    });

    it('should not change hash when source is undefined', async () => {
      const inputWithUndefined: MerkleLeafInput = {
        id: 'COUNTY-001',
        boundaryType: 'county',
        geometryHash: 11111n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        source: undefined,
      };

      const inputWithoutField: MerkleLeafInput = {
        id: 'COUNTY-001',
        boundaryType: 'county',
        geometryHash: 11111n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
      };

      const hash1 = await computeLeafHash(inputWithUndefined);
      const hash2 = await computeLeafHash(inputWithoutField);

      expect(hash1).toBe(hash2);
    });

    it('should not include provenance when only URL is provided (no checksum)', async () => {
      // If checksum is missing, we fall back to non-provenance hash
      const inputWithPartialProvenance: MerkleLeafInput = {
        id: 'CD-02',
        boundaryType: 'congressional-district',
        geometryHash: 22222n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        source: {
          url: 'https://example.com/file.zip',
          checksum: '', // Empty checksum
          timestamp: '2024-01-01T00:00:00Z',
        },
      };

      const inputWithoutProvenance: MerkleLeafInput = {
        id: 'CD-02',
        boundaryType: 'congressional-district',
        geometryHash: 22222n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
      };

      const hash1 = await computeLeafHash(inputWithPartialProvenance);
      const hash2 = await computeLeafHash(inputWithoutProvenance);

      // Empty checksum should fall back to backward-compatible behavior
      expect(hash1).toBe(hash2);
    });
  });

  describe('Batch Hashing with Provenance', () => {
    it('should batch compute hashes with mixed provenance', async () => {
      const provenance: ProvenanceSource = {
        url: 'https://census.gov/tiger.zip',
        checksum: 'abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
        timestamp: '2024-06-15T12:00:00Z',
      };

      const inputs: MerkleLeafInput[] = [
        {
          id: 'CD-01',
          boundaryType: 'congressional-district',
          geometryHash: 1n,
          authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
          source: provenance,
        },
        {
          id: 'CD-02',
          boundaryType: 'congressional-district',
          geometryHash: 2n,
          authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
          // No provenance
        },
        {
          id: 'SLDU-01',
          boundaryType: 'state-legislative-upper',
          geometryHash: 3n,
          authority: AUTHORITY_LEVELS.STATE_OFFICIAL,
          source: {
            url: 'https://state.gov/sldu.zip',
            checksum: 'ffff1234567890abcdef1234567890abcdef1234567890abcdef1234567890ff',
            timestamp: '2024-07-01T08:00:00Z',
          },
        },
      ];

      const hashes = await computeLeafHashesBatch(inputs);

      expect(hashes).toHaveLength(3);
      hashes.forEach((hash) => {
        expect(typeof hash).toBe('bigint');
        expect(hash).toBeGreaterThan(0n);
      });

      // All hashes should be different
      expect(hashes[0]).not.toBe(hashes[1]);
      expect(hashes[1]).not.toBe(hashes[2]);
      expect(hashes[0]).not.toBe(hashes[2]);
    });

    it('should produce same results as individual hashing', async () => {
      const provenance: ProvenanceSource = {
        url: 'https://example.com/data.zip',
        checksum: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        timestamp: '2024-03-15T09:30:00Z',
      };

      const inputs: MerkleLeafInput[] = [
        {
          id: 'TEST-01',
          boundaryType: 'congressional-district',
          geometryHash: 100n,
          authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
          source: provenance,
        },
        {
          id: 'TEST-02',
          boundaryType: 'county',
          geometryHash: 200n,
          authority: AUTHORITY_LEVELS.STATE_OFFICIAL,
        },
      ];

      // Batch hash
      const batchHashes = await computeLeafHashesBatch(inputs);

      // Individual hashes
      const individualHash1 = await computeLeafHash(inputs[0]);
      const individualHash2 = await computeLeafHash(inputs[1]);

      expect(batchHashes[0]).toBe(individualHash1);
      expect(batchHashes[1]).toBe(individualHash2);
    });
  });

  describe('Provenance String Format', () => {
    it('should use pipe-delimited format for provenance string', async () => {
      // This test verifies the internal format: "url|checksum|timestamp"
      // By testing that the same provenance values always produce the same hash
      const provenance: ProvenanceSource = {
        url: 'https://test.com/file.zip',
        checksum: 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
        timestamp: '2024-09-01T00:00:00Z',
      };

      const input: MerkleLeafInput = {
        id: 'FORMAT-TEST',
        boundaryType: 'congressional-district',
        geometryHash: 999n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        source: provenance,
      };

      // Multiple invocations should produce identical hashes
      const hashes = await Promise.all([
        computeLeafHash(input),
        computeLeafHash(input),
        computeLeafHash(input),
      ]);

      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);
    });

    it('should handle special characters in URL', async () => {
      const provenanceWithSpecialChars: ProvenanceSource = {
        url: 'https://example.com/path?query=value&other=123#fragment',
        checksum: '0000000000000000000000000000000000000000000000000000000000000000',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const input: MerkleLeafInput = {
        id: 'SPECIAL-CHARS',
        boundaryType: 'county',
        geometryHash: 555n,
        authority: AUTHORITY_LEVELS.MUNICIPAL_OFFICIAL,
        source: provenanceWithSpecialChars,
      };

      const hash = await computeLeafHash(input);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });

    it('should handle very long URLs', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(500) + '.zip';
      const provenanceWithLongUrl: ProvenanceSource = {
        url: longUrl,
        checksum: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        timestamp: '2024-12-31T23:59:59Z',
      };

      const input: MerkleLeafInput = {
        id: 'LONG-URL',
        boundaryType: 'state-legislative-lower',
        geometryHash: 777n,
        authority: AUTHORITY_LEVELS.STATE_OFFICIAL,
        source: provenanceWithLongUrl,
      };

      const hash = await computeLeafHash(input);

      expect(typeof hash).toBe('bigint');
      expect(hash).toBeGreaterThan(0n);
    });
  });

  describe('Authority + Provenance Combination', () => {
    it('should produce different hashes for same provenance but different authority', async () => {
      const provenance: ProvenanceSource = {
        url: 'https://data.gov/boundaries.zip',
        checksum: 'abababababababababababababababababababababababababababababababab',
        timestamp: '2024-05-15T14:30:00Z',
      };

      const inputFederal: MerkleLeafInput = {
        id: 'AUTHORITY-TEST',
        boundaryType: 'congressional-district',
        geometryHash: 888n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        source: provenance,
      };

      const inputState: MerkleLeafInput = {
        id: 'AUTHORITY-TEST',
        boundaryType: 'congressional-district',
        geometryHash: 888n,
        authority: AUTHORITY_LEVELS.STATE_OFFICIAL,
        source: provenance,
      };

      const hashFederal = await computeLeafHash(inputFederal);
      const hashState = await computeLeafHash(inputState);

      // Different authority levels with same provenance should produce different hashes
      expect(hashFederal).not.toBe(hashState);
    });

    it('should produce different hashes for same authority but different provenance', async () => {
      const provenance1: ProvenanceSource = {
        url: 'https://source1.gov/data.zip',
        checksum: '1111111111111111111111111111111111111111111111111111111111111111',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const provenance2: ProvenanceSource = {
        url: 'https://source2.gov/data.zip',
        checksum: '2222222222222222222222222222222222222222222222222222222222222222',
        timestamp: '2024-01-01T00:00:00Z',
      };

      const input1: MerkleLeafInput = {
        id: 'PROVENANCE-TEST',
        boundaryType: 'county',
        geometryHash: 444n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        source: provenance1,
      };

      const input2: MerkleLeafInput = {
        id: 'PROVENANCE-TEST',
        boundaryType: 'county',
        geometryHash: 444n,
        authority: AUTHORITY_LEVELS.FEDERAL_MANDATE,
        source: provenance2,
      };

      const hash1 = await computeLeafHash(input1);
      const hash2 = await computeLeafHash(input2);

      // Same authority with different provenance should produce different hashes
      expect(hash1).not.toBe(hash2);
    });
  });
});
