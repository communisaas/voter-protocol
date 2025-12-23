/**
 * Vitest Configuration for Integration Tests
 *
 * SCOPE: Integration tests with conditional real API calls
 *
 * TARGET: < 5 minutes total execution time
 *
 * USAGE: RUN_INTEGRATION=true npm run test:integration
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns - integration tests only
    include: [
      'src/__tests__/integration/**/*.test.ts',
      'src/**/*.integration.test.ts',
    ],

    // Exclude unit and E2E tests
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/unit/**',
      'src/__tests__/e2e/**',
      'src/__tests__/performance/**',
    ],

    // Global setup
    setupFiles: ['src/__tests__/setup.ts'],

    // Test execution
    threads: false, // Single-threaded to avoid rate limiting issues
    isolate: true,
    sequence: {
      shuffle: false, // Run in order to respect rate limiting
    },

    // Timeouts (generous for real API calls)
    testTimeout: 30_000, // 30 seconds per test
    hookTimeout: 10_000, // 10 seconds for hooks

    // Coverage (integration tests cover integration paths)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/providers/**/*.ts',
        'src/services/**/*.ts',
        'src/scanners/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/scripts/**',
      ],
    },

    // Reporter
    reporter: process.env.CI ? ['dot', 'json', 'junit'] : ['verbose'],
    outputFile: {
      json: './test-results/integration-results.json',
      junit: './test-results/integration-results.xml',
    },

    // Globals
    globals: true,

    // Environment
    environment: 'node',

    // Retry logic for integration tests (network failures)
    retry: process.env.CI ? 2 : 0, // Retry twice in CI for network flakes
  },
});
