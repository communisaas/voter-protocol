/**
 * DataValidator Report Export Tests
 *
 * Comprehensive test suite for multi-state report export functionality.
 *
 * TYPE SAFETY: Nuclear-level strictness. Zero `any`, zero `@ts-ignore`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataValidator } from '../../../services/data-validator.js';
import type { MultiStateValidationResult } from '../../../services/data-validator.types.js';

describe('DataValidator Report Export', () => {
  let validator: DataValidator;

  beforeEach(() => {
    validator = new DataValidator();
  });

  // ==========================================================================
  // Report Export Tests
  // ==========================================================================

  describe('exportMultiStateReport', () => {
    it('should export report in JSON format', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501', '5502', '5503', '5504', '5505', '5506', '5507', '5508'],
              invalidGeoids: [],
            },
          },
          {
            state: 'TX',
            stateName: 'Texas',
            layer: 'congressional',
            expected: 38,
            actual: 36,
            match: false,
            geoidValid: true,
            geometryValid: false,
            duration: 2000,
            details: {
              geoids: Array.from({ length: 36 }, (_, i) => `48${(i + 1).toString().padStart(2, '0')}`),
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 2,
          passed: 1,
          failed: 1,
          successRate: 0.5,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 3500,
      };

      const json = await validator.exportMultiStateReport(multiStateResult, 'json');

      // Should be valid JSON
      const parsed = JSON.parse(json);
      expect(parsed.generatedAt).toBeDefined();
      expect(parsed.reportVersion).toBe('1.0.0');
      expect(parsed.summary.totalStates).toBe(2);
      expect(parsed.summary.passedStates).toBe(1);
      expect(parsed.summary.failedStates).toBe(1);
      expect(parsed.summary.successRate).toBe(0.5);
      expect(parsed.states).toHaveLength(2);
      expect(parsed.recommendations).toBeInstanceOf(Array);
    });

    it('should export report in Markdown format', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501', '5502'],
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 1,
          passed: 1,
          failed: 0,
          successRate: 1.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 1500,
      };

      const markdown = await validator.exportMultiStateReport(multiStateResult, 'markdown');

      // Should contain markdown headers
      expect(markdown).toContain('# Multi-State Validation Report');
      expect(markdown).toContain('## Executive Summary');
      expect(markdown).toContain('## Recommendations');
      expect(markdown).toContain('## State Details');

      // Should contain state name
      expect(markdown).toContain('Wisconsin');

      // Should contain emoji status indicators
      expect(markdown).toContain('✅');

      // Should contain table headers
      expect(markdown).toContain('| Layer | Expected | Actual | Match | GEOID | Geometry | Duration |');

      // Should contain layer data
      expect(markdown).toContain('congressional');
      expect(markdown).toContain('1.5s');
    });

    it('should export report in CSV format', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501', '5502'],
              invalidGeoids: [],
            },
          },
          {
            state: 'TX',
            stateName: 'Texas',
            layer: 'state_senate',
            expected: 31,
            actual: 30,
            match: false,
            geoidValid: false,
            geometryValid: true,
            duration: 2000,
            details: {
              geoids: [],
              invalidGeoids: ['4800'],
            },
          },
        ],
        summary: {
          totalValidations: 2,
          passed: 1,
          failed: 1,
          successRate: 0.5,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 3500,
      };

      const csv = await validator.exportMultiStateReport(multiStateResult, 'csv');

      // Should have CSV header
      expect(csv).toContain('State,State Name,Layer,Expected,Actual,Match,GEOID Valid,Geometry Valid,Duration (ms),Issues');

      // Should have data rows
      expect(csv).toContain('WI,Wisconsin,congressional,8,8,TRUE,TRUE,TRUE,1500,None');
      expect(csv).toContain('TX,Texas,state_senate,31,30,FALSE,FALSE,TRUE,2000,');

      // Should not contain commas in issues field
      const lines = csv.split('\n');
      expect(lines.length).toBeGreaterThan(2); // Header + at least 2 rows
    });

    it('should generate recommendations for critical issues', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'TX',
            stateName: 'Texas',
            layer: 'congressional',
            expected: 38,
            actual: 30,
            match: false,
            geoidValid: false,
            geometryValid: false,
            duration: 2000,
            details: {
              geoids: [],
              invalidGeoids: ['4800', '4801'],
            },
          },
        ],
        summary: {
          totalValidations: 1,
          passed: 0,
          failed: 1,
          successRate: 0.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 2000,
      };

      const json = await validator.exportMultiStateReport(multiStateResult, 'json');
      const parsed = JSON.parse(json);

      // Should have critical recommendations
      expect(parsed.recommendations.some((r: string) => r.includes('CRITICAL'))).toBe(true);
      expect(parsed.recommendations.some((r: string) => r.includes('TX'))).toBe(true);
      expect(parsed.recommendations.some((r: string) => r.includes('<80%'))).toBe(true);
    });

    it('should generate success recommendations for high pass rate', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 1,
          passed: 1,
          failed: 0,
          successRate: 1.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 1500,
      };

      const json = await validator.exportMultiStateReport(multiStateResult, 'json');
      const parsed = JSON.parse(json);

      // Should have success recommendation
      expect(parsed.recommendations.some((r: string) => r.includes('>95%'))).toBe(true);
      expect(parsed.recommendations.some((r: string) => r.includes('excellent'))).toBe(true);
    });

    it('should handle multiple layers per state', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'state_senate',
            expected: 33,
            actual: 33,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 2000,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'state_house',
            expected: 99,
            actual: 99,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 2500,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 3,
          passed: 3,
          failed: 0,
          successRate: 1.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 6000,
      };

      const json = await validator.exportMultiStateReport(multiStateResult, 'json');
      const parsed = JSON.parse(json);

      // Should group all layers under Wisconsin
      expect(parsed.states).toHaveLength(1);
      expect(parsed.states[0].state).toBe('WI');
      expect(parsed.states[0].layers).toHaveLength(3);
      expect(parsed.summary.totalLayers).toBe(3);
    });
  });

  describe('saveReport', () => {
    it('should save report to file with markdown format', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 1,
          passed: 1,
          failed: 0,
          successRate: 1.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 1500,
      };

      const testDir = '.shadow-atlas/test-reports';
      const testFile = `${testDir}/test-report-${Date.now()}.md`;

      await validator.saveReport(multiStateResult, testFile, 'markdown');

      // Verify file was created
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(testFile, 'utf-8');

      expect(content).toContain('# Multi-State Validation Report');
      expect(content).toContain('Wisconsin');

      // Cleanup
      const { unlink } = await import('node:fs/promises');
      await unlink(testFile);
    });

    it('should infer format from file extension', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 1,
          passed: 1,
          failed: 0,
          successRate: 1.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 1500,
      };

      const testDir = '.shadow-atlas/test-reports';
      const jsonFile = `${testDir}/test-report-${Date.now()}.json`;

      // Should infer JSON format from .json extension
      await validator.saveReport(multiStateResult, jsonFile);

      const { readFile } = await import('node:fs/promises');
      const content = await readFile(jsonFile, 'utf-8');

      // Should be valid JSON
      const parsed = JSON.parse(content);
      expect(parsed.reportVersion).toBe('1.0.0');

      // Cleanup
      const { unlink } = await import('node:fs/promises');
      await unlink(jsonFile);
    });

    it('should save CSV format correctly', async () => {
      const multiStateResult: MultiStateValidationResult = {
        states: [
          {
            state: 'WI',
            stateName: 'Wisconsin',
            layer: 'congressional',
            expected: 8,
            actual: 8,
            match: true,
            geoidValid: true,
            geometryValid: true,
            duration: 1500,
            details: {
              geoids: ['5501'],
              invalidGeoids: [],
            },
          },
        ],
        summary: {
          totalValidations: 1,
          passed: 1,
          failed: 0,
          successRate: 1.0,
        },
        validatedAt: new Date('2025-01-15T12:00:00Z'),
        totalDurationMs: 1500,
      };

      const testDir = '.shadow-atlas/test-reports';
      const csvFile = `${testDir}/test-report-${Date.now()}.csv`;

      await validator.saveReport(multiStateResult, csvFile, 'csv');

      const { readFile } = await import('node:fs/promises');
      const content = await readFile(csvFile, 'utf-8');

      expect(content).toContain('State,State Name,Layer,Expected,Actual,Match,GEOID Valid,Geometry Valid,Duration (ms),Issues');
      expect(content).toContain('WI,Wisconsin,congressional,8,8,TRUE,TRUE,TRUE,1500,None');

      // Cleanup
      const { unlink } = await import('node:fs/promises');
      await unlink(csvFile);
    });
  });
});
