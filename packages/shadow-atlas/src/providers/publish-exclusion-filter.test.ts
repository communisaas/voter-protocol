/**
 * Publish-exclusion filter tests (P17-wave1-ingest, O8-license-confirms gate)
 */

import { describe, test, expect } from 'vitest';
import { filterPublishExclusions, hasPendingPublishExclusions } from './publish-exclusion-filter.js';
import type { NormalizedBoundary, ProviderSourceMetadata } from '../core/types/provider.js';

function makeBoundary(
  id: string,
  provider: string,
  publishExclusion?: ProviderSourceMetadata['publishExclusion'],
): NormalizedBoundary {
  return {
    id,
    name: id,
    level: 'district',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: {},
    source: {
      provider,
      url: `https://example.com/${id}`,
      version: '1',
      license: publishExclusion ? 'public-domain-basis-unconfirmed' : 'public-domain',
      updatedAt: new Date().toISOString(),
      checksum: '',
      authorityLevel: 'federal-mandate',
      legalStatus: 'official',
      collectionMethod: 'portal-discovery',
      lastVerified: new Date().toISOString(),
      verifiedBy: 'automated',
      topologyValidated: false,
      geometryRepaired: false,
      coordinateSystem: 'EPSG:4326',
      updateMonitoring: 'api-polling',
      publishExclusion,
    },
  };
}

describe('filterPublishExclusions', () => {
  test('boundaries with no publishExclusion pass through to included, none excluded', () => {
    const boundaries = [makeBoundary('a', 'USGS'), makeBoundary('b', 'USGS')];
    const result = filterPublishExclusions(boundaries);
    expect(result.included).toHaveLength(2);
    expect(result.excluded).toHaveLength(0);
    expect(result.exclusionSummary).toHaveLength(0);
  });

  test('boundaries with publishExclusion are excluded, never silently dropped', () => {
    const gate = { reason: 'no explicit grant', pendingConfirmation: 'O8-license-confirms (EPA)' };
    const boundaries = [
      makeBoundary('a', 'EPA', gate),
      makeBoundary('b', 'EPA', gate),
      makeBoundary('c', 'USGS'), // no gate
    ];
    const result = filterPublishExclusions(boundaries);
    expect(result.included.map((b) => b.id)).toEqual(['c']);
    expect(result.excluded.map((b) => b.id)).toEqual(['a', 'b']);
    expect(result.exclusionSummary).toHaveLength(1);
    expect(result.exclusionSummary[0].count).toBe(2);
    expect(result.exclusionSummary[0].provider).toBe('EPA');
  });

  test('distinct gates produce distinct summary rows even for the same provider', () => {
    const gateA = { reason: 'reason A', pendingConfirmation: 'O8 (EPA)' };
    const gateB = { reason: 'reason B', pendingConfirmation: 'O8 (EPA)' };
    const boundaries = [makeBoundary('a', 'EPA', gateA), makeBoundary('b', 'EPA', gateB)];
    const result = filterPublishExclusions(boundaries);
    expect(result.exclusionSummary).toHaveLength(2);
  });

  test('never mutates the input array or its elements', () => {
    const gate = { reason: 'r', pendingConfirmation: 'p' };
    const boundaries = [makeBoundary('a', 'EPA', gate)];
    const snapshot = JSON.stringify(boundaries);
    filterPublishExclusions(boundaries);
    expect(JSON.stringify(boundaries)).toBe(snapshot);
  });

  test('empty input is trivially valid', () => {
    const result = filterPublishExclusions([]);
    expect(result.included).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.exclusionSummary).toHaveLength(0);
  });
});

describe('hasPendingPublishExclusions', () => {
  test('false when no boundary is gated', () => {
    expect(hasPendingPublishExclusions([makeBoundary('a', 'USGS')])).toBe(false);
  });

  test('true when at least one boundary is gated', () => {
    const gate = { reason: 'r', pendingConfirmation: 'p' };
    expect(
      hasPendingPublishExclusions([makeBoundary('a', 'USGS'), makeBoundary('b', 'EPA', gate)]),
    ).toBe(true);
  });

  test('empty input is false', () => {
    expect(hasPendingPublishExclusions([])).toBe(false);
  });
});
