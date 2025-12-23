/**
 * Vitest Configuration for E2E Tests
 *
 * SCOPE: End-to-end tests with real API calls and complete workflows
 *
 * TARGET: < 30 minutes total execution time
 *
 * USAGE: RUN_E2E=true npm run test:e2e
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns - E2E tests only
    include: [
      'src/__tests__/e2e/**/*.test.ts',
      'src/**/*.e2e.test.ts',
    ],

    // Exclude unit and integration tests
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/unit/**',
      'src/__tests__/integration/**',
      'src/__tests__/performance/**',
    ],

    // Global setup
    setupFiles: ['src/__tests__/setup.ts'],

    // Test execution
    threads: false, // Single-threaded for rate limiting
    isolate: true,
    sequence: {
      shuffle: false, // Run in order to respect rate limiting
    },

    // Timeouts (very generous for complete workflows)
    testTimeout: 120_000, // 120 seconds (2 minutes) per test
    hookTimeout: 30_000, // 30 seconds for hooks

    // Coverage (E2E tests validate integration, not coverage)
    coverage: {
      enabled: false, // E2E tests don't need coverage metrics
    },

    // Reporter
    reporter: process.env.CI ? ['dot', 'json', 'junit'] : ['verbose'],
    outputFile: {
      json: './test-results/e2e-results.json',
      junit: './test-results/e2e-results.xml',
    },

    // Globals
    globals: true,

    // Environment
    environment: 'node',

    // Retry logic for E2E tests (network failures are common)
    retry: process.env.CI ? 3 : 1, // Retry 3 times in CI, once locally
  },
});
