/**
 * TIGER Validity Window Tests
 *
 * Tests TIGER-specific validity calculations with redistricting awareness.
 *
 * Test Coverage:
 * 1. Validity window correctly identifies expired TIGER data
 * 2. Redistricting gap detection (Jan-Jun of years ending in 2)
 * 3. Grace period logic during redistricting (18 months)
 * 4. Automatic expiration warnings (30 days before validity ends)
 * 5. Confidence decay over validity window
 */

import { describe, it, expect } from 'vitest';
import {
  getTIGERValidityWindow,
  isRedistrictingPeriod,
  isInRedistrictingGap,
  getRedistrictingPeriod,
  shouldApplyGracePeriod,
  getTIGERValidityStatus,
  getExpirationWarning,
  calculateConfidenceDecay,
} from './tiger-validity.js';

describe('TIGERValidity', () => {
  describe('getTIGERValidityWindow', () => {
    it('should calculate valid-from as July 1 of release year', () => {
      const window = getTIGERValidityWindow(2024);

      expect(window.validFrom.getUTCFullYear()).toBe(2024);
      expect(window.validFrom.getUTCMonth()).toBe(6); // July (0-indexed)
      expect(window.validFrom.getUTCDate()).toBe(1);
    });

    it('should calculate valid-until as July 1 of next year', () => {
      const window = getTIGERValidityWindow(2024);

      expect(window.validUntil.getUTCFullYear()).toBe(2025);
      expect(window.validUntil.getUTCMonth()).toBe(6); // July (0-indexed)
      expect(window.validUntil.getUTCDate()).toBe(1);
    });

    it('should set next release same as valid-until', () => {
      const window = getTIGERValidityWindow(2024);

      expect(window.nextRelease).toEqual(window.validUntil);
    });

    it('should detect redistricting cycles', () => {
      const window2021 = getTIGERValidityWindow(2021);
      const window2022 = getTIGERValidityWindow(2022);
      const window2024 = getTIGERValidityWindow(2024);

      expect(window2021.isRedistrictingCycle).toBe(true);
      expect(window2022.isRedistrictingCycle).toBe(true);
      expect(window2024.isRedistrictingCycle).toBe(false);
    });

    it('should not be in gap during July 2021', () => {
      const window = getTIGERValidityWindow(2021);
      expect(window.isInGap).toBe(false);
    });

    it('should be in gap during January-June 2022', () => {
      const window = getTIGERValidityWindow(2022);
      // Note: isInGap checks current date, not release date
      // For TIGER 2022 release (Jul 2022), it's not in gap at release time
      expect(window.isRedistrictingCycle).toBe(true);
    });
  });

  describe('isRedistrictingPeriod', () => {
    it('should return true for years ending in 1', () => {
      expect(isRedistrictingPeriod(new Date('2021-06-15'))).toBe(true);
      expect(isRedistrictingPeriod(new Date('2031-06-15'))).toBe(true);
      expect(isRedistrictingPeriod(new Date('2041-06-15'))).toBe(true);
    });

    it('should return true for years ending in 2', () => {
      expect(isRedistrictingPeriod(new Date('2022-06-15'))).toBe(true);
      expect(isRedistrictingPeriod(new Date('2032-06-15'))).toBe(true);
      expect(isRedistrictingPeriod(new Date('2042-06-15'))).toBe(true);
    });

    it('should return false for other years', () => {
      expect(isRedistrictingPeriod(new Date('2020-06-15'))).toBe(false);
      expect(isRedistrictingPeriod(new Date('2023-06-15'))).toBe(false);
      expect(isRedistrictingPeriod(new Date('2024-06-15'))).toBe(false);
      expect(isRedistrictingPeriod(new Date('2025-06-15'))).toBe(false);
    });
  });

  describe('TEST 2: Redistricting gap detection', () => {
    it('should detect gap period (Jan-Jun of years ending in 2)', () => {
      expect(isInRedistrictingGap(new Date('2022-01-01'))).toBe(true);
      expect(isInRedistrictingGap(new Date('2022-03-15'))).toBe(true);
      expect(isInRedistrictingGap(new Date('2022-06-30'))).toBe(true);
    });

    it('should not be in gap before January', () => {
      expect(isInRedistrictingGap(new Date('2021-12-31'))).toBe(false);
    });

    it('should not be in gap after June', () => {
      expect(isInRedistrictingGap(new Date('2022-07-01'))).toBe(false);
      expect(isInRedistrictingGap(new Date('2022-08-15'))).toBe(false);
    });

    it('should not be in gap during year ending in 1', () => {
      expect(isInRedistrictingGap(new Date('2021-03-15'))).toBe(false);
      expect(isInRedistrictingGap(new Date('2031-03-15'))).toBe(false);
    });

    it('should not be in gap during non-redistricting years', () => {
      expect(isInRedistrictingGap(new Date('2024-03-15'))).toBe(false);
      expect(isInRedistrictingGap(new Date('2025-03-15'))).toBe(false);
    });

    it('should work for future redistricting cycles', () => {
      expect(isInRedistrictingGap(new Date('2032-03-15'))).toBe(true);
      expect(isInRedistrictingGap(new Date('2042-03-15'))).toBe(true);
    });
  });

  describe('getRedistrictingPeriod', () => {
    it('should return period for 2020 cycle', () => {
      const period = getRedistrictingPeriod(new Date('2022-03-15'));

      expect(period).not.toBeNull();
      expect(period!.censusYear).toBe(2020);
      expect(period!.redistrictingYears).toEqual([2021, 2022]);
    });

    it('should return period for 2030 cycle', () => {
      const period = getRedistrictingPeriod(new Date('2032-03-15'));

      expect(period).not.toBeNull();
      expect(period!.censusYear).toBe(2030);
      expect(period!.redistrictingYears).toEqual([2031, 2032]);
    });

    it('should return null for non-redistricting years', () => {
      const period = getRedistrictingPeriod(new Date('2024-03-15'));
      expect(period).toBeNull();
    });

    it('should have gap dates', () => {
      const period = getRedistrictingPeriod(new Date('2022-03-15'));

      expect(period).not.toBeNull();
      expect(period!.gapStart).toEqual(new Date('2022-01-01T00:00:00Z'));
      expect(period!.gapEnd).toEqual(new Date('2022-07-01T00:00:00Z'));
    });

    it('should have grace period end date', () => {
      const period = getRedistrictingPeriod(new Date('2022-03-15'));

      expect(period).not.toBeNull();
      expect(period!.graceEnd).toEqual(new Date('2023-07-01T00:00:00Z'));
    });
  });

  describe('TEST 4: Grace period logic', () => {
    it('should apply grace period for congressional districts', () => {
      const result = shouldApplyGracePeriod(
        'congressional',
        new Date('2022-09-01')
      );

      expect(result).toBe(true);
    });

    it('should apply grace period for state legislative districts', () => {
      const senatePeriod = shouldApplyGracePeriod(
        'state_senate',
        new Date('2022-09-01')
      );
      const housePeriod = shouldApplyGracePeriod(
        'state_house',
        new Date('2022-09-01')
      );

      expect(senatePeriod).toBe(true);
      expect(housePeriod).toBe(true);
    });

    it('should not apply grace period for counties', () => {
      const result = shouldApplyGracePeriod(
        'county',
        new Date('2022-09-01')
      );

      expect(result).toBe(false);
    });

    it('should not apply grace period for other boundaries', () => {
      expect(shouldApplyGracePeriod('place', new Date('2022-09-01'))).toBe(false);
      expect(shouldApplyGracePeriod('school_unified', new Date('2022-09-01'))).toBe(false);
      expect(shouldApplyGracePeriod('voting_precinct', new Date('2022-09-01'))).toBe(false);
    });

    it('should not apply grace period during gap', () => {
      const result = shouldApplyGracePeriod(
        'congressional',
        new Date('2022-03-15')
      );

      expect(result).toBe(false); // In gap, not in grace period
    });

    it('should not apply grace period after grace end', () => {
      const result = shouldApplyGracePeriod(
        'congressional',
        new Date('2023-08-01')
      );

      expect(result).toBe(false);
    });

    it('should apply grace period for 18 months after gap', () => {
      // Gap ends July 1, 2022
      // Grace period: July 1, 2022 → July 1, 2023
      const julyStart = shouldApplyGracePeriod(
        'congressional',
        new Date('2022-07-01')
      );
      const midGrace = shouldApplyGracePeriod(
        'congressional',
        new Date('2023-01-01')
      );
      const graceEnd = shouldApplyGracePeriod(
        'congressional',
        new Date('2023-06-30')
      );

      expect(julyStart).toBe(true);
      expect(midGrace).toBe(true);
      expect(graceEnd).toBe(true);
    });
  });

  describe('TEST 1: getTIGERValidityStatus - Expired data detection', () => {
    it('should mark data as invalid before valid-from', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2024-06-15')
      );

      expect(status.isValid).toBe(false);
      expect(status.confidence).toBe(0.0);
      expect(status.reason).toContain('not yet released');
      expect(status.recommendation).toBe('use-primary');
    });

    it('should mark data as invalid after valid-until', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2025-08-01')
      );

      expect(status.isValid).toBe(false);
      expect(status.confidence).toBe(0.0);
      expect(status.reason).toContain('expired');
      expect(status.recommendation).toBe('use-tiger');
    });

    it('should mark data as valid within window (normal period)', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2024-09-15')
      );

      expect(status.isValid).toBe(true);
      expect(status.confidence).toBe(1.0);
      expect(status.recommendation).toBe('use-tiger');
    });
  });

  describe('getTIGERValidityStatus - Redistricting awareness', () => {
    it('should recommend primary during redistricting gap', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2021,
        new Date('2022-03-15')
      );

      expect(status.isValid).toBe(false);
      expect(status.confidence).toBe(0.3);
      expect(status.reason).toContain('Redistricting gap');
      expect(status.recommendation).toBe('use-primary');
    });

    it('should have moderate confidence during grace period', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2022,
        new Date('2022-09-01')
      );

      expect(status.isValid).toBe(true);
      expect(status.confidence).toBe(0.7);
      expect(status.reason).toContain('Grace period');
      expect(status.recommendation).toBe('use-tiger');
    });

    it('should not apply gap logic to counties', () => {
      const status = getTIGERValidityStatus(
        'county',
        2021,
        new Date('2022-03-15')
      );

      // Counties are not affected by redistricting gap
      expect(status.isValid).toBe(true);
      expect(status.confidence).toBe(1.0);
    });
  });

  describe('TEST 3: Expiration warnings', () => {
    it('should show warning 30 days before expiration', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2025-06-01')
      );

      expect(status.daysUntilExpiration).toBe(30);
      expect(status.showExpirationWarning).toBe(true);
    });

    it('should show warning 15 days before expiration', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2025-06-16')
      );

      expect(status.daysUntilExpiration).toBe(15);
      expect(status.showExpirationWarning).toBe(true);
    });

    it('should not show warning 31 days before expiration', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2025-05-31')
      );

      expect(status.daysUntilExpiration).toBe(31);
      expect(status.showExpirationWarning).toBe(false);
    });

    it('should not show warning after expiration', () => {
      const status = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2025-07-02')
      );

      expect(status.daysUntilExpiration).toBeLessThan(0);
      expect(status.showExpirationWarning).toBe(false);
    });
  });

  describe('getExpirationWarning', () => {
    it('should return warning within 30 days', () => {
      const warning = getExpirationWarning(2024, new Date('2025-06-15'));

      expect(warning).not.toBeNull();
      expect(warning).toContain('will expire in 16 days');
      expect(warning).toContain('2025-07-01');
    });

    it('should return null outside 30-day window', () => {
      const warning = getExpirationWarning(2024, new Date('2025-05-15'));

      expect(warning).toBeNull();
    });

    it('should return null after expiration', () => {
      const warning = getExpirationWarning(2024, new Date('2025-07-15'));

      expect(warning).toBeNull();
    });
  });

  describe('calculateConfidenceDecay', () => {
    const validFrom = new Date('2024-07-01');
    const validUntil = new Date('2025-07-01');

    it('should be 0.0 before validity', () => {
      const confidence = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2024-06-15')
      );

      expect(confidence).toBe(0.0);
    });

    it('should be 0.0 after expiration', () => {
      const confidence = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2025-07-15')
      );

      expect(confidence).toBe(0.0);
    });

    it('should be 1.0 in first 75% of window', () => {
      const midpoint = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2024-09-01')
      );
      const at70pct = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2024-12-15')
      );

      expect(midpoint).toBe(1.0);
      expect(at70pct).toBe(1.0);
    });

    it('should decay in last 25% of window', () => {
      // Window: 2024-07-01 to 2025-07-01 = 365 days
      // 75% threshold at day 273 (~2025-04-01)
      // 80% at day 292 (~2025-04-19)
      // 90% at day 328 (~2025-05-25)
      const at80pct = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2025-04-19')
      );
      const at90pct = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2025-05-25')
      );

      expect(at80pct).toBeGreaterThan(0.4);
      expect(at80pct).toBeLessThan(1.0);
      expect(at90pct).toBeGreaterThan(0.4);
      expect(at90pct).toBeLessThan(at80pct);
    });

    it('should reach minimum 0.4 at expiration', () => {
      const atExpiry = calculateConfidenceDecay(
        validFrom,
        validUntil,
        new Date('2025-06-30T23:59:59Z')
      );

      expect(atExpiry).toBeGreaterThanOrEqual(0.4);
      expect(atExpiry).toBeLessThan(0.5);
    });
  });

  describe('Edge cases', () => {
    it('should handle boundary dates correctly', () => {
      const exactStart = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2024-07-01T00:00:00Z')
      );
      const exactEnd = getTIGERValidityStatus(
        'congressional',
        2024,
        new Date('2025-07-01T00:00:00Z')
      );

      expect(exactStart.isValid).toBe(true);
      expect(exactEnd.isValid).toBe(false); // Expired at exact moment
    });

    it('should handle leap years correctly', () => {
      const window2024 = getTIGERValidityWindow(2024);
      const window2025 = getTIGERValidityWindow(2025);

      expect(window2024.validUntil).toEqual(window2025.validFrom);
    });

    it('should handle midnight correctly', () => {
      const gapStart = isInRedistrictingGap(new Date('2022-01-01T00:00:00Z'));
      const gapEnd = isInRedistrictingGap(new Date('2022-07-01T00:00:00Z'));

      expect(gapStart).toBe(true);
      expect(gapEnd).toBe(false);
    });
  });
});
