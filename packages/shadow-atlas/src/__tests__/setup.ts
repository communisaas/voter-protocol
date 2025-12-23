/**
 * Global Test Setup for Shadow Atlas
 *
 * SCOPE: Shared configuration and utilities for all Shadow Atlas tests
 *
 * TIER DETECTION:
 * - CI=true: Running in CI environment
 * - RUN_E2E=true: Enable E2E tests (nightly only)
 * - RUN_INTEGRATION=false: Skip integration tests (rarely needed)
 *
 * TYPE SAFETY: Nuclear-level strictness. No `any`, no loose casts.
 */

import { beforeAll, afterAll, expect } from 'vitest';

// ============================================================================
// Custom Matchers
// ============================================================================

/**
 * Custom matcher: toBeOneOf
 * Checks if value is one of the expected values in the array.
 *
 * Usage:
 * ```typescript
 * expect(result.status).toBeOneOf(['committed', 'validation_failed', 'extraction_failed']);
 * ```
 */
expect.extend({
  toBeOneOf<T>(received: T, expected: readonly T[]): { pass: boolean; message: () => string } {
    const pass = expected.includes(received);
    return {
      pass,
      message: () =>
        pass
          ? `expected ${JSON.stringify(received)} not to be one of ${JSON.stringify(expected)}`
          : `expected ${JSON.stringify(received)} to be one of ${JSON.stringify(expected)}`,
    };
  },
});

// ============================================================================
// Environment Detection
// ============================================================================

export const isCI = process.env.CI === 'true';
export const runE2E = process.env.RUN_E2E === 'true';
export const runIntegration = process.env.RUN_INTEGRATION !== 'false';

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/**
 * Rate limit delay for real API calls in integration/E2E tests
 * - Prevents 429 rate limiting from external APIs
 * - Conservative delay: 500ms between requests
 */
export const API_RATE_LIMIT_MS = 500;

/**
 * Request timeout for external API calls
 * - 30 second timeout prevents hanging tests
 */
export const API_TIMEOUT_MS = 30_000;

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Delay execution for rate limiting
 */
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create mock fetch function with predefined responses
 *
 * Usage:
 * ```typescript
 * const mockFetch = createMockFetch(new Map([
 *   ['https://api.example.com/data', { features: [...] }],
 * ]));
 * ```
 */
export function createMockFetch(
  responses: Map<string, unknown>
): (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> {
  return async (url: string) => ({
    ok: true,
    json: async () => responses.get(url) ?? { features: [] },
  });
}

/**
 * Retry function with exponential backoff
 *
 * @param fn - Function to retry
 * @param maxRetries - Maximum retry attempts
 * @param initialDelay - Initial delay in milliseconds
 * @returns Result of function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 500
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delayMs = initialDelay * Math.pow(2, attempt - 1);
        await delay(delayMs);
      }
    }
  }

  throw lastError ?? new Error('Retry failed');
}

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeAll(() => {
  if (isCI) {
    console.log('========================================');
    console.log('Running in CI environment');
    console.log(`E2E tests: ${runE2E ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Integration tests: ${runIntegration ? 'ENABLED' : 'DISABLED'}`);
    console.log('========================================');
  }
});

afterAll(() => {
  // Cleanup if needed
});
