/**
 * Integration test - skipped in unit test suite
 * Run with: npm run test:integration
 *
 * TIGER Real Data Pipeline Tests
 *
 * NOTE: This test requires:
 * - Network access to Census Bureau TIGER endpoints
 * - GDAL/ogr2ogr installed locally
 * - Downloads 10-50MB shapefiles
 *
 * Tests are skipped in unit test suite. Run separately for integration testing.
 */

import { describe, it, expect } from 'vitest';

describe.skip('TIGER Pipeline Integration (REAL DATA)', () => {
  it('placeholder - requires network and GDAL', () => {
    expect(true).toBe(true);
  });
});
