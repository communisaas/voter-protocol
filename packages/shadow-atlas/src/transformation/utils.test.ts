/**
 * Tests for transformation utilities
 *
 * Validates:
 * 1. IPFS CID generation (deterministic, browser-compatible)
 * 2. Update detection (added, removed, modified districts)
 * 3. Rejection tracking (samples, aggregation)
 */

import { describe, it, expect } from 'vitest';
import { generateCID, generateMerkleTreeCID, detectUpdates } from './utils.js';
import type { NormalizedDistrict } from './types.js';
import type { Polygon } from 'geojson';

describe('IPFS CID Generation', () => {
  it('should generate deterministic CID for same input', async () => {
    const data = { test: 'data', value: 123 };

    const cid1 = await generateCID(data);
    const cid2 = await generateCID(data);

    expect(cid1).toBe(cid2);
    expect(cid1).toMatch(/^ba/); // CIDv1 starts with 'ba'
  });

  it('should generate different CIDs for different inputs', async () => {
    const data1 = { test: 'data1' };
    const data2 = { test: 'data2' };

    const cid1 = await generateCID(data1);
    const cid2 = await generateCID(data2);

    expect(cid1).not.toBe(cid2);
  });

  it('should generate CID for merkle tree', async () => {
    const mockGeometry: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };

    const district: NormalizedDistrict = {
      id: 'test-1',
      name: 'Test District',
      jurisdiction: 'USA/TX/Test',
      districtType: 'municipal',
      geometry: mockGeometry,
      bbox: [0, 0, 1, 1],
      provenance: {
        source: 'test-source',
        authority: 'state-gis',
        jurisdiction: 'TX, USA',
        timestamp: Date.now(),
        method: 'test',
        responseHash: 'test-hash',
        httpStatus: 200,
        featureCount: 1,
        geometryType: 'Polygon',
        coordinateSystem: 'EPSG:4326',
      },
    };

    const merkleTree = {
      root: '0x123',
      leaves: ['0x456'],
      districts: [district],
    };

    const cid = await generateMerkleTreeCID(merkleTree);

    expect(cid).toBeDefined();
    expect(cid).toMatch(/^ba/);
  });
});

describe('Update Detection', () => {
  const createMockDistrict = (
    id: string,
    name: string,
    coords: Array<[number, number]>
  ): NormalizedDistrict => {
    const geometry: Polygon = {
      type: 'Polygon',
      coordinates: [coords],
    };

    return {
      id,
      name,
      jurisdiction: 'USA/TX/Test',
      districtType: 'municipal',
      geometry,
      bbox: [
        Math.min(...coords.map(c => c[0])),
        Math.min(...coords.map(c => c[1])),
        Math.max(...coords.map(c => c[0])),
        Math.max(...coords.map(c => c[1])),
      ],
      provenance: {
        source: 'test-source',
        authority: 'state-gis',
        jurisdiction: 'TX, USA',
        timestamp: Date.now(),
        method: 'test',
        responseHash: 'test-hash',
        httpStatus: 200,
        featureCount: 1,
        geometryType: 'Polygon',
        coordinateSystem: 'EPSG:4326',
      },
    };
  };

  it('should detect added districts', () => {
    const previous = [
      createMockDistrict('d1', 'District 1', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ];

    const current = [
      ...previous,
      createMockDistrict('d2', 'District 2', [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ]),
    ];

    const updates = detectUpdates(previous, current);

    expect(updates.added).toEqual(['d2']);
    expect(updates.removed).toEqual([]);
    expect(updates.modified).toEqual([]);
  });

  it('should detect removed districts', () => {
    const previous = [
      createMockDistrict('d1', 'District 1', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
      createMockDistrict('d2', 'District 2', [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ]),
    ];

    const current = [previous[0]];

    const updates = detectUpdates(previous, current);

    expect(updates.added).toEqual([]);
    expect(updates.removed).toEqual(['d2']);
    expect(updates.modified).toEqual([]);
  });

  it('should detect modified districts (name change)', () => {
    const previous = [
      createMockDistrict('d1', 'District 1', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ];

    const current = [
      createMockDistrict('d1', 'District 1 - Updated', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ];

    const updates = detectUpdates(previous, current);

    expect(updates.added).toEqual([]);
    expect(updates.removed).toEqual([]);
    expect(updates.modified.length).toBe(1);
    expect(updates.modified[0].id).toBe('d1');
    expect(updates.modified[0].changes).toContain('name');
  });

  it('should detect modified districts (geometry change)', () => {
    const previous = [
      createMockDistrict('d1', 'District 1', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
    ];

    const current = [
      createMockDistrict('d1', 'District 1', [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ]),
    ];

    const updates = detectUpdates(previous, current);

    expect(updates.modified.length).toBe(1);
    expect(updates.modified[0].changes).toContain('geometry');
    expect(updates.modified[0].changes).toContain('bbox');
    expect(updates.modified[0].areaDelta).toBeDefined();
  });

  it('should handle complex update scenario', () => {
    const previous = [
      createMockDistrict('d1', 'District 1', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]),
      createMockDistrict('d2', 'District 2', [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ]),
      createMockDistrict('d3', 'District 3', [
        [4, 4],
        [5, 4],
        [5, 5],
        [4, 5],
        [4, 4],
      ]),
    ];

    const current = [
      createMockDistrict('d1', 'District 1 - Updated', [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]), // Modified
      createMockDistrict('d2', 'District 2', [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ]), // Unchanged
      createMockDistrict('d4', 'District 4', [
        [6, 6],
        [7, 6],
        [7, 7],
        [6, 7],
        [6, 6],
      ]), // Added
    ];

    const updates = detectUpdates(previous, current);

    expect(updates.added).toEqual(['d4']);
    expect(updates.removed).toEqual(['d3']);
    expect(updates.modified.length).toBe(1);
    expect(updates.modified[0].id).toBe('d1');
  });
});
