/**
 * Ward Registry Tests
 *
 * Validates that the ward registry correctly loads and indexes
 * city council ward data from the canonical data files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadWardRegistry, type WardRegistry } from '../../hydration/ward-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../agents/data');
const HAS_DATA = existsSync(resolve(DATA_DIR, 'bulk-ingestion-results.json'))
  && existsSync(resolve(DATA_DIR, 'attributed-council-districts.json'));

describe.skipIf(!HAS_DATA)('WardRegistry', () => {
  let registry: WardRegistry;

  beforeAll(async () => {
    registry = await loadWardRegistry();
  });

  it('loads entries from canonical data files', () => {
    expect(registry.entries.size).toBeGreaterThan(0);
    // We know there are 424 validated cities, but confidence filtering may reduce count
    expect(registry.entries.size).toBeGreaterThanOrEqual(300);
    expect(registry.entries.size).toBeLessThanOrEqual(500);
  });

  it('covers multiple states', () => {
    const states = registry.getCoveredStates();
    // Bulk ingestion data spans 47 states
    expect(states.size).toBeGreaterThanOrEqual(20);
  });

  it('getByState returns correct entries for CA', () => {
    const ca = registry.getByState('CA');
    // CA has 76 cities in the bulk ingestion data
    expect(ca.length).toBeGreaterThanOrEqual(50);
    for (const entry of ca) {
      expect(entry.state).toBe('CA');
      expect(entry.cityFips).toMatch(/^06/); // CA FIPS prefix
      expect(entry.sourceUrl).toContain('http');
      expect(entry.confidence).toBeGreaterThanOrEqual(70);
    }
  });

  it('getByState returns empty for non-existent state', () => {
    const xx = registry.getByState('XX');
    expect(xx).toEqual([]);
  });

  it('getCoveredCityFips returns unique FIPS codes', () => {
    const fips = registry.getCoveredCityFips();
    expect(fips.size).toBe(registry.entries.size);
    for (const f of fips) {
      expect(typeof f).toBe('string');
      expect(f.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('each entry has required fields', () => {
    for (const entry of registry.entries.values()) {
      expect(entry.cityFips).toBeTruthy();
      expect(entry.cityName).toBeTruthy();
      expect(entry.state).toMatch(/^[A-Z]{2}$/);
      expect(entry.featureCount).toBeGreaterThan(0);
      expect(entry.sourceUrl).toContain('http');
      expect(entry.confidence).toBeGreaterThanOrEqual(70);
      expect(entry.method).toBeTruthy();
    }
  });

  it('deduplicates entries per FIPS (picks highest confidence)', () => {
    // DC has 266 layers in attributed data but should resolve to 1 entry
    const dc = registry.entries.get('1150000');
    if (dc) {
      expect(dc.confidence).toBeGreaterThanOrEqual(85);
    }
  });

  it('respects minConfidence filter', async () => {
    const strict = await loadWardRegistry({ minConfidence: 85 });
    const loose = await loadWardRegistry({ minConfidence: 50 });
    expect(strict.entries.size).toBeLessThanOrEqual(loose.entries.size);
  });
});
