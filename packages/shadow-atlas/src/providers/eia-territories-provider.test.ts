/**
 * EIA territories provider — pagination + maxFeatures unit tests (P17-wave1-ingest)
 *
 * Mocked fetch (no network). Regression guard for the real timeout this
 * session found: the live ArcGIS FeatureServer is slow enough for large
 * outFields=* + full-geometry pages (~49s for one 500-feature page,
 * verified 2026-07-04) that a full unbounded national pagination loop
 * cannot fit a reasonable test timeout. `maxFeatures` lets a caller cap the
 * total fetched across pages without changing default (unbounded, full
 * national) production behavior.
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import { EIATerritoriesProvider } from './eia-territories-provider.js';

function mockFeature(id: number) {
  return {
    attributes: { ID: id, NAME: `Territory ${id}`, UTILITY_ID: id },
    geometry: { rings: [[[-90, 40], [-89, 40], [-89, 41], [-90, 40]]] },
  };
}

function mockResponse(features: ReturnType<typeof mockFeature>[], exceededTransferLimit = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ features, exceededTransferLimit }),
  } as Response;
}

describe('EIATerritoriesProvider pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('without maxFeatures, follows exceededTransferLimit/full-page signal to keep paginating', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return mockResponse([mockFeature(1), mockFeature(2)], true); // page 1 full, more follows
      return mockResponse([mockFeature(3)]); // page 2 partial, done
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EIATerritoriesProvider({ pageSize: 2 });
    const raw = await provider.download({ level: 'district' });
    const parsed = JSON.parse(raw[0].data.toString('utf-8'));
    expect(parsed).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('maxFeatures stops pagination once the cap is reached, even if more pages are available', async () => {
    let call = 0;
    const fetchMock = vi.fn(async (url: string) => {
      call++;
      // Verify the requested page size shrinks to respect the remaining cap.
      const params = new URL(url).searchParams;
      const requested = Number(params.get('resultRecordCount'));
      if (call === 1) {
        expect(requested).toBe(2); // first page: min(pageSize=2, cap=3-0=3) = 2
        return mockResponse([mockFeature(1), mockFeature(2)], true);
      }
      expect(requested).toBe(1); // second page: min(pageSize=2, cap=3-2=1) = 1
      return mockResponse([mockFeature(3)], true); // pretend more exists — cap must still stop us
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EIATerritoriesProvider({ pageSize: 2, maxFeatures: 3 });
    const raw = await provider.download({ level: 'district' });
    const parsed = JSON.parse(raw[0].data.toString('utf-8'));
    expect(parsed).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2); // NOT a third page, even though exceededTransferLimit was true
  });

  test('maxFeatures larger than the real dataset does not loop forever (stops when a page is short)', async () => {
    const fetchMock = vi.fn(async () => mockResponse([mockFeature(1)])); // one short page, no more
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EIATerritoriesProvider({ pageSize: 100, maxFeatures: 1000 });
    const raw = await provider.download({ level: 'district' });
    const parsed = JSON.parse(raw[0].data.toString('utf-8'));
    expect(parsed).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('maxFeatures: 0 fetches nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const provider = new EIATerritoriesProvider({ maxFeatures: 0 });
    const raw = await provider.download({ level: 'district' });
    const parsed = JSON.parse(raw[0].data.toString('utf-8'));
    expect(parsed).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
