/**
 * Input Validator Security Tests
 *
 * Comprehensive fuzzing and boundary testing for input validation.
 * Validates defense against injection attacks, DoS, and data corruption.
 */

import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import {
  validateCoordinates,
  validateStateCode,
  validateStateFips,
  validateURL,
  validateJobID,
  validateSnapshotID,
  validateGeoJSON,
  validatePagination,
  validateContentType,
  validateResponseSize,
  sanitizeErrorMessage,
  // SA-014: Discovery schema validation
  parseDiscoveryResults,
  parseCheckpointState,
  parseChecksumCache,
  safeParseJSON,
  DiscoveryResultSchema,
} from '../input-validator.js';

describe('Input Validator - Coordinate Validation', () => {
  test('accepts valid coordinates', () => {
    const testCases = [
      { lat: '0', lon: '0' }, // Null Island
      { lat: '43.0731', lon: '-89.4012' }, // Madison, WI
      { lat: '90', lon: '180' }, // North Pole, Dateline
      { lat: '-90', lon: '-180' }, // South Pole, Antimeridian
      { lat: '45.5', lon: '-122.5' }, // Portland, OR
    ];

    for (const { lat, lon } of testCases) {
      const result = validateCoordinates(lat, lon);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lat).toBe(parseFloat(lat));
        expect(result.data.lon).toBe(parseFloat(lon));
      }
    }
  });

  test('rejects coordinates outside valid range', () => {
    const testCases = [
      { lat: '91', lon: '0', reason: 'Latitude too high' },
      { lat: '-91', lon: '0', reason: 'Latitude too low' },
      { lat: '0', lon: '181', reason: 'Longitude too high' },
      { lat: '0', lon: '-181', reason: 'Longitude too low' },
    ];

    for (const { lat, lon, reason } of testCases) {
      const result = validateCoordinates(lat, lon);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeTruthy();
      }
    }
  });

  test('rejects special float values', () => {
    const testCases = [
      { lat: 'NaN', lon: '0' },
      { lat: '0', lon: 'NaN' },
      { lat: 'Infinity', lon: '0' },
      { lat: '0', lon: '-Infinity' },
    ];

    for (const { lat, lon } of testCases) {
      const result = validateCoordinates(lat, lon);
      expect(result.success).toBe(false);
    }
  });

  test('rejects excessive precision (DoS protection)', () => {
    const lat = '43.073100000000000001'; // 18 decimal places
    const lon = '-89.401200000000000002';

    const result = validateCoordinates(lat, lon);
    expect(result.success).toBe(false);
  });

  test('rejects missing parameters', () => {
    const result1 = validateCoordinates(undefined, '0');
    expect(result1.success).toBe(false);

    const result2 = validateCoordinates('0', undefined);
    expect(result2.success).toBe(false);

    const result3 = validateCoordinates(undefined, undefined);
    expect(result3.success).toBe(false);
  });

  test('rejects overly long coordinate strings (DoS protection)', () => {
    const longString = '1' + '.'.repeat(100);

    const result = validateCoordinates(longString, '0');
    expect(result.success).toBe(false);
  });
});

describe('Input Validator - State Code Validation', () => {
  test('accepts valid state codes', () => {
    const validCodes = ['WI', 'CA', 'NY', 'TX', 'FL', 'DC', 'PR'];

    for (const code of validCodes) {
      const result = validateStateCode(code);
      expect(result.success).toBe(true);
    }
  });

  test('accepts lowercase and converts to uppercase', () => {
    const result = validateStateCode('wi');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('WI');
    }
  });

  test('rejects invalid state codes', () => {
    const invalidCodes = ['ZZ', 'XX', 'AB', '00', '  ', 'W', 'WIS', '12'];

    for (const code of invalidCodes) {
      const result = validateStateCode(code);
      expect(result.success).toBe(false);
    }
  });

  test('rejects injection attempts', () => {
    const injectionAttempts = [
      "WI'; DROP TABLE states;--",
      'WI OR 1=1',
      'WI<script>',
      '../WI',
    ];

    for (const code of injectionAttempts) {
      const result = validateStateCode(code);
      expect(result.success).toBe(false);
    }
  });
});

describe('Input Validator - FIPS Code Validation', () => {
  test('accepts valid FIPS codes', () => {
    const validCodes = ['01', '06', '55', '48', '12']; // AL, CA, WI, TX, FL

    for (const fips of validCodes) {
      const result = validateStateFips(fips);
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid FIPS codes', () => {
    const invalidCodes = ['00', '57', '99', 'AA', '1', '001', 'XX'];

    for (const fips of invalidCodes) {
      const result = validateStateFips(fips);
      expect(result.success).toBe(false);
    }
  });

  test('rejects SQL injection attempts', () => {
    const injectionAttempts = ["55' OR '1'='1", '55; DROP TABLE', "55'--"];

    for (const fips of injectionAttempts) {
      const result = validateStateFips(fips);
      expect(result.success).toBe(false);
    }
  });
});

describe('Input Validator - URL Validation', () => {
  test('accepts valid URLs from allowlist', () => {
    const validURLs = [
      'https://tigerweb.geo.census.gov/api/rest/services/...',
      'https://services.arcgis.com/some/service',
      'https://data.cityofchicago.org/api/...',
      'https://geoportal.statistics.gov.uk/datasets/...',
    ];

    for (const url of validURLs) {
      const result = validateURL(url);
      expect(result.success).toBe(true);
    }
  });

  test('rejects HTTP URLs (only HTTPS allowed)', () => {
    const httpURL = 'http://tigerweb.geo.census.gov/api/...';
    const result = validateURL(httpURL);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('HTTPS');
    }
  });

  test('rejects URLs not in allowlist', () => {
    const maliciousURLs = [
      'https://evil.com/api',
      'https://attacker.net/steal',
      'https://example.com/test',
    ];

    for (const url of maliciousURLs) {
      const result = validateURL(url);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('allowlist');
      }
    }
  });

  test('rejects private IP addresses (SSRF protection)', () => {
    const privateURLs = [
      'https://192.168.1.1/api',
      'https://10.0.0.1/admin',
      'https://172.16.0.1/internal',
      'https://127.0.0.1/localhost',
      'https://localhost/api',
    ];

    for (const url of privateURLs) {
      const result = validateURL(url);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('private');
      }
    }
  });

  test('rejects malformed URLs', () => {
    const malformedURLs = [
      'not-a-url',
      'ftp://census.gov',
      'javascript:alert(1)',
      '//evil.com',
    ];

    for (const url of malformedURLs) {
      const result = validateURL(url);
      expect(result.success).toBe(false);
    }
  });
});

describe('Input Validator - Job ID Validation', () => {
  test('accepts valid UUIDs', () => {
    const validUUIDs = [
      '550e8400-e29b-41d4-a716-446655440000',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    ];

    for (const uuid of validUUIDs) {
      const result = validateJobID(uuid);
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid UUIDs', () => {
    const invalidUUIDs = [
      'not-a-uuid',
      '12345',
      'g47ac10b-58cc-4372-a567-0e02b2c3d479', // Invalid hex
      '550e8400-e29b-41d4-a716', // Too short
    ];

    for (const uuid of invalidUUIDs) {
      const result = validateJobID(uuid);
      expect(result.success).toBe(false);
    }
  });

  test('rejects path traversal attempts', () => {
    const traversalAttempts = [
      '../../../etc/passwd',
      '..\\..\\windows\\system32',
      'job/../admin',
    ];

    for (const attempt of traversalAttempts) {
      const result = validateJobID(attempt);
      expect(result.success).toBe(false);
    }
  });
});

describe('Input Validator - GeoJSON Validation', () => {
  test('accepts valid GeoJSON FeatureCollection', () => {
    const validGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
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
          },
          properties: { name: 'Test' },
        },
      ],
    };

    const result = validateGeoJSON(validGeoJSON);
    expect(result.success).toBe(true);
  });

  test('rejects oversized feature collections (DoS protection)', () => {
    const oversized = {
      type: 'FeatureCollection',
      features: Array(100000).fill({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [] },
        properties: null,
      }),
    };

    const result = validateGeoJSON(oversized);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('too large');
    }
  });

  test('rejects invalid GeoJSON structure', () => {
    const invalidGeoJSONs = [
      { type: 'Feature' }, // Missing FeatureCollection wrapper
      { type: 'FeatureCollection' }, // Missing features array
      { type: 'FeatureCollection', features: 'not-an-array' },
      { type: 'FeatureCollection', features: [{ type: 'Point' }] }, // Wrong geometry type
    ];

    for (const geojson of invalidGeoJSONs) {
      const result = validateGeoJSON(geojson);
      expect(result.success).toBe(false);
    }
  });
});

describe('Input Validator - Pagination Validation', () => {
  test('accepts valid pagination parameters', () => {
    const testCases = [
      { limit: '10', offset: '0' },
      { limit: '100', offset: '50' },
      { limit: '1', offset: '999999' },
    ];

    for (const { limit, offset } of testCases) {
      const result = validatePagination(limit, offset);
      expect(result.success).toBe(true);
    }
  });

  test('applies default values for missing parameters', () => {
    const result = validatePagination(undefined, undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(0);
    }
  });

  test('rejects excessive limit (DoS protection)', () => {
    const result = validatePagination('10000', '0');
    expect(result.success).toBe(false);
  });

  test('rejects negative values', () => {
    const result1 = validatePagination('-10', '0');
    expect(result1.success).toBe(false);

    const result2 = validatePagination('10', '-5');
    expect(result2.success).toBe(false);
  });

  test('rejects non-integer values', () => {
    const result = validatePagination('10.5', '0');
    expect(result.success).toBe(false);
  });
});

describe('Input Validator - Content-Type Validation', () => {
  test('accepts valid content types', () => {
    const validTypes = [
      'application/json',
      'application/geo+json',
      'application/vnd.geo+json',
      'application/json; charset=utf-8',
    ];

    for (const contentType of validTypes) {
      expect(validateContentType(contentType)).toBe(true);
    }
  });

  test('rejects invalid content types', () => {
    const invalidTypes = [
      'text/html',
      'application/xml',
      'text/plain',
      'application/octet-stream',
    ];

    for (const contentType of invalidTypes) {
      expect(validateContentType(contentType)).toBe(false);
    }
  });

  test('rejects missing content type', () => {
    expect(validateContentType(undefined)).toBe(false);
  });
});

describe('Input Validator - Response Size Validation', () => {
  test('accepts responses within size limit', () => {
    expect(validateResponseSize('1000')).toBe(true);
    expect(validateResponseSize('5242880')).toBe(true); // 5 MB
  });

  test('rejects oversized responses (DoS protection)', () => {
    const maxSize = 10 * 1024 * 1024; // 10 MB
    const oversized = (maxSize + 1).toString();
    expect(validateResponseSize(oversized, maxSize)).toBe(false);
  });

  test('accepts missing Content-Length (will check during streaming)', () => {
    expect(validateResponseSize(undefined)).toBe(true);
  });

  test('rejects invalid Content-Length values', () => {
    expect(validateResponseSize('not-a-number')).toBe(false);
    expect(validateResponseSize('-100')).toBe(false);
  });
});

describe('Input Validator - Error Sanitization', () => {
  test('sanitizes file paths from error messages', () => {
    const error = new Error('ENOENT: no such file or directory, open \'/var/app/data/secret.txt\'');
    const sanitized = sanitizeErrorMessage(error);

    expect(sanitized).not.toContain('/var/app/data');
    expect(sanitized).toContain('[path]');
  });

  test('limits error message length', () => {
    const longError = new Error('A'.repeat(500));
    const sanitized = sanitizeErrorMessage(longError);

    expect(sanitized.length).toBeLessThanOrEqual(200);
  });

  test('extracts first validation error from Zod errors', () => {
    // Create a Zod-like error
    const zodError = {
      errors: [{ message: 'Invalid input' }, { message: 'Another error' }],
    };

    const sanitized = sanitizeErrorMessage(zodError);
    expect(sanitized).toContain('Invalid input');
    expect(sanitized).not.toContain('Another error');
  });
});

// ============================================================================
// SA-014: Discovery Schema Validation Tests
// ============================================================================

describe('Input Validator - Discovery Result Schema (SA-014)', () => {

  test('accepts valid discovery result', () => {
    const validResult = JSON.stringify([{
      geoid: '0644000',
      cityName: 'Los Angeles',
      state: 'California',
      population: 3900000,
      status: 'found',
      districtCount: 15,
      downloadUrl: 'https://example.com/data.geojson',
      portalType: 'arcgis-hub',
      confidence: 95,
      discoveredAt: '2025-01-15T10:00:00Z',
      errorMessage: null,
    }]);

    const results = parseDiscoveryResults(validResult);
    expect(results).toHaveLength(1);
    expect(results[0].geoid).toBe('0644000');
    expect(results[0].status).toBe('found');
  });

  test('rejects invalid geoid format', () => {
    const invalidGeoid = JSON.stringify([{
      geoid: 'abc', // Invalid - must be numeric
      cityName: 'Test City',
      state: 'Test State',
      population: 100000,
      status: 'found',
      districtCount: null,
      downloadUrl: null,
      portalType: null,
      confidence: 0,
      discoveredAt: null,
      errorMessage: null,
    }]);

    expect(() => parseDiscoveryResults(invalidGeoid)).toThrow();
  });

  test('rejects invalid status value', () => {
    const invalidStatus = JSON.stringify([{
      geoid: '1234567',
      cityName: 'Test City',
      state: 'Test State',
      population: 100000,
      status: 'invalid_status', // Invalid enum value
      districtCount: null,
      downloadUrl: null,
      portalType: null,
      confidence: 0,
      discoveredAt: null,
      errorMessage: null,
    }]);

    expect(() => parseDiscoveryResults(invalidStatus)).toThrow();
  });

  test('rejects confidence out of range', () => {
    const outOfRange = JSON.stringify([{
      geoid: '1234567',
      cityName: 'Test City',
      state: 'Test State',
      population: 100000,
      status: 'found',
      districtCount: null,
      downloadUrl: null,
      portalType: null,
      confidence: 150, // Invalid - must be 0-100
      discoveredAt: null,
      errorMessage: null,
    }]);

    expect(() => parseDiscoveryResults(outOfRange)).toThrow();
  });

  test('rejects invalid JSON syntax', () => {
    const malformedJson = '{ invalid json }';
    expect(() => parseDiscoveryResults(malformedJson)).toThrow();
  });
});

describe('Input Validator - Checkpoint State Schema (SA-014)', () => {

  test('accepts valid checkpoint state', () => {
    const validCheckpoint = JSON.stringify({
      id: '550e8400-e29b-41d4-a716-446655440000',
      startedAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T11:00:00Z',
      completedStates: ['01', '06'],
      failedStates: ['36'],
      pendingStates: ['48'],
      options: {
        states: ['01', '06', '36', '48'],
        layers: ['cd', 'sldu'],
        year: 2024,
      },
      circuitOpen: false,
      consecutiveFailures: 0,
      boundaryCount: 1000,
    });

    const checkpoint = parseCheckpointState(validCheckpoint);
    expect(checkpoint.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(checkpoint.completedStates).toHaveLength(2);
  });

  test('rejects invalid state FIPS codes', () => {
    const invalidFips = JSON.stringify({
      id: '550e8400-e29b-41d4-a716-446655440000',
      startedAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T11:00:00Z',
      completedStates: ['ABC'], // Invalid - must be 2 digits
      failedStates: [],
      pendingStates: [],
      options: {
        states: [],
        layers: [],
        year: 2024,
      },
      circuitOpen: false,
      consecutiveFailures: 0,
      boundaryCount: 0,
    });

    expect(() => parseCheckpointState(invalidFips)).toThrow();
  });

  test('rejects invalid UUID', () => {
    const invalidUuid = JSON.stringify({
      id: 'not-a-uuid',
      startedAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T11:00:00Z',
      completedStates: [],
      failedStates: [],
      pendingStates: [],
      options: {
        states: [],
        layers: [],
        year: 2024,
      },
      circuitOpen: false,
      consecutiveFailures: 0,
      boundaryCount: 0,
    });

    expect(() => parseCheckpointState(invalidUuid)).toThrow();
  });
});

describe('Input Validator - Checksum Cache Schema (SA-014)', () => {

  test('accepts valid checksum cache', () => {
    const validCache = JSON.stringify({
      lastChecked: '2025-01-15T10:00:00Z',
      sources: {
        'cd-01-2024': {
          etag: '"abc123"',
          lastModified: 'Tue, 15 Jan 2025 10:00:00 GMT',
          checkedAt: '2025-01-15T10:00:00Z',
        },
      },
    });

    const cache = parseChecksumCache(validCache);
    expect(cache.lastChecked).toBe('2025-01-15T10:00:00Z');
    expect(cache.sources['cd-01-2024'].etag).toBe('"abc123"');
  });

  test('accepts null etag and lastModified', () => {
    const cacheWithNulls = JSON.stringify({
      lastChecked: '2025-01-15T10:00:00Z',
      sources: {
        'cd-01-2024': {
          etag: null,
          lastModified: null,
          checkedAt: '2025-01-15T10:00:00Z',
        },
      },
    });

    const cache = parseChecksumCache(cacheWithNulls);
    expect(cache.sources['cd-01-2024'].etag).toBeNull();
  });
});

describe('Input Validator - Safe JSON Parse (SA-014)', () => {

  test('returns success for valid JSON and schema', () => {
    const schema = z.object({ name: z.string() });
    const result = safeParseJSON('{"name":"test"}', schema);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('test');
    }
  });

  test('returns error for invalid JSON syntax', () => {
    const schema = z.object({ name: z.string() });
    const result = safeParseJSON('{ invalid }', schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON syntax');
    }
  });

  test('returns error for schema validation failure', () => {
    const schema = z.object({ name: z.string().min(5) });
    const result = safeParseJSON('{"name":"ab"}', schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('5');  // References min length
    }
  });
});
