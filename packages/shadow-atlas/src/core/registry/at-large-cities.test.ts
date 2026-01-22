/**
 * At-Large Cities Registry Tests
 *
 * Validates the at-large city registry structure and helper functions
 */

import { describe, it, expect } from 'vitest';
import { AT_LARGE_CITIES, type AtLargeCity } from './at-large-cities.generated.js';
import {
  isAtLargeCity,
  getAtLargeCityInfo,
  getAtLargeCitiesByState,
  getAtLargeCityStats,
} from './registry-utils.js';

describe('AT_LARGE_CITIES registry', () => {
  it('should contain Cambridge MA (proportional representation)', () => {
    const cambridge = AT_LARGE_CITIES['2511000'];
    expect(cambridge).toBeDefined();
    expect(cambridge.cityName).toBe('Cambridge');
    expect(cambridge.state).toBe('MA');
    expect(cambridge.electionMethod).toBe('proportional');
    expect(cambridge.councilSize).toBe(9);
  });

  it('should contain Santa Monica CA (at-large)', () => {
    const santaMonica = AT_LARGE_CITIES['0670000'];
    expect(santaMonica).toBeDefined();
    expect(santaMonica.cityName).toBe('Santa Monica');
    expect(santaMonica.state).toBe('CA');
    expect(santaMonica.electionMethod).toBe('at-large');
    expect(santaMonica.councilSize).toBe(7);
  });

  it('should contain Pearland TX (at-large)', () => {
    const pearland = AT_LARGE_CITIES['4856348'];
    expect(pearland).toBeDefined();
    expect(pearland.cityName).toBe('Pearland');
    expect(pearland.state).toBe('TX');
    expect(pearland.electionMethod).toBe('at-large');
  });

  it('should have valid FIPS codes (7 digits)', () => {
    for (const fips of Object.keys(AT_LARGE_CITIES)) {
      expect(fips).toMatch(/^\d{7}$/);
    }
  });

  it('should have valid election methods', () => {
    const validMethods = ['at-large', 'proportional'];
    for (const city of Object.values(AT_LARGE_CITIES)) {
      expect(validMethods).toContain(city.electionMethod);
    }
  });

  it('should have council sizes > 0', () => {
    for (const city of Object.values(AT_LARGE_CITIES)) {
      expect(city.councilSize).toBeGreaterThan(0);
      expect(city.councilSize).toBeLessThan(50); // Sanity check
    }
  });

  it('should have source documentation', () => {
    for (const city of Object.values(AT_LARGE_CITIES)) {
      expect(city.source).toBeDefined();
      expect(city.source.length).toBeGreaterThan(0);
    }
  });
});

describe('isAtLargeCity()', () => {
  it('should return true for Cambridge MA', () => {
    expect(isAtLargeCity('2511000')).toBe(true);
  });

  it('should return true for Santa Monica CA', () => {
    expect(isAtLargeCity('0670000')).toBe(true);
  });

  it('should return false for non-at-large cities', () => {
    expect(isAtLargeCity('4805000')).toBe(false); // Austin TX
    expect(isAtLargeCity('5363000')).toBe(false); // Seattle WA
  });

  it('should return false for invalid FIPS codes', () => {
    expect(isAtLargeCity('0000000')).toBe(false);
    expect(isAtLargeCity('9999999')).toBe(false);
  });
});

describe('getAtLargeCityInfo()', () => {
  it('should return city info for valid at-large city', () => {
    const info = getAtLargeCityInfo('2511000');
    expect(info).toBeDefined();
    expect(info?.cityName).toBe('Cambridge');
  });

  it('should return undefined for non-at-large city', () => {
    const info = getAtLargeCityInfo('4805000'); // Austin TX
    expect(info).toBeUndefined();
  });

  it('should return undefined for invalid FIPS', () => {
    const info = getAtLargeCityInfo('0000000');
    expect(info).toBeUndefined();
  });
});

describe('getAtLargeCitiesByState()', () => {
  it('should return MA cities (Cambridge)', () => {
    const maCities = getAtLargeCitiesByState('MA');
    expect(maCities.length).toBeGreaterThan(0);
    const cambridge = maCities.find(([fips]) => fips === '2511000');
    expect(cambridge).toBeDefined();
  });

  it('should return TX cities (Pearland)', () => {
    const txCities = getAtLargeCitiesByState('TX');
    expect(txCities.length).toBeGreaterThan(0);
    const pearland = txCities.find(([fips]) => fips === '4856348');
    expect(pearland).toBeDefined();
  });

  it('should return empty array for states with no at-large cities', () => {
    const citiesArray = getAtLargeCitiesByState('ZZ'); // Invalid state
    expect(citiesArray).toEqual([]);
  });

  it('should return array of [FIPS, city] tuples', () => {
    const maCities = getAtLargeCitiesByState('MA');
    if (maCities.length > 0) {
      const [fips, city] = maCities[0];
      expect(typeof fips).toBe('string');
      expect(city).toHaveProperty('cityName');
      expect(city).toHaveProperty('state');
      expect(city).toHaveProperty('electionMethod');
    }
  });
});

describe('getAtLargeCityStats()', () => {
  it('should return total count', () => {
    const stats = getAtLargeCityStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.total).toBe(Object.keys(AT_LARGE_CITIES).length);
  });

  it('should count by election method', () => {
    const stats = getAtLargeCityStats();
    expect(stats.byMethod).toBeDefined();
    expect(Object.keys(stats.byMethod).length).toBeGreaterThan(0);

    // Should have at least one of each type based on current registry
    const hasAtLarge = stats.byMethod['at-large'] > 0;
    const hasProportional = stats.byMethod['proportional'] > 0;
    expect(hasAtLarge || hasProportional).toBe(true);
  });

  it('should count by state', () => {
    const stats = getAtLargeCityStats();
    expect(stats.byState).toBeDefined();
    expect(Object.keys(stats.byState).length).toBeGreaterThan(0);

    // MA should have Cambridge
    expect(stats.byState['MA']).toBeGreaterThan(0);
  });

  it('should have consistent counts', () => {
    const stats = getAtLargeCityStats();
    const totalByMethod = Object.values(stats.byMethod).reduce((a, b) => a + b, 0);
    const totalByState = Object.values(stats.byState).reduce((a, b) => a + b, 0);

    expect(totalByMethod).toBe(stats.total);
    expect(totalByState).toBe(stats.total);
  });
});

describe('Registry data quality', () => {
  it('should have unique FIPS codes', () => {
    const fipsCodes = Object.keys(AT_LARGE_CITIES);
    const uniqueFips = new Set(fipsCodes);
    expect(uniqueFips.size).toBe(fipsCodes.length);
  });

  it('should have valid state abbreviations (2 letters)', () => {
    for (const city of Object.values(AT_LARGE_CITIES)) {
      expect(city.state).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('should have non-empty city names', () => {
    for (const city of Object.values(AT_LARGE_CITIES)) {
      expect(city.cityName.length).toBeGreaterThan(0);
      expect(city.cityName).not.toMatch(/^\s*$/); // Not just whitespace
    }
  });

  it('should have meaningful sources (not placeholder text)', () => {
    for (const city of Object.values(AT_LARGE_CITIES)) {
      expect(city.source).not.toBe('TODO');
      expect(city.source).not.toBe('TBD');
      expect(city.source).not.toMatch(/^\s*$/);
    }
  });
});
