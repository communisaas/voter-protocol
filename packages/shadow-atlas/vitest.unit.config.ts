/**
 * Vitest Configuration for Unit Tests
 *
 * SCOPE: Fast unit tests with all external dependencies mocked
 *
 * TARGET: < 5 seconds total execution time
 *
 * USAGE: npm run test:unit
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns - unit tests only
    include: [
      'src/**/*.test.ts',
      'src/__tests__/unit/**/*.test.ts',
    ],

    // Exclude integration and E2E tests
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/__tests__/integration/**',
      'src/__tests__/e2e/**',
      'src/__tests__/performance/**',
      // Exclude files with "integration" or "e2e" in name
      '**/*.integration.test.ts',
      '**/*.e2e.test.ts',
    ],

    // Global setup
    setupFiles: ['src/__tests__/setup.ts'],

    // Test execution
    threads: false, // Single-threaded for deterministic behavior
    isolate: true, // Isolate each test file

    // Timeouts (short for unit tests)
    testTimeout: 5_000, // 5 seconds max per test
    hookTimeout: 5_000, // 5 seconds for hooks

    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/scripts/**',
        'src/**/*.types.ts',
      ],
      // Strict coverage thresholds for unit tests
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },

    // Reporter
    reporter: process.env.CI ? ['dot', 'json', 'junit'] : ['verbose'],
    outputFile: {
      json: './test-results/unit-results.json',
      junit: './test-results/unit-results.xml',
    },

    // Globals
    globals: true,

    // Environment
    environment: 'node',

    // Retry flaky tests (unit tests should NOT be flaky)
    retry: 0, // No retries for unit tests - they must be deterministic
  },
});
