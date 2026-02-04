/**
 * URL Validator Tests
 *
 * SA-009: Tests for URL allowlist enforcement in the discovery pipeline.
 *
 * Tests cover:
 * - Allowlist pattern matching (exact and suffix)
 * - Private IP blocking
 * - HTTPS enforcement
 * - Security logging
 * - Batch validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateDiscoveryURL,
  isURLSafeForBypass,
  batchValidateDiscoveryURLs,
  matchAllowlistPattern,
  isPrivateHostname,
  isDomainAllowed,
  getMatchingPatternDescription,
  URL_ALLOWLIST_PATTERNS,
} from '../url-validator.js';

describe('URL Validator', () => {
  // ============================================================================
  // validateDiscoveryURL
  // ============================================================================

  describe('validateDiscoveryURL', () => {
    describe('allowed URLs', () => {
      it('should allow Census Bureau URLs', () => {
        const result = validateDiscoveryURL(
          'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer',
          'test'
        );
        expect(result.allowed).toBe(true);
        expect(result.url).toContain('tigerweb.geo.census.gov');
        expect(result.matchedPattern?.organization).toBe('US Census Bureau');
      });

      it('should allow www2.census.gov (suffix match)', () => {
        const result = validateDiscoveryURL(
          'https://www2.census.gov/geo/tiger/TIGER2023/',
          'test'
        );
        expect(result.allowed).toBe(true);
      });

      it('should allow ArcGIS Hub URLs', () => {
        const result = validateDiscoveryURL(
          'https://hub.arcgis.com/api/v3/datasets',
          'test'
        );
        expect(result.allowed).toBe(true);
        expect(result.matchedPattern?.organization).toBe('Esri');
      });

      it('should allow ArcGIS Online subdomains', () => {
        const result = validateDiscoveryURL(
          'https://services.arcgis.com/some-org/rest/services/Districts/FeatureServer/0',
          'test'
        );
        expect(result.allowed).toBe(true);
      });

      it('should allow Socrata Discovery API', () => {
        const result = validateDiscoveryURL(
          'https://api.us.socrata.com/api/catalog/v1?q=council%20districts',
          'test'
        );
        expect(result.allowed).toBe(true);
      });

      it('should allow city Socrata portals (exact match)', () => {
        const urls = [
          'https://data.cityofchicago.org/resource/abc123.geojson',
          'https://data.seattle.gov/api/views/xyz789',
          'https://data.sfgov.org/resource/wards.json',
          'https://data.cityofnewyork.us/api/catalog/v1',
        ];

        for (const url of urls) {
          const result = validateDiscoveryURL(url, 'test');
          expect(result.allowed).toBe(true);
        }
      });

      it('should allow state GIS portals', () => {
        const urls = [
          'https://geodata.hawaii.gov/arcgis/rest/services/AdminBnd/MapServer/11',
          'https://gis.texas.gov/arcgis/rest/services',
        ];

        for (const url of urls) {
          const result = validateDiscoveryURL(url, 'test');
          expect(result.allowed).toBe(true);
        }
      });
    });

    describe('blocked URLs', () => {
      it('should block localhost', () => {
        const result = validateDiscoveryURL('https://localhost/api', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('private');
      });

      it('should block 127.0.0.1', () => {
        const result = validateDiscoveryURL('https://127.0.0.1/api', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('private');
      });

      it('should block private IP ranges (10.x.x.x)', () => {
        const result = validateDiscoveryURL('https://10.0.0.1/internal', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('private');
      });

      it('should block private IP ranges (172.16-31.x.x)', () => {
        const result = validateDiscoveryURL('https://172.16.0.1/internal', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('private');
      });

      it('should block private IP ranges (192.168.x.x)', () => {
        const result = validateDiscoveryURL('https://192.168.1.1/router', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('private');
      });

      it('should block AWS metadata endpoint', () => {
        const result = validateDiscoveryURL('https://169.254.169.254/latest/meta-data/', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('private');
      });

      it('should block HTTP URLs', () => {
        const result = validateDiscoveryURL('http://hub.arcgis.com/api/v3/datasets', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('HTTPS');
      });

      it('should block non-allowlisted domains', () => {
        const result = validateDiscoveryURL('https://evil-site.com/fake-census-data', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('not in allowlist');
      });

      it('should block invalid URLs', () => {
        const result = validateDiscoveryURL('not-a-url', 'test');
        expect(result.allowed).toBe(false);
        expect(result.error).toContain('Invalid URL');
      });

      it('should block URLs with similar-looking domains (typosquatting)', () => {
        const typosquattingUrls = [
          'https://hub.arcg1s.com/api', // 1 instead of i
          'https://tigerweb.geo.census.org/api', // .org instead of .gov
          'https://data.census-gov.com/api', // hyphen instead of dot
          'https://arcgis.com.evil.com/api', // evil.com suffix
        ];

        for (const url of typosquattingUrls) {
          const result = validateDiscoveryURL(url, 'test');
          expect(result.allowed).toBe(false);
        }
      });
    });

    describe('edge cases', () => {
      it('should handle URLs with query parameters', () => {
        const result = validateDiscoveryURL(
          'https://hub.arcgis.com/api/v3/datasets?q=test&limit=10',
          'test'
        );
        expect(result.allowed).toBe(true);
      });

      it('should handle URLs with fragments', () => {
        const result = validateDiscoveryURL(
          'https://hub.arcgis.com/api#section',
          'test'
        );
        expect(result.allowed).toBe(true);
      });

      it('should handle URLs with ports', () => {
        // Standard HTTPS port should work
        const result = validateDiscoveryURL(
          'https://hub.arcgis.com:443/api',
          'test'
        );
        expect(result.allowed).toBe(true);
      });

      it('should handle empty URL', () => {
        const result = validateDiscoveryURL('', 'test');
        expect(result.allowed).toBe(false);
      });
    });
  });

  // ============================================================================
  // isURLSafeForBypass
  // ============================================================================

  describe('isURLSafeForBypass', () => {
    it('should return true for public HTTPS URLs', () => {
      expect(isURLSafeForBypass('https://example.com/api')).toBe(true);
      expect(isURLSafeForBypass('https://custom-gis.somecity.gov/arcgis')).toBe(true);
    });

    it('should return false for HTTP URLs', () => {
      expect(isURLSafeForBypass('http://example.com/api')).toBe(false);
    });

    it('should return false for private IPs', () => {
      expect(isURLSafeForBypass('https://192.168.1.1/api')).toBe(false);
      expect(isURLSafeForBypass('https://10.0.0.1/api')).toBe(false);
      expect(isURLSafeForBypass('https://localhost/api')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isURLSafeForBypass('not-a-url')).toBe(false);
      expect(isURLSafeForBypass('')).toBe(false);
    });
  });

  // ============================================================================
  // batchValidateDiscoveryURLs
  // ============================================================================

  describe('batchValidateDiscoveryURLs', () => {
    it('should separate allowed and blocked URLs', () => {
      const urls = [
        'https://hub.arcgis.com/api/v3/datasets',
        'https://evil.com/fake',
        'https://data.seattle.gov/resource/abc',
        'https://localhost/internal',
        'https://api.us.socrata.com/api/catalog/v1',
      ];

      const result = batchValidateDiscoveryURLs(urls, 'test');

      expect(result.allowed).toHaveLength(3);
      expect(result.blocked).toHaveLength(2);

      expect(result.allowed).toContain('https://hub.arcgis.com/api/v3/datasets');
      expect(result.allowed).toContain('https://data.seattle.gov/resource/abc');
      expect(result.allowed).toContain('https://api.us.socrata.com/api/catalog/v1');

      expect(result.blocked.map(b => b.url)).toContain('https://evil.com/fake');
      expect(result.blocked.map(b => b.url)).toContain('https://localhost/internal');
    });

    it('should handle empty array', () => {
      const result = batchValidateDiscoveryURLs([], 'test');
      expect(result.allowed).toHaveLength(0);
      expect(result.blocked).toHaveLength(0);
    });

    it('should include error messages for blocked URLs', () => {
      const urls = ['https://evil.com/fake'];
      const result = batchValidateDiscoveryURLs(urls, 'test');

      expect(result.blocked[0].error).toContain('not in allowlist');
    });
  });

  // ============================================================================
  // matchAllowlistPattern
  // ============================================================================

  describe('matchAllowlistPattern', () => {
    it('should match exact domains', () => {
      const pattern = matchAllowlistPattern('tigerweb.geo.census.gov');
      expect(pattern).not.toBeNull();
      expect(pattern?.type).toBe('exact');
    });

    it('should match suffix patterns', () => {
      const pattern = matchAllowlistPattern('www2.census.gov');
      expect(pattern).not.toBeNull();
      expect(pattern?.type).toBe('suffix');
    });

    it('should match ArcGIS subdomains', () => {
      const subdomains = [
        'hub.arcgis.com',
        'services.arcgis.com',
        'www.arcgis.com',
        'opendata.arcgis.com',
        'some-org.maps.arcgis.com',
      ];

      for (const domain of subdomains) {
        const pattern = matchAllowlistPattern(domain);
        expect(pattern).not.toBeNull();
      }
    });

    it('should be case-insensitive', () => {
      expect(matchAllowlistPattern('HUB.ARCGIS.COM')).not.toBeNull();
      expect(matchAllowlistPattern('TigerWeb.Geo.Census.Gov')).not.toBeNull();
    });

    it('should return null for non-matching domains', () => {
      expect(matchAllowlistPattern('evil.com')).toBeNull();
      expect(matchAllowlistPattern('arcgis.com.evil.com')).toBeNull();
    });
  });

  // ============================================================================
  // isPrivateHostname
  // ============================================================================

  describe('isPrivateHostname', () => {
    it('should detect localhost', () => {
      expect(isPrivateHostname('localhost')).toBe(true);
      expect(isPrivateHostname('::1')).toBe(true);
    });

    it('should detect private IPv4 ranges', () => {
      // 10.x.x.x
      expect(isPrivateHostname('10.0.0.1')).toBe(true);
      expect(isPrivateHostname('10.255.255.255')).toBe(true);

      // 172.16-31.x.x
      expect(isPrivateHostname('172.16.0.1')).toBe(true);
      expect(isPrivateHostname('172.31.255.255')).toBe(true);

      // 192.168.x.x
      expect(isPrivateHostname('192.168.0.1')).toBe(true);
      expect(isPrivateHostname('192.168.255.255')).toBe(true);

      // 127.x.x.x (loopback)
      expect(isPrivateHostname('127.0.0.1')).toBe(true);
      expect(isPrivateHostname('127.255.255.255')).toBe(true);
    });

    it('should detect link-local addresses', () => {
      expect(isPrivateHostname('169.254.169.254')).toBe(true);
      expect(isPrivateHostname('169.254.1.1')).toBe(true);
    });

    it('should detect private IPv6 ranges', () => {
      expect(isPrivateHostname('fe80::1')).toBe(true);
      expect(isPrivateHostname('fc00::1')).toBe(true);
      expect(isPrivateHostname('fd00::1')).toBe(true);
    });

    it('should not flag public IPs', () => {
      expect(isPrivateHostname('8.8.8.8')).toBe(false);
      expect(isPrivateHostname('1.1.1.1')).toBe(false);
      expect(isPrivateHostname('hub.arcgis.com')).toBe(false);
    });

    it('should not flag non-private 172.x ranges', () => {
      expect(isPrivateHostname('172.15.0.1')).toBe(false);
      expect(isPrivateHostname('172.32.0.1')).toBe(false);
    });
  });

  // ============================================================================
  // isDomainAllowed
  // ============================================================================

  describe('isDomainAllowed', () => {
    it('should return true for allowed domains', () => {
      expect(isDomainAllowed('tigerweb.geo.census.gov')).toBe(true);
      expect(isDomainAllowed('hub.arcgis.com')).toBe(true);
      expect(isDomainAllowed('api.us.socrata.com')).toBe(true);
    });

    it('should return false for non-allowed domains', () => {
      expect(isDomainAllowed('evil.com')).toBe(false);
      expect(isDomainAllowed('fake-census.gov')).toBe(false);
    });
  });

  // ============================================================================
  // getMatchingPatternDescription
  // ============================================================================

  describe('getMatchingPatternDescription', () => {
    it('should return description for matching domains', () => {
      const desc = getMatchingPatternDescription('tigerweb.geo.census.gov');
      expect(desc).toContain('TIGER');
      expect(desc).toContain('Census Bureau');
    });

    it('should return null for non-matching domains', () => {
      expect(getMatchingPatternDescription('evil.com')).toBeNull();
    });
  });

  // ============================================================================
  // URL_ALLOWLIST_PATTERNS
  // ============================================================================

  describe('URL_ALLOWLIST_PATTERNS', () => {
    it('should be frozen (immutable)', () => {
      expect(Object.isFrozen(URL_ALLOWLIST_PATTERNS)).toBe(true);
    });

    it('should have required fields for each pattern', () => {
      for (const pattern of URL_ALLOWLIST_PATTERNS) {
        expect(pattern.type).toMatch(/^(exact|suffix)$/);
        expect(pattern.domain).toBeTruthy();
        expect(pattern.description).toBeTruthy();
        expect(pattern.organization).toBeTruthy();
      }
    });

    it('should include critical data sources', () => {
      const domains = URL_ALLOWLIST_PATTERNS.map(p => p.domain);

      // Census
      expect(domains).toContain('tigerweb.geo.census.gov');
      expect(domains).toContain('.census.gov');

      // ArcGIS
      expect(domains).toContain('.arcgis.com');

      // Socrata
      expect(domains).toContain('.socrata.com');
    });
  });
});
