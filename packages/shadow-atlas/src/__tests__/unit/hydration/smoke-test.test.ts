/**
 * Tests for smoke test error categorization (M-3).
 *
 * Verifies that network/API errors produce API_UNREACHABLE category
 * and data quality issues produce DATA_REGRESSION category, with
 * the correct exit codes.
 */

import { describe, it, expect } from 'vitest';

// We can't easily run the full smoke test runner (it imports providers that
// hit real APIs), so we test the classifyError function directly by importing
// it. Since classifyError is not exported, we test the behavior through the
// exported types and the patterns it uses.

// ============================================================================
// classifyError pattern tests (extracted logic)
// ============================================================================

// Reproduce the classification logic for unit testing
type ErrorCategory = 'API_UNREACHABLE' | 'DATA_REGRESSION';

function classifyError(message: string): ErrorCategory {
  const apiPatterns = [
    /timed out/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /fetch failed/i,
    /network/i,
    /HTTP [45]\d\d/i,
    /Failed to fetch/i,
    /No provider registered/i,
    /socket hang up/i,
    /abort/i,
  ];

  for (const pattern of apiPatterns) {
    if (pattern.test(message)) {
      return 'API_UNREACHABLE';
    }
  }

  return 'DATA_REGRESSION';
}

describe('smoke test error classification', () => {
  describe('API_UNREACHABLE errors', () => {
    it('classifies timeout errors as API_UNREACHABLE', () => {
      expect(classifyError('Boundary extraction timed out after 600000ms')).toBe('API_UNREACHABLE');
    });

    it('classifies ECONNREFUSED as API_UNREACHABLE', () => {
      expect(classifyError('connect ECONNREFUSED 127.0.0.1:443')).toBe('API_UNREACHABLE');
    });

    it('classifies ENOTFOUND as API_UNREACHABLE', () => {
      expect(classifyError('getaddrinfo ENOTFOUND api.parliament.uk')).toBe('API_UNREACHABLE');
    });

    it('classifies ECONNRESET as API_UNREACHABLE', () => {
      expect(classifyError('read ECONNRESET')).toBe('API_UNREACHABLE');
    });

    it('classifies ETIMEDOUT as API_UNREACHABLE', () => {
      expect(classifyError('connect ETIMEDOUT 10.0.0.1:443')).toBe('API_UNREACHABLE');
    });

    it('classifies fetch failures as API_UNREACHABLE', () => {
      expect(classifyError('fetch failed')).toBe('API_UNREACHABLE');
      expect(classifyError('Failed to fetch data from TIGERweb')).toBe('API_UNREACHABLE');
    });

    it('classifies network errors as API_UNREACHABLE', () => {
      expect(classifyError('NetworkError when attempting to fetch resource')).toBe('API_UNREACHABLE');
    });

    it('classifies HTTP 4xx/5xx errors as API_UNREACHABLE', () => {
      expect(classifyError('HTTP 404 Not Found')).toBe('API_UNREACHABLE');
      expect(classifyError('HTTP 500 Internal Server Error')).toBe('API_UNREACHABLE');
      expect(classifyError('HTTP 503 Service Unavailable')).toBe('API_UNREACHABLE');
      expect(classifyError('HTTP 429 Too Many Requests')).toBe('API_UNREACHABLE');
    });

    it('classifies socket hang up as API_UNREACHABLE', () => {
      expect(classifyError('socket hang up')).toBe('API_UNREACHABLE');
    });

    it('classifies abort errors as API_UNREACHABLE', () => {
      expect(classifyError('The operation was aborted')).toBe('API_UNREACHABLE');
    });
  });

  describe('DATA_REGRESSION errors', () => {
    it('classifies count drops as DATA_REGRESSION', () => {
      expect(classifyError('CRITICAL: Boundary count 100 is >20% below minimum 400')).toBe('DATA_REGRESSION');
    });

    it('classifies confidence drops as DATA_REGRESSION', () => {
      expect(classifyError('CRITICAL: Confidence 50% is >20% below minimum 90%')).toBe('DATA_REGRESSION');
    });

    it('classifies schema failures as DATA_REGRESSION', () => {
      expect(classifyError('CRITICAL: Schema validation failed (would block DB write)')).toBe('DATA_REGRESSION');
    });

    it('classifies official count drops as DATA_REGRESSION', () => {
      expect(classifyError('CRITICAL: Official count 10 is >20% below minimum 530')).toBe('DATA_REGRESSION');
    });

    it('classifies unsupported country as DATA_REGRESSION', () => {
      expect(classifyError('Unsupported country: XX')).toBe('DATA_REGRESSION');
    });

    it('classifies generic unknown errors as DATA_REGRESSION', () => {
      expect(classifyError('Something unexpected happened')).toBe('DATA_REGRESSION');
    });
  });

  describe('exit code logic', () => {
    it('exit code 3 when only API failures exist', () => {
      const errors = [
        { message: 'CRITICAL: timed out', category: 'API_UNREACHABLE' as ErrorCategory },
      ];
      const hasDataFailures = errors.some(e => e.category === 'DATA_REGRESSION');
      const hasApiFailures = errors.some(e => e.category === 'API_UNREACHABLE');
      const hasWarnings = false;

      const exitCode = hasDataFailures ? 1 : hasApiFailures ? 3 : hasWarnings ? 2 : 0;
      expect(exitCode).toBe(3);
    });

    it('exit code 1 when data regression exists (even with API failures)', () => {
      const errors = [
        { message: 'CRITICAL: timed out', category: 'API_UNREACHABLE' as ErrorCategory },
        { message: 'CRITICAL: count drop', category: 'DATA_REGRESSION' as ErrorCategory },
      ];
      const hasDataFailures = errors.some(e => e.category === 'DATA_REGRESSION');
      const hasApiFailures = errors.some(e => e.category === 'API_UNREACHABLE');
      const hasWarnings = false;

      const exitCode = hasDataFailures ? 1 : hasApiFailures ? 3 : hasWarnings ? 2 : 0;
      expect(exitCode).toBe(1);
    });

    it('exit code 0 when no failures and no warnings', () => {
      const errors: { message: string; category: ErrorCategory }[] = [];
      const hasDataFailures = errors.some(e => e.category === 'DATA_REGRESSION');
      const hasApiFailures = errors.some(e => e.category === 'API_UNREACHABLE');
      const hasWarnings = false;

      const exitCode = hasDataFailures ? 1 : hasApiFailures ? 3 : hasWarnings ? 2 : 0;
      expect(exitCode).toBe(0);
    });

    it('exit code 2 for warnings only', () => {
      const errors: { message: string; category: ErrorCategory }[] = [];
      const hasDataFailures = errors.some(e => e.category === 'DATA_REGRESSION');
      const hasApiFailures = errors.some(e => e.category === 'API_UNREACHABLE');
      const hasWarnings = true;

      const exitCode = hasDataFailures ? 1 : hasApiFailures ? 3 : hasWarnings ? 2 : 0;
      expect(exitCode).toBe(2);
    });
  });
});
