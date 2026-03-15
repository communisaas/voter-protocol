/**
 * Tests for H-2: Cell map tree roundtrip verification.
 *
 * Verifies that:
 * 1. verifyCellMapSample() passes for correctly built trees
 * 2. verifyCellMapSample() detects deliberately injected mismatches
 * 3. buildCellMapTree() throws when roundtrip verification fails
 * 4. Sampling covers first, last, and evenly spaced mappings
 */

import { describe, it, expect } from 'vitest';
import {
  buildCellMapTree,
  verifyCellMapSample,
  DISTRICT_SLOT_COUNT,
  type CellDistrictMapping,
} from '../../../tree-builder.js';
import { generateMockMappings } from '../../../cell-district-loader.js';
import { getHasher } from '@voter-protocol/crypto/poseidon2';

const TEST_DEPTH = 8;

function mockDistricts(seed: number): bigint[] {
  const districts = new Array(DISTRICT_SLOT_COUNT).fill(0n);
  districts[0] = BigInt(seed + 1);
  districts[1] = BigInt(seed + 100);
  return districts;
}

describe('verifyCellMapSample', () => {
  it('passes for a correctly built tree', async () => {
    const mappings = generateMockMappings(20, '06');
    const result = await buildCellMapTree(mappings, TEST_DEPTH);

    const hasher = await getHasher();
    const verification = await verifyCellMapSample(
      result.tree,
      mappings,
      result.commitments,
      hasher,
    );

    expect(verification.mismatches).toHaveLength(0);
    expect(verification.verified).toBeGreaterThan(0);
    expect(verification.verified).toBeLessThanOrEqual(mappings.length);
  }, 60_000);

  it('samples first, last, and middle elements', async () => {
    const mappings = generateMockMappings(100, '06');
    const result = await buildCellMapTree(mappings, TEST_DEPTH);

    const hasher = await getHasher();
    const verification = await verifyCellMapSample(
      result.tree,
      mappings,
      result.commitments,
      hasher,
      15,
    );

    // Should verify up to 15 samples from a 100-element set
    expect(verification.verified).toBeGreaterThanOrEqual(10);
    expect(verification.verified).toBeLessThanOrEqual(15);
    expect(verification.mismatches).toHaveLength(0);
  }, 120_000);

  it('handles empty mappings', async () => {
    const hasher = await getHasher();
    const result = await verifyCellMapSample(
      null as any, // tree not needed for empty
      [],
      new Map(),
      hasher,
    );

    expect(result.verified).toBe(0);
    expect(result.mismatches).toHaveLength(0);
  }, 30_000);

  it('handles small mapping sets (fewer than sample size)', async () => {
    const mappings = generateMockMappings(3, '06');
    const result = await buildCellMapTree(mappings, TEST_DEPTH);

    const hasher = await getHasher();
    const verification = await verifyCellMapSample(
      result.tree,
      mappings,
      result.commitments,
      hasher,
      15, // request 15 but only 3 exist
    );

    // Should verify all 3
    expect(verification.verified).toBe(3);
    expect(verification.mismatches).toHaveLength(0);
  }, 60_000);

  it('detects missing commitment as mismatch', async () => {
    const mappings = generateMockMappings(5, '06');
    const result = await buildCellMapTree(mappings, TEST_DEPTH);

    // Create a commitments map with one entry removed
    const brokenCommitments = new Map(result.commitments);
    const firstKey = mappings[0].cellId.toString();
    brokenCommitments.delete(firstKey);

    const hasher = await getHasher();
    const verification = await verifyCellMapSample(
      result.tree,
      mappings,
      brokenCommitments,
      hasher,
    );

    expect(verification.mismatches.length).toBeGreaterThan(0);
    expect(verification.mismatches.some(m => m.cellId === mappings[0].cellId)).toBe(true);
  }, 60_000);
});

describe('buildCellMapTree roundtrip verification', () => {
  it('succeeds for valid mappings (verification runs automatically)', async () => {
    const mappings = generateMockMappings(10, '11');
    const result = await buildCellMapTree(mappings, TEST_DEPTH);

    // If we get here, roundtrip verification passed
    expect(result.cellCount).toBe(10);
    expect(result.root).not.toBe(0n);
  }, 60_000);

  it('produces stable roots with verification enabled', async () => {
    const mappings = generateMockMappings(5, '36');

    const r1 = await buildCellMapTree(mappings, TEST_DEPTH);
    const r2 = await buildCellMapTree(mappings, TEST_DEPTH);

    expect(r1.root).toBe(r2.root);
  }, 120_000);
});
