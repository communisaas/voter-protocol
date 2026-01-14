/**
 * Governance Validator Tests
 *
 * CRITICAL: These tests verify ZERO FALSE POSITIVES policy.
 * Never skip Layer 1 for district-based cities.
 *
 * Test coverage:
 * - At-large cities → Skip Layer 1
 * - District-based cities → Attempt Layer 1
 * - Mixed cities → Attempt Layer 1
 * - Unknown cities → Attempt Layer 1 (graceful degradation)
 * - District count validation → Reject mismatches
 */

import { describe, it, expect } from 'vitest';
import { GovernanceValidator } from '../../../validators/semantic/governance.js';

describe('GovernanceValidator', () => {
  describe('checkGovernance()', () => {
    it('should skip Layer 1 for confirmed at-large cities (Boulder, CO)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('0803000'); // Boulder, CO

      expect(result.structure).toBe('at-large');
      expect(result.shouldAttemptLayer1).toBe(false);
      expect(result.reason).toContain('at-large governance');
      expect(result.source).toBe('https://bouldercolorado.gov/government/city-council');
      expect(result.councilSize).toBe(9);
      expect(result.districtSeats).toBeUndefined();
    });

    it('should skip Layer 1 for confirmed at-large cities (Ann Arbor, MI)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('2603000'); // Ann Arbor, MI

      expect(result.structure).toBe('at-large');
      expect(result.shouldAttemptLayer1).toBe(false);
      expect(result.reason).toContain('at-large governance');
      expect(result.source).toBe('https://www.a2gov.org/departments/city-council/');
    });

    it('should attempt Layer 1 for district-based cities (Portland, OR)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('4159000'); // Portland, OR

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.reason).toContain('district-based governance');
      expect(result.source).toBe('https://www.portland.gov/bts/cgis/open-data-site');
      expect(result.councilSize).toBe(12);
      expect(result.districtSeats).toBe(12);
    });

    it('should attempt Layer 1 for district-based cities (Kansas City, MO)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('2938000'); // Kansas City, MO

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.reason).toContain('district-based governance');
      expect(result.districtSeats).toBe(6);
    });

    it('should attempt Layer 1 for district-based cities (Seattle, WA)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('5363000'); // Seattle, WA

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.districtSeats).toBe(7);
    });

    it('should attempt Layer 1 for district-based cities (Los Angeles, CA)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('0644000'); // Los Angeles, CA

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.districtSeats).toBe(15);
    });

    it('should attempt Layer 1 for district-based cities (New York, NY)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('3651000'); // New York, NY

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.districtSeats).toBe(51);
    });

    it('should attempt Layer 1 for district-based cities (Chicago, IL)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('1714000'); // Chicago, IL

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.districtSeats).toBe(50);
    });

    it('should attempt Layer 1 for district-based cities (Austin, TX)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('4805000'); // Austin, TX

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.districtSeats).toBe(10);
    });

    it('should attempt Layer 1 for district-based cities (San Francisco, CA)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('0667000'); // San Francisco, CA

      expect(result.structure).toBe('district-based');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.districtSeats).toBe(11);
    });

    it('should attempt Layer 1 for unknown cities (graceful degradation)', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('9999999'); // Unknown FIPS

      expect(result.structure).toBe('unknown');
      expect(result.shouldAttemptLayer1).toBe(true);
      expect(result.reason).toContain('attempting discovery');
      expect(result.reason).toContain('graceful degradation');
      expect(result.source).toBeUndefined();
    });

    it('should provide consistent results for same city (idempotent)', async () => {
      const validator = new GovernanceValidator();
      const result1 = await validator.checkGovernance('0803000'); // Boulder
      const result2 = await validator.checkGovernance('0803000'); // Boulder

      expect(result1).toEqual(result2);
    });
  });

  describe('validateDiscoveredDistricts()', () => {
    it('should accept valid district count for Portland (12 districts)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('4159000', 12);

      expect(validation.valid).toBe(true);
      expect(validation.reason).toContain('matches registry');
      expect(validation.expectedCount).toBe(12);
      expect(validation.discoveredCount).toBe(12);
    });

    it('should accept valid district count for Kansas City (6 districts)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('2938000', 6);

      expect(validation.valid).toBe(true);
      expect(validation.expectedCount).toBe(6);
      expect(validation.discoveredCount).toBe(6);
    });

    it('should accept valid district count for Seattle (7 districts)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('5363000', 7);

      expect(validation.valid).toBe(true);
      expect(validation.expectedCount).toBe(7);
      expect(validation.discoveredCount).toBe(7);
    });

    it('should reject mismatched district count (Portland with wrong count)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('4159000', 6); // Should be 12

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('12 district seats');
      expect(validation.reason).toContain('discovered 6');
      expect(validation.expectedCount).toBe(12);
      expect(validation.discoveredCount).toBe(6);
    });

    it('should reject mismatched district count (Seattle with wrong count)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('5363000', 9); // Should be 7

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('7 district seats');
      expect(validation.reason).toContain('discovered 9');
    });

    it('should reject districts discovered for at-large cities (Boulder)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('0803000', 5); // Boulder is at-large

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('at-large governance');
      expect(validation.reason).toContain('discovered 5 districts');
      expect(validation.expectedCount).toBe(0);
      expect(validation.discoveredCount).toBe(5);
    });

    it('should reject districts discovered for at-large cities (Ann Arbor)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('2603000', 3); // Ann Arbor is at-large

      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('at-large governance');
    });

    it('should accept discovered districts for unknown cities (no registry)', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('9999999', 8); // Unknown city

      expect(validation.valid).toBe(true);
      expect(validation.reason).toContain('No registry entry');
      expect(validation.discoveredCount).toBe(8);
      expect(validation.expectedCount).toBeUndefined();
    });

    it('should handle zero discovered districts', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('4159000', 0); // Portland should have 12

      expect(validation.valid).toBe(false);
      expect(validation.discoveredCount).toBe(0);
    });
  });

  describe('getGovernanceMetadata()', () => {
    it('should return full metadata for registered cities', () => {
      const validator = new GovernanceValidator();
      const metadata = validator.getGovernanceMetadata('4159000'); // Portland

      expect(metadata).not.toBeNull();
      expect(metadata?.cityFips).toBe('4159000');
      expect(metadata?.cityName).toBe('Portland');
      expect(metadata?.state).toBe('OR');
      expect(metadata?.structure).toBe('district-based');
      expect(metadata?.councilSize).toBe(12);
      expect(metadata?.source).toBe('https://www.portland.gov/bts/cgis/open-data-site');
      expect(metadata?.lastVerified).toBe('2025-11-18');
    });

    it('should return null for unregistered cities', () => {
      const validator = new GovernanceValidator();
      const metadata = validator.getGovernanceMetadata('9999999'); // Unknown

      expect(metadata).toBeNull();
    });
  });

  describe('isConfirmedAtLarge()', () => {
    it('should return true for confirmed at-large cities', () => {
      const validator = new GovernanceValidator();

      expect(validator.isConfirmedAtLarge('0803000')).toBe(true); // Boulder
      expect(validator.isConfirmedAtLarge('2603000')).toBe(true); // Ann Arbor
    });

    it('should return false for district-based cities', () => {
      const validator = new GovernanceValidator();

      expect(validator.isConfirmedAtLarge('4159000')).toBe(false); // Portland
      expect(validator.isConfirmedAtLarge('2938000')).toBe(false); // Kansas City
    });

    it('should return false for unknown cities', () => {
      const validator = new GovernanceValidator();

      expect(validator.isConfirmedAtLarge('9999999')).toBe(false);
    });
  });

  describe('isConfirmedDistrictBased()', () => {
    it('should return true for confirmed district-based cities', () => {
      const validator = new GovernanceValidator();

      expect(validator.isConfirmedDistrictBased('4159000')).toBe(true); // Portland
      expect(validator.isConfirmedDistrictBased('2938000')).toBe(true); // Kansas City
      expect(validator.isConfirmedDistrictBased('5363000')).toBe(true); // Seattle
      expect(validator.isConfirmedDistrictBased('0667000')).toBe(true); // San Francisco
    });

    it('should return false for at-large cities', () => {
      const validator = new GovernanceValidator();

      expect(validator.isConfirmedDistrictBased('0803000')).toBe(false); // Boulder
      expect(validator.isConfirmedDistrictBased('2603000')).toBe(false); // Ann Arbor
    });

    it('should return false for unknown cities', () => {
      const validator = new GovernanceValidator();

      expect(validator.isConfirmedDistrictBased('9999999')).toBe(false);
    });
  });

  describe('Zero False Positives Policy', () => {
    it('CRITICAL: should NEVER skip Layer 1 for district-based cities', async () => {
      const validator = new GovernanceValidator();

      // Test all district-based cities in registry
      const districtBasedFips = [
        '4159000', // Portland
        '2938000', // Kansas City
        '5363000', // Seattle
        '0644000', // Los Angeles
        '3651000', // New York
        '1714000', // Chicago
        '4805000', // Austin
        '0667000', // San Francisco
      ];

      for (const fips of districtBasedFips) {
        const result = await validator.checkGovernance(fips);
        expect(result.shouldAttemptLayer1).toBe(true);
      }
    });

    it('CRITICAL: should ALWAYS attempt Layer 1 for unknown cities', async () => {
      const validator = new GovernanceValidator();

      // Test various unknown FIPS codes
      const unknownFips = [
        '9999999',
        '0000000',
        '1234567',
        '9876543',
      ];

      for (const fips of unknownFips) {
        const result = await validator.checkGovernance(fips);
        expect(result.shouldAttemptLayer1).toBe(true);
        expect(result.structure).toBe('unknown');
      }
    });

    it('CRITICAL: should ONLY skip Layer 1 for confirmed at-large cities', async () => {
      const validator = new GovernanceValidator();

      // Only these cities should be skipped
      const atLargeFips = [
        '0803000', // Boulder
        '2603000', // Ann Arbor
      ];

      for (const fips of atLargeFips) {
        const result = await validator.checkGovernance(fips);
        expect(result.shouldAttemptLayer1).toBe(false);
        expect(result.structure).toBe('at-large');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty FIPS code', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('');

      expect(result.structure).toBe('unknown');
      expect(result.shouldAttemptLayer1).toBe(true);
    });

    it('should handle malformed FIPS code', async () => {
      const validator = new GovernanceValidator();
      const result = await validator.checkGovernance('abc123xyz');

      expect(result.structure).toBe('unknown');
      expect(result.shouldAttemptLayer1).toBe(true);
    });

    it('should handle negative district counts in validation', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('4159000', -1);

      expect(validation.valid).toBe(false);
      expect(validation.discoveredCount).toBe(-1);
    });

    it('should handle extremely large district counts in validation', () => {
      const validator = new GovernanceValidator();
      const validation = validator.validateDiscoveredDistricts('4159000', 999);

      expect(validation.valid).toBe(false);
      expect(validation.discoveredCount).toBe(999);
    });
  });

  describe('Performance', () => {
    it('should complete governance check in <1ms (in-memory lookup)', async () => {
      const validator = new GovernanceValidator();
      const start = performance.now();

      await validator.checkGovernance('4159000');

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1); // <1ms for hash table lookup
    });

    it('should complete validation in <1ms', () => {
      const validator = new GovernanceValidator();
      const start = performance.now();

      validator.validateDiscoveredDistricts('4159000', 12);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1);
    });

    it('should handle 1000 checks in <100ms', async () => {
      const validator = new GovernanceValidator();
      const start = performance.now();

      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(validator.checkGovernance('4159000'));
      }

      await Promise.all(promises);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });
});
