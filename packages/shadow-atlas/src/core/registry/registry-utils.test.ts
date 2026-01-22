/**
 * Registry Utility Functions Tests
 *
 * Tests for isStale(), isQuarantined(), and other utility functions
 * that operate on the generated registry constants.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KNOWN_PORTALS, type KnownPortal } from './known-portals.generated.js';
import { QUARANTINED_PORTALS } from './quarantined-portals.generated.js';
import {
  isStale,
  getPortal,
  hasPortal,
  isQuarantined,
  getQuarantinedPortal,
  getQuarantineSummary,
} from './registry-utils.js';

describe('isStale()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false for portal verified today', () => {
    const today = new Date('2026-01-19T12:00:00.000Z');
    vi.setSystemTime(today);

    const freshPortal: KnownPortal = {
      cityFips: '9999999',
      cityName: 'Test City',
      state: 'XX',
      portalType: 'arcgis',
      downloadUrl: 'https://example.com',
      featureCount: 5,
      lastVerified: '2026-01-19T00:00:00.000Z',
      confidence: 90,
      discoveredBy: 'manual',
      notes: 'Test portal',
    };

    expect(isStale(freshPortal)).toBe(false);
  });

  it('should return false for portal verified 89 days ago', () => {
    const today = new Date('2026-01-19T12:00:00.000Z');
    vi.setSystemTime(today);

    const freshPortal: KnownPortal = {
      cityFips: '9999999',
      cityName: 'Test City',
      state: 'XX',
      portalType: 'arcgis',
      downloadUrl: 'https://example.com',
      featureCount: 5,
      lastVerified: '2025-10-22T00:00:00.000Z', // 89 days before 2026-01-19
      confidence: 90,
      discoveredBy: 'manual',
      notes: 'Test portal',
    };

    expect(isStale(freshPortal)).toBe(false);
  });

  it('should return true for portal verified 91 days ago', () => {
    const today = new Date('2026-01-19T12:00:00.000Z');
    vi.setSystemTime(today);

    const stalePortal: KnownPortal = {
      cityFips: '9999999',
      cityName: 'Test City',
      state: 'XX',
      portalType: 'arcgis',
      downloadUrl: 'https://example.com',
      featureCount: 5,
      lastVerified: '2025-10-20T00:00:00.000Z', // 91 days before 2026-01-19
      confidence: 90,
      discoveredBy: 'manual',
      notes: 'Test portal',
    };

    expect(isStale(stalePortal)).toBe(true);
  });

  it('should return true for portal verified 1 year ago', () => {
    const today = new Date('2026-01-19T12:00:00.000Z');
    vi.setSystemTime(today);

    const veryStalePortal: KnownPortal = {
      cityFips: '9999999',
      cityName: 'Test City',
      state: 'XX',
      portalType: 'arcgis',
      downloadUrl: 'https://example.com',
      featureCount: 5,
      lastVerified: '2025-01-19T00:00:00.000Z', // 1 year ago
      confidence: 90,
      discoveredBy: 'manual',
      notes: 'Test portal',
    };

    expect(isStale(veryStalePortal)).toBe(true);
  });

  it('should work with real registry data', () => {
    vi.useRealTimers(); // Use real time for this test

    // Just verify the function doesn't throw on real data
    const portals = Object.values(KNOWN_PORTALS);
    expect(portals.length).toBeGreaterThan(0);

    for (const portal of portals.slice(0, 10)) {
      const result = isStale(portal);
      expect(typeof result).toBe('boolean');
    }
  });
});

describe('getPortal()', () => {
  it('should return portal for valid FIPS code', () => {
    // Use a known city from the registry (NYC)
    const portal = getPortal('3651000');
    if (portal) {
      expect(portal.cityName).toMatch(/new york/i);
      expect(portal.state).toBe('NY');
    }
  });

  it('should return undefined for invalid FIPS code', () => {
    expect(getPortal('0000000')).toBeUndefined();
    expect(getPortal('9999999')).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(getPortal('')).toBeUndefined();
  });
});

describe('hasPortal()', () => {
  it('should return true for known portal', () => {
    // Get any known FIPS from the registry
    const knownFips = Object.keys(KNOWN_PORTALS)[0];
    if (knownFips) {
      expect(hasPortal(knownFips)).toBe(true);
    }
  });

  it('should return false for unknown FIPS', () => {
    expect(hasPortal('0000000')).toBe(false);
    expect(hasPortal('9999999')).toBe(false);
  });
});

describe('isQuarantined()', () => {
  it('should return true for quarantined city', () => {
    // Get any quarantined FIPS from the registry
    const quarantinedFips = Object.keys(QUARANTINED_PORTALS)[0];
    if (quarantinedFips) {
      expect(isQuarantined(quarantinedFips)).toBe(true);
    }
  });

  it('should return false for non-quarantined city', () => {
    expect(isQuarantined('0000000')).toBe(false);
  });

  it('should return false for known portal that is not quarantined', () => {
    // NYC should be in known portals but not quarantined
    expect(isQuarantined('3651000')).toBe(false);
  });
});

describe('getQuarantinedPortal()', () => {
  it('should return portal for quarantined city', () => {
    const quarantinedFips = Object.keys(QUARANTINED_PORTALS)[0];
    if (quarantinedFips) {
      const portal = getQuarantinedPortal(quarantinedFips);
      expect(portal).toBeDefined();
      expect(portal?.matchedPattern).toBeDefined();
    }
  });

  it('should return undefined for non-quarantined city', () => {
    expect(getQuarantinedPortal('0000000')).toBeUndefined();
    expect(getQuarantinedPortal('3651000')).toBeUndefined(); // NYC
  });
});

describe('getQuarantineSummary()', () => {
  it('should return pattern counts', () => {
    const summary = getQuarantineSummary();
    expect(typeof summary).toBe('object');

    // Total should match quarantine count
    const totalFromSummary = Object.values(summary).reduce((a, b) => a + b, 0);
    expect(totalFromSummary).toBe(Object.keys(QUARANTINED_PORTALS).length);
  });

  it('should have string keys (pattern names)', () => {
    const summary = getQuarantineSummary();
    for (const key of Object.keys(summary)) {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('should have positive number values', () => {
    const summary = getQuarantineSummary();
    for (const value of Object.values(summary)) {
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe('Registry data integrity', () => {
  it('should track overlap between known and quarantined entries', () => {
    const knownFips = new Set(Object.keys(KNOWN_PORTALS));
    const quarantinedFips = new Set(Object.keys(QUARANTINED_PORTALS));

    // Find any FIPS in both registries
    const overlap = [...knownFips].filter(fips => quarantinedFips.has(fips));

    // KNOWN ISSUE: Some cities exist in both registries due to migration artifacts.
    // These should be cleaned up in a future data hygiene pass.
    // Documenting current state for regression tracking:
    // - 1235050: Jacksonville Beach, FL
    // - 1861092: South Bend, IN
    // - 2220575: DeQuincy, LA
    // - 0614218: Carson, CA
    //
    // TODO: Remove these from quarantined-portals.ndjson or known-portals.ndjson
    const KNOWN_OVERLAP = ['1235050', '1861092', '2220575', '0614218'];

    // Verify no NEW overlaps have been introduced
    const unexpectedOverlap = overlap.filter(fips => !KNOWN_OVERLAP.includes(fips));
    expect(unexpectedOverlap).toEqual([]);

    // Track current overlap count for monitoring
    expect(overlap.length).toBeLessThanOrEqual(KNOWN_OVERLAP.length);
  });
});
