/**
 * Redistricting Gap Detector Tests - WP-FRESHNESS-5
 *
 * Tests for detecting redistricting gap periods where TIGER is guaranteed stale.
 * Verifies cycle detection, state finalization tracking, and gap recommendations.
 */

import { describe, it, expect } from 'vitest';
import {
  RedistrictingGapDetector,
  gapDetector,
  type GapBoundaryType,
  type GapStatus,
  type StateGapInfo,
} from './gap-detector.js';

describe('RedistrictingGapDetector', () => {
  const detector = new RedistrictingGapDetector();

  describe('isInGap', () => {
    it('should return true during Jan-Jun 2022', () => {
      expect(detector.isInGap(new Date('2022-01-15'))).toBe(true);
      expect(detector.isInGap(new Date('2022-03-15'))).toBe(true);
      expect(detector.isInGap(new Date('2022-06-30'))).toBe(true);
    });

    it('should return false after July 2022', () => {
      expect(detector.isInGap(new Date('2022-07-01'))).toBe(false);
      expect(detector.isInGap(new Date('2022-09-15'))).toBe(false);
      expect(detector.isInGap(new Date('2022-12-15'))).toBe(false);
    });

    it('should return false before Jan 2022', () => {
      expect(detector.isInGap(new Date('2021-12-31'))).toBe(false);
      expect(detector.isInGap(new Date('2021-09-15'))).toBe(false);
    });

    it('should return true during Jan-Jun 2032 (future cycle)', () => {
      expect(detector.isInGap(new Date('2032-02-15'))).toBe(true);
      expect(detector.isInGap(new Date('2032-05-15'))).toBe(true);
    });

    it('should return false during 2031 (first redistricting year)', () => {
      // 2031 is finalization year, not gap period
      expect(detector.isInGap(new Date('2031-03-15'))).toBe(false);
      expect(detector.isInGap(new Date('2031-10-15'))).toBe(false);
    });

    it('should return false in non-redistricting years', () => {
      expect(detector.isInGap(new Date('2023-03-15'))).toBe(false);
      expect(detector.isInGap(new Date('2025-01-15'))).toBe(false);
      expect(detector.isInGap(new Date('2028-06-15'))).toBe(false);
    });

    it('should return true during Jan-Jun 2042 (far future cycle)', () => {
      expect(detector.isInGap(new Date('2042-04-15'))).toBe(true);
    });
  });

  describe('getCurrentCycle', () => {
    it('should return 2020 cycle info during 2021', () => {
      const cycle = detector.getCurrentCycle(new Date('2021-06-15'));
      expect(cycle).not.toBeNull();
      expect(cycle?.cycleYear).toBe(2020);
      expect(cycle?.redistrictingYears).toEqual([2021, 2022]);
    });

    it('should return 2020 cycle info during 2022', () => {
      const cycle = detector.getCurrentCycle(new Date('2022-06-15'));
      expect(cycle).not.toBeNull();
      expect(cycle?.cycleYear).toBe(2020);
    });

    it('should return null during non-redistricting years', () => {
      expect(detector.getCurrentCycle(new Date('2023-06-15'))).toBeNull();
      expect(detector.getCurrentCycle(new Date('2025-01-15'))).toBeNull();
      expect(detector.getCurrentCycle(new Date('2029-12-31'))).toBeNull();
    });

    it('should return 2030 cycle info during 2031-2032', () => {
      const cycle2031 = detector.getCurrentCycle(new Date('2031-03-15'));
      expect(cycle2031).not.toBeNull();
      expect(cycle2031?.cycleYear).toBe(2030);

      const cycle2032 = detector.getCurrentCycle(new Date('2032-03-15'));
      expect(cycle2032).not.toBeNull();
      expect(cycle2032?.cycleYear).toBe(2030);
    });

    it('should have correct gap period dates', () => {
      const cycle = detector.getCurrentCycle(new Date('2022-03-15'));
      expect(cycle).not.toBeNull();
      expect(cycle?.gapPeriodStart.getUTCFullYear()).toBe(2022);
      expect(cycle?.gapPeriodStart.getUTCMonth()).toBe(0); // January
      expect(cycle?.gapPeriodEnd.getUTCFullYear()).toBe(2022);
      expect(cycle?.gapPeriodEnd.getUTCMonth()).toBe(6); // July
    });
  });

  describe('checkBoundaryGap - non-legislative boundaries', () => {
    const nonLegislative: GapBoundaryType[] = [
      'county',
      'place',
      'city_council',
      'school_unified',
      'voting_precinct',
      'special_district',
    ];

    it.each(nonLegislative)(
      'should return use-tiger for %s even during gap period',
      (boundaryType) => {
        const status = detector.checkBoundaryGap(
          boundaryType,
          'CA',
          new Date('2022-03-15')
        );
        expect(status.inGap).toBe(false);
        expect(status.gapType).toBe('none');
        expect(status.recommendation).toBe('use-tiger');
        expect(status.reasoning).toContain('not affected by redistricting');
      }
    );
  });

  describe('checkBoundaryGap - legislative boundaries', () => {
    const legislative: GapBoundaryType[] = [
      'congressional',
      'state_senate',
      'state_house',
    ];

    it.each(legislative)(
      'should detect gap for %s during gap period',
      (boundaryType) => {
        const status = detector.checkBoundaryGap(
          boundaryType,
          'CA',
          new Date('2022-03-15')
        );
        expect(status.inGap).toBe(true);
        expect(status.gapType).toBe('post-finalization-pre-tiger');
        expect(status.recommendation).toBe('use-primary');
      }
    );

    it('should return use-tiger for non-redistricting years', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'CA',
        new Date('2023-03-15')
      );
      expect(status.inGap).toBe(false);
      expect(status.gapType).toBe('none');
      expect(status.recommendation).toBe('use-tiger');
      expect(status.reasoning).toContain('Not a redistricting year');
    });
  });

  describe('checkBoundaryGap - California', () => {
    it('should return gap status during gap period', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'CA',
        new Date('2022-03-15')
      );
      expect(status.inGap).toBe(true);
      expect(status.recommendation).toBe('use-primary');
      expect(status.finalizationInfo).toBeDefined();
      expect(status.finalizationInfo?.stateCode).toBe('CA');
      // Reasoning uses state code "CA", finalizationInfo has full name
      expect(status.reasoning).toContain('CA');
      expect(status.finalizationInfo?.state).toBe('California');
    });

    it('should return use-tiger after July update', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'CA',
        new Date('2022-09-15')
      );
      expect(status.inGap).toBe(false);
      expect(status.gapType).toBe('post-tiger');
      expect(status.recommendation).toBe('use-tiger');
      expect(status.reasoning).toContain('TIGER updated');
    });

    it('should have correct finalization dates', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'CA',
        new Date('2022-03-15')
      );
      expect(status.finalizationInfo?.finalizedDate.getUTCFullYear()).toBe(
        2021
      );
      expect(status.finalizationInfo?.courtChallenges).toBe(false);
    });
  });

  describe('checkBoundaryGap - Texas', () => {
    it('should have court challenges noted', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'TX',
        new Date('2022-03-15')
      );
      expect(status.finalizationInfo?.courtChallenges).toBe(true);
      expect(status.finalizationInfo?.notes).toContain('Voting Rights Act');
    });
  });

  describe('checkBoundaryGap - New York (late finalization)', () => {
    it('should handle late finalization correctly', () => {
      // NY finalized Feb 2022, effective June 28, 2022
      const preEffective = detector.checkBoundaryGap(
        'congressional',
        'NY',
        new Date('2022-03-15')
      );
      expect(preEffective.inGap).toBe(false);
      expect(preEffective.gapType).toBe('pre-finalization');
      expect(preEffective.recommendation).toBe('use-tiger');
      expect(preEffective.reasoning).toContain('not yet effective');
    });

    it('should detect gap after effective date', () => {
      const postEffective = detector.checkBoundaryGap(
        'congressional',
        'NY',
        new Date('2022-06-29')
      );
      expect(postEffective.inGap).toBe(true);
      expect(postEffective.gapType).toBe('post-finalization-pre-tiger');
      expect(postEffective.recommendation).toBe('use-primary');
    });
  });

  describe('checkBoundaryGap - unknown state', () => {
    it('should return pre-finalization for unknown states during redistricting', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'ZZ',
        new Date('2022-03-15')
      );
      expect(status.inGap).toBe(false);
      expect(status.gapType).toBe('pre-finalization');
      expect(status.recommendation).toBe('use-tiger');
      expect(status.reasoning).toContain('not yet finalized');
    });
  });

  describe('getStatesInGap', () => {
    it('should return states in gap during gap period', () => {
      const states = detector.getStatesInGap(new Date('2022-03-15'));
      expect(states.length).toBeGreaterThan(0);

      // California should be in the list
      const ca = states.find((s) => s.stateCode === 'CA');
      expect(ca).toBeDefined();
      expect(ca?.gapDays).toBeGreaterThan(0);
    });

    it('should return empty array outside gap period', () => {
      const states = detector.getStatesInGap(new Date('2023-03-15'));
      expect(states).toEqual([]);
    });

    it('should sort by gap duration (longest first)', () => {
      const states = detector.getStatesInGap(new Date('2022-06-01'));

      // States with Jan 1 effective date should have longer gaps
      // than states with later effective dates
      for (let i = 1; i < states.length; i++) {
        expect(states[i - 1].gapDays).toBeGreaterThanOrEqual(states[i].gapDays);
      }
    });

    it('should not include states before their effective date', () => {
      // NY effective June 28, check on March 15
      const states = detector.getStatesInGap(new Date('2022-03-15'));
      const ny = states.find((s) => s.stateCode === 'NY');
      expect(ny).toBeUndefined(); // NY not yet effective
    });

    it('should include NY after its effective date', () => {
      const states = detector.getStatesInGap(new Date('2022-06-29'));
      const ny = states.find((s) => s.stateCode === 'NY');
      expect(ny).toBeDefined();
      expect(ny?.gapDays).toBe(1); // 1 day after June 28
    });
  });

  describe('getFinalizationDates', () => {
    it('should return 2020 cycle finalization data', () => {
      const dates = detector.getFinalizationDates(2020);
      expect(dates.size).toBeGreaterThan(0);
      expect(dates.has('CA')).toBe(true);
      expect(dates.has('TX')).toBe(true);
      expect(dates.has('NY')).toBe(true);
    });

    it('should return empty map for future cycles', () => {
      const dates2030 = detector.getFinalizationDates(2030);
      expect(dates2030.size).toBe(0);

      const dates2040 = detector.getFinalizationDates(2040);
      expect(dates2040.size).toBe(0);
    });

    it('should have complete finalization info', () => {
      const dates = detector.getFinalizationDates(2020);
      const ca = dates.get('CA');

      expect(ca).toBeDefined();
      expect(ca?.state).toBe('California');
      expect(ca?.stateCode).toBe('CA');
      expect(ca?.finalizedDate).toBeInstanceOf(Date);
      expect(ca?.effectiveDate).toBeInstanceOf(Date);
      expect(typeof ca?.courtChallenges).toBe('boolean');
    });
  });

  describe('Default instance', () => {
    it('should work the same as new instance', () => {
      const newDetector = new RedistrictingGapDetector();
      const date = new Date('2022-03-15');

      expect(gapDetector.isInGap(date)).toBe(newDetector.isInGap(date));

      const status1 = gapDetector.checkBoundaryGap('congressional', 'CA', date);
      const status2 = newDetector.checkBoundaryGap(
        'congressional',
        'CA',
        date
      );
      expect(status1.inGap).toBe(status2.inGap);
      expect(status1.recommendation).toBe(status2.recommendation);
    });
  });

  describe('Edge cases', () => {
    it('should handle exact gap start boundary', () => {
      const exactStart = new Date('2022-01-01T00:00:00Z');
      expect(detector.isInGap(exactStart)).toBe(true);
    });

    it('should handle exact gap end boundary', () => {
      const exactEnd = new Date('2022-07-01T00:00:00Z');
      expect(detector.isInGap(exactEnd)).toBe(false);
    });

    it('should handle last moment of gap period', () => {
      const lastMoment = new Date('2022-06-30T23:59:59Z');
      expect(detector.isInGap(lastMoment)).toBe(true);
    });

    it('should handle case-sensitive state codes', () => {
      // Should only match uppercase codes
      const upperCase = detector.checkBoundaryGap(
        'congressional',
        'CA',
        new Date('2022-03-15')
      );
      expect(upperCase.finalizationInfo).toBeDefined();

      const lowerCase = detector.checkBoundaryGap(
        'congressional',
        'ca',
        new Date('2022-03-15')
      );
      expect(lowerCase.finalizationInfo).toBeUndefined();
    });
  });

  describe('Historical accuracy', () => {
    it('should have accurate CA finalization date', () => {
      const dates = detector.getFinalizationDates(2020);
      const ca = dates.get('CA');
      // CA Citizens Redistricting Commission finalized Dec 20, 2021
      expect(ca?.finalizedDate.getUTCFullYear()).toBe(2021);
      expect(ca?.finalizedDate.getUTCMonth()).toBe(11); // December
    });

    it('should track court-challenged states', () => {
      const dates = detector.getFinalizationDates(2020);

      // States known to have had court challenges
      expect(dates.get('TX')?.courtChallenges).toBe(true);
      expect(dates.get('NY')?.courtChallenges).toBe(true);
      expect(dates.get('PA')?.courtChallenges).toBe(true);
      expect(dates.get('OH')?.courtChallenges).toBe(true);
      expect(dates.get('NC')?.courtChallenges).toBe(true);

      // States without significant court challenges
      expect(dates.get('CA')?.courtChallenges).toBe(false);
      expect(dates.get('CO')?.courtChallenges).toBe(false);
      expect(dates.get('OR')?.courtChallenges).toBe(false);
    });

    it('should have reasonable number of tracked states', () => {
      const dates = detector.getFinalizationDates(2020);
      // Should track most states with significant redistricting
      expect(dates.size).toBeGreaterThanOrEqual(20);
    });
  });

  describe('Gap duration calculations', () => {
    it('should calculate correct gap days for CA on March 15', () => {
      // CA effective Jan 1, 2022
      // March 15 = 73 days later (Jan has 31, Feb has 28, plus 15)
      const states = detector.getStatesInGap(new Date('2022-03-15'));
      const ca = states.find((s) => s.stateCode === 'CA');
      expect(ca?.gapDays).toBe(73);
    });

    it('should calculate correct gap days for late-finalizing states', () => {
      // FL effective April 22, 2022
      // May 1 = 9 days later
      const states = detector.getStatesInGap(new Date('2022-05-01'));
      const fl = states.find((s) => s.stateCode === 'FL');
      expect(fl?.gapDays).toBe(9);
    });
  });

  describe('Recommendations include context', () => {
    it('should include state name in recommendation', () => {
      const states = detector.getStatesInGap(new Date('2022-03-15'));
      const ca = states.find((s) => s.stateCode === 'CA');
      expect(ca?.recommendation).toContain('California');
    });

    it('should include staleness duration in recommendation', () => {
      const states = detector.getStatesInGap(new Date('2022-03-15'));
      const ca = states.find((s) => s.stateCode === 'CA');
      expect(ca?.recommendation).toContain('stale');
    });

    it('should include TIGER update date in reasoning', () => {
      const status = detector.checkBoundaryGap(
        'congressional',
        'CA',
        new Date('2022-03-15')
      );
      expect(status.reasoning).toContain('2022-07-15');
    });
  });
});
